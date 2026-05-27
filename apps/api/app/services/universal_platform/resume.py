from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException, status

from apps.api.app.models.run import RunLogEntry, RunRecord, RunStatus
from apps.api.app.services.automation_service import automation_service


def submit_otp_and_resume(
    service: Any, run_id: str, otp_code: str | None, actor: str | None = None
) -> RunRecord:
    otp_value = (otp_code or "").strip()
    claimed_run, previous_status = claim_run_for_resume(service, run_id, actor, otp_value)
    try:
        template = service.get_template(claimed_run.template_id, requester=actor)
        flow = service.get_flow(template.flow_id, requester=actor)
        params = service._get_validated_params_snapshot(run_id)
        service._validate_params(template, params, template.policies.otp)
        service._materialize_replay_bridge(flow)
        env = service._build_env(flow.start_url, params, otp_value)
        env["FLOW_SESSION_ID"] = flow.session_id
        if previous_status == "waiting_user":
            resume_from_step_id = service._resolve_resume_from_step_id(claimed_run.wait_context)
            if resume_from_step_id:
                env["FLOW_FROM_STEP_ID"] = resume_from_step_id
            env["FLOW_RESUME_CONTEXT"] = "true"
        if claimed_run.correlation_id:
            env["UIQ_RUN_CORRELATION_ID"] = claimed_run.correlation_id
        env["UIQ_LINKED_RUN_ID"] = claimed_run.run_id
        task = automation_service.run_command(
            "automation-replay-flow",
            env,
            requested_by=actor,
        )
    except Exception as exc:
        mark_run_resume_failed(service, run_id, f"otp resume submit failed: {exc}")
        service._audit("run.resume_otp_failed", actor, {"run_id": run_id, "error": str(exc)})
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to submit otp resume run",
        ) from exc

    with service._lock:
        run = service._load_run_locked(run_id)
        if run is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
        run.status = service._map_task_status(task.status)
        run.task_id = task.task_id
        task_correlation_id = getattr(task, "correlation_id", None)
        if task_correlation_id:
            run.correlation_id = task_correlation_id
        run.artifacts_ref["linked_task_id"] = task.task_id
        if run.correlation_id:
            run.artifacts_ref["correlation_id"] = run.correlation_id
        run.wait_context = None
        run.updated_at = datetime.now(UTC)
        resume_message = (
            f"otp accepted and resumed with task {task.task_id}"
            if previous_status == "waiting_otp"
            else f"manual gate resolved and resumed with task {task.task_id}"
        )
        run.logs.append(RunLogEntry(ts=datetime.now(UTC), level="info", message=resume_message))
        service._save_run_locked(run)

    audit_action = "run.resume_otp" if previous_status == "waiting_otp" else "run.resume_user"
    service._audit(audit_action, actor, {"run_id": run_id, "task_id": task.task_id})
    return run


def claim_run_for_resume(
    service: Any, run_id: str, actor: str | None, otp_value: str
) -> tuple[RunRecord, RunStatus]:
    service.get_run(run_id, requester=actor)
    with service._lock:
        current = service._load_run_locked(run_id)
        if current is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
        previous_status = current.status
        if previous_status not in {"waiting_otp", "waiting_user"}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="run is not waiting for user input"
            )
        if previous_status == "waiting_otp" and not otp_value:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="otp_code is required"
            )
        current.status = "queued"
        current.updated_at = datetime.now(UTC)
        claim_message = "otp resume claimed; scheduling run"
        if previous_status == "waiting_user":
            claim_message = "manual gate resume claimed; scheduling run"
        current.logs.append(RunLogEntry(ts=datetime.now(UTC), level="info", message=claim_message))
        service._save_run_locked(current)
        return current, previous_status


def mark_run_resume_failed(service: Any, run_id: str, message: str) -> RunRecord:
    with service._lock:
        run = service._load_run_locked(run_id)
        if run is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
        run.status = "failed"
        run.updated_at = datetime.now(UTC)
        run.logs.append(
            RunLogEntry(ts=datetime.now(UTC), level="error", message=service._redact_text(message))
        )
        service._save_run_locked(run)
        return run
