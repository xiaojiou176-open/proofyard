from __future__ import annotations

import importlib
import os

from fastapi.testclient import TestClient
import pytest

import apps.api.app.api.computer_use as computer_use_api
import apps.api.app.core.access_control as access_control
import apps.api.app.core.observability as observability
from apps.api.app.services.computer_use_service import (
    ComputerUseAction,
    ComputerUseServiceError,
    ComputerUseSession,
)

observability.os = os
app = importlib.import_module("apps.api.app.main").app
client = TestClient(
    app,
    headers={"x-automation-token": "test-token", "x-automation-client-id": "pytest-computer-use"},
)


@pytest.fixture(autouse=True)
def _setup_access(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTOMATION_API_TOKEN", "test-token")
    access_control.reset_for_tests()


def test_create_session_returns_session_id(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_create_session(
        *, instruction: str, actor: str, model: str | None = None, metadata: dict | None = None
    ):
        assert instruction == "open github"
        assert actor
        return ComputerUseSession(
            session_id="cus_" + "a" * 32,
            instruction=instruction,
            model=model or "gemini-3.1-pro-preview",
            created_at="2026-02-22T00:00:00+00:00",
            created_by=actor,
            metadata=metadata or {},
        )

    monkeypatch.setattr(
        computer_use_api.computer_use_service, "create_session", fake_create_session
    )

    response = client.post("/api/computer-use/sessions", json={"instruction": "open github"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"] == "cus_" + "a" * 32
    assert payload["model"] == "gemini-3.1-pro-preview"


def test_preview_confirm_execute_closed_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    session_id = "cus_" + "b" * 32
    action_id = "act_preview001"

    def fake_preview_action(**kwargs):
        assert kwargs["session_id"] == session_id
        return ComputerUseAction(
            action_id=action_id,
            name="click",
            args={"x": 100, "y": 120},
            rationale="open menu",
            risk_level="high",
            confirmation_reason="contains sensitive action",
            action_digest="abc123digest",
            require_confirmation=True,
            safety_decision="require_confirmation",
        )

    def fake_confirm_action(**kwargs):
        assert kwargs["action_id"] == action_id
        return ComputerUseAction(
            action_id=action_id,
            name="click",
            args={"x": 100, "y": 120},
            rationale="open menu",
            risk_level="high",
            confirmation_reason="approved by operator",
            action_digest="abc123digest",
            require_confirmation=True,
            safety_decision="require_confirmation",
            status="confirmed",
            confirmed_by="pytest",
        )

    def fake_execute_action(**kwargs):
        assert kwargs["action_id"] == action_id
        return {
            "actionId": action_id,
            "status": "executed",
            "executor": "backend-playwright-adapter",
            "executedAt": "2026-02-22T00:00:10+00:00",
            "executedBy": "pytest",
            "appliedArgs": {"x": 100, "y": 120},
            "riskLevel": "high",
            "confirmationReason": "approved by operator",
            "actionDigest": "abc123digest",
            "evidence": {
                "screens": [".runtime-cache/automation/computer-use/test.png"],
                "clips": [],
                "network_summary": {"request_count": 2},
                "dom_summary": {"title": "home"},
                "replay_trace": {"steps": [{"step": "click"}]},
            },
        }

    monkeypatch.setattr(
        computer_use_api.computer_use_service, "preview_action", fake_preview_action
    )
    monkeypatch.setattr(
        computer_use_api.computer_use_service, "confirm_action", fake_confirm_action
    )
    monkeypatch.setattr(
        computer_use_api.computer_use_service, "execute_action", fake_execute_action
    )

    preview = client.post(
        f"/api/computer-use/sessions/{session_id}/preview", json={"screenshot_base64": None}
    )
    assert preview.status_code == 200
    assert preview.json()["require_confirmation"] is True
    assert preview.json()["risk_level"] == "high"

    confirm = client.post(
        f"/api/computer-use/sessions/{session_id}/confirm/{action_id}",
        json={"approved": True, "confirmation_reason": "approved by operator"},
    )
    assert confirm.status_code == 200
    assert confirm.json()["status"] == "confirmed"

    execute = client.post(f"/api/computer-use/sessions/{session_id}/execute/{action_id}")
    assert execute.status_code == 200
    assert execute.json()["status"] == "executed"
    assert execute.json()["executor"] == "backend-playwright-adapter"
    assert execute.json()["evidence"]["network_summary"]["request_count"] == 2


def test_execute_maps_confirmation_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_execute_action(**kwargs):
        raise ComputerUseServiceError(
            "action requires confirmation before execution", status_code=409
        )

    monkeypatch.setattr(
        computer_use_api.computer_use_service, "execute_action", fake_execute_action
    )

    response = client.post(f"/api/computer-use/sessions/{'cus_' + 'c' * 32}/execute/act_missing")
    assert response.status_code == 409
    assert response.json()["detail"] == "action requires confirmation before execution"


def test_read_evidence_returns_events(monkeypatch: pytest.MonkeyPatch) -> None:
    session_id = "cus_" + "d" * 32

    def fake_read_evidence(*, session_id: str):
        return {
            "sessionId": session_id,
            "eventCount": 2,
            "events": [
                {"event": "session_created"},
                {"event": "action_executed"},
            ],
            "evidencePath": ".runtime-cache/automation/computer-use/evidence.jsonl",
        }

    monkeypatch.setattr(computer_use_api.computer_use_service, "read_evidence", fake_read_evidence)

    response = client.get(f"/api/computer-use/sessions/{session_id}/evidence")
    assert response.status_code == 200
    payload = response.json()
    assert payload["event_count"] == 2
    assert len(payload["events"]) == 2


def test_computer_use_requires_token() -> None:
    raw_client = TestClient(app)
    response = raw_client.post("/api/computer-use/sessions", json={"instruction": "open browser"})
    assert response.status_code == 401
    assert response.json()["detail"] == "invalid automation token"
