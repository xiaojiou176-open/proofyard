from __future__ import annotations

import json
import os
import shutil
import threading
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


def test_otp_resume_reuses_run_snapshot_not_template_defaults(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured_env: dict[str, str] = {}

    def fake_run_command(
        command_id: str, env_overrides: dict[str, str], *, requested_by: str | None
    ):
        captured_env.clear()
        captured_env.update(env_overrides)
        now = datetime.now(timezone.utc)
        return RunningTask(
            task_id="mock-task-snapshot",
            command_id=command_id,
            status="queued",
            created_at=now,
            requested_by=requested_by,
        ).snapshot()

    monkeypatch.setattr(automation_service, "run_command", fake_run_command)
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
            "name": "otp-snapshot",
            "params_schema": [{"key": "username", "type": "string", "required": True}],
            "defaults": {"username": "default-name"},
            "policies": {
                "otp": {"required": True, "provider": "manual", "regex": "\\b(\\d{6})\\b"}
            },
        },
    ).json()["template_id"]
    run_id = client.post(
        "/api/runs", json={"template_id": template_id, "params": {"username": "snapshot-name"}}
    ).json()["run"]["run_id"]
    assert (
        client.patch(
            f"/api/templates/{template_id}", json={"defaults": {"username": "changed-default"}}
        ).status_code
        == 200
    )
    resumed = client.post(f"/api/runs/{run_id}/otp", json={"otp_code": "123456"})
    assert resumed.status_code == 200
    assert captured_env.get("FLOW_INPUT") == "snapshot-name"


def test_universal_matrix_otp_manual_resume(monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_run_command(monkeypatch)
    session_id = client.post(
        "/api/sessions/start", json={"start_url": "https://example.com/register", "mode": "manual"}
    ).json()["session_id"]
    flow_id = client.post(
        "/api/flows",
        json={
            "session_id": session_id,
            "start_url": "https://example.com/register",
            "steps": [
                {"step_id": "s1", "action": "navigate", "url": "https://example.com/register"},
                {"step_id": "s2", "action": "type", "value_ref": "${params.otp}"},
            ],
        },
    ).json()["flow_id"]
    template_id = client.post(
        "/api/templates",
        json={
            "flow_id": flow_id,
            "name": "otp-template",
            "params_schema": [{"key": "otp", "type": "secret", "required": True}],
            "defaults": {},
            "policies": {
                "otp": {"required": True, "provider": "manual", "regex": "\\b(\\d{6})\\b"}
            },
        },
    ).json()["template_id"]

    first_run = client.post("/api/runs", json={"template_id": template_id, "params": {}})
    assert first_run.status_code == 200
    run_id = first_run.json()["run"]["run_id"]
    assert first_run.json()["run"]["status"] == "waiting_otp"
    assert first_run.json()["run"]["task_id"] is None
    assert "validated_params_snapshot" not in first_run.json()["run"]

    resume_without_code = client.post(f"/api/runs/{run_id}/otp", json={})
    assert resume_without_code.status_code == 422
    assert resume_without_code.json()["detail"] == "otp_code is required"

    resume = client.post(f"/api/runs/{run_id}/otp", json={"otp_code": "123456"})
    assert resume.status_code == 200
    assert resume.json()["run"]["status"] == "queued"
    assert resume.json()["run"]["task_id"] is not None
    assert resume.json()["run"]["correlation_id"].startswith("corr_")
    assert "validated_params_snapshot" not in resume.json()["run"]


def test_run_correlation_is_written_into_run_and_task_env(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_env: dict[str, str] = {}

    def fake_run_command(
        command_id: str, env_overrides: dict[str, str], *, requested_by: str | None
    ):
        captured_env.clear()
        captured_env.update(env_overrides)
        now = datetime.now(timezone.utc)
        return RunningTask(
            task_id="task-correlation",
            command_id=command_id,
            status="queued",
            created_at=now,
            requested_by=requested_by,
            correlation_id=env_overrides.get("UIQ_RUN_CORRELATION_ID"),
            linked_run_id=env_overrides.get("UIQ_LINKED_RUN_ID"),
        ).snapshot()

    monkeypatch.setattr(automation_service, "run_command", fake_run_command)
    session_id = client.post(
        "/api/sessions/start", json={"start_url": "https://example.com/register", "mode": "manual"}
    ).json()["session_id"]
    flow_id = client.post(
        "/api/flows",
        json={
            "session_id": session_id,
            "start_url": "https://example.com/register",
            "steps": [
                {"step_id": "s1", "action": "navigate", "url": "https://example.com/register"}
            ],
        },
    ).json()["flow_id"]
    template_id = client.post(
        "/api/templates",
        json={
            "flow_id": flow_id,
            "name": "corr-template",
            "params_schema": [],
            "defaults": {},
            "policies": {"otp": {"required": False, "provider": "manual"}},
        },
    ).json()["template_id"]

    response = client.post("/api/runs", json={"template_id": template_id, "params": {}})
    assert response.status_code == 200
    run = response.json()["run"]
    assert run["correlation_id"].startswith("corr_")
    assert run["artifacts_ref"]["correlation_id"] == run["correlation_id"]
    assert run["artifacts_ref"]["linked_task_id"] == "task-correlation"
    assert captured_env["FLOW_SESSION_ID"] == session_id
    assert captured_env["UIQ_RUN_CORRELATION_ID"] == run["correlation_id"]
    assert captured_env["UIQ_LINKED_RUN_ID"] == run["run_id"]


def test_universal_sessions_finish_and_list() -> None:
    first = client.post(
        "/api/sessions/start", json={"start_url": "https://a.example.com", "mode": "manual"}
    )
    second = client.post(
        "/api/sessions/start", json={"start_url": "https://b.example.com", "mode": "ai"}
    )
    assert first.status_code == 200
    assert second.status_code == 200
    session_id = first.json()["session_id"]

    finished = client.post(f"/api/sessions/{session_id}/finish")
    assert finished.status_code == 200
    assert finished.json()["finished_at"] is not None

    listed = client.get("/api/sessions?limit=10")
    assert listed.status_code == 200
    assert len(listed.json()["sessions"]) >= 2


def test_universal_run_otp_conflict(monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_run_command(monkeypatch)
    session_id = client.post(
        "/api/sessions/start", json={"start_url": "https://x.example.com", "mode": "manual"}
    ).json()["session_id"]
    flow_id = client.post(
        "/api/flows",
        json={
            "session_id": session_id,
            "start_url": "https://x.example.com",
            "steps": [{"step_id": "s1", "action": "navigate", "url": "https://x.example.com"}],
        },
    ).json()["flow_id"]
    template_id = client.post(
        "/api/templates",
        json={
            "flow_id": flow_id,
            "name": "non-otp-template",
            "params_schema": [{"key": "username", "type": "string", "required": True}],
            "defaults": {"username": "a"},
            "policies": {"otp": {"required": False, "provider": "manual"}},
        },
    ).json()["template_id"]
    run_id = client.post(
        "/api/runs", json={"template_id": template_id, "params": {"username": "b"}}
    ).json()["run"]["run_id"]
    otp = client.post(f"/api/runs/{run_id}/otp", json={"otp_code": "123456"})
    assert otp.status_code == 409


def test_run_recovery_plan_api_returns_waiting_otp_guidance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_run_command(monkeypatch)
    session_id = client.post(
        "/api/sessions/start", json={"start_url": "https://x.example.com", "mode": "manual"}
    ).json()["session_id"]
    flow_id = client.post(
        "/api/flows",
        json={
            "session_id": session_id,
            "start_url": "https://x.example.com",
            "steps": [{"step_id": "s1", "action": "navigate", "url": "https://x.example.com"}],
        },
    ).json()["flow_id"]
    template_id = client.post(
        "/api/templates",
        json={
            "flow_id": flow_id,
            "name": "otp-template",
            "params_schema": [{"key": "otp", "type": "secret", "required": True}],
            "defaults": {},
            "policies": {
                "otp": {"required": True, "provider": "manual", "regex": "\\b(\\d{6})\\b"}
            },
        },
    ).json()["template_id"]
    run_id = client.post("/api/runs", json={"template_id": template_id, "params": {}}).json()[
        "run"
    ]["run_id"]

    response = client.get(f"/api/runs/{run_id}/recover-plan")
    assert response.status_code == 200
    plan = response.json()["plan"]
    assert plan["run_id"] == run_id
    assert plan["primary_action"]["action_id"] == "submit_otp"
    assert plan["primary_action"]["requires_input"] is True
    assert plan["primary_action"]["safety_level"] == "manual_only"


def test_universal_run_otp_resume_concurrent_only_one_succeeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: dict[str, int] = {"count": 0}
    calls_lock = threading.Lock()

    def fake_run_command(
        command_id: str, env_overrides: dict[str, str], *, requested_by: str | None
    ):
        with calls_lock:
            calls["count"] += 1
        now = datetime.now(timezone.utc)
        return RunningTask(
            task_id=f"concurrent-task-{calls['count']}",
            command_id=command_id,
            status="queued",
            created_at=now,
            requested_by=requested_by,
        ).snapshot()

    monkeypatch.setattr(automation_service, "run_command", fake_run_command)

    session = universal_platform_service.start_session(
        "https://otp-concurrency.example.com", "manual", owner="owner-a"
    )
    flow = universal_platform_service.create_flow(
        session_id=session.session_id,
        start_url="https://otp-concurrency.example.com",
        steps=[
            {"step_id": "s1", "action": "navigate", "url": "https://otp-concurrency.example.com"}
        ],
        requester="owner-a",
    )
    template = universal_platform_service.create_template(
        flow_id=flow.flow_id,
        name="otp-concurrency",
        params_schema=[{"key": "otp", "type": "secret", "required": True}],
        defaults={},
        policies={"otp": {"required": True, "provider": "manual", "regex": r"\b(\d{6})\b"}},
        created_by="owner-a",
    )
    run = universal_platform_service.create_run(template.template_id, params={}, actor="owner-a")
    assert run.status == "waiting_otp"

    barrier = threading.Barrier(2)
    results: list[tuple[str, int | str]] = []
    results_lock = threading.Lock()

    def worker() -> None:
        barrier.wait()
        try:
            resumed = universal_platform_service.submit_otp_and_resume(
                run.run_id, "123456", actor="owner-a"
            )
            with results_lock:
                results.append(("ok", resumed.status))
        except HTTPException as exc:
            with results_lock:
                results.append(("err", exc.status_code))

    threads = [threading.Thread(target=worker), threading.Thread(target=worker)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=5)

    assert len(results) == 2
    assert ("ok", "queued") in results
    assert ("err", 409) in results
    assert calls["count"] == 1


def test_universal_run_step_logs_visualized_from_task_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_run_command(monkeypatch)
    session_id = client.post(
        "/api/sessions/start", json={"start_url": "https://steps.example.com", "mode": "manual"}
    ).json()["session_id"]
    flow_id = client.post(
        "/api/flows",
        json={
            "session_id": session_id,
            "start_url": "https://steps.example.com",
            "steps": [
                {"step_id": "s1", "action": "navigate", "url": "https://steps.example.com"},
                {"step_id": "s2", "action": "click"},
            ],
        },
    ).json()["flow_id"]
    template_id = client.post(
        "/api/templates",
        json={
            "flow_id": flow_id,
            "name": "step-log-template",
            "params_schema": [],
            "defaults": {},
            "policies": {"otp": {"required": False, "provider": "manual"}},
        },
    ).json()["template_id"]
    run = client.post("/api/runs", json={"template_id": template_id, "params": {}}).json()["run"]
    run_id = run["run_id"]
    task_id = run["task_id"]
    assert task_id

    now = datetime.now(timezone.utc)

    def fake_get_task(_task_id: str, requested_by: str | None = None):
        assert _task_id == task_id
        return RunningTask(
            task_id=task_id,
            command_id="automation-replay-flow",
            status="success",
            created_at=now,
            output_lines=[
                json.dumps(
                    {
                        "stepResults": [
                            {"step_id": "s1", "action": "navigate", "ok": True, "detail": "ok"},
                            {
                                "step_id": "s2",
                                "action": "click",
                                "ok": False,
                                "detail": "selector missing",
                            },
                        ]
                    }
                )
            ],
        ).snapshot()

    monkeypatch.setattr(automation_service, "get_task", fake_get_task)
    fetched = client.get(f"/api/runs/{run_id}")
    assert fetched.status_code == 200
    payload = fetched.json()["run"]
    assert payload["step_cursor"] == 2
    assert any("step s1" in item["message"] for item in payload["logs"])
    assert any("step s2" in item["message"] for item in payload["logs"])


def test_manual_gate_maps_waiting_user_with_wait_context(monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_run_command(monkeypatch)
    session_id = client.post(
        "/api/sessions/start", json={"start_url": "https://gate.example.com", "mode": "manual"}
    ).json()["session_id"]
    flow_id = client.post(
        "/api/flows",
        json={
            "session_id": session_id,
            "start_url": "https://gate.example.com",
            "steps": [{"step_id": "s1", "action": "navigate", "url": "https://gate.example.com"}],
        },
    ).json()["flow_id"]
    template_id = client.post(
        "/api/templates",
        json={
            "flow_id": flow_id,
            "name": "manual-gate-template",
            "params_schema": [],
            "defaults": {},
            "policies": {"otp": {"required": False, "provider": "manual"}},
        },
    ).json()["template_id"]
    run_payload = client.post("/api/runs", json={"template_id": template_id, "params": {}}).json()[
        "run"
    ]
    run_id = run_payload["run_id"]
    task_id = run_payload["task_id"]
    now = datetime.now(timezone.utc)

    def fake_get_task(_task_id: str, requested_by: str | None = None):
        assert _task_id == task_id
        return RunningTask(
            task_id=task_id,
            command_id="automation-replay-flow",
            status="running",
            created_at=now,
            output_lines=[
                json.dumps(
                    {
                        "stepResults": [
                            {"step_id": "s1", "action": "navigate", "ok": True, "detail": "ok"}
                        ],
                        "manualGate": {
                            "reasonCode": "captcha_required",
                            "atStepId": "s2",
                            "afterStepId": "s1",
                            "resumeFromStepId": "s3",
                            "resumeHint": "complete captcha then resume",
                            "providerDomain": "gate.example.com",
                            "gateRequiredByPolicy": True,
                        },
                    }
                )
            ],
        ).snapshot()

    monkeypatch.setattr(automation_service, "get_task", fake_get_task)
    fetched = client.get(f"/api/runs/{run_id}")
    assert fetched.status_code == 200
    payload = fetched.json()["run"]
    assert payload["status"] == "waiting_user"
    assert payload["task_id"] is None
    assert payload["wait_context"] == {
        "reason_code": "captcha_required",
        "at_step_id": "s2",
        "after_step_id": "s1",
        "resume_from_step_id": "s3",
        "resume_hint": "complete captcha then resume",
        "provider_domain": "gate.example.com",
        "gate_required_by_policy": True,
    }


def test_waiting_user_can_resume_without_otp_code(monkeypatch: pytest.MonkeyPatch) -> None:
    env_calls: list[dict[str, str]] = []

    def fake_run_command(
        command_id: str, env_overrides: dict[str, str], *, requested_by: str | None
    ):
        env_calls.append(dict(env_overrides))
        now = datetime.now(timezone.utc)
        return RunningTask(
            task_id=f"manual-gate-resume-{len(env_calls)}",
            command_id=command_id,
            status="queued",
            created_at=now,
            requested_by=requested_by,
        ).snapshot()

    monkeypatch.setattr(automation_service, "run_command", fake_run_command)

    session_id = client.post(
        "/api/sessions/start", json={"start_url": "https://resume.example.com", "mode": "manual"}
    ).json()["session_id"]
    flow_id = client.post(
        "/api/flows",
        json={
            "session_id": session_id,
            "start_url": "https://resume.example.com",
            "steps": [{"step_id": "s1", "action": "navigate", "url": "https://resume.example.com"}],
        },
    ).json()["flow_id"]
    template_id = client.post(
        "/api/templates",
        json={
            "flow_id": flow_id,
            "name": "manual-gate-resume-template",
            "params_schema": [{"key": "username", "type": "string", "required": True}],
            "defaults": {"username": "runner"},
            "policies": {"otp": {"required": False, "provider": "manual"}},
        },
    ).json()["template_id"]
    run_payload = client.post(
        "/api/runs", json={"template_id": template_id, "params": {"username": "runner"}}
    ).json()["run"]
    run_id = run_payload["run_id"]
    task_id = run_payload["task_id"]
    assert len(env_calls) == 1
    now = datetime.now(timezone.utc)

    def fake_get_task(_task_id: str, requested_by: str | None = None):
        assert _task_id == task_id
        return RunningTask(
            task_id=task_id,
            command_id="automation-replay-flow",
            status="running",
            created_at=now,
            output_lines=[
                json.dumps(
                    {
                        "stepResults": [
                            {"step_id": "s1", "action": "navigate", "ok": True, "detail": "ok"}
                        ],
                        "manualGate": {
                            "reasonCode": "need_manual_confirmation",
                            "resumeFromStepId": "s9",
                            "resumeHint": "confirm action then resume",
                        },
                    }
                )
            ],
        ).snapshot()

    monkeypatch.setattr(automation_service, "get_task", fake_get_task)
    waiting = client.get(f"/api/runs/{run_id}")
    assert waiting.status_code == 200
    assert waiting.json()["run"]["status"] == "waiting_user"

    resumed = client.post(f"/api/runs/{run_id}/otp", json={})
    assert resumed.status_code == 200
    assert resumed.json()["run"]["status"] == "queued"
    assert resumed.json()["run"]["task_id"] == "manual-gate-resume-2"
    assert len(env_calls) == 2
    assert env_calls[0]["FLOW_SESSION_ID"] == session_id
    assert env_calls[1]["FLOW_SESSION_ID"] == session_id
    assert env_calls[1]["FLOW_RESUME_CONTEXT"] == "true"
    assert env_calls[1]["FLOW_FROM_STEP_ID"] == "s9"
