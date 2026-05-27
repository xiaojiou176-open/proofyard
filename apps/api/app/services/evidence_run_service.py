from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status

from apps.api.app.core.settings import env_str
from apps.api.app.models.evidence_run import (
    EvidenceRunCompare,
    EvidenceRunCompareArtifactDelta,
    EvidenceRunCompareGateStatusDelta,
    EvidenceRunCompareResponse,
    EvidenceRunCompareSummaryDelta,
    EvidenceRegistryState,
    EvidenceRun,
    EvidenceRunLatestResponse,
    EvidenceRunListResponse,
    EvidenceRunProvenance,
    EvidenceRunResponse,
    EvidenceRunSummary,
    EvidenceSharePack,
    EvidenceSharePackJsonBundle,
    EvidenceSharePackResponse,
    FailureExplanation,
    FailureExplanationAnchor,
    HostedReviewWorkspace,
    HostedReviewWorkspaceResponse,
    PromotionCandidate,
    PromotionCandidateResponse,
)


class EvidenceRunService:
    def __init__(self) -> None:
        self._root = Path(__file__).resolve().parents[4]
        runtime_cache_override = env_str("UIQ_RUNTIME_CACHE_ROOT", "").strip()
        self._runtime_cache_root = (
            Path(runtime_cache_override)
            if runtime_cache_override
            else (self._root / ".runtime-cache")
        )
        self._runs_root = self._runtime_cache_root / "artifacts" / "runs"
        self._promotion_root = self._runtime_cache_root / "artifacts" / "release" / "promotion-candidates"

    def list_runs(self, limit: int = 20) -> EvidenceRunListResponse:
        registry_state = self._registry_state()
        if registry_state != "available":
            return EvidenceRunListResponse(runs=[], registry_state=registry_state)

        entries = []
        for entry in self._runs_root.iterdir():
            if not entry.is_dir():
                continue
            manifest_path = entry / "manifest.json"
            mtime = manifest_path.stat().st_mtime if manifest_path.exists() else entry.stat().st_mtime
            entries.append((mtime, entry.name, entry))
        entries.sort(key=lambda item: item[0], reverse=True)

        runs = [self._build_summary(run_id, run_dir) for _, run_id, run_dir in entries[: max(1, min(limit, 200))]]
        return EvidenceRunListResponse(runs=runs, registry_state=registry_state)

    def get_run(self, run_id: str) -> EvidenceRunResponse:
        run_dir = self._runs_root / run_id
        if not run_dir.exists() or not run_dir.is_dir():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="evidence run not found")
        return EvidenceRunResponse(run=self._build_detail(run_id, run_dir))

    def get_latest_run(self) -> EvidenceRunLatestResponse:
        listing = self.list_runs(limit=1)
        if listing.registry_state != "available" or not listing.runs:
            return EvidenceRunLatestResponse(run=None, registry_state=listing.registry_state)
        run_id = listing.runs[0].run_id
        run_dir = self._runs_root / run_id
        return EvidenceRunLatestResponse(
            run=self._build_detail(run_id, run_dir),
            registry_state=listing.registry_state,
        )

    def compare_runs(self, baseline_run_id: str, candidate_run_id: str) -> EvidenceRunCompareResponse:
        baseline_dir = self._runs_root / baseline_run_id
        candidate_dir = self._runs_root / candidate_run_id
        if not baseline_dir.exists() or not candidate_dir.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="evidence run not found")

        baseline = self._build_detail(baseline_run_id, baseline_dir)
        candidate = self._build_detail(candidate_run_id, candidate_dir)
        baseline_manifest, _ = self._read_manifest(baseline_dir)
        candidate_manifest, _ = self._read_manifest(candidate_dir)
        baseline_failed_checks = self._failed_check_count(baseline_manifest)
        candidate_failed_checks = self._failed_check_count(candidate_manifest)

        compare = EvidenceRunCompare(
            baseline_run_id=baseline_run_id,
            candidate_run_id=candidate_run_id,
            compare_state=(
                "ready"
                if baseline.retention_state == "retained"
                and candidate.retention_state == "retained"
                else "partial_compare"
            ),
            baseline_retention_state=baseline.retention_state,
            candidate_retention_state=candidate.retention_state,
            gate_status_delta=EvidenceRunCompareGateStatusDelta(
                baseline=baseline.gate_status,
                candidate=candidate.gate_status,
            ),
            summary_delta=EvidenceRunCompareSummaryDelta(
                duration_ms=(
                    candidate.duration_ms - baseline.duration_ms
                    if baseline.duration_ms is not None and candidate.duration_ms is not None
                    else None
                ),
                failed_checks=(
                    candidate_failed_checks - baseline_failed_checks
                    if baseline_failed_checks is not None and candidate_failed_checks is not None
                    else None
                ),
                missing_artifacts=len(candidate.missing_paths) - len(baseline.missing_paths),
            ),
            artifact_delta=EvidenceRunCompareArtifactDelta(
                baseline_missing_paths=baseline.missing_paths,
                candidate_missing_paths=candidate.missing_paths,
                report_path_changes=self._changed_keys(baseline.reports, candidate.reports),
                proof_path_changes=self._changed_keys(baseline.proof_paths, candidate.proof_paths),
            ),
        )
        return EvidenceRunCompareResponse(compare=compare)

    def build_share_pack(
        self, run_id: str, candidate_run_id: str | None = None
    ) -> EvidenceSharePackResponse:
        detail = self.get_run(run_id).run
        compare = self.compare_runs(run_id, candidate_run_id).compare if candidate_run_id else None
        markdown_summary = "\n".join(
            [
                "## Evidence Share Pack",
                f"- Run ID: `{detail.run_id}`",
                f"- Retention: **{detail.retention_state}**",
                f"- Gate Status: **{detail.gate_status or 'unknown'}**",
                f"- Missing Paths: {', '.join(detail.missing_paths) if detail.missing_paths else 'None'}",
                (
                    f"- Compare: `{compare.baseline_run_id}` -> `{compare.candidate_run_id}` ({compare.compare_state})"
                    if compare
                    else "- Compare: Not included"
                ),
            ]
        )
        issue_ready_snippet = "\n".join(
            [
                "### Failure Digest",
                f"- run_id: `{detail.run_id}`",
                f"- retention_state: `{detail.retention_state}`",
                f"- gate_status: `{detail.gate_status or 'unknown'}`",
                f"- missing_paths: {', '.join(detail.missing_paths) if detail.missing_paths else 'none'}",
            ]
        )
        release_appendix = "\n".join(
            [
                "### Evidence Appendix",
                f"- canonical_run: `{detail.run_id}`",
                f"- retained_state: `{detail.retention_state}`",
                f"- proof_paths: {', '.join(detail.proof_paths.values()) if detail.proof_paths else 'none'}",
            ]
        )
        share_pack = EvidenceSharePack(
            run_id=detail.run_id,
            retention_state=detail.retention_state,
            compare=compare,
            markdown_summary=markdown_summary,
            issue_ready_snippet=issue_ready_snippet,
            release_appendix=release_appendix,
            json_bundle=EvidenceSharePackJsonBundle(
                run_id=detail.run_id,
                retention_state=detail.retention_state,
                gate_status=detail.gate_status,
                missing_paths=detail.missing_paths,
                compare=compare,
            ),
        )
        return EvidenceSharePackResponse(share_pack=share_pack)

    def build_promotion_candidate(
        self, run_id: str, candidate_run_id: str | None = None
    ) -> PromotionCandidateResponse:
        detail = self.get_run(run_id).run
        compare = self.compare_runs(run_id, candidate_run_id).compare if candidate_run_id else None
        share_pack = self.build_share_pack(run_id, candidate_run_id).share_pack
        reason_codes: list[str] = []
        if detail.retention_state != "retained":
            reason_codes.append("promotion.retention.not_retained")
        if detail.provenance.source is None:
            reason_codes.append("promotion.provenance.missing")
        if not share_pack.markdown_summary.strip():
            reason_codes.append("promotion.share_pack.empty")
        eligible = len(reason_codes) == 0
        review_state = self._promotion_review_state(detail.run_id, eligible)

        candidate = PromotionCandidate(
            run_id=detail.run_id,
            eligible=eligible,
            retention_state=detail.retention_state,
            provenance_ready=detail.provenance.source is not None,
            share_pack_ready=bool(share_pack.markdown_summary.strip()),
            compare_ready=compare is not None and compare.compare_state == "ready",
            review_state=review_state,
            review_state_reason=self._promotion_review_state_reason(review_state),
            reason_codes=reason_codes,
            release_reference=(
                f".runtime-cache/artifacts/release/promotion-candidates/{detail.run_id}.promotion-candidate.md"
            ),
            showcase_reference="docs/showcase/minimal-success-case.md#promotion-candidate-contract",
            supporting_share_pack_reference=(
                f".runtime-cache/artifacts/release/share-pack/{detail.run_id}.share-pack.md"
            ),
        )
        return PromotionCandidateResponse(candidate=candidate)

    def build_review_workspace(
        self, run_id: str, candidate_run_id: str | None = None
    ) -> HostedReviewWorkspaceResponse:
        detail = self.get_run(run_id).run
        compare = self.compare_runs(run_id, candidate_run_id).compare if candidate_run_id else None
        share_pack = self.build_share_pack(run_id, candidate_run_id).share_pack
        promotion_candidate = self.build_promotion_candidate(run_id, candidate_run_id).candidate

        anchors = [
            FailureExplanationAnchor(label="manifest", path=detail.manifest_path or "manifest.json"),
            FailureExplanationAnchor(label="summary", path=detail.summary_path or "reports/summary.json"),
        ]
        for path in detail.missing_paths[:3]:
            anchors.append(FailureExplanationAnchor(label="missing", path=path))
        explanation = FailureExplanation(
            run_id=detail.run_id,
            summary=(
                f"Review run {detail.run_id} from the retained evidence surface before you promote or share it more widely."
            ),
            uncertainty=(
                "This review workspace is local-first and artifact-backed. It prepares a review packet, but it is not a hosted collaboration platform."
            ),
            evidence_anchors=anchors,
            next_actions=[
                "Explain the run first.",
                "Review the share pack and compare state.",
                "Use promotion only after the evidence packet is reviewable.",
            ],
        )

        compare_state = compare.compare_state if compare else "not_requested"
        workspace_state = (
            "review_ready"
            if detail.retention_state == "retained"
            and (compare is None or compare.compare_state == "ready")
            else "review_partial"
        )
        review_summary = (
            "This packet is ready for human review."
            if workspace_state == "review_ready"
            else "This packet is reviewable, but some evidence or compare context still needs caution."
        )
        next_review_step = (
            "Share this review packet with the maintainer who needs the evidence-first summary."
            if workspace_state == "review_ready"
            else "Resolve the missing evidence or partial compare signals before you treat this packet as promotion-ready."
        )
        workspace = HostedReviewWorkspace(
            run_id=detail.run_id,
            workspace_state=workspace_state,
            retention_state=detail.retention_state,
            compare_state=compare_state,
            review_summary=review_summary,
            next_review_step=next_review_step,
            share_pack=share_pack,
            explanation=explanation,
            compare=compare,
            promotion_candidate=promotion_candidate,
            recommended_order=[
                "Explain the run",
                "Read the share pack",
                "Review compare context",
                "Decide promotion status",
            ],
        )
        return HostedReviewWorkspaceResponse(workspace=workspace)

    def _promotion_review_state(self, run_id: str, eligible: bool) -> str:
        artifact_path = self._promotion_root / f"{run_id}.promotion-candidate.json"
        if artifact_path.exists():
            try:
                payload = json.loads(artifact_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                payload = {}
            review_state = payload.get("reviewState")
            if review_state in {"candidate", "review", "approved"}:
                if not eligible and review_state != "candidate":
                    return "candidate"
                return str(review_state)
        return "candidate"

    @staticmethod
    def _promotion_review_state_reason(review_state: str) -> str:
        if review_state == "review":
            return (
                "Promotion is staged for maintainer review before it can be cited by release or showcase surfaces."
            )
        if review_state == "approved":
            return (
                "Promotion is approved and can be cited by release or showcase surfaces without pointing at raw run artifacts."
            )
        return "Promotion remains a candidate until a maintainer advances it to review or approved."

    def _registry_state(self) -> EvidenceRegistryState:
        if not self._runs_root.exists():
            return "missing"
        has_dirs = any(entry.is_dir() for entry in self._runs_root.iterdir())
        return "available" if has_dirs else "empty"

    @staticmethod
    def _safe_string(value: Any) -> str | None:
        return value if isinstance(value, str) and value.strip() else None

    @staticmethod
    def _safe_string_list(value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        return [item for item in value if isinstance(item, str) and item.strip()]

    def _read_manifest(self, run_dir: Path) -> tuple[dict[str, Any] | None, str | None]:
        manifest_path = run_dir / "manifest.json"
        if not manifest_path.exists():
            return None, None
        try:
            return json.loads(manifest_path.read_text(encoding="utf-8")), None
        except json.JSONDecodeError as exc:
            return None, str(exc)

    def _expected_paths(self, manifest: dict[str, Any] | None) -> list[str]:
        expected = {"manifest.json", "reports/summary.json"}
        if not manifest:
            return sorted(expected)

        reports = manifest.get("reports")
        if isinstance(reports, dict):
            for value in reports.values():
                if isinstance(value, str) and value.strip():
                    expected.add(value)

        proof = manifest.get("proof")
        if isinstance(proof, dict):
            for key in ("coveragePath", "stabilityPath", "gapsPath", "reproPath"):
                value = proof.get(key)
                if isinstance(value, str) and value.strip():
                    expected.add(value)

        return sorted(expected)

    def _provenance(self, manifest: dict[str, Any] | None) -> EvidenceRunProvenance:
        raw = manifest.get("provenance") if isinstance(manifest, dict) else None
        if not isinstance(raw, dict):
            return EvidenceRunProvenance()
        source = raw.get("source")
        return EvidenceRunProvenance(
            source=source if source in {"canonical", "automation", "operator"} else None,
            correlation_id=self._safe_string(raw.get("correlationId")),
            linked_run_ids=self._safe_string_list(raw.get("linkedRunIds")),
            linked_task_ids=self._safe_string_list(raw.get("linkedTaskIds")),
        )

    def _retention_state(self, run_dir: Path, expected_paths: list[str], available_paths: list[str]) -> str:
        visible_entries = [entry for entry in run_dir.iterdir() if not entry.name.startswith(".")]
        if not visible_entries:
            return "empty"
        if not available_paths:
            return "missing"
        if len(available_paths) == len(expected_paths):
            return "retained"
        return "partial"

    def _build_summary(self, run_id: str, run_dir: Path) -> EvidenceRunSummary:
        manifest, _parse_error = self._read_manifest(run_dir)
        expected_paths = self._expected_paths(manifest)
        available_paths = [path for path in expected_paths if (run_dir / path).exists()]
        missing_paths = [path for path in expected_paths if (run_dir / path).exists() is False]
        timing = manifest.get("timing") if isinstance(manifest, dict) else None
        target = manifest.get("target") if isinstance(manifest, dict) else None
        gate_results = manifest.get("gateResults") if isinstance(manifest, dict) else None
        return EvidenceRunSummary(
            run_id=run_id,
            profile=self._safe_string(manifest.get("profile") if isinstance(manifest, dict) else None),
            target_name=self._safe_string(target.get("name") if isinstance(target, dict) else None),
            target_type=self._safe_string(target.get("type") if isinstance(target, dict) else None),
            gate_status=self._safe_string(gate_results.get("status") if isinstance(gate_results, dict) else None),
            retention_state=self._retention_state(run_dir, expected_paths, available_paths),
            started_at=timing.get("startedAt") if isinstance(timing, dict) else None,
            finished_at=timing.get("finishedAt") if isinstance(timing, dict) else None,
            duration_ms=timing.get("durationMs") if isinstance(timing, dict) else None,
            manifest_path="manifest.json" if (run_dir / "manifest.json").exists() else None,
            summary_path="reports/summary.json" if (run_dir / "reports/summary.json").exists() else None,
            missing_paths=missing_paths,
            provenance=self._provenance(manifest),
        )

    def _build_detail(self, run_id: str, run_dir: Path) -> EvidenceRun:
        manifest, parse_error = self._read_manifest(run_dir)
        summary = self._build_summary(run_id, run_dir)
        expected_paths = self._expected_paths(manifest)
        available_paths = [path for path in expected_paths if (run_dir / path).exists()]
        reports = {
            key: value
            for key, value in (manifest.get("reports", {}) if isinstance(manifest, dict) else {}).items()
            if isinstance(value, str) and value.strip()
        }
        proof = manifest.get("proof") if isinstance(manifest, dict) else None
        proof_paths = {}
        if isinstance(proof, dict):
            for source_key, target_key in (
                ("coveragePath", "coverage"),
                ("stabilityPath", "stability"),
                ("gapsPath", "gaps"),
                ("reproPath", "repro"),
            ):
                value = proof.get(source_key)
                if isinstance(value, str) and value.strip():
                    proof_paths[target_key] = value

        return EvidenceRun(
            **summary.model_dump(),
            available_paths=available_paths,
            reports=reports,
            proof_paths=proof_paths,
            evidence_index_count=len(manifest.get("evidenceIndex", [])) if isinstance(manifest, dict) else 0,
            state_count=len(manifest.get("states", [])) if isinstance(manifest, dict) else 0,
            registry_state=self._registry_state(),
            parse_error=parse_error,
        )

    @staticmethod
    def _failed_check_count(manifest: dict[str, Any] | None) -> int | None:
        if not isinstance(manifest, dict):
            return None
        gate_results = manifest.get("gateResults")
        if not isinstance(gate_results, dict):
            return None
        checks = gate_results.get("checks")
        if not isinstance(checks, list):
            return None
        return sum(
            1
            for check in checks
            if isinstance(check, dict) and check.get("status") in {"failed", "blocked"}
        )

    @staticmethod
    def _changed_keys(
        baseline: dict[str, str],
        candidate: dict[str, str],
    ) -> list[str]:
        keys = set(baseline.keys()) | set(candidate.keys())
        return sorted([key for key in keys if baseline.get(key) != candidate.get(key)])


evidence_run_service = EvidenceRunService()
