from __future__ import annotations

import json
import base64
import os
import re
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

from fastapi import APIRouter, Depends
from fastapi import HTTPException
from fastapi import Query
from fastapi import status

from apps.api.app.api.dependencies.security import (
    AutomationSecurityContext,
    require_automation_access,
)
from apps.api.app.api.health import build_alerts_payload, build_diagnostics_payload
from apps.api.app.models.automation import (
    EvidenceTimelineItemResponse,
    EvidenceTimelineResponse,
    FlowDraftDocumentResponse,
    FlowDraftDocumentUpdateRequest,
    FlowPreviewResponse,
    FlowPreviewStep,
    OrchestrateFromArtifactsRequest,
    OrchestrateFromArtifactsResponse,
    ReplayFromStepRequest,
    ReplayLatestStepRequest,
    StepEvidenceResponse,
    RunCommandResponse,
)
from apps.api.app.services.automation_service import automation_service
from apps.api.app.services.universal_platform_service import universal_platform_service

router = APIRouter(prefix="/api/command-tower", tags=["command-tower"])
_RUNTIME_AUTOMATION_ROOT = (
    Path(__file__).resolve().parents[4] / ".runtime-cache" / "automation"
).resolve()
_SAFE_RUNTIME_PART_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


@router.get("/overview")
def overview(
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> dict[str, object]:
    return {
        "status": "ok",
        "diagnostics": build_diagnostics_payload(),
        "alerts": build_alerts_payload(),
        "latest_flow": latest_flow_preview(security.actor),
    }


@router.get("/latest-flow", response_model=FlowPreviewResponse)
def latest_flow(
    security: AutomationSecurityContext = Depends(require_automation_access),
    session_id: str | None = Query(default=None),
) -> FlowPreviewResponse:
    return latest_flow_preview(security.actor, session_id=session_id)


@router.get("/latest-flow-draft", response_model=FlowDraftDocumentResponse)
def latest_flow_draft(
    security: AutomationSecurityContext = Depends(require_automation_access),
    session_id: str | None = Query(default=None),
) -> FlowDraftDocumentResponse:
    loaded = load_latest_flow_draft(security.actor, session_id=session_id)
    if loaded is None:
        return FlowDraftDocumentResponse()
    session_id, _, flow = loaded
    return FlowDraftDocumentResponse(session_id=session_id, flow=flow)


@router.patch("/latest-flow-draft", response_model=FlowDraftDocumentResponse)
def update_latest_flow_draft(
    payload: FlowDraftDocumentUpdateRequest,
    security: AutomationSecurityContext = Depends(require_automation_access),
    session_id: str | None = Query(default=None),
) -> FlowDraftDocumentResponse:
    loaded = load_latest_flow_draft(security.actor, session_id=session_id)
    if loaded is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="latest flow draft not found"
        )
    session_id, flow_draft_path, current = loaded

    updated = normalize_flow_draft_update(payload.flow, current)
    flow_draft_path.write_text(json.dumps(updated, ensure_ascii=False, indent=2), encoding="utf-8")
    return FlowDraftDocumentResponse(session_id=session_id, flow=updated)


@router.post("/replay-latest", response_model=RunCommandResponse)
def replay_latest_flow(
    security: AutomationSecurityContext = Depends(require_automation_access),
    session_id: str | None = Query(default=None),
) -> RunCommandResponse:
    loaded = load_latest_flow_draft(security.actor, session_id=session_id)
    if loaded is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="latest flow draft not found"
        )
    _, _, flow = loaded
    env: dict[str, str] = {}
    start_url = flow.get("start_url")
    if isinstance(start_url, str) and start_url.strip():
        env["START_URL"] = start_url.strip()
    task = automation_service.run_command(
        "automation-replay-flow",
        env,
        requested_by=security.actor,
    )
    return RunCommandResponse(task=task)


@router.post("/orchestrate-from-artifacts", response_model=OrchestrateFromArtifactsResponse)
def orchestrate_from_artifacts(
    payload: OrchestrateFromArtifactsRequest,
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> OrchestrateFromArtifactsResponse:
    return universal_platform_service.create_template_from_artifacts(
        payload,
        actor=security.actor,
    )


@router.post("/replay-latest-from-step", response_model=RunCommandResponse)
def replay_latest_flow_from_step(
    payload: ReplayFromStepRequest,
    security: AutomationSecurityContext = Depends(require_automation_access),
    session_id: str | None = Query(default=None),
) -> RunCommandResponse:
    loaded = load_latest_flow_draft(security.actor, session_id=session_id)
    if loaded is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="latest flow draft not found"
        )
    _, _, flow = loaded
    step_id = payload.step_id.strip()
    if not step_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="step_id is required"
        )
    exists = any(
        isinstance(item, dict) and item.get("step_id") == step_id for item in flow.get("steps", [])
    )
    if not exists:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="step not found in latest flow draft"
        )

    env: dict[str, str] = {"FLOW_FROM_STEP_ID": step_id}
    if payload.replay_preconditions:
        env["FLOW_REPLAY_PRECONDITIONS"] = "true"
    start_url = flow.get("start_url")
    if isinstance(start_url, str) and start_url.strip():
        env["START_URL"] = start_url.strip()
    task = automation_service.run_command(
        "automation-replay-flow",
        env,
        requested_by=security.actor,
    )
    return RunCommandResponse(task=task)


@router.post("/replay-latest-step", response_model=RunCommandResponse)
def replay_latest_flow_step(
    payload: ReplayLatestStepRequest,
    security: AutomationSecurityContext = Depends(require_automation_access),
    session_id: str | None = Query(default=None),
) -> RunCommandResponse:
    loaded = load_latest_flow_draft(security.actor, session_id=session_id)
    if loaded is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="latest flow draft not found"
        )
    _, _, flow = loaded
    step_id = payload.step_id.strip()
    if not step_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="step_id is required"
        )
    target_step = next(
        (
            item
            for item in flow.get("steps", [])
            if isinstance(item, dict) and item.get("step_id") == step_id
        ),
        None,
    )
    if target_step is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="step not found in latest flow draft"
        )

    env: dict[str, str] = {"FLOW_STEP_ID": step_id}
    start_url = flow.get("start_url")
    if isinstance(start_url, str) and start_url.strip():
        env["START_URL"] = start_url.strip()

    selector_index = (
        target_step.get("selected_selector_index") if isinstance(target_step, dict) else None
    )
    selector_index_value = _to_safe_int(selector_index)
    if selector_index_value is not None:
        env["FLOW_SELECTOR_INDEX"] = str(max(0, selector_index_value))

    task = automation_service.run_command(
        "automation-replay-flow-step",
        env,
        requested_by=security.actor,
    )
    return RunCommandResponse(task=task)


@router.get("/evidence", response_model=StepEvidenceResponse)
def step_evidence(
    step_id: str,
    security: AutomationSecurityContext = Depends(require_automation_access),
    session_id: str | None = Query(default=None),
) -> StepEvidenceResponse:
    step_key = step_id.strip()
    if not step_key:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="step_id is required"
        )
    session = resolve_session_for_requester(security.actor, session_id=session_id)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="latest session not found"
        )
    _, session_dir = session
    merged = merge_step_evidence(session_dir, step_key)
    if merged is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="step evidence not found")
    return merged


@router.get("/evidence-timeline", response_model=EvidenceTimelineResponse)
def evidence_timeline(
    security: AutomationSecurityContext = Depends(require_automation_access),
    session_id: str | None = Query(default=None),
) -> EvidenceTimelineResponse:
    session = resolve_session_for_requester(security.actor, session_id=session_id)
    if session is None:
        return EvidenceTimelineResponse()
    _, session_dir = session
    items = read_timeline_items(session_dir)
    return EvidenceTimelineResponse(items=items)


def resolve_session_for_requester(
    requester: str, session_id: str | None = None
) -> tuple[str, Path] | None:
    if session_id is not None and not session_id.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="session_id is required when provided",
        )
    if session_id is not None:
        normalized_session_id = session_id.strip()
        session = universal_platform_service.get_session(normalized_session_id, requester=requester)
        session_dir_path = _validated_session_dir(runtime_root(), normalized_session_id)
        if session_dir_path is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="session directory not found"
            )
        return session.session_id, session_dir_path

    sessions = universal_platform_service.list_sessions(limit=1, requester=requester)
    if not sessions:
        return None
    latest_owned = sessions[0]
    session_dir_path = _validated_session_dir(runtime_root(), latest_owned.session_id)
    if session_dir_path is None:
        return None
    return latest_owned.session_id, session_dir_path


def runtime_root() -> Path:
    runtime_override = os.getenv("UNIVERSAL_AUTOMATION_RUNTIME_DIR", "").strip()
    if runtime_override:
        return Path(runtime_override).resolve()
    return _RUNTIME_AUTOMATION_ROOT


def _sanitize_runtime_relative_path(raw_path: str) -> Path | None:
    value = raw_path.strip().replace("\\", "/")
    if not value:
        return None

    parts = []
    for part in PurePosixPath(value).parts:
        if part in {"", ".", "/"}:
            continue
        if part == "..":
            return None
        if not _SAFE_RUNTIME_PART_RE.fullmatch(part):
            return None
        parts.append(part)

    if not parts:
        return None
    return Path(*parts)


def _sanitize_path_under_root(root: Path, raw_path: str) -> Path | None:
    value = raw_path.strip().replace("\\", "/")
    if not value:
        return None

    root_prefix = root.resolve().as_posix().rstrip("/")
    if value == root_prefix:
        return None
    if value.startswith(f"{root_prefix}/"):
        value = value[len(root_prefix) + 1 :]
    elif value.startswith("/"):
        return None

    return _sanitize_runtime_relative_path(value)


def resolve_latest_session() -> tuple[str, Path] | None:
    latest_path = runtime_root() / "latest-session.json"
    if not latest_path.exists():
        return None
    try:
        payload = json.loads(latest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    session_id = payload.get("sessionId")
    session_dir = payload.get("sessionDir")
    if not isinstance(session_id, str) or not session_id.strip():
        return None
    if not isinstance(session_dir, str) or not session_dir.strip():
        return None
    validated = _validated_session_dir(runtime_root(), session_dir)
    if validated is None:
        return None
    return session_id.strip(), validated


def _to_safe_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _validated_session_dir(runtime_root: Path, session_dir_raw: str) -> Path | None:
    relative_path = _sanitize_path_under_root(runtime_root, session_dir_raw)
    if relative_path is None:
        return None
    if len(relative_path.parts) != 1:
        return None

    try:
        raw_session_dir = runtime_root / relative_path
        if raw_session_dir.is_symlink():
            return None
        session_dir = raw_session_dir.resolve()
        resolved = session_dir.resolve()
    except OSError:
        return None
    if resolved != session_dir:
        return None
    if not resolved.is_dir():
        return None
    try:
        resolved.relative_to(runtime_root)
    except ValueError:
        return None
    return resolved


def load_latest_flow_draft(
    requester: str | None = None, session_id: str | None = None
) -> tuple[str, Path, dict[str, Any]] | None:
    if requester is None:
        latest = resolve_latest_session()
        if latest is None:
            return None
        session_id, session_dir = latest
        flow_draft_path = session_dir / "flow-draft.json"
        if not flow_draft_path.exists():
            return None
        try:
            flow = json.loads(flow_draft_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return None
        if not isinstance(flow, dict):
            return None
        return session_id, flow_draft_path, flow

    session = resolve_session_for_requester(requester, session_id=session_id)
    if session is None:
        return None
    session_id, session_dir = session
    flow_draft_path = session_dir / "flow-draft.json"
    if not flow_draft_path.exists():
        return None
    try:
        flow = json.loads(flow_draft_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    if not isinstance(flow, dict):
        return None
    return session_id, flow_draft_path, flow


def normalize_flow_draft_update(updated: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    start_url = updated.get("start_url", current.get("start_url"))
    steps = updated.get("steps")
    if not isinstance(start_url, str) or not start_url.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="start_url is required"
        )
    if not isinstance(steps, list):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="steps must be a list"
        )
    sanitized_steps: list[dict[str, Any]] = []
    for index, step in enumerate(steps, start=1):
        if not isinstance(step, dict):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"step #{index} must be object",
            )
        action = step.get("action")
        if not isinstance(action, str) or not action.strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"step #{index} action is required",
            )
        step_id = step.get("step_id")
        if not isinstance(step_id, str) or not step_id.strip():
            step = {**step, "step_id": f"s{index}"}
        sanitized_steps.append(step)

    return {
        **current,
        **updated,
        "start_url": start_url.strip(),
        "steps": sanitized_steps,
        "generated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }


def latest_flow_preview(requester: str, session_id: str | None = None) -> FlowPreviewResponse:
    loaded = load_latest_flow_draft(requester, session_id=session_id)
    if loaded is None:
        return FlowPreviewResponse()
    session_id, _, flow = loaded

    steps: list[FlowPreviewStep] = []
    for raw in flow.get("steps", [])[:30]:
        selector = None
        target = raw.get("target")
        if isinstance(target, dict):
            selectors = target.get("selectors")
            if isinstance(selectors, list) and selectors:
                first = selectors[0]
                if isinstance(first, dict):
                    selector = str(first.get("value") or "")
        steps.append(
            FlowPreviewStep(
                step_id=str(raw.get("step_id", "")),
                action=str(raw.get("action", "")),
                url=str(raw.get("url")) if raw.get("url") else None,
                value_ref=str(raw.get("value_ref")) if raw.get("value_ref") else None,
                selector=selector,
            )
        )

    generated_at_raw = flow.get("generated_at")
    generated_at = None
    if isinstance(generated_at_raw, str):
        try:
            generated_at = datetime.fromisoformat(generated_at_raw.replace("Z", "+00:00"))
        except ValueError:
            generated_at = None

    return FlowPreviewResponse(
        session_id=session_id,
        start_url=flow.get("start_url"),
        generated_at=generated_at,
        source_event_count=_to_safe_int(flow.get("source_event_count")) or 0,
        step_count=len(flow.get("steps", [])),
        steps=steps,
    )


def merge_step_evidence(session_dir: Path, step_id: str) -> StepEvidenceResponse | None:
    step_result = read_step_result(session_dir / "replay-flow-step-result.json", step_id)
    flow_result = read_step_result(session_dir / "replay-flow-result.json", step_id)
    payload = step_result or flow_result
    if payload is None:
        return None
    screenshot_before_path = payload.get("screenshot_before_path")
    screenshot_after_path = payload.get("screenshot_after_path")
    if screenshot_before_path is None and payload.get("screenshot_path") is not None:
        screenshot_before_path = payload.get("screenshot_path")
    screenshot_before_safe = (
        _safe_screenshot_path(session_dir, screenshot_before_path)
        if isinstance(screenshot_before_path, str)
        else None
    )
    screenshot_after_safe = (
        _safe_screenshot_path(session_dir, screenshot_after_path)
        if isinstance(screenshot_after_path, str)
        else None
    )
    screenshot_before_data_url = (
        to_data_url(screenshot_before_safe) if screenshot_before_safe else None
    )
    screenshot_after_data_url = (
        to_data_url(screenshot_after_safe) if screenshot_after_safe else None
    )
    return StepEvidenceResponse(
        step_id=step_id,
        action=str(payload.get("action")) if payload.get("action") is not None else None,
        ok=bool(payload.get("ok")) if payload.get("ok") is not None else None,
        detail=str(payload.get("detail")) if payload.get("detail") is not None else None,
        duration_ms=_to_safe_int(payload.get("duration_ms")),
        matched_selector=str(payload.get("matched_selector"))
        if payload.get("matched_selector") is not None
        else None,
        selector_index=_to_safe_int(payload.get("selector_index")),
        screenshot_before_path=str(screenshot_before_path)
        if screenshot_before_safe and isinstance(screenshot_before_path, str)
        else None,
        screenshot_after_path=str(screenshot_after_path)
        if screenshot_after_safe and isinstance(screenshot_after_path, str)
        else None,
        screenshot_before_data_url=screenshot_before_data_url,
        screenshot_after_data_url=screenshot_after_data_url,
        fallback_trail=parse_fallback_trail(payload),
    )


def read_step_result(result_path: Path, step_id: str) -> dict[str, Any] | None:
    if not result_path.exists():
        return None
    try:
        raw = json.loads(result_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    if isinstance(raw, dict) and raw.get("stepId") == step_id:
        return raw
    if not isinstance(raw, dict):
        return None
    step_results = raw.get("stepResults")
    if not isinstance(step_results, list):
        return None
    for item in step_results:
        if isinstance(item, dict) and item.get("step_id") == step_id:
            return item
    return None


def read_timeline_items(session_dir: Path) -> list[EvidenceTimelineItemResponse]:
    full = session_dir / "replay-flow-result.json"
    if not full.exists():
        return []
    try:
        raw = json.loads(full.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    if not isinstance(raw, dict):
        return []
    step_results = raw.get("stepResults")
    if not isinstance(step_results, list):
        return []
    items: list[EvidenceTimelineItemResponse] = []
    for step in step_results:
        if not isinstance(step, dict):
            continue
        screenshot_before_path = step.get("screenshot_before_path")
        screenshot_after_path = step.get("screenshot_after_path")
        if screenshot_before_path is None and step.get("screenshot_path") is not None:
            screenshot_before_path = step.get("screenshot_path")
        screenshot_before_safe = (
            _safe_screenshot_path(session_dir, screenshot_before_path)
            if isinstance(screenshot_before_path, str)
            else None
        )
        screenshot_after_safe = (
            _safe_screenshot_path(session_dir, screenshot_after_path)
            if isinstance(screenshot_after_path, str)
            else None
        )
        before_url = to_data_url(screenshot_before_safe) if screenshot_before_safe else None
        after_url = to_data_url(screenshot_after_safe) if screenshot_after_safe else None
        items.append(
            EvidenceTimelineItemResponse(
                step_id=str(step.get("step_id") or ""),
                action=str(step.get("action")) if step.get("action") is not None else None,
                ok=bool(step.get("ok")) if step.get("ok") is not None else None,
                detail=str(step.get("detail")) if step.get("detail") is not None else None,
                duration_ms=_to_safe_int(step.get("duration_ms")),
                matched_selector=str(step.get("matched_selector"))
                if step.get("matched_selector") is not None
                else None,
                selector_index=_to_safe_int(step.get("selector_index")),
                screenshot_before_path=str(screenshot_before_path)
                if screenshot_before_safe and isinstance(screenshot_before_path, str)
                else None,
                screenshot_after_path=str(screenshot_after_path)
                if screenshot_after_safe and isinstance(screenshot_after_path, str)
                else None,
                screenshot_before_data_url=before_url,
                screenshot_after_data_url=after_url,
                fallback_trail=parse_fallback_trail(step),
            )
        )
    return items


def parse_fallback_trail(payload: dict[str, Any]) -> list[dict[str, Any]]:
    raw = payload.get("fallback_trail")
    if not isinstance(raw, list):
        return []
    parsed: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        parsed.append(
            {
                "selector_index": _to_safe_int(item.get("selector_index")),
                "kind": str(item.get("kind", "")),
                "value": str(item.get("value", "")),
                "normalized": str(item.get("normalized"))
                if item.get("normalized") is not None
                else None,
                "success": bool(item.get("success")),
                "error": str(item.get("error")) if item.get("error") is not None else None,
            }
        )
    return parsed


def _safe_screenshot_path(session_dir: Path, screenshot_path_raw: str) -> Path | None:
    evidence_root = (session_dir / "evidence").resolve()
    session_root = session_dir.resolve()
    relative_path = _sanitize_screenshot_relative_path(session_root, screenshot_path_raw)
    if relative_path is None:
        return None
    candidate = session_root / relative_path
    candidate_abs = candidate.absolute()
    try:
        resolved = candidate.resolve()
    except OSError:
        return None
    if resolved != candidate_abs:
        return None
    try:
        resolved.relative_to(evidence_root)
    except ValueError:
        try:
            resolved.relative_to(session_root)
        except ValueError:
            return None
    if not resolved.exists() or not resolved.is_file():
        return None
    return resolved


def _sanitize_screenshot_relative_path(session_root: Path, raw_path: str) -> Path | None:
    return _sanitize_path_under_root(session_root, raw_path)


def _max_evidence_bytes() -> int:
    raw = os.getenv("COMMAND_TOWER_EVIDENCE_MAX_BYTES", "1048576").strip()
    try:
        parsed = int(raw)
    except ValueError:
        return 1_048_576
    return max(1, parsed)


def _detect_image_mime(binary: bytes) -> str:
    if binary.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if binary.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if binary.startswith(b"GIF87a") or binary.startswith(b"GIF89a"):
        return "image/gif"
    if len(binary) > 12 and binary[:4] == b"RIFF" and binary[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


def to_data_url(session_or_path: Path, screenshot_path_raw: str | None = None) -> str | None:
    screenshot_path = session_or_path
    if screenshot_path_raw is not None:
        resolved = _safe_screenshot_path(session_or_path, screenshot_path_raw)
        if resolved is None:
            return None
        screenshot_path = resolved
    if not screenshot_path.exists() or not screenshot_path.is_file():
        return None
    try:
        binary = screenshot_path.read_bytes()
    except OSError:
        return None
    if len(binary) > _max_evidence_bytes():
        return None
    encoded = base64.b64encode(binary).decode("ascii")
    mime = _detect_image_mime(binary)
    return f"data:{mime};base64,{encoded}"
