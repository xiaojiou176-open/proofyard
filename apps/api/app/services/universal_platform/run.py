from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

from fastapi import HTTPException, status

from apps.api.app.models.template import OtpPolicy
from apps.api.app.models.run import RunLogEntry, RunRecord, RunStatus, RunWaitContext
from apps.api.app.services.automation_service import automation_service
from apps.api.app.services.otp_providers import OtpFetchRequest, resolve_otp_code as fetch_otp_code


def list_runs(service: Any, limit: int = 100, requester: str | None = None) -> list[RunRecord]:
    items = [RunRecord.model_validate(item) for item in service._read_json(service._runs_path)]
    for item in items:
        service._sync_run_status(item)
    if requester:
        items = [item for item in items if service._run_owner(item) == requester]
    items.sort(key=lambda item: item.updated_at, reverse=True)
    return items[: max(1, min(limit, 500))]


def get_run(service: Any, run_id: str, requester: str | None = None) -> RunRecord:
    for item in service.list_runs(limit=500, requester=requester):
        if item.run_id == run_id:
            return item
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")


def create_run(
    service: Any,
    template_id: str,
    params: dict[str, str],
    actor: str | None = None,
    otp_code: str | None = None,
) -> RunRecord:
    template = service.get_template(template_id, requester=actor)
    flow = service.get_flow(template.flow_id, requester=actor)
    service._ensure_allowed_param_keys(template.params_schema, params, source="run params")
    merged_params = {**template.defaults, **params}
    service._validate_params(template, merged_params, template.policies.otp)
    now = datetime.now(UTC)
    run = RunRecord(
        run_id=f"rn_{uuid4().hex}",
        template_id=template_id,
        status="queued",
        params=service._public_params(template, merged_params),
        correlation_id=f"corr_{uuid4().hex}",
        created_at=now,
        updated_at=now,
    )
    service._cache_validated_params_snapshot(run.run_id, merged_params)

    otp_code_resolved = service._resolve_otp_code(template.policies.otp, otp_code)
    if template.policies.otp.required and not otp_code_resolved:
        run.status = "waiting_otp"
        run.logs.append(
            RunLogEntry(
                ts=datetime.now(UTC),
                level="warn",
                message=f"waiting OTP from provider {template.policies.otp.provider}",
            )
        )
        service._upsert_run(run)
        service._audit("run.waiting_otp", actor, {"run_id": run.run_id, "template_id": template_id})
        return run

    materialize_replay_bridge(service, flow)
    env = service._build_env(flow.start_url, merged_params, otp_code_resolved)
    env["FLOW_SESSION_ID"] = flow.session_id
    if run.correlation_id:
        env["UIQ_RUN_CORRELATION_ID"] = run.correlation_id
    env["UIQ_LINKED_RUN_ID"] = run.run_id
    task = automation_service.run_command(
        "automation-replay-flow",
        env,
        requested_by=actor,
    )
    run.status = service._map_task_status(task.status)
    run.task_id = task.task_id
    if run.correlation_id:
        run.artifacts_ref["correlation_id"] = run.correlation_id
    run.artifacts_ref["linked_task_id"] = task.task_id
    run.logs.append(
        RunLogEntry(
            ts=datetime.now(UTC), level="info", message=f"submitted automation task {task.task_id}"
        )
    )
    service._upsert_run(run)
    service._audit(
        "run.create",
        actor,
        {"run_id": run.run_id, "template_id": template_id, "task_id": task.task_id},
    )
    return run


def cancel_run(service: Any, run_id: str, actor: str | None = None) -> RunRecord:
    run = service.get_run(run_id, requester=actor)
    if run.task_id:
        try:
            automation_service.cancel_task(run.task_id, requested_by=actor)
        except HTTPException as exc:
            if exc.status_code != status.HTTP_404_NOT_FOUND:
                raise
            run.logs.append(
                RunLogEntry(
                    ts=datetime.now(UTC),
                    level="warn",
                    message="linked task not found during cancel",
                )
            )
    run.status = "cancelled"
    run.updated_at = datetime.now(UTC)
    run.logs.append(RunLogEntry(ts=datetime.now(UTC), level="warn", message="cancelled by user"))
    service._upsert_run(run)
    service._audit("run.cancel", actor, {"run_id": run_id})
    return run


def sync_run_status(service: Any, run: RunRecord) -> None:
    if not run.task_id:
        return
    try:
        task = automation_service.get_task(run.task_id)
    except HTTPException:
        return
    progress_cursor, progress_logs, wait_context = extract_progress(
        task.output_tail, redact_text=service._redact_text
    )
    if progress_cursor > run.step_cursor:
        run.step_cursor = progress_cursor
        run.updated_at = datetime.now(UTC)
    if progress_logs:
        append_unique_logs(run, progress_logs)
    if wait_context is not None:
        run.wait_context = wait_context
        run.status = "waiting_user"
        run.task_id = None
        run.updated_at = datetime.now(UTC)
        wait_reason = wait_context.reason_code or "manual_gate"
        run.logs.append(
            RunLogEntry(
                ts=datetime.now(UTC),
                level="warn",
                message=f"run paused for manual gate: {wait_reason}",
            )
        )
        service._upsert_run(run)
        return
    if run.wait_context is not None:
        run.wait_context = None
        run.updated_at = datetime.now(UTC)
    mapped = map_task_status(task.status)
    next_correlation_id = getattr(task, "correlation_id", None) or run.correlation_id
    if next_correlation_id and next_correlation_id != run.correlation_id:
        run.correlation_id = next_correlation_id
        run.artifacts_ref["correlation_id"] = next_correlation_id
        run.updated_at = datetime.now(UTC)
    task_id = getattr(task, "task_id", None)
    if task_id and run.artifacts_ref.get("linked_task_id") != task_id:
        run.artifacts_ref["linked_task_id"] = task_id
        run.updated_at = datetime.now(UTC)
    if mapped != run.status:
        run.status = mapped
        run.updated_at = datetime.now(UTC)
        run.logs.append(
            RunLogEntry(ts=datetime.now(UTC), level="info", message=f"status synced to {mapped}")
        )
        service._upsert_run(run)
        return
    if progress_cursor > 0 or progress_logs:
        service._upsert_run(run)


def map_task_status(task_status: str) -> RunStatus:
    if task_status in {"queued", "running", "success", "failed", "cancelled"}:
        return task_status  # type: ignore[return-value]
    return "failed"


def resolve_otp_code(otp: OtpPolicy, manual_code: str | None) -> str | None:
    if not otp.required:
        return None
    return fetch_otp_code(
        OtpFetchRequest(
            provider=otp.provider,
            regex=otp.regex,
            sender_filter=otp.sender_filter,
            subject_filter=otp.subject_filter,
            manual_code=manual_code,
        )
    )


def build_env(
    start_url: str,
    params: dict[str, str],
    otp_code: str | None,
    *,
    stripe_param_keys: tuple[str, ...],
    is_secret_param_key: Callable[[str], bool],
) -> dict[str, str]:
    env: dict[str, str] = {"START_URL": start_url}
    input_map: dict[str, str] = {}
    secret_map: dict[str, str] = {}
    for key, value in params.items():
        if is_secret_param_key(key):
            secret_map[key] = value
        else:
            input_map[key] = value
        if key in stripe_param_keys:
            env[key] = value
            continue
        if key.lower().endswith("password"):
            env["FLOW_SECRET_INPUT"] = value
        elif key.lower().endswith("otp"):
            env["FLOW_OTP_CODE"] = value
        else:
            env["FLOW_INPUT"] = value
    if input_map:
        env["FLOW_INPUT_JSON"] = json.dumps(input_map, ensure_ascii=False)
    if secret_map:
        env["FLOW_SECRET_INPUT_JSON"] = json.dumps(secret_map, ensure_ascii=False)
    if otp_code:
        env["FLOW_OTP_CODE"] = otp_code
    return env


def materialize_replay_bridge(service: Any, flow: Any) -> Path:
    runtime_root = Path(service._runtime_root)
    runtime_root.mkdir(parents=True, exist_ok=True)
    session_dir = runtime_root / flow.session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    flow_path = session_dir / "flow-draft.json"
    flow_payload = {
        "start_url": flow.start_url,
        "source_event_count": flow.source_event_count,
        "steps": [step.model_dump(mode="json") for step in flow.steps],
    }
    flow_path.write_text(
        json.dumps(flow_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return session_dir


def extract_progress(
    output_tail: str,
    *,
    redact_text: Callable[[str], str],
) -> tuple[int, list[RunLogEntry], RunWaitContext | None]:
    trimmed = output_tail.strip()
    if not trimmed:
        return 0, [], None
    cursor = 0
    logs: list[RunLogEntry] = []
    start = trimmed.find("{")
    if start < 0:
        return cursor, logs, None
    candidate = trimmed[start:]
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError:
        return cursor, logs, None

    if isinstance(parsed, dict) and isinstance(parsed.get("stepResults"), list):
        step_results = parsed.get("stepResults", [])
        for step in step_results:
            if not isinstance(step, dict):
                continue
            step_id = str(step.get("step_id") or "")
            action = str(step.get("action") or "")
            ok = bool(step.get("ok"))
            detail = redact_text(str(step.get("detail") or ""))
            if step_id:
                cursor += 1
                logs.append(
                    RunLogEntry(
                        ts=datetime.now(UTC),
                        level="info" if ok else "error",
                        message=f"step {step_id} ({action}) {'ok' if ok else 'failed'}: {detail}",
                    )
                )
    elif isinstance(parsed, dict) and parsed.get("stepId"):
        step_id = str(parsed.get("stepId"))
        action = str(parsed.get("action") or "")
        ok = bool(parsed.get("ok"))
        detail = redact_text(str(parsed.get("detail") or ""))
        cursor = 1
        logs.append(
            RunLogEntry(
                ts=datetime.now(UTC),
                level="info" if ok else "error",
                message=f"step {step_id} ({action}) {'ok' if ok else 'failed'}: {detail}",
            )
        )

    wait_context = extract_wait_context(parsed) if isinstance(parsed, dict) else None
    return cursor, logs, wait_context


def extract_wait_context(payload: dict[str, Any]) -> RunWaitContext | None:
    manual_gate = payload.get("manualGate")
    if not isinstance(manual_gate, dict):
        manual_gate = payload.get("manual_gate")
    if not isinstance(manual_gate, dict):
        return None
    gate_required = coerce_optional_bool(
        manual_gate.get("required"),
        manual_gate.get("manual_gate_required"),
        manual_gate.get("manualGateRequired"),
    )
    context = RunWaitContext(
        reason_code=coerce_optional_text(
            manual_gate.get("reason_code"), manual_gate.get("reasonCode")
        ),
        at_step_id=coerce_optional_text(manual_gate.get("at_step_id"), manual_gate.get("atStepId")),
        after_step_id=coerce_optional_text(
            manual_gate.get("after_step_id"), manual_gate.get("afterStepId")
        ),
        resume_from_step_id=coerce_optional_text(
            manual_gate.get("resume_from_step_id"),
            manual_gate.get("resumeFromStepId"),
        ),
        resume_hint=coerce_optional_text(
            manual_gate.get("resume_hint"), manual_gate.get("resumeHint")
        ),
        provider_domain=coerce_optional_text(
            manual_gate.get("provider_domain"),
            manual_gate.get("providerDomain"),
        ),
        gate_required_by_policy=coerce_optional_bool(
            manual_gate.get("gate_required_by_policy"),
            manual_gate.get("gateRequiredByPolicy"),
        ),
    )
    has_anchor = any(
        value is not None
        for value in (
            context.reason_code,
            context.at_step_id,
            context.after_step_id,
            context.resume_from_step_id,
            context.resume_hint,
        )
    )
    if gate_required is not True and not has_anchor:
        return None
    return context


def resolve_resume_from_step_id(wait_context: RunWaitContext | None) -> str | None:
    if wait_context is None:
        return None
    return wait_context.resume_from_step_id or wait_context.after_step_id or wait_context.at_step_id


def coerce_optional_text(*candidates: Any) -> str | None:
    for candidate in candidates:
        if not isinstance(candidate, str):
            continue
        value = candidate.strip()
        if value:
            return value
    return None


def coerce_optional_bool(*candidates: Any) -> bool | None:
    for candidate in candidates:
        if isinstance(candidate, bool):
            return candidate
        if not isinstance(candidate, str):
            continue
        normalized = candidate.strip().lower()
        if normalized in {"true", "1", "yes"}:
            return True
        if normalized in {"false", "0", "no"}:
            return False
    return None


def append_unique_logs(run: RunRecord, entries: list[RunLogEntry]) -> None:
    existing = {entry.message for entry in run.logs}
    for entry in entries:
        if entry.message in existing:
            continue
        run.logs.append(entry)
        existing.add(entry.message)
