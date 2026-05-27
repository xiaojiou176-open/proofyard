from __future__ import annotations

import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import apps.api.app.core.access_control as access_control
from apps.api.app.main import app
from apps.api.app.services.automation_service import RunningTask, automation_service
from apps.api.app.services.universal_platform_service import UniversalPlatformService
from apps.api.app.services.universal_platform_service import universal_platform_service

TEST_AUTOMATION_TOKEN = "test-token-0123456789"

client = TestClient(
    app,
    headers={
        "x-automation-token": TEST_AUTOMATION_TOKEN,
        "x-automation-client-id": "pytest-universal",
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
    fresh_service = UniversalPlatformService()
    universal_platform_service.__dict__.clear()
    universal_platform_service.__dict__.update(fresh_service.__dict__)


def _mock_run_command(monkeypatch: pytest.MonkeyPatch) -> None:
    counter = {"n": 0}

    def fake_run_command(
        command_id: str, env_overrides: dict[str, str], *, requested_by: str | None
    ):
        counter["n"] += 1
        now = datetime.now(timezone.utc)
        task_id = f"mock-task-{counter['n']}"
        return RunningTask(
            task_id=task_id,
            command_id=command_id,
            status="queued",
            created_at=now,
            requested_by=requested_by,
            message=f"mocked with env keys={sorted(env_overrides.keys())}",
        ).snapshot()

    monkeypatch.setattr(automation_service, "run_command", fake_run_command)


def test_universal_json_decode_error_moves_corrupt_file_to_quarantine(tmp_path: Path) -> None:
    broken_path = tmp_path / "runs.json"
    broken_path.write_text("{ broken", encoding="utf-8")

    rows = universal_platform_service._read_json(broken_path)

    assert rows == []
    assert not broken_path.exists()
    assert broken_path.with_suffix(".json.corrupt").exists()


def test_template_defaults_reject_unknown_keys() -> None:
    session_id = client.post(
        "/api/sessions/start", json={"start_url": "https://example.com", "mode": "manual"}
    ).json()["session_id"]
    flow_id = client.post(
        "/api/flows",
        json={
            "session_id": session_id,
            "start_url": "https://example.com",
            "steps": [{"step_id": "s1", "action": "navigate", "url": "https://example.com"}],
        },
    ).json()["flow_id"]
    resp = client.post(
        "/api/templates",
        json={
            "flow_id": flow_id,
            "name": "bad-defaults",
            "params_schema": [{"key": "email", "type": "email", "required": True}],
            "defaults": {"email": "a@example.com", "unexpected": "x"},
            "policies": {"otp": {"required": False, "provider": "manual"}},
        },
    )
    assert resp.status_code == 422
    assert "unknown defaults keys" in resp.json()["detail"]


def test_run_params_reject_unknown_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_run_command(monkeypatch)
    session_id = client.post(
        "/api/sessions/start", json={"start_url": "https://example.com", "mode": "manual"}
    ).json()["session_id"]
    flow_id = client.post(
        "/api/flows",
        json={
            "session_id": session_id,
            "start_url": "https://example.com",
            "steps": [{"step_id": "s1", "action": "navigate", "url": "https://example.com"}],
        },
    ).json()["flow_id"]
    template_id = client.post(
        "/api/templates",
        json={
            "flow_id": flow_id,
            "name": "run-whitelist",
            "params_schema": [{"key": "email", "type": "email", "required": True}],
            "defaults": {"email": "a@example.com"},
            "policies": {"otp": {"required": False, "provider": "manual"}},
        },
    ).json()["template_id"]
    resp = client.post(
        "/api/runs",
        json={"template_id": template_id, "params": {"email": "x@example.com", "bad": "1"}},
    )
    assert resp.status_code == 422
    assert "unknown run params keys" in resp.json()["detail"]


def test_universal_resources_enforce_owner_closure(monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_run_command(monkeypatch)
    session = universal_platform_service.start_session(
        "https://example.com", "manual", owner="owner"
    )
    flow = universal_platform_service.create_flow(
        session_id=session.session_id,
        start_url="https://example.com",
        steps=[{"step_id": "s1", "action": "navigate", "url": "https://example.com"}],
        requester="owner",
    )
    template = universal_platform_service.create_template(
        flow_id=flow.flow_id,
        name="owned-template",
        params_schema=[],
        defaults={},
        policies={"otp": {"required": False, "provider": "manual"}},
        created_by="owner",
    )
    run = universal_platform_service.create_run(template.template_id, params={}, actor="owner")
    assert universal_platform_service.list_runs(requester="attacker") == []
    with pytest.raises(HTTPException):
        universal_platform_service.get_flow(flow.flow_id, requester="attacker")
    with pytest.raises(HTTPException):
        universal_platform_service.get_template(template.template_id, requester="attacker")
    with pytest.raises(HTTPException):
        universal_platform_service.get_run(run.run_id, requester="attacker")
    assert universal_platform_service.get_run(run.run_id, requester="owner").run_id == run.run_id


def test_run_log_detail_redaction(monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_run_command(monkeypatch)
    session_id = client.post(
        "/api/sessions/start", json={"start_url": "https://example.com", "mode": "manual"}
    ).json()["session_id"]
    flow_id = client.post(
        "/api/flows",
        json={
            "session_id": session_id,
            "start_url": "https://example.com",
            "steps": [{"step_id": "s1", "action": "navigate", "url": "https://example.com"}],
        },
    ).json()["flow_id"]
    template_id = client.post(
        "/api/templates",
        json={
            "flow_id": flow_id,
            "name": "redaction-template",
            "params_schema": [],
            "defaults": {},
            "policies": {"otp": {"required": False, "provider": "manual"}},
        },
    ).json()["template_id"]
    run = client.post("/api/runs", json={"template_id": template_id, "params": {}}).json()["run"]
    run_id = run["run_id"]
    task_id = run["task_id"]
    now = datetime.now(timezone.utc)

    def fake_get_task(_task_id: str, requested_by: str | None = None):
        return RunningTask(
            task_id=task_id,
            command_id="automation-replay-flow",
            status="success",
            created_at=now,
            output_lines=[
                json.dumps(
                    {
                        "stepResults": [
                            {
                                "step_id": "s1",
                                "action": "navigate",
                                "ok": False,
                                "detail": "otp=123456 token=abc key=q password=p secret=s card=4111111111111111",
                            }
                        ]
                    }
                )
            ],
        ).snapshot()

    monkeypatch.setattr(automation_service, "get_task", fake_get_task)
    fetched = client.get(f"/api/runs/{run_id}")
    assert fetched.status_code == 200
    message = fetched.json()["run"]["logs"][-1]["message"]
    assert "123456" not in message
    assert "abc" not in message
    assert "4111111111111111" not in message


def test_template_secret_defaults_never_persist_even_for_stripe_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session_id = client.post(
        "/api/sessions/start", json={"start_url": "https://stripe.example.com", "mode": "manual"}
    ).json()["session_id"]
    flow_id = client.post(
        "/api/flows",
        json={
            "session_id": session_id,
            "start_url": "https://stripe.example.com",
            "steps": [{"step_id": "s1", "action": "navigate", "url": "https://stripe.example.com"}],
        },
    ).json()["flow_id"]

    resp = client.post(
        "/api/templates",
        json={
            "flow_id": flow_id,
            "name": "stripe-defaults",
            "params_schema": [
                {"key": "stripeCardNumber", "type": "secret", "required": True},
                {"key": "email", "type": "email", "required": True},
            ],
            "defaults": {"stripeCardNumber": "4242424242424242", "email": "buyer@example.com"},
            "policies": {"otp": {"required": False, "provider": "manual"}},
        },
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert "stripeCardNumber" not in payload["defaults"]
    assert payload["defaults"]["email"] == "buyer@example.com"

    universal_dir = Path(os.environ.get("UNIVERSAL_PLATFORM_DATA_DIR", ""))
    if not universal_dir:
        root = Path(__file__).resolve().parents[3]
        universal_dir = root / ".runtime-cache" / "automation" / "universal"
    templates_path = universal_dir / "templates.json"
    stored_templates = json.loads(templates_path.read_text(encoding="utf-8"))
    stored_template = next(
        item for item in stored_templates if item["template_id"] == payload["template_id"]
    )
    assert "stripeCardNumber" not in stored_template.get("defaults", {})
    assert "4242424242424242" not in templates_path.read_text(encoding="utf-8")
    _mock_run_command(monkeypatch)
    run_resp = client.post(
        "/api/runs",
        json={
            "template_id": payload["template_id"],
            "params": {"stripeCardNumber": "4242424242424242", "email": "buyer@example.com"},
        },
    )
    assert run_resp.status_code == 200
    run_payload = run_resp.json()["run"]
    assert run_payload["params"]["email"] == "buyer@example.com"
    assert "stripeCardNumber" not in run_payload["params"]


def test_run_responses_do_not_expose_validated_params_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_run_command(monkeypatch)
    session_id = client.post(
        "/api/sessions/start", json={"start_url": "https://example.com", "mode": "manual"}
    ).json()["session_id"]
    flow_id = client.post(
        "/api/flows",
        json={
            "session_id": session_id,
            "start_url": "https://example.com",
            "steps": [{"step_id": "s1", "action": "navigate", "url": "https://example.com"}],
        },
    ).json()["flow_id"]
    template_id = client.post(
        "/api/templates",
        json={
            "flow_id": flow_id,
            "name": "no-snapshot-response",
            "params_schema": [{"key": "username", "type": "string", "required": True}],
            "defaults": {"username": "default-user"},
            "policies": {"otp": {"required": False, "provider": "manual"}},
        },
    ).json()["template_id"]

    created = client.post(
        "/api/runs", json={"template_id": template_id, "params": {"username": "alice"}}
    )
    assert created.status_code == 200
    run_id = created.json()["run"]["run_id"]
    assert "validated_params_snapshot" not in created.json()["run"]

    fetched = client.get(f"/api/runs/{run_id}")
    assert fetched.status_code == 200
    assert "validated_params_snapshot" not in fetched.json()["run"]

    listed = client.get("/api/runs?limit=20")
    assert listed.status_code == 200
    target = next(item for item in listed.json()["runs"] if item["run_id"] == run_id)
    assert "validated_params_snapshot" not in target
