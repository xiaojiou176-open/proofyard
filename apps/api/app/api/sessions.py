from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from apps.api.app.api.dependencies.security import (
    AutomationSecurityContext,
    require_automation_access,
)
from apps.api.app.models.flow import SessionRecord
from apps.api.app.models.universal_api import SessionListResponse, SessionStartRequest
from apps.api.app.services.universal_platform_service import universal_platform_service

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.get("", response_model=SessionListResponse)
def list_sessions(
    limit: int = Query(default=30, ge=1, le=200),
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> SessionListResponse:
    return SessionListResponse(
        sessions=universal_platform_service.list_sessions(limit=limit, requester=security.actor)
    )


@router.post("/start", response_model=SessionRecord)
def start_session(
    payload: SessionStartRequest,
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> SessionRecord:
    return universal_platform_service.start_session(
        payload.start_url,
        payload.mode,
        owner=security.actor,
    )


@router.post("/{session_id}/finish", response_model=SessionRecord)
def finish_session(
    session_id: str,
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> SessionRecord:
    return universal_platform_service.finish_session(session_id, owner=security.actor)
