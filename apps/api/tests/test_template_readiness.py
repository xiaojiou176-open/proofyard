from __future__ import annotations

import os
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import apps.api.app.core.access_control as access_control
from apps.api.app.main import app

TEST_AUTOMATION_TOKEN = "test-token-0123456789"

client = TestClient(
    app,
    headers={
        "x-automation-token": TEST_AUTOMATION_TOKEN,
        "x-automation-client-id": "pytest-template-readiness",
    },
)


@pytest.fixture(autouse=True)
def reset_universal_state(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTOMATION_API_TOKEN", TEST_AUTOMATION_TOKEN)
    access_control.reset_for_tests()
    universal_dir = Path(os.environ.get("UNIVERSAL_PLATFORM_DATA_DIR", ""))
    if not universal_dir:
        root = Path(__file__).resolve().parents[3]
        universal_dir = root / ".runtime-cache" / "automation" / "universal"
    if universal_dir.exists():
        shutil.rmtree(universal_dir)


def test_template_readiness_api_returns_selector_and_manual_gate_risk() -> None:
    session_id = client.post(
        "/api/sessions/start", json={"start_url": "https://example.com", "mode": "manual"}
    ).json()["session_id"]
    flow_id = client.post(
        "/api/flows",
        json={
            "session_id": session_id,
            "start_url": "https://example.com",
            "source_event_count": 3,
            "steps": [
                {
                    "step_id": "s1",
                    "action": "click",
                    "confidence": 0.5,
                    "target": {"selectors": [{"kind": "css", "value": "#submit", "score": 40}]},
                },
                {
                    "step_id": "s2",
                    "action": "manual_gate",
                    "manual_handoff_required": True,
                },
            ],
        },
    ).json()["flow_id"]
    template_id = client.post(
        "/api/templates",
        json={
            "flow_id": flow_id,
            "name": "ready-template",
            "params_schema": [],
            "defaults": {},
            "policies": {"otp": {"required": False, "provider": "manual"}},
        },
    ).json()["template_id"]

    response = client.get(f"/api/templates/{template_id}/readiness")
    assert response.status_code == 200
    payload = response.json()
    assert payload["template_id"] == template_id
    assert payload["selector_risk_count"] == 2
    assert payload["manual_gate_density"] == 0.5
    assert "s1" in payload["low_confidence_steps"]
    assert payload["high_risk_steps"][0]["step_id"] in {"s1", "s2"}
