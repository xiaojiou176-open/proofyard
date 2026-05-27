from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

EvidenceRegistryState = Literal["available", "empty", "missing"]
EvidenceRetentionState = Literal["retained", "partial", "missing", "empty"]


class EvidenceRunProvenance(BaseModel):
    source: Literal["canonical", "automation", "operator"] | None = None
    correlation_id: str | None = None
    linked_run_ids: list[str] = Field(default_factory=list)
    linked_task_ids: list[str] = Field(default_factory=list)


class EvidenceRunSummary(BaseModel):
    run_id: str
    profile: str | None = None
    target_name: str | None = None
    target_type: str | None = None
    gate_status: str | None = None
    retention_state: EvidenceRetentionState
    started_at: datetime | None = None
    finished_at: datetime | None = None
    duration_ms: int | None = None
    manifest_path: str | None = None
    summary_path: str | None = None
    missing_paths: list[str] = Field(default_factory=list)
    provenance: EvidenceRunProvenance = Field(default_factory=EvidenceRunProvenance)


class EvidenceRun(EvidenceRunSummary):
    available_paths: list[str] = Field(default_factory=list)
    reports: dict[str, str] = Field(default_factory=dict)
    proof_paths: dict[str, str] = Field(default_factory=dict)
    evidence_index_count: int = 0
    state_count: int = 0
    registry_state: EvidenceRegistryState
    parse_error: str | None = None


class EvidenceRunListResponse(BaseModel):
    runs: list[EvidenceRunSummary] = Field(default_factory=list)
    registry_state: EvidenceRegistryState


class EvidenceRunResponse(BaseModel):
    run: EvidenceRun


class EvidenceRunLatestResponse(BaseModel):
    run: EvidenceRun | None = None
    registry_state: EvidenceRegistryState


class EvidenceRunCompareGateStatusDelta(BaseModel):
    baseline: str | None = None
    candidate: str | None = None


class EvidenceRunCompareSummaryDelta(BaseModel):
    duration_ms: int | None = None
    failed_checks: int | None = None
    missing_artifacts: int = 0


class EvidenceRunCompareArtifactDelta(BaseModel):
    baseline_missing_paths: list[str] = Field(default_factory=list)
    candidate_missing_paths: list[str] = Field(default_factory=list)
    report_path_changes: list[str] = Field(default_factory=list)
    proof_path_changes: list[str] = Field(default_factory=list)


class EvidenceRunCompare(BaseModel):
    baseline_run_id: str
    candidate_run_id: str
    compare_state: Literal["ready", "partial_compare"]
    baseline_retention_state: EvidenceRetentionState
    candidate_retention_state: EvidenceRetentionState
    gate_status_delta: EvidenceRunCompareGateStatusDelta
    summary_delta: EvidenceRunCompareSummaryDelta
    artifact_delta: EvidenceRunCompareArtifactDelta


class EvidenceRunCompareResponse(BaseModel):
    compare: EvidenceRunCompare


class EvidenceSharePackJsonBundle(BaseModel):
    run_id: str
    retention_state: EvidenceRetentionState
    gate_status: str | None = None
    missing_paths: list[str] = Field(default_factory=list)
    compare: EvidenceRunCompare | None = None


class EvidenceSharePack(BaseModel):
    run_id: str
    retention_state: EvidenceRetentionState
    compare: EvidenceRunCompare | None = None
    markdown_summary: str
    issue_ready_snippet: str
    release_appendix: str
    json_bundle: EvidenceSharePackJsonBundle


class EvidenceSharePackResponse(BaseModel):
    share_pack: EvidenceSharePack


class FailureExplanationAnchor(BaseModel):
    label: str
    path: str


class FailureExplanation(BaseModel):
    run_id: str
    summary: str
    uncertainty: str
    evidence_anchors: list[FailureExplanationAnchor] = Field(default_factory=list)
    next_actions: list[str] = Field(default_factory=list)


class FailureExplanationResponse(BaseModel):
    explanation: FailureExplanation


class PromotionCandidate(BaseModel):
    run_id: str
    eligible: bool
    retention_state: EvidenceRetentionState
    provenance_ready: bool
    share_pack_ready: bool
    compare_ready: bool
    review_state: Literal["candidate", "review", "approved"]
    review_state_reason: str
    reason_codes: list[str] = Field(default_factory=list)
    release_reference: str
    showcase_reference: str
    supporting_share_pack_reference: str


class PromotionCandidateResponse(BaseModel):
    candidate: PromotionCandidate


class HostedReviewWorkspace(BaseModel):
    run_id: str
    workspace_state: Literal["review_ready", "review_partial"]
    retention_state: EvidenceRetentionState
    compare_state: Literal["ready", "partial_compare", "not_requested"]
    review_summary: str
    next_review_step: str
    explanation: FailureExplanation
    share_pack: EvidenceSharePack
    compare: EvidenceRunCompare | None = None
    promotion_candidate: PromotionCandidate
    recommended_order: list[str] = Field(default_factory=list)


class HostedReviewWorkspaceResponse(BaseModel):
    workspace: HostedReviewWorkspace
