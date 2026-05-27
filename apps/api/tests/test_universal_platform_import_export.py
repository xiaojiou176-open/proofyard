from __future__ import annotations

import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import apps.api.app.core.access_control as access_control
from apps.api.app.main import app
from apps.api.app.services.automation_service import RunningTask, automation_service

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


def test_import_latest_flow_rejects_session_dir_outside_runtime_root(tmp_path: Path) -> None:
    runtime = Path(os.environ["UNIVERSAL_AUTOMATION_RUNTIME_DIR"])
    runtime.mkdir(parents=True, exist_ok=True)
    outside = tmp_path / "outside-session"
    outside.mkdir(parents=True, exist_ok=True)
    (outside / "flow-draft.json").write_text(
        json.dumps(
            {
                "start_url": "https://outside.example.com",
                "steps": [{"step_id": "s1", "action": "navigate"}],
            }
        ),
        encoding="utf-8",
    )
    (runtime / "latest-session.json").write_text(
        json.dumps({"sessionId": "ss_out", "sessionDir": str(outside)}),
        encoding="utf-8",
    )
    resp = client.post("/api/flows/import-latest")
    assert resp.status_code == 400
    assert "outside runtime root" in resp.json()["detail"]


def test_universal_import_latest_flow_and_patch() -> None:
    runtime = Path(os.environ.get("UNIVERSAL_AUTOMATION_RUNTIME_DIR", ""))
    if not runtime:
        root = Path(__file__).resolve().parents[3]
        runtime = root / ".runtime-cache" / "automation"
    session_dir = runtime / "pytest-universal-import"
    runtime.mkdir(parents=True, exist_ok=True)
    session_dir.mkdir(parents=True, exist_ok=True)
    (runtime / "latest-session.json").write_text(
        json.dumps(
            {"sessionId": "ss_import", "sessionDir": str(session_dir)}, ensure_ascii=False, indent=2
        ),
        encoding="utf-8",
    )
    (session_dir / "flow-draft.json").write_text(
        json.dumps(
            {
                "start_url": "https://import.example.com",
                "source_event_count": 3,
                "steps": [
                    {"step_id": "s1", "action": "navigate", "url": "https://import.example.com"}
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    imported = client.post("/api/flows/import-latest")
    assert imported.status_code == 200
    flow_id = imported.json()["flow_id"]
    assert imported.json()["session_id"] == "ss_import"

    patched = client.patch(
        f"/api/flows/{flow_id}",
        json={
            "start_url": "https://import-updated.example.com",
            "steps": [
                {"step_id": "s1", "action": "navigate", "url": "https://import-updated.example.com"}
            ],
        },
    )
    assert patched.status_code == 200
    assert patched.json()["start_url"] == "https://import-updated.example.com"


def test_import_latest_flow_create_run_materializes_replay_bridge(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime = Path(os.environ.get("UNIVERSAL_AUTOMATION_RUNTIME_DIR", ""))
    if not runtime:
        root = Path(__file__).resolve().parents[3]
        runtime = root / ".runtime-cache" / "automation"
    session_dir = runtime / "pytest-universal-import"
    runtime.mkdir(parents=True, exist_ok=True)
    session_dir.mkdir(parents=True, exist_ok=True)
    (runtime / "latest-session.json").write_text(
        json.dumps(
            {"sessionId": "ss_import", "sessionDir": str(session_dir)}, ensure_ascii=False, indent=2
        ),
        encoding="utf-8",
    )
    (session_dir / "flow-draft.json").write_text(
        json.dumps(
            {
                "start_url": "https://import.example.com",
                "source_event_count": 1,
                "steps": [
                    {"step_id": "s1", "action": "navigate", "url": "https://import.example.com"}
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    imported = client.post("/api/flows/import-latest")
    assert imported.status_code == 200
    flow_id = imported.json()["flow_id"]

    captured_env: dict[str, str] = {}

    def fake_run_command(
        command_id: str, env_overrides: dict[str, str], *, requested_by: str | None
    ):
        captured_env.clear()
        captured_env.update(env_overrides)
        now = datetime.now(timezone.utc)
        return RunningTask(
            task_id="mock-import-bridge",
            command_id=command_id,
            status="queued",
            created_at=now,
            requested_by=requested_by,
        ).snapshot()

    monkeypatch.setattr(automation_service, "run_command", fake_run_command)

    template = client.post(
        "/api/templates",
        json={
            "flow_id": flow_id,
            "name": "import-bridge-template",
            "params_schema": [],
            "defaults": {},
            "policies": {"otp": {"required": False, "provider": "manual"}},
        },
    )
    assert template.status_code == 200
    template_id = template.json()["template_id"]

    run = client.post("/api/runs", json={"template_id": template_id, "params": {}})
    assert run.status_code == 200
    assert captured_env["FLOW_SESSION_ID"] == "ss_import"

    bridged_flow = runtime / "ss_import" / "flow-draft.json"
    assert bridged_flow.exists()
    payload = json.loads(bridged_flow.read_text(encoding="utf-8"))
    assert payload["start_url"] == "https://import.example.com"
    assert payload["steps"][0]["step_id"] == "s1"


def test_template_export_import_roundtrip_preserves_flow_and_scrubs_defaults() -> None:
    session_id = client.post(
        "/api/sessions/start", json={"start_url": "https://exchange.example.com", "mode": "manual"}
    ).json()["session_id"]
    flow_id = client.post(
        "/api/flows",
        json={
            "session_id": session_id,
            "start_url": "https://exchange.example.com",
            "steps": [{"step_id": "s1", "action": "navigate", "url": "https://exchange.example.com"}],
        },
    ).json()["flow_id"]
    template_id = client.post(
        "/api/templates",
        json={
            "flow_id": flow_id,
            "name": "checkout-template",
            "params_schema": [
                {"key": "email", "type": "email", "required": True},
                {"key": "password", "type": "secret", "required": True},
            ],
            "defaults": {"email": "demo@example.com", "password": "plain-secret"},
            "policies": {"otp": {"required": False, "provider": "manual"}},
        },
    ).json()["template_id"]

    exported = client.get(f"/api/templates/{template_id}/export")
    assert exported.status_code == 200
    payload = exported.json()
    assert payload["defaults"].get("password") in (None, "***")

    imported = client.post(
        "/api/templates/import",
        json={"template": payload, "name": "checkout-template-imported"},
    )
    assert imported.status_code == 200
    body = imported.json()
    assert body["template_id"] != template_id
    assert body["flow_id"] == flow_id
    assert body["name"] == "checkout-template-imported"
    assert body["defaults"] == {"email": "demo@example.com"}
