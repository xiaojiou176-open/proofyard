from __future__ import annotations

import time
import hashlib
import logging
from datetime import datetime, timedelta, timezone
import shutil
from threading import Event

from fastapi.testclient import TestClient
import pytest
from pytest import MonkeyPatch

import apps.api.app.core.access_control as access_control
import apps.api.app.services.automation_commands as automation_commands
from apps.api.app.core.metrics import runtime_metrics
from apps.api.app.core.observability import REQUEST_ID_CTX
from apps.api.app.main import app
from apps.api.app.services.automation_service import RunningTask, automation_service

TEST_AUTOMATION_TOKEN = "test-token-0123456789"
ALT_AUTOMATION_TOKEN = "token-1234567890abcd"

client = TestClient(
    app,
    headers={
        "x-automation-token": TEST_AUTOMATION_TOKEN,
        "x-automation-client-id": "pytest-client",
    },
)


@pytest.fixture(autouse=True)
def reset_automation_state(monkeypatch: MonkeyPatch) -> None:
    with automation_service._lock:
        task_ids = list(automation_service._tasks.keys())
        automation_service._tasks.clear()
        automation_service._idempotency_records.clear()
        for task_id in task_ids:
            automation_service._delete_task_locked(task_id)
    monkeypatch.setenv("AUTOMATION_API_TOKEN", TEST_AUTOMATION_TOKEN)
    monkeypatch.setenv("APP_ENV", "test")
    access_control.reset_for_tests()


def test_list_automation_commands() -> None:
    response = client.get("/api/automation/commands")
    assert response.status_code == 200
    commands = response.json()["commands"]
    command_ids = {item["command_id"] for item in commands}
    expected = {
        "setup",
        "run",
        "run-midscene",
        "run-ui",
        "run-ui-midscene",
        "clean",
        "map",
        "diagnose",
        "dev-frontend",
        "lint-frontend",
        "automation-install",
        "automation-lint",
        "automation-record",
        "automation-record-manual",
        "automation-record-midscene",
        "automation-extract",
        "automation-generate-case",
        "automation-replay",
        "automation-replay-flow",
        "automation-replay-flow-step",
        "automation-test",
        "backend-test",
    }
    assert expected.issubset(command_ids)


def test_list_tasks_rejects_invalid_status_filter() -> None:
    response = client.get("/api/automation/tasks?status=invalid")
    assert response.status_code == 422
    assert response.json()["detail"] == "invalid status filter"


def test_build_command_specs_falls_back_when_zsh_is_unavailable(
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        shutil,
        "which",
        lambda program: None if program == "zsh" else f"/bin/{program}",
    )

    specs = automation_commands.build_command_specs()

    assert specs["automation-replay-flow"].argv == [
        "bash",
        "-lc",
        "cd apps/automation-runner && pnpm replay-flow",
    ]
    assert specs["lint-frontend"].argv == ["bash", "-lc", "cd apps/web && pnpm lint"]


def test_run_unknown_command_returns_404() -> None:
    response = client.post(
        "/api/automation/run",
        json={"command": "not-exists", "params": {}},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "command not found"


def test_run_high_risk_command_returns_403() -> None:
    response = client.post(
        "/api/automation/run",
        json={"command": "clean", "params": {}},
    )
    assert response.status_code == 403
    assert "high-risk command is disabled" in response.json()["detail"]


def test_run_command_rejects_oversized_params_value() -> None:
    response = client.post(
        "/api/automation/run",
        json={
            "command": "run-ui",
            "params": {
                "UIQ_BASE_URL": "https://example.com",
                "SUCCESS_SELECTOR": "#" + ("x" * 2050),
            },
        },
    )
    assert response.status_code == 422


def test_run_command_filters_params(monkeypatch: MonkeyPatch) -> None:
    captured: dict[str, dict[str, str]] = {}
    spawn_called = Event()

    def fake_spawn(argv: list[str], env: dict[str, str]):
        captured["env"] = env
        spawn_called.set()

        class FakeProcess:
            def __init__(self) -> None:
                self.stdout = iter(["ok\n"])
                self._finished = False

            def wait(self, timeout: float | None = None) -> int:
                self._finished = True
                return 0

            def terminate(self) -> None:
                return None

            def poll(self) -> int | None:
                return 0 if self._finished else None

        return FakeProcess()

    monkeypatch.setattr(automation_service, "_spawn_process", fake_spawn)

    response = client.post(
        "/api/automation/run",
        json={
            "command": "run-ui",
            "params": {
                "UIQ_BASE_URL": "https://example.com",
                "START_URL": "https://example.com/custom",
                "AI_PROVIDER": "gemini",
                "AI_SPEED_MODE": "balanced",
                "GEMINI_MODEL_PRIMARY": "gemini-2.5-pro",
                "GEMINI_MODEL_FLASH": "gemini-2.5-flash",
                "GEMINI_EMBED_MODEL": "text-embedding-004",
                "GEMINI_THINKING_LEVEL": "high",
                "FLOW_FROM_STEP_ID": "s9",
                "FLOW_STEP_ID": "s2",
                "FLOW_OTP_CODE": "123456",
                "SUCCESS_SELECTOR": "#done",
            },
        },
    )

    assert response.status_code == 200
    task_id = response.json()["task"]["task_id"]
    assert task_id
    assert spawn_called.wait(timeout=2), "timed out waiting for fake_spawn to be called"

    # Only whitelisted env vars should pass through.
    assert captured["env"]["UIQ_BASE_URL"] == "https://example.com"
    assert captured["env"]["START_URL"] == "https://example.com/custom"
    assert captured["env"]["AI_PROVIDER"] == "gemini"
    assert captured["env"]["AI_SPEED_MODE"] == "balanced"
    assert captured["env"]["GEMINI_MODEL_PRIMARY"] == "gemini-2.5-pro"
    assert captured["env"]["GEMINI_MODEL_FLASH"] == "gemini-2.5-flash"
    assert captured["env"]["GEMINI_EMBED_MODEL"] == "text-embedding-004"
    assert captured["env"]["GEMINI_THINKING_LEVEL"] == "high"
    assert captured["env"]["FLOW_FROM_STEP_ID"] == "s9"
    assert captured["env"]["FLOW_STEP_ID"] == "s2"
    assert captured["env"]["FLOW_OTP_CODE"] == "123456"
    assert captured["env"]["SUCCESS_SELECTOR"] == "#done"


def test_run_command_accepts_params_only(monkeypatch: MonkeyPatch) -> None:
    captured: dict[str, dict[str, str]] = {}
    spawn_called = Event()

    def fake_spawn(argv: list[str], env: dict[str, str]):
        captured["env"] = env
        spawn_called.set()

        class FakeProcess:
            def __init__(self) -> None:
                self.stdout = iter(["ok\n"])
                self._finished = False

            def wait(self, timeout: float | None = None) -> int:
                self._finished = True
                return 0

            def terminate(self) -> None:
                return None

            def poll(self) -> int | None:
                return 0 if self._finished else None

        return FakeProcess()

    monkeypatch.setattr(automation_service, "_spawn_process", fake_spawn)

    response = client.post(
        "/api/automation/run",
        json={
            "command": "run-ui",
            "params": {
                "UIQ_BASE_URL": "https://example.com",
                "FLOW_STEP_ID": "s3",
            },
        },
    )

    assert response.status_code == 200
    assert spawn_called.wait(timeout=2), "timed out waiting for fake_spawn to be called"
    assert captured["env"]["UIQ_BASE_URL"] == "https://example.com"
    assert captured["env"]["FLOW_STEP_ID"] == "s3"


def test_run_command_rejects_unknown_params_field() -> None:
    response = client.post(
        "/api/automation/run",
        json={
            "command": "run-ui",
            "params": {"UNKNOWN_FIELD": "x"},
        },
    )
    assert response.status_code == 422
    detail = response.json().get("detail")
    assert isinstance(detail, list)
    assert any(item.get("loc") == ["body", "params", "UNKNOWN_FIELD"] for item in detail)


def test_run_command_rejects_legacy_env_field() -> None:
    response = client.post(
        "/api/automation/run",
        json={
            "command": "run-ui",
            "env": {"UIQ_BASE_URL": "https://example.com"},
        },
    )
    assert response.status_code == 422
    detail = response.json().get("detail")
    assert isinstance(detail, list)
    assert any(item.get("loc") == ["body", "env"] for item in detail)


def test_spawn_failure_marks_task_failed(monkeypatch: MonkeyPatch) -> None:
    def fake_spawn(argv: list[str], env: dict[str, str]):
        raise RuntimeError("boom")

    monkeypatch.setattr(automation_service, "_spawn_process", fake_spawn)

    response = client.post(
        "/api/automation/run",
        json={"command": "run-ui", "params": {}},
    )
    assert response.status_code == 200
    task_id = response.json()["task"]["task_id"]

    # Thread should flip this task to failed quickly.
    for _ in range(50):
        task_response = client.get(f"/api/automation/tasks/{task_id}")
        task = task_response.json()
        if task["status"] == "failed":
            break
        time.sleep(0.01)

    assert task["status"] == "failed"
    assert "spawn failed" in (task["message"] or "")


def test_run_command_retry_path_uses_backoff_scheduler(monkeypatch: MonkeyPatch) -> None:
    call_count = {"value": 0}
    observed_retry_attempts: list[int] = []

    class FakeProcess:
        def __init__(self, exit_code: int) -> None:
            self.stdout = iter(["retry\n"])
            self._exit_code = exit_code
            self._finished = False

        def wait(self, timeout: float | None = None) -> int:
            self._finished = True
            return self._exit_code

        def terminate(self) -> None:
            return None

        def poll(self) -> int | None:
            return self._exit_code if self._finished else None

    def fake_spawn(argv: list[str], env: dict[str, str]):
        call_count["value"] += 1
        return FakeProcess(1 if call_count["value"] == 1 else 0)

    def fake_retry_delay(attempt: int) -> float:
        observed_retry_attempts.append(attempt)
        return 0.0

    monkeypatch.setattr(automation_service, "_spawn_process", fake_spawn)
    monkeypatch.setattr(automation_service, "_compute_retry_delay_seconds", fake_retry_delay)
    monkeypatch.setattr(automation_service, "_default_retries", 1)
    # Keep this test isolated from aggressive task-pruning settings.
    monkeypatch.setattr(automation_service, "_completed_task_ttl_seconds", 3600)
    monkeypatch.setattr(automation_service, "_max_tasks", 10_000)
    monkeypatch.setattr(access_control, "_RATE_LIMIT_PER_MINUTE", 10_000)

    response = client.post(
        "/api/automation/run",
        json={"command": "run-ui", "params": {"UIQ_BASE_URL": "https://example.com"}},
    )
    assert response.status_code == 200
    task_id = response.json()["task"]["task_id"]

    deadline = time.monotonic() + 20.0
    final_status = ""
    final_attempt = 0
    while True:
        with automation_service._lock:
            task = automation_service._tasks.get(task_id)
            if task is None:
                pytest.fail(f"task {task_id} disappeared while waiting for retry success")
            final_status = task.status
            final_attempt = task.attempt
        if final_status == "success":
            break
        if time.monotonic() >= deadline:
            pytest.fail(f"timed out waiting for retry task success, last status={final_status!r}")
        time.sleep(0.05)

    assert final_status == "success"
    assert final_attempt == 2
    assert call_count["value"] == 2
    assert observed_retry_attempts == [2]


def test_run_command_timeout_does_not_requeue_retry(monkeypatch: MonkeyPatch) -> None:
    class FakeProcess:
        def __init__(self) -> None:
            self.stdout = iter([])
            self._finished = False

        def wait(self, timeout: float | None = None) -> int:
            self._finished = True
            return -9

        def terminate(self) -> None:
            return None

        def poll(self) -> int | None:
            return 0 if self._finished else None

    spec = automation_service._commands["run-ui"]
    task_id = "timeout-no-retry"
    with automation_service._lock:
        automation_service._tasks[task_id] = RunningTask(
            task_id=task_id,
            command_id="run-ui",
            status="queued",
            created_at=datetime.now(timezone.utc),
            max_attempts=3,
            attempt=1,
        )

    monkeypatch.setattr(automation_service, "_spawn_process", lambda argv, env: FakeProcess())

    def fake_enforce_timeout(
        target_task_id: str, process: FakeProcess, timeout_seconds: int
    ) -> None:
        with automation_service._lock:
            task = automation_service._tasks[target_task_id]
            task.status = "failed"
            task.message = "timeout after 1s"
            task.finished_at = datetime.now(timezone.utc)
            automation_service._save_task_locked(task)

    monkeypatch.setattr(automation_service, "_enforce_timeout", fake_enforce_timeout)

    automation_service._run_task(task_id, spec, {"UIQ_BASE_URL": "https://example.com"})

    with automation_service._lock:
        task = automation_service._tasks[task_id]
        assert task.status == "failed"
        assert task.message == "timeout after 1s"
        assert task.attempt == 1


def test_run_command_uses_request_id_from_context_when_missing_explicit_value(
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.setattr(automation_service, "_run_task", lambda *args, **kwargs: None)
    token = REQUEST_ID_CTX.set("req-context-001")
    try:
        task = automation_service.run_command(
            "run-ui", {"UIQ_BASE_URL": "https://example.com"}, requested_by="ctx-user"
        )
    finally:
        REQUEST_ID_CTX.reset(token)

    with automation_service._lock:
        task_internal = automation_service._tasks[task.task_id]
        assert task_internal.request_id == "req-context-001"


def test_run_command_coalesces_duplicate_inflight_by_idempotency(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setattr(automation_service, "_run_task", lambda *args, **kwargs: None)
    payload = {
        "command": "run-ui",
        "params": {
            "UIQ_BASE_URL": "https://example.com",
            "AUTOMATION_IDEMPOTENCY_KEY": "wave-c3-inflight",
        },
    }

    first = client.post("/api/automation/run", json=payload)
    second = client.post("/api/automation/run", json=payload)
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["task"]["task_id"] == second.json()["task"]["task_id"]

    with automation_service._lock:
        assert len(automation_service._tasks) == 1


def test_run_command_idempotency_replay_creates_new_task(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setattr(automation_service, "_run_task", lambda *args, **kwargs: None)
    seed_payload = {
        "command": "run-ui",
        "params": {
            "UIQ_BASE_URL": "https://example.com",
            "AUTOMATION_IDEMPOTENCY_KEY": "wave-c3-replay",
        },
    }
    first = client.post("/api/automation/run", json=seed_payload)
    assert first.status_code == 200
    original_task_id = first.json()["task"]["task_id"]

    with automation_service._lock:
        task = automation_service._tasks[original_task_id]
        task.status = "success"
        task.finished_at = datetime.now(timezone.utc)
        task.message = "completed"
        automation_service._save_task_locked(task)

    duplicate = client.post("/api/automation/run", json=seed_payload)
    assert duplicate.status_code == 200
    assert duplicate.json()["task"]["task_id"] == original_task_id

    replay = client.post(
        "/api/automation/run",
        json={
            "command": "run-ui",
            "params": {
                "UIQ_BASE_URL": "https://example.com",
                "AUTOMATION_IDEMPOTENCY_KEY": "wave-c3-replay",
                "AUTOMATION_IDEMPOTENCY_REPLAY": "true",
            },
        },
    )
    assert replay.status_code == 200
    replay_task_id = replay.json()["task"]["task_id"]
    assert replay_task_id != original_task_id

    with automation_service._lock:
        replay_task = automation_service._tasks[replay_task_id]
        assert replay_task.replay_of_task_id == original_task_id
        assert replay_task.message == f"idempotent replay of {original_task_id}"


def test_automation_token_protects_routes(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("AUTOMATION_API_TOKEN", ALT_AUTOMATION_TOKEN)
    no_token_client = TestClient(app)
    no_token = no_token_client.get("/api/automation/commands")
    assert no_token.status_code == 401

    bad_token = client.get("/api/automation/commands", headers={"x-automation-token": "wrong"})
    assert bad_token.status_code == 401

    ok = client.get(
        "/api/automation/commands",
        headers={
            "x-automation-token": ALT_AUTOMATION_TOKEN,
            "x-automation-client-id": "token-protect",
        },
    )
    assert ok.status_code == 200


def test_automation_require_token_false_allows_no_token(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("AUTOMATION_REQUIRE_TOKEN", "false")
    monkeypatch.setenv("AUTOMATION_API_TOKEN", ALT_AUTOMATION_TOKEN)
    response = TestClient(app).get("/api/automation/commands")
    assert response.status_code == 200


def test_automation_require_token_false_still_rejects_invalid_token(
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.setenv("AUTOMATION_REQUIRE_TOKEN", "false")
    monkeypatch.setenv("AUTOMATION_API_TOKEN", ALT_AUTOMATION_TOKEN)
    response = TestClient(app).get(
        "/api/automation/commands", headers={"x-automation-token": "wrong"}
    )
    assert response.status_code == 401


def test_local_client_without_configured_token_is_rejected(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.delenv("AUTOMATION_API_TOKEN", raising=False)
    response = TestClient(app).get("/api/automation/commands")
    assert response.status_code == 401


def test_allow_local_no_token_with_loopback_only(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.delenv("AUTOMATION_API_TOKEN", raising=False)
    monkeypatch.setenv("AUTOMATION_ALLOW_LOCAL_NO_TOKEN", "true")
    monkeypatch.setenv("APP_ENV", "test")
    loopback_client = TestClient(app)
    monkeypatch.setattr(access_control, "_is_loopback_client", lambda request: True)
    allowed = loopback_client.get("/api/automation/commands")
    assert allowed.status_code == 200
    monkeypatch.setattr(access_control, "_is_loopback_client", lambda request: False)
    rejected = loopback_client.get("/api/automation/commands")
    assert rejected.status_code == 401


def test_allow_local_no_token_rejects_non_loopback_when_token_configured(
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.setenv("AUTOMATION_API_TOKEN", ALT_AUTOMATION_TOKEN)
    monkeypatch.setenv("AUTOMATION_ALLOW_LOCAL_NO_TOKEN", "true")
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setattr(access_control, "_is_loopback_client", lambda request: False)
    response = TestClient(app).get("/api/automation/commands")
    assert response.status_code == 401


def test_allow_local_no_token_rejects_loopback_in_production(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.delenv("AUTOMATION_API_TOKEN", raising=False)
    monkeypatch.setenv("AUTOMATION_ALLOW_LOCAL_NO_TOKEN", "true")
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setattr(access_control, "_is_loopback_client", lambda request: True)
    response = TestClient(app).get("/api/automation/commands")
    assert response.status_code == 503
    assert "must be false in production" in response.json()["detail"]


def test_allow_local_no_token_is_blocked_in_production_even_with_valid_token(
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.setenv("AUTOMATION_API_TOKEN", ALT_AUTOMATION_TOKEN)
    monkeypatch.setenv("AUTOMATION_ALLOW_LOCAL_NO_TOKEN", "true")
    monkeypatch.setenv("APP_ENV", "production")
    response = TestClient(app).get(
        "/api/automation/commands",
        headers={
            "x-automation-token": ALT_AUTOMATION_TOKEN,
            "x-automation-client-id": "prod-client",
        },
    )
    assert response.status_code == 503
    assert "must be false in production" in response.json()["detail"]


def test_automation_token_rejects_placeholder_value(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("AUTOMATION_API_TOKEN", "replace-with-strong-token")
    response = TestClient(app).get("/api/automation/commands")
    assert response.status_code == 503
    assert "automation token is weak" in response.json()["detail"]


def test_automation_token_rejects_short_value(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("AUTOMATION_API_TOKEN", "short-token")
    response = TestClient(app).get("/api/automation/commands")
    assert response.status_code == 401


def test_redis_rate_limit_error_falls_back_to_memory(monkeypatch: MonkeyPatch) -> None:
    class BrokenRedis:
        def eval(self, *args, **kwargs):
            raise RuntimeError("redis down")

    before = runtime_metrics.snapshot()["rate_limit_redis_errors"]
    monkeypatch.setenv("REDIS_URL", "redis://127.0.0.1:6379/0")
    monkeypatch.setattr(access_control, "_REDIS_CLIENT", BrokenRedis())
    monkeypatch.setattr(access_control, "_REDIS_URL_CACHE", "redis://127.0.0.1:6379/0")

    response = client.get("/api/automation/commands")
    assert response.status_code == 200
    after = runtime_metrics.snapshot()["rate_limit_redis_errors"]
    assert after == before + 1


def test_task_pruning_keeps_running() -> None:
    original_max_tasks = automation_service._max_tasks
    try:
        automation_service._max_tasks = 2
        automation_service._tasks.clear()

        now = datetime.now(timezone.utc)
        automation_service._tasks["done-1"] = RunningTask(
            task_id="done-1",
            command_id="run-ui",
            status="success",
            created_at=now - timedelta(seconds=3),
        )
        automation_service._tasks["done-2"] = RunningTask(
            task_id="done-2",
            command_id="run-ui",
            status="failed",
            created_at=now - timedelta(seconds=2),
        )
        automation_service._tasks["running-1"] = RunningTask(
            task_id="running-1",
            command_id="run-ui",
            status="running",
            created_at=now - timedelta(seconds=1),
        )

        automation_service._prune_tasks_locked()

        assert "done-1" not in automation_service._tasks
        assert "done-2" in automation_service._tasks
        assert "running-1" in automation_service._tasks
    finally:
        automation_service._max_tasks = original_max_tasks


def test_task_pruning_recycles_expired_completed_and_idempotency_record() -> None:
    original_ttl = automation_service._completed_task_ttl_seconds
    try:
        automation_service._completed_task_ttl_seconds = 60
        now = datetime.now(timezone.utc)
        expired = RunningTask(
            task_id="expired-1",
            command_id="run-ui",
            status="success",
            created_at=now - timedelta(minutes=10),
            finished_at=now - timedelta(minutes=10),
            idempotency_key="user:expired-key",
        )
        recent = RunningTask(
            task_id="recent-1",
            command_id="run-ui",
            status="success",
            created_at=now - timedelta(seconds=5),
            finished_at=now - timedelta(seconds=5),
            idempotency_key="user:recent-key",
        )
        with automation_service._lock:
            automation_service._tasks[expired.task_id] = expired
            automation_service._tasks[recent.task_id] = recent
            automation_service._idempotency_records["user:expired-key"] = (
                expired.task_id,
                now - timedelta(minutes=10),
            )
            automation_service._idempotency_records["user:recent-key"] = (
                recent.task_id,
                now - timedelta(seconds=5),
            )
            automation_service._save_task_locked(expired)
            automation_service._save_task_locked(recent)
            automation_service._prune_tasks_locked()

            assert "expired-1" not in automation_service._tasks
            assert "recent-1" in automation_service._tasks
            assert "user:expired-key" not in automation_service._idempotency_records
            assert "user:recent-key" in automation_service._idempotency_records
    finally:
        automation_service._completed_task_ttl_seconds = original_ttl


def test_run_command_prunes_completed_when_capacity_is_full(monkeypatch: MonkeyPatch) -> None:
    original_max_tasks = automation_service._max_tasks
    original_run_task = automation_service._run_task
    try:
        automation_service._max_tasks = 2
        automation_service._tasks.clear()
        now = datetime.now(timezone.utc)
        task1 = RunningTask(
            task_id="done-1",
            command_id="run-ui",
            status="success",
            created_at=now - timedelta(seconds=2),
        )
        task2 = RunningTask(
            task_id="done-2",
            command_id="run-ui",
            status="failed",
            created_at=now - timedelta(seconds=1),
        )
        with automation_service._lock:
            automation_service._tasks[task1.task_id] = task1
            automation_service._tasks[task2.task_id] = task2
            automation_service._save_task_locked(task1)
            automation_service._save_task_locked(task2)
        monkeypatch.setattr(automation_service, "_run_task", lambda *args, **kwargs: None)

        response = client.post("/api/automation/run", json={"command": "run-ui", "params": {}})
        assert response.status_code == 200

        with automation_service._lock:
            assert len(automation_service._tasks) == 2
            assert "done-1" not in automation_service._tasks
    finally:
        automation_service._run_task = original_run_task
        automation_service._max_tasks = original_max_tasks


def test_cancel_queued_task_sets_cancelled() -> None:
    now = datetime.now(timezone.utc)
    task = RunningTask(
        task_id="queued-x",
        command_id="run-ui",
        status="queued",
        created_at=now,
    )
    automation_service._tasks[task.task_id] = task
    with automation_service._lock:
        automation_service._save_task_locked(task)
    cancelled = automation_service.cancel_task(task.task_id)
    assert cancelled.status == "cancelled"
    assert cancelled.message == "task cancelled before start"
    automation_service._tasks.pop(task.task_id, None)


def test_cancel_running_without_process_is_sticky() -> None:
    now = datetime.now(timezone.utc)
    task = RunningTask(
        task_id="running-no-process",
        command_id="run-ui",
        status="running",
        created_at=now,
    )
    automation_service._tasks[task.task_id] = task
    with automation_service._lock:
        automation_service._save_task_locked(task)
    cancelled = automation_service.cancel_task(task.task_id)
    assert cancelled.status == "cancelled"
    assert cancelled.message == "task cancellation requested by user"
    automation_service._tasks.pop(task.task_id, None)


def test_list_tasks_supports_filters() -> None:
    now = datetime.now(timezone.utc)
    owner = f"token:{hashlib.sha256(f'{TEST_AUTOMATION_TOKEN}::pytest-client'.encode('utf-8')).hexdigest()[:16]}"
    task1 = RunningTask(
        task_id="a1", command_id="run-ui", status="success", created_at=now, requested_by=owner
    )
    task2 = RunningTask(
        task_id="a2", command_id="run", status="failed", created_at=now, requested_by=owner
    )
    automation_service._tasks["a1"] = task1
    automation_service._tasks["a2"] = task2
    with automation_service._lock:
        automation_service._save_task_locked(task1)
        automation_service._save_task_locked(task2)

    response = client.get("/api/automation/tasks?status=failed&command_id=run")
    assert response.status_code == 200
    tasks = response.json()["tasks"]
    assert len(tasks) == 1
    assert tasks[0]["task_id"] == "a2"


def test_automation_client_id_header_cannot_spoof_requester(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("AUTOMATION_API_TOKEN", ALT_AUTOMATION_TOKEN)
    owner_id = (
        f"token:{hashlib.sha256(f'{ALT_AUTOMATION_TOKEN}::owner'.encode('utf-8')).hexdigest()[:16]}"
    )
    with automation_service._lock:
        task = RunningTask(
            task_id="owner-task",
            command_id="run-ui",
            status="success",
            created_at=datetime.now(timezone.utc),
            requested_by=owner_id,
        )
        automation_service._tasks[task.task_id] = task
        automation_service._save_task_locked(task)

    owner_headers = {"x-automation-token": ALT_AUTOMATION_TOKEN, "x-automation-client-id": "owner"}
    attacker_headers = {
        "x-automation-token": ALT_AUTOMATION_TOKEN,
        "x-automation-client-id": "attacker",
    }

    owner = client.get("/api/automation/tasks/owner-task", headers=owner_headers)
    attacker = client.get("/api/automation/tasks/owner-task", headers=attacker_headers)
    assert owner.status_code == 200
    assert attacker.status_code == 403


def test_task_output_is_redacted(monkeypatch: MonkeyPatch) -> None:
    def fake_spawn(argv: list[str], env: dict[str, str]):
        class FakeProcess:
            def __init__(self) -> None:
                self.stdout = iter(
                    [
                        "password=MySecret1!\n",
                        "x-automation-token=abc123\n",
                    ]
                )
                self._finished = False

            def wait(self, timeout: float | None = None) -> int:
                self._finished = True
                return 0

            def terminate(self) -> None:
                return None

            def poll(self) -> int | None:
                return 0 if self._finished else None

        return FakeProcess()

    monkeypatch.setattr(automation_service, "_spawn_process", fake_spawn)
    response = client.post("/api/automation/run", json={"command": "run-ui", "params": {}})
    assert response.status_code == 200
    task_id = response.json()["task"]["task_id"]

    for _ in range(50):
        task_response = client.get(f"/api/automation/tasks/{task_id}")
        task = task_response.json()
        if task["status"] == "success":
            break
        time.sleep(0.01)

    assert "***REDACTED***" in task["output_tail"]
    assert "MySecret1!" not in task["output_tail"]
    assert "abc123" not in task["output_tail"]


def test_redaction_covers_gemini_and_google_keys() -> None:
    redacted_gemini = automation_service._redact_sensitive("gemini_api_key=abc123\n")
    redacted_google = automation_service._redact_sensitive("google_api_key=xyz789\n")

    assert "gemini_api_key=***REDACTED***" in redacted_gemini
    assert "google_api_key=***REDACTED***" in redacted_google
    assert "abc123" not in redacted_gemini
    assert "xyz789" not in redacted_google


def test_spawn_failure_log_includes_request_context(
    monkeypatch: MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def fake_spawn(argv: list[str], env: dict[str, str]):
        raise RuntimeError("spawn boom")

    monkeypatch.setattr(automation_service, "_spawn_process", fake_spawn)
    request_id = "req-observe-001"

    with caplog.at_level(logging.ERROR, logger="automation"):
        response = client.post(
            "/api/automation/run",
            json={"command": "run-ui", "params": {}},
            headers={
                "x-request-id": request_id,
                "x-automation-token": TEST_AUTOMATION_TOKEN,
                "x-automation-client-id": "obs-client",
            },
        )
        assert response.status_code == 200
        task_id = response.json()["task"]["task_id"]
        for _ in range(100):
            if any(
                getattr(item, "task_id", None) == task_id
                and item.getMessage() == "automation task spawn failed"
                for item in caplog.records
            ):
                break
            time.sleep(0.01)

    matched = [
        item
        for item in caplog.records
        if getattr(item, "task_id", None) == task_id
        and item.getMessage() == "automation task spawn failed"
    ]
    assert matched, "expected automation spawn failure log with task context"
    record = matched[-1]
    assert getattr(record, "request_id", None) == request_id
    assert getattr(record, "command_id", None) == "run-ui"
    assert record.exc_info is not None


def test_rate_limit_returns_429(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setattr(access_control, "_RATE_LIMIT_PER_MINUTE", 2)
    first = client.get("/api/automation/commands")
    second = client.get("/api/automation/commands")
    third = client.get("/api/automation/commands")
    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 429


def test_rate_limit_key_isolated_by_client_id(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setattr(access_control, "_RATE_LIMIT_PER_MINUTE", 1)
    headers_a = {"x-automation-token": TEST_AUTOMATION_TOKEN, "x-automation-client-id": "tenant-a"}
    headers_b = {"x-automation-token": TEST_AUTOMATION_TOKEN, "x-automation-client-id": "tenant-b"}

    first_a = client.get("/api/automation/commands", headers=headers_a)
    second_a = client.get("/api/automation/commands", headers=headers_a)
    first_b = client.get("/api/automation/commands", headers=headers_b)

    assert first_a.status_code == 200
    assert second_a.status_code == 429
    assert first_b.status_code == 200


def test_rate_limit_increments_runtime_metric(monkeypatch: MonkeyPatch) -> None:
    baseline = int(runtime_metrics.snapshot()["rate_limited"])
    monkeypatch.setattr(access_control, "_RATE_LIMIT_PER_MINUTE", 1)

    first = client.get("/api/automation/commands")
    second = client.get("/api/automation/commands")
    assert first.status_code == 200
    assert second.status_code == 429
    assert int(runtime_metrics.snapshot()["rate_limited"]) == baseline + 1


def test_rate_bucket_compaction_trims_active_buckets(monkeypatch: MonkeyPatch) -> None:
    now = time.time()
    monkeypatch.setattr(access_control, "_client_ip", lambda request: "127.0.0.1")
    target_identity = f"token:{hashlib.sha256(f'{TEST_AUTOMATION_TOKEN}::pytest-client'.encode('utf-8')).hexdigest()[:16]}"
    target_key = f"{target_identity}:/api/automation/commands"
    with access_control._RATE_LOCK:
        access_control._RATE_BUCKETS.clear()
        access_control._RATE_BUCKETS[target_key] = access_control.deque([now - 1])
        access_control._RATE_BUCKETS["10.0.0.2:/api/automation/commands"] = access_control.deque(
            [now - 2]
        )
        access_control._RATE_BUCKETS["10.0.0.3:/api/automation/tasks"] = access_control.deque(
            [now - 3]
        )

    monkeypatch.setattr(access_control, "_MAX_RATE_BUCKETS", 2)
    monkeypatch.setattr(access_control, "_RATE_LIMIT_PER_MINUTE", 120)

    response = client.get("/api/automation/commands")
    assert response.status_code == 200
    with access_control._RATE_LOCK:
        assert len(access_control._RATE_BUCKETS) <= 2
        assert target_key in access_control._RATE_BUCKETS


def test_authenticated_rate_limit_ignores_legacy_ip_bucket(monkeypatch: MonkeyPatch) -> None:
    now = time.time()
    legacy_identity = "127.0.0.1:pytest-client"
    legacy_key = f"{legacy_identity}:/api/automation/commands"
    monkeypatch.setattr(access_control, "_RATE_LIMIT_PER_MINUTE", 1)
    with access_control._RATE_LOCK:
        access_control._RATE_BUCKETS.clear()
        access_control._RATE_BUCKETS[legacy_key] = access_control.deque([now - 1])

    response = client.get("/api/automation/commands")
    assert response.status_code == 200


def test_redis_rate_limit_falls_back_to_memory(monkeypatch: MonkeyPatch) -> None:
    class BrokenRedis:
        def eval(self, *args, **kwargs):
            raise RuntimeError("redis down")

    monkeypatch.setenv("REDIS_URL", "redis://127.0.0.1:6379/0")
    monkeypatch.setattr(access_control, "_REDIS_CLIENT", BrokenRedis())
    monkeypatch.setattr(access_control, "_REDIS_URL_CACHE", "redis://127.0.0.1:6379/0")
    monkeypatch.setattr(access_control, "_RATE_LIMIT_PER_MINUTE", 1)

    first = client.get("/api/automation/commands")
    second = client.get("/api/automation/commands")
    assert first.status_code == 200
    assert second.status_code == 429


def test_run_command_rejects_deprecated_command_id() -> None:
    response = client.post("/api/automation/run", json={"command_id": "run-ui", "params": {}})
    assert response.status_code == 422
