from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pytest import MonkeyPatch

from apps.api.app.services.automation_service import (
    AutomationService,
    RunningTask,
    automation_service,
)


def _reset_service_state(service: AutomationService) -> None:
    with service._lock:
        task_ids = list(service._tasks.keys())
        service._tasks.clear()
        service._idempotency_records.clear()
        for task_id in task_ids:
            service._delete_task_locked(task_id)


@pytest.fixture(autouse=True)
def reset_automation_service_state() -> None:
    _reset_service_state(automation_service)


def _wait_for_terminal(
    task_id: str,
    timeout_seconds: float = 5.0,
    service: AutomationService = automation_service,
) -> RunningTask:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        with service._lock:
            task = service._tasks.get(task_id)
            if task is not None and task.status in {"success", "failed", "cancelled"}:
                return task
        time.sleep(0.01)
    raise AssertionError(f"task did not finish before timeout: {task_id}")


def test_run_command_strips_control_env_before_spawn(monkeypatch: MonkeyPatch) -> None:
    captured: dict[str, str] = {}
    service = AutomationService()
    _reset_service_state(service)

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

    def fake_spawn(argv: list[str], env: dict[str, str]):
        captured.update(env)
        return FakeProcess()

    monkeypatch.setattr(service, "_spawn_process", fake_spawn)

    task = service.run_command(
        "run-ui",
        {
            "UIQ_BASE_URL": "https://example.com",
            "AUTOMATION_IDEMPOTENCY_KEY": "wave-c3-control-env",
            "AUTOMATION_IDEMPOTENCY_REPLAY": "true",
        },
        requested_by="wave-c3-user",
    )
    terminal = _wait_for_terminal(task.task_id, service=service)
    assert terminal.status == "success"
    assert captured["UIQ_BASE_URL"] == "https://example.com"
    assert "AUTOMATION_IDEMPOTENCY_KEY" not in captured
    assert "AUTOMATION_IDEMPOTENCY_REPLAY" not in captured


def test_run_command_coalesces_duplicate_inflight_submission(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setattr(automation_service, "_run_task", lambda *args, **kwargs: None)

    first = automation_service.run_command(
        "run-ui",
        {
            "UIQ_BASE_URL": "https://example.com",
            "AUTOMATION_IDEMPOTENCY_KEY": "wave-c3-inflight",
        },
        requested_by="wave-c3-user",
    )
    second = automation_service.run_command(
        "run-ui",
        {
            "UIQ_BASE_URL": "https://example.com",
            "AUTOMATION_IDEMPOTENCY_KEY": "wave-c3-inflight",
        },
        requested_by="wave-c3-user",
    )

    assert first.task_id == second.task_id
    with automation_service._lock:
        assert len(automation_service._tasks) == 1


def test_run_command_replay_creates_new_task_for_completed_duplicate(
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.setattr(automation_service, "_run_task", lambda *args, **kwargs: None)
    first = automation_service.run_command(
        "run-ui",
        {
            "UIQ_BASE_URL": "https://example.com",
            "AUTOMATION_IDEMPOTENCY_KEY": "wave-c3-replay",
        },
        requested_by="wave-c3-user",
    )

    with automation_service._lock:
        origin = automation_service._tasks[first.task_id]
        origin.status = "success"
        origin.finished_at = datetime.now(timezone.utc)
        origin.message = "completed"
        automation_service._save_task_locked(origin)

    duplicate = automation_service.run_command(
        "run-ui",
        {
            "UIQ_BASE_URL": "https://example.com",
            "AUTOMATION_IDEMPOTENCY_KEY": "wave-c3-replay",
        },
        requested_by="wave-c3-user",
    )
    assert duplicate.task_id == first.task_id

    replay = automation_service.run_command(
        "run-ui",
        {
            "UIQ_BASE_URL": "https://example.com",
            "AUTOMATION_IDEMPOTENCY_KEY": "wave-c3-replay",
            "AUTOMATION_IDEMPOTENCY_REPLAY": "true",
        },
        requested_by="wave-c3-user",
    )
    assert replay.task_id != first.task_id
    with automation_service._lock:
        replay_task = automation_service._tasks[replay.task_id]
        assert replay_task.replay_of_task_id == first.task_id


def test_compute_retry_delay_applies_backoff_and_jitter(monkeypatch: MonkeyPatch) -> None:
    original_base = automation_service._retry_base_seconds
    original_max = automation_service._retry_max_seconds
    original_jitter = automation_service._retry_jitter_ratio
    try:
        automation_service._retry_base_seconds = 1.0
        automation_service._retry_max_seconds = 8.0
        automation_service._retry_jitter_ratio = 0.25
        monkeypatch.setattr(
            "apps.api.app.services.automation_service.random.uniform", lambda low, high: high
        )

        assert automation_service._compute_retry_delay_seconds(2) == pytest.approx(1.25)
        assert automation_service._compute_retry_delay_seconds(3) == pytest.approx(2.5)
        assert automation_service._compute_retry_delay_seconds(6) == pytest.approx(10.0)
    finally:
        automation_service._retry_base_seconds = original_base
        automation_service._retry_max_seconds = original_max
        automation_service._retry_jitter_ratio = original_jitter


@pytest.mark.parametrize(
    ("configured", "expected"),
    [
        ("-3", 0),
        ("0", 0),
        ("1", 1),
        ("999", 1),
    ],
)
def test_default_retries_is_clamped_to_zero_or_one(
    monkeypatch: MonkeyPatch, configured: str, expected: int
) -> None:
    monkeypatch.setenv("AUTOMATION_DEFAULT_RETRIES", configured)
    service = AutomationService()
    assert service._default_retries == expected


def test_retry_path_uses_backoff_scheduler(monkeypatch: MonkeyPatch) -> None:
    call_count = {"value": 0}
    observed_retry_attempts: list[int] = []
    original_retries = automation_service._default_retries

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

    try:
        automation_service._default_retries = 1
        monkeypatch.setattr(automation_service, "_spawn_process", fake_spawn)
        monkeypatch.setattr(automation_service, "_compute_retry_delay_seconds", fake_retry_delay)

        task = automation_service.run_command(
            "run-ui", {"UIQ_BASE_URL": "https://example.com"}, requested_by="wave-c3-user"
        )
        terminal = _wait_for_terminal(task.task_id)
        assert terminal.status == "success"
        assert terminal.attempt == 2
        assert call_count["value"] == 2
        assert observed_retry_attempts == [2]
    finally:
        automation_service._default_retries = original_retries


def test_prune_tasks_recycles_expired_completed_and_idempotency_records() -> None:
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


def test_automation_lifecycle_script_builds_seed_and_isolated_dir() -> None:
    resolved = Path(__file__).resolve()
    repo_root = next(
        (
            parent
            for parent in resolved.parents
            if (parent / "scripts" / "automation-lifecycle.sh").exists()
        ),
        resolved.parents[2],
    )
    cycle_id = "wave-c3-script-test"
    script = repo_root / "scripts" / "automation-lifecycle.sh"
    seed_file = repo_root / ".runtime-cache" / "automation" / "lifecycle" / cycle_id / "seed.json"
    run_dir = seed_file.parent

    if run_dir.exists():
        shutil.rmtree(run_dir)

    result = subprocess.run(
        [str(script), "--cycle-id", cycle_id, "--ttl-hours", "1", "--dry-run"],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
    )
    assert "[automation-lifecycle] seeded:" in result.stdout
    assert seed_file.exists()

    payload = json.loads(seed_file.read_text(encoding="utf-8"))
    assert payload["cycleId"] == cycle_id
    assert payload["idempotencyKey"].startswith("wave-c3-")


def test_automation_lifecycle_rejects_unsafe_cycle_id_and_run_cmd_path() -> None:
    resolved = Path(__file__).resolve()
    repo_root = next(
        (
            parent
            for parent in resolved.parents
            if (parent / "scripts" / "automation-lifecycle.sh").exists()
        ),
        resolved.parents[2],
    )
    script = repo_root / "scripts" / "automation-lifecycle.sh"

    bad_cycle = subprocess.run(
        [str(script), "--cycle-id", "../escape", "--ttl-hours", "1", "--dry-run"],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
    )
    assert bad_cycle.returncode != 0
    assert "unsafe characters" in bad_cycle.stderr

    outside_script = Path("/tmp/automation-lifecycle-outside.sh")
    outside_script.write_text("#!/usr/bin/env bash\necho outside\n", encoding="utf-8")
    outside_script.chmod(0o755)
    bad_run_cmd = subprocess.run(
        [
            str(script),
            "--cycle-id",
            "wave-c3-safe-id",
            "--run-cmd",
            str(outside_script),
            "--ttl-hours",
            "1",
            "--dry-run",
        ],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
    )
    assert bad_run_cmd.returncode != 0
    assert "--run-cmd must stay inside repo root" in bad_run_cmd.stderr


def test_run_task_handles_process_without_stdout(monkeypatch: MonkeyPatch) -> None:
    class NoStdoutProcess:
        pid = None
        stdout = None

        def wait(self, timeout: float | None = None) -> int:
            _ = timeout
            return 1

        def poll(self) -> int | None:
            return 0

        def terminate(self) -> None:
            return None

        def kill(self) -> None:
            return None

    now = datetime.now(timezone.utc)
    task = RunningTask(task_id="no-stdout", command_id="run-ui", status="queued", created_at=now)
    with automation_service._lock:
        automation_service._tasks[task.task_id] = task
        automation_service._save_task_locked(task)

    monkeypatch.setattr(automation_service, "_spawn_process", lambda *_a, **_k: NoStdoutProcess())
    automation_service._run_task(
        task.task_id, SimpleNamespace(tags=[], argv=["echo", "x"]), {"UIQ_BASE_URL": "https://x"}
    )
    with automation_service._lock:
        failed = automation_service._tasks[task.task_id]
        assert failed.status == "failed"
        assert "runtime failed: process stdout is not available" in (failed.message or "")


def test_enforce_timeout_marks_running_task_failed_with_force_kill(monkeypatch: MonkeyPatch) -> None:
    class BusyProcess:
        pid = None

        def poll(self) -> int | None:
            return None

    now = datetime.now(timezone.utc)
    task = RunningTask(task_id="timeout-1", command_id="run-ui", status="running", created_at=now)
    with automation_service._lock:
        automation_service._tasks[task.task_id] = task
        automation_service._save_task_locked(task)

    monkeypatch.setattr(automation_service, "_terminate_process", lambda *_a, **_k: True)
    automation_service._enforce_timeout(task.task_id, BusyProcess(), timeout_seconds=0)
    with automation_service._lock:
        failed = automation_service._tasks[task.task_id]
        assert failed.status == "failed"
        assert failed.message == "timeout after 0s (force-killed)"


def test_retry_task_after_delay_skips_non_queued_task(monkeypatch: MonkeyPatch) -> None:
    now = datetime.now(timezone.utc)
    task = RunningTask(task_id="retry-skip", command_id="run-ui", status="success", created_at=now)
    with automation_service._lock:
        automation_service._tasks[task.task_id] = task
        automation_service._save_task_locked(task)

    triggered: list[str] = []
    monkeypatch.setattr(automation_service, "_sleep", lambda *_a, **_k: None)
    monkeypatch.setattr(automation_service, "_run_task", lambda *_a, **_k: triggered.append("run"))
    automation_service._retry_task_after_delay(
        task.task_id, SimpleNamespace(tags=[], argv=[]), {}, delay_seconds=0
    )
    assert triggered == []


def test_gc_idempotency_records_removes_missing_and_expired_entries() -> None:
    now = datetime.now(timezone.utc)
    with automation_service._lock:
        automation_service._tasks["present"] = RunningTask(
            task_id="present", command_id="run-ui", status="success", created_at=now
        )
        automation_service._idempotency_records["missing-key"] = ("missing-task", now)
        automation_service._idempotency_records["expired-key"] = (
            "present",
            now - timedelta(seconds=automation_service._idempotency_ttl_seconds + 5),
        )
        automation_service._gc_idempotency_records_locked(now=now)
        assert "missing-key" not in automation_service._idempotency_records
        assert "expired-key" not in automation_service._idempotency_records


def test_sync_from_store_locked_handles_non_sql_and_preserves_process(monkeypatch: MonkeyPatch) -> None:
    now = datetime.now(timezone.utc)
    original_store = automation_service._task_store
    original_tasks = dict(automation_service._tasks)
    try:
        marker = object()
        local = RunningTask(
            task_id="sync-local",
            command_id="run-ui",
            status="running",
            created_at=now,
            process=marker,  # type: ignore[arg-type]
            output_lines=["line-a"],
        )
        automation_service._tasks = {"sync-local": local}
        automation_service._task_store = SimpleNamespace(kind="file")
        automation_service._sync_from_store_locked()
        assert automation_service._tasks["sync-local"].process is marker

        loaded = RunningTask(
            task_id="sync-local", command_id="run-ui", status="queued", created_at=now
        ).snapshot()
        automation_service._task_store = SimpleNamespace(kind="sql", load=lambda: [loaded])
        automation_service._sync_from_store_locked()
        assert automation_service._tasks["sync-local"].process is marker
        assert automation_service._tasks["sync-local"].output_lines == ["line-a"]
    finally:
        automation_service._task_store = original_store
        automation_service._tasks = original_tasks


def test_mask_requester_and_sql_task_summary_branch() -> None:
    assert automation_service._mask_requester(None) == "anonymous"
    assert automation_service._mask_requester("shortid") == "shortid"
    assert automation_service._mask_requester("abcdefghijklmn") == "abcd...mn"

    original_store = automation_service._task_store
    try:
        automation_service._task_store = SimpleNamespace(
            kind="sql",
            summary=lambda: {"total": 9, "queued": 1},
        )
        assert automation_service.task_summary() == {"total": 9, "queued": 1}
    finally:
        automation_service._task_store = original_store


def test_run_command_rejects_new_queue_entry_when_capacity_is_exhausted(
    monkeypatch: MonkeyPatch,
) -> None:
    original_max_tasks = automation_service._max_tasks
    original_run_task = automation_service._run_task
    try:
        automation_service._max_tasks = 1
        monkeypatch.setattr(automation_service, "_prune_tasks_locked", lambda additional_slots=0: None)
        monkeypatch.setattr(automation_service, "_run_task", lambda *_a, **_k: None)
        with automation_service._lock:
            automation_service._tasks["existing-task"] = RunningTask(
                task_id="existing-task",
                command_id="run-ui",
                status="queued",
                created_at=datetime.now(timezone.utc),
                requested_by="wave-c3-user",
            )

        with pytest.raises(HTTPException) as queue_full:
            automation_service.run_command(
                "run-ui",
                {"UIQ_BASE_URL": "https://example.com"},
                requested_by="wave-c3-user",
            )
        assert queue_full.value.status_code == 429
    finally:
        automation_service._max_tasks = original_max_tasks
        automation_service._run_task = original_run_task


def test_run_task_skips_spawn_when_cancelled_during_env_build(monkeypatch: MonkeyPatch) -> None:
    task = RunningTask(
        task_id="cancel-before-spawn",
        command_id="run-ui",
        status="queued",
        created_at=datetime.now(timezone.utc),
    )
    with automation_service._lock:
        automation_service._tasks[task.task_id] = task
        automation_service._save_task_locked(task)

    def cancel_during_env(_env: dict[str, str]) -> dict[str, str]:
        with automation_service._lock:
            automation_service._tasks[task.task_id].status = "cancelled"
        return {}

    spawn_called = {"value": False}
    monkeypatch.setattr(automation_service, "_build_child_env", cancel_during_env)
    monkeypatch.setattr(
        automation_service,
        "_spawn_process",
        lambda *_a, **_k: spawn_called.__setitem__("value", True),
    )
    automation_service._run_task(
        task.task_id,
        SimpleNamespace(tags=[], argv=["echo", "x"]),
        {"UIQ_BASE_URL": "https://example.com"},
    )
    assert spawn_called["value"] is False


def test_run_task_marks_terminal_failure_without_retry_and_terminate_without_pid(
    monkeypatch: MonkeyPatch,
) -> None:
    class FailingProcess:
        def __init__(self) -> None:
            self.pid = None
            self.stdout = iter(["bad\n"])
            self._finished = False
            self.terminated = False

        def wait(self, timeout: float | None = None) -> int:
            _ = timeout
            self._finished = True
            return 7

        def poll(self) -> int | None:
            return 7 if self._finished else None

        def terminate(self) -> None:
            self.terminated = True

        def kill(self) -> None:
            self.terminated = True

    task = RunningTask(
        task_id="terminal-failure",
        command_id="run-ui",
        status="queued",
        created_at=datetime.now(timezone.utc),
        max_attempts=1,
    )
    with automation_service._lock:
        automation_service._tasks[task.task_id] = task
        automation_service._save_task_locked(task)

    monkeypatch.setattr(automation_service, "_spawn_process", lambda *_a, **_k: FailingProcess())
    automation_service._run_task(
        task.task_id,
        SimpleNamespace(tags=[], argv=["echo", "x"]),
        {"UIQ_BASE_URL": "https://example.com"},
    )
    with automation_service._lock:
        failed = automation_service._tasks[task.task_id]
        assert failed.status == "failed"
        assert failed.message == "exit code 7"

    graceful = FailingProcess()
    assert automation_service._terminate_process(graceful, timeout_seconds=0.01) is False
    assert graceful.terminated is True
