from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy.exc import IntegrityError

import apps.api.app.core.task_store as task_store_module
from apps.api.app.core.metrics import runtime_metrics
from apps.api.app.core.task_store import FileTaskStore, SqlTaskStore, TaskStore
from apps.api.app.services.automation_service import AutomationService, RunningTask


def test_sqlite_task_store_persists_across_service_restart(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "automation_tasks.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+pysqlite:///{db_path}")

    first = AutomationService()
    try:
        with first._lock:
            task = RunningTask(
                task_id="t-1",
                command_id="run",
                status="success",
                created_at=datetime.now(timezone.utc),
                message="done",
                idempotency_key="auto:test-key",
            )
            first._tasks[task.task_id] = task
            first._save_task_locked(task)

        second = AutomationService()
        task = second.get_task("t-1")
        assert task.task_id == "t-1"
        assert task.status == "success"
        assert task.message == "done"
        assert task.idempotency_key == "auto:test-key"
    finally:
        first.close()
        if "second" in locals():
            second.close()


def test_sqlite_task_summary_uses_persisted_rows(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "automation_tasks.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+pysqlite:///{db_path}")

    service = AutomationService()
    try:
        now = datetime.now(timezone.utc)
        with service._lock:
            service._tasks["t-1"] = RunningTask(
                task_id="t-1", command_id="run", status="failed", created_at=now
            )
            service._tasks["t-2"] = RunningTask(
                task_id="t-2", command_id="run", status="success", created_at=now
            )
            service._tasks["t-3"] = RunningTask(
                task_id="t-3", command_id="run", status="running", created_at=now
            )
            service._save_task_locked(service._tasks["t-1"])
            service._save_task_locked(service._tasks["t-2"])
            service._save_task_locked(service._tasks["t-3"])

        summary = service.task_summary()
        assert summary["total"] == 3
        assert summary["failed"] == 1
        assert summary["success"] == 1
        assert summary["running"] == 1
        assert summary["completed"] == 2
        assert summary["failed_completed"] == 1
    finally:
        service.close()


def test_sqlite_restart_recovers_running_task_and_persists_failed_status(
    monkeypatch, tmp_path
) -> None:
    db_path = tmp_path / "automation_tasks.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+pysqlite:///{db_path}")

    first = AutomationService()
    try:
        with first._lock:
            task = RunningTask(
                task_id="t-running",
                command_id="run",
                status="running",
                created_at=datetime.now(timezone.utc),
                message="running",
            )
            first._tasks[task.task_id] = task
            first._save_task_locked(task)

        restarted = AutomationService()
        recovered = restarted.get_task("t-running")
        assert recovered.status == "failed"
        assert recovered.message == "interrupted by service restart"

        summary = restarted.task_summary()
        assert summary["running"] == 0
        assert summary["failed"] == 1
        assert summary["failed_completed"] == 1
    finally:
        first.close()
        if "restarted" in locals():
            restarted.close()


def test_file_task_store_records_decode_error_metric(tmp_path) -> None:
    state_path = tmp_path / "tasks.json"
    now = datetime.now(timezone.utc).isoformat()
    state_path.write_text(
        json.dumps(
            {
                "tasks": [
                    {
                        "task_id": "ok-1",
                        "command_id": "run",
                        "status": "success",
                        "created_at": now,
                        "output_tail": "",
                    },
                    {
                        "task_id": "bad-1",
                        "command_id": "run",
                        "status": "not-a-valid-status",
                        "created_at": now,
                        "output_tail": "",
                    },
                ]
            }
        ),
        encoding="utf-8",
    )
    store = FileTaskStore(state_path)
    before = int(runtime_metrics.snapshot()["task_store_decode_errors"])
    tasks = store.load()
    after = int(runtime_metrics.snapshot()["task_store_decode_errors"])
    assert len(tasks) == 1
    assert tasks[0].task_id == "ok-1"
    assert after == before + 1


def test_file_task_store_quarantines_corrupt_json_and_records_metric(tmp_path) -> None:
    state_path = tmp_path / "tasks.json"
    state_path.write_text("{ invalid json", encoding="utf-8")
    store = FileTaskStore(state_path)
    before = int(runtime_metrics.snapshot()["task_store_decode_errors"])
    tasks = store.load()
    after = int(runtime_metrics.snapshot()["task_store_decode_errors"])
    assert tasks == []
    assert after == before + 1
    assert not state_path.exists()
    assert state_path.with_suffix(".json.corrupt").exists()


def test_file_task_store_keeps_original_when_quarantine_move_fails(monkeypatch, tmp_path) -> None:
    state_path = tmp_path / "tasks.json"
    state_path.write_text("{ invalid json", encoding="utf-8")
    store = FileTaskStore(state_path)

    original_replace = Path.replace

    def broken_replace(self: Path, target: Path) -> Path:
        if self == state_path:
            raise OSError("disk error")
        return original_replace(self, target)

    monkeypatch.setattr(Path, "replace", broken_replace)
    before = int(runtime_metrics.snapshot()["task_store_decode_errors"])
    tasks = store.load()
    after = int(runtime_metrics.snapshot()["task_store_decode_errors"])
    assert tasks == []
    assert after == before + 1
    assert state_path.exists()
    assert not state_path.with_suffix(".json.corrupt").exists()


def test_file_task_store_concurrent_upsert_keeps_all_records(tmp_path) -> None:
    store = FileTaskStore(tmp_path / "tasks.json")
    workers = 20
    rounds = 3
    barrier = threading.Barrier(workers)
    now = datetime.now(timezone.utc)

    def worker(worker_id: int) -> None:
        barrier.wait()
        for idx in range(rounds):
            task = RunningTask(
                task_id=f"w{worker_id}-r{idx}",
                command_id="run-ui",
                status="success",
                created_at=now,
                message=f"worker-{worker_id}-round-{idx}",
            ).snapshot()
            store.upsert(task)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(workers)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)

    loaded = store.load()
    assert len(loaded) == workers * rounds
    assert {task.task_id for task in loaded} == {
        f"w{i}-r{j}" for i in range(workers) for j in range(rounds)
    }


def test_sqlite_unique_idempotency_key_blocks_duplicate_active_tasks(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "automation_tasks.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+pysqlite:///{db_path}")

    service = AutomationService()
    try:
        now = datetime.now(timezone.utc)
        with service._lock:
            first = RunningTask(
                task_id="active-1",
                command_id="run",
                status="queued",
                created_at=now,
                idempotency_key="user:dup-key",
            )
            second = RunningTask(
                task_id="active-2",
                command_id="run",
                status="running",
                created_at=now,
                idempotency_key="user:dup-key",
            )
            service._tasks[first.task_id] = first
            service._save_task_locked(first)
            service._tasks[second.task_id] = second
            with pytest.raises(IntegrityError):
                service._save_task_locked(second)
    finally:
        service.close()


def test_sqlite_unique_idempotency_key_allows_duplicate_completed_tasks(
    monkeypatch, tmp_path
) -> None:
    db_path = tmp_path / "automation_tasks.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+pysqlite:///{db_path}")

    service = AutomationService()
    try:
        now = datetime.now(timezone.utc)
        with service._lock:
            first = RunningTask(
                task_id="done-1",
                command_id="run",
                status="success",
                created_at=now,
                idempotency_key="user:dup-key-completed",
            )
            second = RunningTask(
                task_id="done-2",
                command_id="run",
                status="failed",
                created_at=now,
                idempotency_key="user:dup-key-completed",
            )
            service._tasks[first.task_id] = first
            service._tasks[second.task_id] = second
            service._save_task_locked(first)
            service._save_task_locked(second)
            summary = service.task_summary()
            assert summary["completed"] == 2
            assert summary["failed"] == 1
            assert summary["success"] == 1
    finally:
        service.close()


def test_task_store_base_class_default_helpers_cover_loop_and_get() -> None:
    class InMemoryStore(TaskStore):
        def __init__(self) -> None:
            self.items: dict[str, object] = {}

        @property
        def kind(self) -> str:
            return "memory"

        def load(self):
            return list(self.items.values())

        def upsert(self, task):
            self.items[task.task_id] = task

        def delete(self, task_id: str) -> None:
            self.items.pop(task_id, None)

        def summary(self) -> dict[str, int]:
            return {"total": len(self.items)}

    store = InMemoryStore()
    now = datetime.now(timezone.utc)
    t1 = RunningTask(task_id="mem-1", command_id="run", status="queued", created_at=now).snapshot()
    t2 = RunningTask(task_id="mem-2", command_id="run", status="success", created_at=now).snapshot()
    store.upsert_many([t1, t2])
    assert store.get("mem-1") is not None
    assert store.get("mem-missing") is None


def test_file_task_store_noop_paths_and_no_fcntl(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(task_store_module, "fcntl", None)
    store = FileTaskStore(tmp_path / "tasks.json")
    store.upsert_many([])
    assert not store._state_path.exists()

    now = datetime.now(timezone.utc)
    task = RunningTask(
        task_id="noop-1", command_id="run", status="queued", created_at=now, message="same"
    ).snapshot()
    store.upsert(task)
    before = store._state_path.read_text(encoding="utf-8")
    store.upsert(task)
    after = store._state_path.read_text(encoding="utf-8")
    assert before == after

    assert store.get("missing-id") is None
    store.delete("missing-id")
    assert store.get("missing-id") is None


def test_sql_task_store_guard_and_empty_upsert(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(task_store_module, "create_engine", None)
    monkeypatch.setattr(task_store_module, "inspect", None)
    monkeypatch.setattr(task_store_module, "text", None)
    with pytest.raises(RuntimeError, match="sqlalchemy is not available"):
        SqlTaskStore("sqlite+pysqlite:///guard.db")

    monkeypatch.undo()
    db_path = tmp_path / "sql-empty.db"
    store = SqlTaskStore(f"sqlite+pysqlite:///{db_path}")
    try:
        store.upsert_many([])
        assert store.get("missing") is None
    finally:
        store.close()


def test_file_task_store_cleans_tempfile_when_replace_fails(monkeypatch, tmp_path) -> None:
    store = FileTaskStore(tmp_path / "tasks.json")
    original_replace = Path.replace

    def broken_replace(self: Path, target: Path) -> Path:
        if target == store._state_path:
            raise OSError("replace failed")
        return original_replace(self, target)

    monkeypatch.setattr(Path, "replace", broken_replace)
    task = RunningTask(
        task_id="replace-fail",
        command_id="run",
        status="queued",
        created_at=datetime.now(timezone.utc),
    ).snapshot()
    with pytest.raises(OSError, match="replace failed"):
        store.upsert(task)
    assert not any(path.suffix == ".tmp" for path in tmp_path.iterdir())


def test_sql_task_store_non_sqlite_requires_existing_schema(monkeypatch) -> None:
    class FakeDialect:
        name = "postgresql"

    class FakeEngine:
        dialect = FakeDialect()

    monkeypatch.setattr(task_store_module, "create_engine", lambda *args, **kwargs: FakeEngine())
    monkeypatch.setattr(
        task_store_module,
        "inspect",
        lambda _engine: SimpleNamespace(has_table=lambda _name: False),
    )

    with pytest.raises(RuntimeError, match="database schema is not ready"):
        SqlTaskStore("postgresql://example.invalid/db")


def test_sql_task_store_empty_summary_includes_all_status_keys(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "sql-summary.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+pysqlite:///{db_path}")
    store = SqlTaskStore(f"sqlite+pysqlite:///{db_path}")
    try:
        summary = store.summary()
        assert summary == {
            "total": 0,
            "queued": 0,
            "running": 0,
            "success": 0,
            "failed": 0,
            "cancelled": 0,
            "completed": 0,
            "failed_completed": 0,
        }
    finally:
        store.close()
