from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from apps.api.app.api.dependencies.security import (
    AutomationSecurityContext,
    require_automation_access,
)
from apps.api.app.models.flow import FlowRecord
from apps.api.app.models.universal_api import FlowCreateRequest, FlowListResponse, FlowUpdateRequest
from apps.api.app.services.universal_platform_service import universal_platform_service

router = APIRouter(prefix="/api/flows", tags=["flows"])


@router.get("", response_model=FlowListResponse)
def list_flows(
    security: AutomationSecurityContext = Depends(require_automation_access),
    limit: int = Query(default=50, ge=1, le=200),
) -> FlowListResponse:
    return FlowListResponse(
        flows=universal_platform_service.list_flows(limit=limit, requester=security.actor)
    )


@router.post("/import-latest", response_model=FlowRecord)
def import_latest_flow(
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> FlowRecord:
    return universal_platform_service.import_latest_flow_draft(owner=security.actor)


@router.post("", response_model=FlowRecord)
def create_flow(
    payload: FlowCreateRequest,
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> FlowRecord:
    return universal_platform_service.create_flow(
        session_id=payload.session_id,
        start_url=payload.start_url,
        source_event_count=payload.source_event_count,
        steps=payload.steps,
        requester=security.actor,
    )


@router.get("/{flow_id}", response_model=FlowRecord)
def get_flow(
    flow_id: str,
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> FlowRecord:
    return universal_platform_service.get_flow(flow_id, requester=security.actor)


@router.patch("/{flow_id}", response_model=FlowRecord)
def update_flow(
    flow_id: str,
    payload: FlowUpdateRequest,
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> FlowRecord:
    return universal_platform_service.update_flow(
        flow_id,
        steps=payload.steps,
        start_url=payload.start_url,
        requester=security.actor,
    )
