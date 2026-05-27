from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from apps.api.app.api.dependencies.security import (
    AutomationSecurityContext,
    require_automation_access,
)
from apps.api.app.services.computer_use_service import ComputerUseServiceError, computer_use_service

router = APIRouter(prefix="/api/computer-use", tags=["computer-use"])


class CreateComputerUseSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    instruction: str = Field(min_length=1, max_length=4000)
    model: str | None = Field(default=None, min_length=1, max_length=128)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ComputerUseSessionResponse(BaseModel):
    session_id: str
    model: str
    instruction: str
    created_at: str


class PreviewComputerUseActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    screenshot_base64: str | None = Field(default=None, max_length=8_000_000)
    screenshot_mime_type: str = Field(default="image/png", min_length=3, max_length=128)
    instruction: str | None = Field(default=None, min_length=1, max_length=4000)
    include_thoughts: bool = True


class ComputerUseActionResponse(BaseModel):
    session_id: str
    action_id: str
    name: str
    args: dict[str, Any]
    rationale: str
    risk_level: str
    confirmation_reason: str | None = None
    action_digest: str
    require_confirmation: bool
    safety_decision: str
    status: str
    confirmed_by: str | None = None
    executed_at: str | None = None


class ConfirmComputerUseActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    approved: bool = True
    confirmation_reason: str | None = Field(default=None, min_length=1, max_length=500)


class ExecuteComputerUseActionResponse(BaseModel):
    session_id: str
    action_id: str
    status: str
    executor: str
    executed_at: str
    executed_by: str
    applied_args: dict[str, Any]
    risk_level: str | None = None
    confirmation_reason: str | None = None
    action_digest: str | None = None
    evidence: dict[str, Any] = Field(default_factory=dict)


class ComputerUseEvidenceResponse(BaseModel):
    session_id: str
    event_count: int
    events: list[dict[str, Any]]
    evidence_path: str


@router.post("/sessions", response_model=ComputerUseSessionResponse)
def create_session(
    payload: CreateComputerUseSessionRequest,
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> ComputerUseSessionResponse:
    try:
        session = computer_use_service.create_session(
            instruction=payload.instruction,
            actor=security.actor,
            model=payload.model,
            metadata=payload.metadata,
        )
    except ComputerUseServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    return ComputerUseSessionResponse(
        session_id=session.session_id,
        model=session.model,
        instruction=session.instruction,
        created_at=session.created_at,
    )


@router.post("/sessions/{session_id}/preview", response_model=ComputerUseActionResponse)
def preview_action(
    session_id: str,
    payload: PreviewComputerUseActionRequest,
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> ComputerUseActionResponse:
    try:
        action = computer_use_service.preview_action(
            session_id=session_id,
            actor=security.actor,
            screenshot_base64=payload.screenshot_base64,
            screenshot_mime_type=payload.screenshot_mime_type,
            instruction=payload.instruction,
            include_thoughts=payload.include_thoughts,
        )
    except ComputerUseServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    return ComputerUseActionResponse(
        session_id=session_id,
        action_id=action.action_id,
        name=action.name,
        args=action.args,
        rationale=action.rationale,
        risk_level=action.risk_level,
        confirmation_reason=action.confirmation_reason,
        action_digest=action.action_digest,
        require_confirmation=action.require_confirmation,
        safety_decision=action.safety_decision,
        status=action.status,
        confirmed_by=action.confirmed_by,
        executed_at=action.executed_at,
    )


@router.post("/sessions/{session_id}/confirm/{action_id}", response_model=ComputerUseActionResponse)
def confirm_action(
    session_id: str,
    action_id: str,
    payload: ConfirmComputerUseActionRequest,
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> ComputerUseActionResponse:
    try:
        action = computer_use_service.confirm_action(
            session_id=session_id,
            action_id=action_id,
            actor=security.actor,
            approved=payload.approved,
            confirmation_reason=payload.confirmation_reason,
        )
    except ComputerUseServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    return ComputerUseActionResponse(
        session_id=session_id,
        action_id=action.action_id,
        name=action.name,
        args=action.args,
        rationale=action.rationale,
        risk_level=action.risk_level,
        confirmation_reason=action.confirmation_reason,
        action_digest=action.action_digest,
        require_confirmation=action.require_confirmation,
        safety_decision=action.safety_decision,
        status=action.status,
        confirmed_by=action.confirmed_by,
        executed_at=action.executed_at,
    )


@router.post(
    "/sessions/{session_id}/execute/{action_id}", response_model=ExecuteComputerUseActionResponse
)
def execute_action(
    session_id: str,
    action_id: str,
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> ExecuteComputerUseActionResponse:
    try:
        result = computer_use_service.execute_action(
            session_id=session_id, action_id=action_id, actor=security.actor
        )
    except ComputerUseServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    return ExecuteComputerUseActionResponse(
        session_id=session_id,
        action_id=action_id,
        status=str(result.get("status") or "unknown"),
        executor=str(result.get("executor") or "backend-playwright-adapter"),
        executed_at=str(result.get("executedAt") or ""),
        executed_by=str(result.get("executedBy") or security.actor),
        applied_args=result.get("appliedArgs")
        if isinstance(result.get("appliedArgs"), dict)
        else {},
        risk_level=str(result.get("riskLevel")) if result.get("riskLevel") is not None else None,
        confirmation_reason=str(result.get("confirmationReason"))
        if result.get("confirmationReason") is not None
        else None,
        action_digest=str(result.get("actionDigest"))
        if result.get("actionDigest") is not None
        else None,
        evidence=result.get("evidence") if isinstance(result.get("evidence"), dict) else {},
    )


@router.get("/sessions/{session_id}/evidence", response_model=ComputerUseEvidenceResponse)
def read_evidence(
    session_id: str,
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> ComputerUseEvidenceResponse:
    try:
        try:
            evidence = computer_use_service.read_evidence(
                session_id=session_id, actor=security.actor
            )
        except TypeError:
            evidence = computer_use_service.read_evidence(session_id=session_id)
    except ComputerUseServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    return ComputerUseEvidenceResponse(
        session_id=session_id,
        event_count=int(evidence.get("eventCount") or 0),
        events=evidence.get("events") if isinstance(evidence.get("events"), list) else [],
        evidence_path=str(evidence.get("evidencePath") or ""),
    )
