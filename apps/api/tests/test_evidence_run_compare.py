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
        "x-automation-client-id": "pytest-evidence-compare",
    },
)


@pytest.fixture(autouse=True)
def reset_evidence_service(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTOMATION_API_TOKEN", TEST_AUTOMATION_TOKEN)
    monkeypatch.setenv("UIQ_RUNTIME_CACHE_ROOT", str(tmp_path))
    access_control.reset_for_tests()
    evidence_runs_api.evidence_run_service = EvidenceRunService()


def _write_manifest(run_dir: Path, run_id: str, *, gate_status: str, failed_checks: int, duration_ms: int) -> None:
    (run_dir / "reports").mkdir(parents=True, exist_ok=True)
    checks = [
        {
            "id": f"check_{index}",
            "expected": 0,
            "actual": 1,
            "severity": "BLOCKER",
            "status": "failed",
            "reasonCode": "gate.failed.unspecified",
            "evidencePath": "reports/summary.json",
        }
        for index in range(failed_checks)
    ]
    manifest = {
        "runId": run_id,
        "profile": "pr",
        "target": {"type": "web", "name": "web.local"},
        "timing": {
            "startedAt": "2026-03-29T09:00:00Z",
            "finishedAt": "2026-03-29T09:05:00Z",
            "durationMs": duration_ms,
        },
        "gateResults": {"status": gate_status, "checks": checks},
        "reports": {"report": "reports/summary.json"},
        "proof": {},
        "evidenceIndex": [
            {
                "id": "report.report",
                "source": "report",
                "kind": "report",
                "path": "reports/summary.json",
            }
        ],
        "states": [],
        "provenance": {"source": "canonical"},
    }
    (run_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (run_dir / "reports" / "summary.json").write_text("{}", encoding="utf-8")


def test_evidence_run_compare_api_returns_deltas(tmp_path: Path) -> None:
    runs_root = tmp_path / "artifacts" / "runs"
    _write_manifest(runs_root / "run-a", "run-a", gate_status="passed", failed_checks=0, duration_ms=1000)
    _write_manifest(runs_root / "run-b", "run-b", gate_status="failed", failed_checks=2, duration_ms=1600)

    response = client.get("/api/evidence-runs/run-a/compare/run-b")
    assert response.status_code == 200
    compare = response.json()["compare"]
    assert compare["baseline_run_id"] == "run-a"
    assert compare["candidate_run_id"] == "run-b"
    assert compare["compare_state"] == "ready"
    assert compare["gate_status_delta"] == {"baseline": "passed", "candidate": "failed"}
    assert compare["summary_delta"]["duration_ms"] == 600
    assert compare["summary_delta"]["failed_checks"] == 2
