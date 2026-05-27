from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from apps.api.app.api.dependencies.security import (
    AutomationSecurityContext,
    require_automation_access,
)
from apps.api.app.models.evidence_run import (
    EvidenceRunCompareResponse,
    EvidenceRunLatestResponse,
    EvidenceRunListResponse,
    EvidenceRunResponse,
    EvidenceSharePackResponse,
    FailureExplanationResponse,
    HostedReviewWorkspaceResponse,
    PromotionCandidateResponse,
)
from apps.api.app.services.failure_explainer_service import build_failure_explanation
from apps.api.app.services.evidence_run_service import evidence_run_service

router = APIRouter(prefix="/api/evidence-runs", tags=["evidence-runs"])


@router.get("", response_model=EvidenceRunListResponse)
def list_evidence_runs(
    limit: int = Query(default=20, ge=1, le=200),
    _security: AutomationSecurityContext = Depends(require_automation_access),
) -> EvidenceRunListResponse:
    return evidence_run_service.list_runs(limit=limit)


@router.get("/latest", response_model=EvidenceRunLatestResponse)
def get_latest_evidence_run(
    _security: AutomationSecurityContext = Depends(require_automation_access),
) -> EvidenceRunLatestResponse:
    return evidence_run_service.get_latest_run()


@router.get("/{run_id}", response_model=EvidenceRunResponse)
def get_evidence_run(
    run_id: str,
    _security: AutomationSecurityContext = Depends(require_automation_access),
) -> EvidenceRunResponse:
    return evidence_run_service.get_run(run_id)


@router.get("/{run_id}/compare/{candidate_run_id}", response_model=EvidenceRunCompareResponse)
def compare_evidence_runs(
    run_id: str,
    candidate_run_id: str,
    _security: AutomationSecurityContext = Depends(require_automation_access),
) -> EvidenceRunCompareResponse:
    return evidence_run_service.compare_runs(run_id, candidate_run_id)


@router.get("/{run_id}/share-pack", response_model=EvidenceSharePackResponse)
def get_evidence_share_pack(
    run_id: str,
    candidate_run_id: str | None = Query(default=None),
    _security: AutomationSecurityContext = Depends(require_automation_access),
) -> EvidenceSharePackResponse:
    return evidence_run_service.build_share_pack(run_id, candidate_run_id)


@router.get("/{run_id}/explain", response_model=FailureExplanationResponse)
def explain_evidence_run_failure(
    run_id: str,
    candidate_run_id: str | None = Query(default=None),
    _security: AutomationSecurityContext = Depends(require_automation_access),
) -> FailureExplanationResponse:
    return build_failure_explanation(evidence_run_service, run_id, candidate_run_id)


@router.get("/{run_id}/promotion-candidate", response_model=PromotionCandidateResponse)
def get_promotion_candidate(
    run_id: str,
    candidate_run_id: str | None = Query(default=None),
    _security: AutomationSecurityContext = Depends(require_automation_access),
) -> PromotionCandidateResponse:
    return evidence_run_service.build_promotion_candidate(run_id, candidate_run_id)


@router.get("/{run_id}/review-workspace", response_model=HostedReviewWorkspaceResponse)
def get_hosted_review_workspace(
    run_id: str,
    candidate_run_id: str | None = Query(default=None),
    _security: AutomationSecurityContext = Depends(require_automation_access),
) -> HostedReviewWorkspaceResponse:
    return evidence_run_service.build_review_workspace(run_id, candidate_run_id)
