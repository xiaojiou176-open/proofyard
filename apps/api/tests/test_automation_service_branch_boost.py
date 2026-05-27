from __future__ import annotations

import json
import signal
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import apps.api.app.core.task_store as task_store_module
from apps.api.app.core.task_store import SqlTaskStore
from apps.api.app.services.automation_service import RunningTask, automation_service
from apps.api.app.services.reconstruction import artifact_resolver as ar


@pytest.fixture(autouse=True)
def reset_automation_service_state() -> None:
    with automation_service._lock:
        task_ids = list(automation_service._tasks.keys())
        automation_service._tasks.clear()
        automation_service._idempotency_records.clear()
        for task_id in task_ids:
            automation_service._delete_task_locked(task_id)


def test_automation_service_filtering_and_internal_guard_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime.now(timezone.utc)
    with automation_service._lock:
        for task in (
            RunningTask(
                task_id="list-1",
                command_id="run-ui",
                status="success",
                created_at=now,
                requested_by="owner-a",
            ),
            RunningTask(
                task_id="list-2",
                command_id="run-docs",
                status="failed",
                created_at=now,
                requested_by="owner-b",
            ),
            RunningTask(
                task_id="list-3",
                command_id="run-ui",
                status="success",
                created_at=now,
                requested_by="owner-a",
            ),
        ):
            automation_service._tasks[task.task_id] = task
            automation_service._save_task_locked(task)

    assert [task.task_id for task in automation_service.list_tasks(limit=0)] == ["list-1"]
    filtered = automation_service.list_tasks(
        requested_by="owner-a",
        status="success",
        command_id="run-ui",
        limit=500,
    )
    assert [task.task_id for task in filtered] == ["list-1", "list-3"]

    with pytest.raises(HTTPException) as denied:
        automation_service.get_task("list-1", requested_by="owner-z")
    assert denied.value.status_code == 403

    spec = SimpleNamespace(tags=[], argv=["echo", "x"])
    automation_service._run_task("missing-task", spec, {})

    cancelled = RunningTask(
        task_id="cancelled-before-run",
        command_id="run-ui",
        status="cancelled",
        created_at=now,
    )
    with automation_service._lock:
        automation_service._tasks[cancelled.task_id] = cancelled
        automation_service._save_task_locked(cancelled)
    automation_service._run_task(cancelled.task_id, spec, {})


def test_automation_service_truncates_output_and_tracks_error_log_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class LoudProcess:
        pid = None

        def __init__(self) -> None:
            self.stdout = iter(["line-1\n", "line-2\n", "line-3\n"])
            self._finished = False

        def wait(self, timeout: float | None = None) -> int:
            _ = timeout
            self._finished = True
            return 0

        def poll(self) -> int | None:
            return 0 if self._finished else None

        def terminate(self) -> None:
            return None

        def kill(self) -> None:
            return None

    task = RunningTask(
        task_id="trimmed-output",
        command_id="run-ui",
        status="queued",
        created_at=datetime.now(timezone.utc),
    )
    with automation_service._lock:
        automation_service._tasks[task.task_id] = task
        automation_service._save_task_locked(task)

    original_max_output_lines = automation_service._max_output_lines
    automation_service._max_output_lines = 2
    try:
        monkeypatch.setattr(automation_service, "_spawn_process", lambda *_args, **_kwargs: LoudProcess())
        automation_service._run_task(
            task.task_id,
            SimpleNamespace(tags=[], argv=["echo", "x"]),
            {"UIQ_BASE_URL": "https://example.com"},
        )
    finally:
        automation_service._max_output_lines = original_max_output_lines

    with automation_service._lock:
        terminal = automation_service._tasks[task.task_id]
        assert terminal.status == "success"
        assert terminal.output_lines == ["line-2\n", "line-3\n"]

    extra = automation_service._task_log_extra(terminal, error="boom")
    assert extra["error"] == "boom"
    assert extra["requested_by"] == "anonymous"


def test_automation_service_timeout_terminate_and_idempotency_cleanup_paths(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class BusyProcess:
        pid = None

        def poll(self) -> int | None:
            return None

    timeout_task = RunningTask(
        task_id="timeout-branch",
        command_id="run-ui",
        status="running",
        created_at=datetime.now(timezone.utc),
    )
    with automation_service._lock:
        automation_service._tasks[timeout_task.task_id] = timeout_task
        automation_service._save_task_locked(timeout_task)

    original_terminate_process = automation_service._terminate_process
    monkeypatch.setattr(automation_service, "_terminate_process", lambda *_args, **_kwargs: True)
    automation_service._enforce_timeout(timeout_task.task_id, BusyProcess(), timeout_seconds=0)
    with automation_service._lock:
        failed = automation_service._tasks[timeout_task.task_id]
        assert failed.message == "timeout after 0s (force-killed)"
    monkeypatch.setattr(automation_service, "_terminate_process", original_terminate_process)

    signals: list[tuple[int, int]] = []
    monkeypatch.setattr(
        "apps.api.app.services.automation_service.os.kill",
        lambda pid, sig: signals.append((pid, sig)),
    )

    class GroupProcess:
        def __init__(self, waits: list[object], pid: int = 321) -> None:
            self.pid = pid
            self._waits = list(waits)
            self.terminated = False
            self.killed = False

        def wait(self, timeout: float | None = None) -> int:
            _ = timeout
            if not self._waits:
                return 0
            result = self._waits.pop(0)
            if isinstance(result, BaseException):
                raise result
            return result

        def terminate(self) -> None:
            self.terminated = True

        def kill(self) -> None:
            self.killed = True

    graceful = GroupProcess([0])
    assert automation_service._terminate_process(graceful, timeout_seconds=0.01) is False
    assert graceful.terminated is False
    assert graceful.killed is False

    force_killed = GroupProcess([subprocess.TimeoutExpired(cmd="x", timeout=0.01), 0])
    assert automation_service._terminate_process(
        force_killed,
        timeout_seconds=0.01,
    ) is True
    assert force_killed.terminated is False
    assert force_killed.killed is False
    assert signals == [
        (321, signal.SIGTERM),
        (321, signal.SIGTERM),
        (321, signal.SIGKILL),
    ]

    now = datetime.now(timezone.utc)
    with automation_service._lock:
        automation_service._idempotency_records["missing-key"] = ("missing-task", now)
        automation_service._gc_idempotency_records_locked(now=now)
        assert "missing-key" not in automation_service._idempotency_records


def test_sql_task_store_runtime_compatibility_and_empty_result_paths(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeInspector:
        def __init__(self, has_table: bool) -> None:
            self._has_table = has_table

        def has_table(self, _name: str) -> bool:
            return self._has_table

        def get_columns(self, _name: str) -> list[dict[str, str]]:
            return [{"name": "task_id"}]

    class FakeConn:
        def __init__(self, rows: list[object], executed: list[str]) -> None:
            self._rows = rows
            self._executed = executed

        def execute(self, statement, *_args, **_kwargs):
            self._executed.append(str(statement))
            row = self._rows.pop(0) if self._rows else None
            return SimpleNamespace(
                mappings=lambda: SimpleNamespace(first=lambda: row),
            )

    class FakeBegin:
        def __init__(self, executed: list[str]) -> None:
            self._executed = executed

        def __enter__(self) -> FakeConn:
            return FakeConn([], self._executed)

        def __exit__(self, exc_type, exc, tb) -> bool:
            return False

    class FakeConnect:
        def __init__(self, rows: list[object], executed: list[str]) -> None:
            self._rows = rows
            self._executed = executed

        def __enter__(self) -> FakeConn:
            return FakeConn(self._rows, self._executed)

        def __exit__(self, exc_type, exc, tb) -> bool:
            return False

    executed: list[str] = []
    store = object.__new__(SqlTaskStore)
    store._engine = SimpleNamespace(
        dialect=SimpleNamespace(name="sqlite"),
        begin=lambda: FakeBegin(executed),
        connect=lambda: FakeConnect([None, None], executed),
    )
    monkeypatch.setattr(task_store_module, "inspect", lambda _engine: FakeInspector(True))
    monkeypatch.setattr(task_store_module, "text", lambda statement: statement)

    store._ensure_sqlite_runtime_compatibility()
    assert any("ADD COLUMN idempotency_key" in statement for statement in executed)
    assert any("ADD COLUMN replay_of_task_id" in statement for statement in executed)

    assert store.get("missing-task") is None
    assert store.summary() == {
        "total": 0,
        "queued": 0,
        "running": 0,
        "success": 0,
        "failed": 0,
        "cancelled": 0,
        "completed": 0,
        "failed_completed": 0,
    }

    store_non_sql = object.__new__(SqlTaskStore)
    store_non_sql._engine = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))
    monkeypatch.setattr(task_store_module, "inspect", lambda _engine: FakeInspector(False))
    with pytest.raises(RuntimeError) as schema_missing:
        store_non_sql._assert_schema_ready()
    assert "missing table 'automation_tasks'" in str(schema_missing.value)


def test_artifact_resolver_oserror_and_header_skip_branches(tmp_path: Path) -> None:
    runtime = tmp_path / "runtime"
    runtime.mkdir()

    original_resolve = Path.resolve
    failing_candidate = runtime / "broken.har"

    def broken_resolve(self: Path, *args, **kwargs) -> Path:
        if self == failing_candidate:
            raise OSError("resolve failed")
        return original_resolve(self, *args, **kwargs)

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(Path, "resolve", broken_resolve)
        with pytest.raises(HTTPException) as invalid_path:
            ar.safe_resolve_under(runtime, failing_candidate, {".har"}, 128)
    assert invalid_path.value.status_code == 422

    file_path = runtime / "artifact.har"
    file_path.write_text("{}", encoding="utf-8")
    path_cls = type(file_path)
    original_exists = path_cls.exists
    original_is_file = path_cls.is_file
    original_stat = path_cls.stat
    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            path_cls,
            "exists",
            lambda self: True if self == file_path else original_exists(self),
        )
        monkeypatch.setattr(
            path_cls,
            "is_file",
            lambda self: True if self == file_path else original_is_file(self),
        )
        monkeypatch.setattr(
            path_cls,
            "stat",
            lambda self: (_ for _ in ()).throw(OSError("stat failed"))
            if self == file_path
            else original_stat(self),
        )
        with pytest.raises(HTTPException) as stat_failed:
            ar.safe_resolve_under(runtime, file_path, {".har"}, 128)
    assert stat_failed.value.status_code == 422

    latest = runtime / "latest-session.json"
    latest.write_text(json.dumps({"sessionDir": ""}), encoding="utf-8")
    fallback = ar.resolve_session_dir(runtime, {}, 128)
    assert fallback.name == "session-fallback"

    session_dir = runtime / "session-live"
    session_dir.mkdir()
    har_path = session_dir / "register.har"
    har_path.write_text(
        json.dumps(
            {
                "log": {
                    "entries": [
                        "skip-me",
                        {
                            "request": {
                                "method": "post",
                                "url": "https://example.com/api/register",
                                "headers": ["skip-header", {"name": "Accept", "value": "*/*"}],
                            },
                            "response": {"status": 201},
                        },
                    ]
                }
            }
        ),
        encoding="utf-8",
    )
    resolved = ar.resolve_artifacts(
        runtime,
        {"session_dir": str(session_dir), "har_path": str(har_path), "metadata": {}},
        artifact_max_bytes=4096,
        discover_start_url=lambda entries: entries[0]["path"] if entries else "",
    )
    assert resolved.start_url == "/api/register"
