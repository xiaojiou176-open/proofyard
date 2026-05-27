from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from apps.api.app.api.dependencies.security import (
    AutomationSecurityContext,
    require_automation_access,
)
from apps.api.app.models.universal_api import (
    RunCreateRequest,
    RunEnvelopeResponse,
    RunListResponse,
    RunOtpSubmitRequest,
    RunRecoveryPlanResponse,
)
from apps.api.app.services.universal_platform_service import universal_platform_service

router = APIRouter(prefix="/api/runs", tags=["runs"])


@router.get("", response_model=RunListResponse)
def list_runs(
    limit: int = Query(default=100, ge=1, le=500),
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> RunListResponse:
    return RunListResponse(
        runs=universal_platform_service.list_runs(limit=limit, requester=security.verified_actor)
    )


@router.post("", response_model=RunEnvelopeResponse)
def create_run(
    payload: RunCreateRequest,
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> RunEnvelopeResponse:
    run = universal_platform_service.create_run(
        payload.template_id,
        payload.params,
        actor=security.verified_actor,
        otp_code=payload.otp_code,
    )
    return RunEnvelopeResponse(run=run)


@router.get("/{run_id}", response_model=RunEnvelopeResponse)
def get_run(
    run_id: str,
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> RunEnvelopeResponse:
    run = universal_platform_service.get_run(run_id, requester=security.verified_actor)
    return RunEnvelopeResponse(run=run)


@router.post("/{run_id}/otp", response_model=RunEnvelopeResponse)
def submit_run_otp(
    run_id: str,
    payload: RunOtpSubmitRequest,
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> RunEnvelopeResponse:
    run = universal_platform_service.submit_otp_and_resume(
        run_id,
        payload.otp_code,
        actor=security.verified_actor,
    )
    return RunEnvelopeResponse(run=run)


@router.get("/{run_id}/recover-plan", response_model=RunRecoveryPlanResponse)
def get_run_recovery_plan(
    run_id: str,
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> RunRecoveryPlanResponse:
    plan = universal_platform_service.build_recovery_plan(run_id, requester=security.verified_actor)
    return RunRecoveryPlanResponse(plan=plan)


@router.post("/{run_id}/cancel", response_model=RunEnvelopeResponse)
def cancel_run(
    run_id: str,
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> RunEnvelopeResponse:
    run = universal_platform_service.cancel_run(run_id, actor=security.verified_actor)
    return RunEnvelopeResponse(run=run)
