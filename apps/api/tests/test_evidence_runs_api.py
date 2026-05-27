from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import apps.api.app.core.access_control as access_control
from apps.api.app.api import evidence_runs as evidence_runs_api
from apps.api.app.main import app
from apps.api.app.services.evidence_run_service import EvidenceRunService

TEST_AUTOMATION_TOKEN = "test-token-0123456789"

client = TestClient(
    app,
    headers={
        "x-automation-token": TEST_AUTOMATION_TOKEN,
        "x-automation-client-id": "pytest-evidence",
    },
)


@pytest.fixture(autouse=True)
def reset_evidence_service(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTOMATION_API_TOKEN", TEST_AUTOMATION_TOKEN)
    monkeypatch.setenv("UIQ_RUNTIME_CACHE_ROOT", str(tmp_path))
    access_control.reset_for_tests()
    fresh_service = EvidenceRunService()
    evidence_runs_api.evidence_run_service = fresh_service


def _write_manifest(run_dir: Path, run_id: str, *, provenance: dict[str, object] | None = None) -> None:
    (run_dir / "reports").mkdir(parents=True, exist_ok=True)
    manifest = {
        "runId": run_id,
        "profile": "pr",
        "target": {"type": "web", "name": "web.local"},
        "timing": {
            "startedAt": "2026-03-29T09:00:00Z",
            "finishedAt": "2026-03-29T09:05:00Z",
            "durationMs": 300000,
        },
        "gateResults": {"status": "passed", "checks": []},
        "reports": {
            "report": "reports/summary.json",
            "proofCoverage": "reports/proof.coverage.json",
        },
        "proof": {"coveragePath": "reports/proof.coverage.json"},
        "evidenceIndex": [
            {
                "id": "report.report",
                "source": "report",
                "kind": "report",
                "path": "reports/summary.json",
            }
        ],
        "states": [],
        "provenance": provenance or {},
    }
    (run_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (run_dir / "reports" / "summary.json").write_text("{}", encoding="utf-8")


def test_evidence_runs_returns_missing_state_when_runs_root_absent() -> None:
    response = client.get("/api/evidence-runs")

    assert response.status_code == 200
    assert response.json() == {"runs": [], "registry_state": "missing"}


def test_evidence_runs_list_latest_and_detail(tmp_path: Path) -> None:
    runs_root = tmp_path / "artifacts" / "runs"
    old_run = runs_root / "run-old"
    new_run = runs_root / "run-new"
    _write_manifest(old_run, "run-old")
    _write_manifest(
        new_run,
        "run-new",
        provenance={
            "source": "canonical",
            "correlationId": "corr-123",
            "linkedRunIds": ["rn_123"],
            "linkedTaskIds": ["task_123"],
        },
    )

    list_response = client.get("/api/evidence-runs?limit=10")
    assert list_response.status_code == 200
    payload = list_response.json()
    assert payload["registry_state"] == "available"
    assert payload["runs"][0]["run_id"] == "run-new"
    assert payload["runs"][0]["retention_state"] == "partial"

    latest_response = client.get("/api/evidence-runs/latest")
    assert latest_response.status_code == 200
    assert latest_response.json()["run"]["run_id"] == "run-new"

    detail_response = client.get("/api/evidence-runs/run-new")
    assert detail_response.status_code == 200
    detail = detail_response.json()["run"]
    assert detail["provenance"]["correlation_id"] == "corr-123"
    assert detail["provenance"]["linked_run_ids"] == ["rn_123"]
    assert detail["provenance"]["linked_task_ids"] == ["task_123"]
    assert "reports/proof.coverage.json" in detail["missing_paths"]


def test_promotion_candidate_reads_review_state_from_release_metadata(tmp_path: Path) -> None:
    run_dir = tmp_path / "artifacts" / "runs" / "run-promote"
    _write_manifest(
        run_dir,
        "run-promote",
        provenance={
            "source": "canonical",
            "correlationId": "corr-promote",
            "linkedRunIds": ["rn_promote"],
            "linkedTaskIds": ["task_promote"],
        },
    )
    (run_dir / "reports" / "proof.coverage.json").write_text("{}", encoding="utf-8")
    promotion_dir = tmp_path / "artifacts" / "release" / "promotion-candidates"
    promotion_dir.mkdir(parents=True, exist_ok=True)
    (promotion_dir / "run-promote.promotion-candidate.json").write_text(
        json.dumps({"reviewState": "review"}),
        encoding="utf-8",
    )

    response = client.get("/api/evidence-runs/run-promote/promotion-candidate")

    assert response.status_code == 200
    candidate = response.json()["candidate"]
    assert candidate["eligible"] is True
    assert candidate["review_state"] == "review"
    assert candidate["release_reference"].endswith("run-promote.promotion-candidate.md")
    assert candidate["showcase_reference"] == "docs/showcase/minimal-success-case.md#promotion-candidate-contract"
    assert candidate["supporting_share_pack_reference"].endswith("run-promote.share-pack.md")


def test_evidence_run_promotion_candidate_reports_release_metadata(tmp_path: Path) -> None:
    runs_root = tmp_path / "artifacts" / "runs"
    retained_run = runs_root / "run-promote"
    _write_manifest(
        retained_run,
        "run-promote",
        provenance={
            "source": "canonical",
            "correlationId": "corr-promote",
        },
    )
    (retained_run / "reports" / "proof.coverage.json").write_text("{}", encoding="utf-8")

    response = client.get("/api/evidence-runs/run-promote/promotion-candidate")

    assert response.status_code == 200
    candidate = response.json()["candidate"]
    assert candidate["eligible"] is True
    assert candidate["provenance_ready"] is True
    assert candidate["share_pack_ready"] is True
    assert candidate["compare_ready"] is False
    assert candidate["review_state"] == "candidate"
    assert candidate["reason_codes"] == []
    assert candidate["release_reference"].endswith("run-promote.promotion-candidate.md")
    assert (
        candidate["showcase_reference"]
        == "docs/showcase/minimal-success-case.md#promotion-candidate-contract"
    )
    assert candidate["supporting_share_pack_reference"].endswith("run-promote.share-pack.md")


def test_promotion_candidate_keeps_compare_ready_false_for_partial_compare(tmp_path: Path) -> None:
    runs_root = tmp_path / "artifacts" / "runs"
    baseline_run = runs_root / "run-promote"
    candidate_run = runs_root / "run-partial"
    _write_manifest(
        baseline_run,
        "run-promote",
        provenance={"source": "canonical", "correlationId": "corr-promote"},
    )
    _write_manifest(
        candidate_run,
        "run-partial",
        provenance={"source": "canonical", "correlationId": "corr-partial"},
    )
    (baseline_run / "reports" / "proof.coverage.json").write_text("{}", encoding="utf-8")

    response = client.get("/api/evidence-runs/run-promote/promotion-candidate?candidate_run_id=run-partial")

    assert response.status_code == 200
    candidate = response.json()["candidate"]
    assert candidate["compare_ready"] is False


def test_promotion_candidate_reports_compare_ready_for_two_retained_runs(tmp_path: Path) -> None:
    runs_root = tmp_path / "artifacts" / "runs"
    baseline_run = runs_root / "run-promote"
    candidate_run = runs_root / "run-retained"
    _write_manifest(
        baseline_run,
        "run-promote",
        provenance={"source": "canonical", "correlationId": "corr-promote"},
    )
    _write_manifest(
        candidate_run,
        "run-retained",
        provenance={"source": "canonical", "correlationId": "corr-retained"},
    )
    (baseline_run / "reports" / "proof.coverage.json").write_text("{}", encoding="utf-8")
    (candidate_run / "reports" / "proof.coverage.json").write_text("{}", encoding="utf-8")

    response = client.get("/api/evidence-runs/run-promote/promotion-candidate?candidate_run_id=run-retained")

    assert response.status_code == 200
    candidate = response.json()["candidate"]
    assert candidate["compare_ready"] is True


def test_hosted_review_workspace_api_returns_review_packet(tmp_path: Path) -> None:
    run_dir = tmp_path / "artifacts" / "runs" / "run-review"
    _write_manifest(
        run_dir,
        "run-review",
        provenance={"source": "canonical", "correlationId": "corr-review"},
    )
    (run_dir / "reports" / "proof.coverage.json").write_text("{}", encoding="utf-8")

    response = client.get("/api/evidence-runs/run-review/review-workspace")

    assert response.status_code == 200
    workspace = response.json()["workspace"]
    assert workspace["run_id"] == "run-review"
    assert workspace["workspace_state"] == "review_ready"
    assert workspace["retention_state"] == "retained"
    assert workspace["compare_state"] == "not_requested"
    assert workspace["share_pack"]["run_id"] == "run-review"
    assert workspace["promotion_candidate"]["run_id"] == "run-review"
    assert "not a hosted collaboration platform" in workspace["explanation"]["uncertainty"]
