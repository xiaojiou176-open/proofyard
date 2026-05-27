from __future__ import annotations

import json
import subprocess
import sys
import time
from datetime import UTC, datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

import apps.api.app.api.command_tower as command_tower
from apps.api.app.models.automation import TaskSnapshot
from apps.api.app.models.run import RunRecord
from apps.api.app.services.automation_service import RunningTask, automation_service
from apps.api.app.services.universal_platform_service import UniversalPlatformService
from apps.api.app.services.vonage_inbox import vonage_inbox_service


def _snapshot(task_id: str, status: str = "queued") -> TaskSnapshot:
    now = datetime.now(timezone.utc)
    return TaskSnapshot(
        task_id=task_id,
        command="run-ui",
        command_id="run-ui",
        status=status,  # type: ignore[arg-type]
        created_at=now,
        updated_at=now,
        output_tail="",
    )


def _new_universal_service(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> UniversalPlatformService:
    runtime_root = tmp_path / "runtime"
    monkeypatch.setenv("UNIVERSAL_AUTOMATION_RUNTIME_DIR", str(runtime_root))
    monkeypatch.setenv("UNIVERSAL_PLATFORM_DATA_DIR", str(runtime_root / "universal"))
    return UniversalPlatformService()


class _MemoryTaskStore:
    kind = "file"

    def __init__(self) -> None:
        self._items: dict[str, TaskSnapshot] = {}

    def load(self) -> list[TaskSnapshot]:
        return list(self._items.values())

    def upsert(self, snapshot: TaskSnapshot) -> None:
        self._items[snapshot.task_id] = snapshot

    def delete(self, task_id: str) -> None:
        self._items.pop(task_id, None)

    def summary(self) -> dict[str, int]:
        counts = {"total": len(self._items), "queued": 0, "running": 0, "success": 0, "failed": 0}
        for item in self._items.values():
            if item.status in counts:
                counts[item.status] += 1
        return counts

    def close(self) -> None:
        return None


@pytest.fixture
def isolated_automation(monkeypatch: pytest.MonkeyPatch):
    previous_store = automation_service._task_store
    previous_tasks = dict(automation_service._tasks)
    previous_records = dict(automation_service._idempotency_records)
    store = _MemoryTaskStore()
    monkeypatch.setattr(automation_service, "_task_store", store)
    with automation_service._lock:
        automation_service._tasks.clear()
        automation_service._idempotency_records.clear()
    try:
        yield store
    finally:
        with automation_service._lock:
            automation_service._tasks.clear()
            automation_service._tasks.update(previous_tasks)
            automation_service._idempotency_records.clear()
            automation_service._idempotency_records.update(previous_records)
        automation_service._task_store = previous_store


@pytest.fixture
def isolated_vonage(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    runtime_root = tmp_path / "runtime"
    monkeypatch.setenv("UNIVERSAL_AUTOMATION_RUNTIME_DIR", str(runtime_root))
    monkeypatch.delenv("REDIS_URL", raising=False)

    previous_inbox_path = vonage_inbox_service._inbox_path
    previous_audit_path = vonage_inbox_service._audit_path
    previous_dedupe_path = vonage_inbox_service._dedupe_path
    previous_redis_client = vonage_inbox_service._redis_client
    previous_redis_url_cache = vonage_inbox_service._redis_url_cache
    previous_dedupe_mode = vonage_inbox_service._last_dedupe_mode

    base = runtime_root / "vonage"
    vonage_inbox_service._inbox_path = base / "inbox.jsonl"
    vonage_inbox_service._audit_path = base / "audit.jsonl"
    vonage_inbox_service._dedupe_path = base / "dedupe.json"
    vonage_inbox_service._redis_client = None
    vonage_inbox_service._redis_url_cache = ""
    vonage_inbox_service._last_dedupe_mode = "file"

    try:
        yield vonage_inbox_service
    finally:
        vonage_inbox_service._inbox_path = previous_inbox_path
        vonage_inbox_service._audit_path = previous_audit_path
        vonage_inbox_service._dedupe_path = previous_dedupe_path
        vonage_inbox_service._redis_client = previous_redis_client
        vonage_inbox_service._redis_url_cache = previous_redis_url_cache
        vonage_inbox_service._last_dedupe_mode = previous_dedupe_mode


def test_automation_summary_list_and_cancel_branches(isolated_automation, monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime.now(timezone.utc)

    queued = RunningTask(
        task_id="queued-1",
        command_id="run-ui",
        status="queued",
        created_at=now,
        requested_by="owner-a",
    )
    running = RunningTask(
        task_id="run-1",
        command_id="run-ui",
        status="running",
        created_at=now,
        requested_by="owner-a",
        process=object(),  # type: ignore[arg-type]
    )
    failed = RunningTask(
        task_id="failed-1",
        command_id="other",
        status="failed",
        created_at=now,
        requested_by="owner-b",
        finished_at=now,
    )
    success = RunningTask(
        task_id="ok-1",
        command_id="run-ui",
        status="success",
        created_at=now,
        requested_by="owner-a",
        finished_at=now,
    )
    with automation_service._lock:
        automation_service._tasks = {
            queued.task_id: queued,
            running.task_id: running,
            failed.task_id: failed,
            success.task_id: success,
        }
        for task in automation_service._tasks.values():
            automation_service._save_task_locked(task)

    summary = automation_service.task_summary()
    assert summary["total"] == 4
    assert summary["completed"] == 2
    assert summary["failed_completed"] == 1

    filtered = automation_service.list_tasks(
        requested_by="owner-b",
        status="failed",  # type: ignore[arg-type]
        command_id="other",
        limit=0,
    )
    assert len(filtered) == 1
    assert filtered[0].task_id == "failed-1"

    with pytest.raises(HTTPException) as denied:
        automation_service.cancel_task("run-1", requested_by="owner-x")
    assert denied.value.status_code == 403

    monkeypatch.setattr(automation_service, "_terminate_process", lambda *_a, **_k: True)
    cancelled_running = automation_service.cancel_task("run-1", requested_by="owner-a")
    assert cancelled_running.status == "cancelled"
    assert cancelled_running.message == "task force-killed by user"

    cancelled_queued = automation_service.cancel_task("queued-1", requested_by="owner-a")
    assert cancelled_queued.status == "cancelled"
    assert cancelled_queued.message == "task cancelled before start"


def test_automation_retry_terminate_and_sync_edge_branches(
    isolated_automation, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert automation_service._compute_retry_delay_seconds(1) == 0.0

    original_base = automation_service._retry_base_seconds
    original_max = automation_service._retry_max_seconds
    original_jitter = automation_service._retry_jitter_ratio
    try:
        automation_service._retry_base_seconds = 2.0
        automation_service._retry_max_seconds = 30.0
        automation_service._retry_jitter_ratio = 0.0
        assert automation_service._compute_retry_delay_seconds(3) == 4.0
    finally:
        automation_service._retry_base_seconds = original_base
        automation_service._retry_max_seconds = original_max
        automation_service._retry_jitter_ratio = original_jitter

    warnings: list[str] = []
    monkeypatch.setattr(
        "apps.api.app.services.automation_service.logger.warning",
        lambda message, **_kwargs: warnings.append(message),
    )

    class TimeoutProcess:
        pid = None

        def __init__(self) -> None:
            self.terminated = False

        def terminate(self) -> None:
            self.terminated = True

        def kill(self) -> None:
            self.terminated = True

        def wait(self, timeout: float | None = None) -> int:
            raise subprocess.TimeoutExpired("cmd", timeout)

    process = TimeoutProcess()
    assert automation_service._terminate_process(process, timeout_seconds=0.01) is True
    assert process.terminated is True
    assert warnings

    now = datetime.now(timezone.utc)
    with automation_service._lock:
        automation_service._idempotency_records["user:missing"] = ("missing-task", now)
        assert automation_service._find_task_by_idempotency_key_locked("user:missing") is None
        assert "user:missing" not in automation_service._idempotency_records

    marker = object()
    with automation_service._lock:
        automation_service._tasks = {
            "local-running": RunningTask(
                task_id="local-running",
                command_id="run-ui",
                status="running",
                created_at=now,
                process=marker,  # type: ignore[arg-type]
                output_lines=["local-tail"],
            )
        }
    monkeypatch.setattr(
        automation_service,
        "_task_store",
        SimpleNamespace(kind="sql", load=lambda: []),
    )
    with automation_service._lock:
        automation_service._sync_from_store_locked()
        assert "local-running" in automation_service._tasks
        assert automation_service._tasks["local-running"].process is marker


def test_command_tower_replay_routes_without_optional_env(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: list[dict[str, Any]] = []
    flow = {"start_url": "   ", "steps": [{"step_id": "s1", "action": "click"}]}
    monkeypatch.setattr(
        command_tower,
        "load_latest_flow_draft",
        lambda *_args, **_kwargs: ("session-1", Path("/tmp/flow.json"), flow),
    )
    monkeypatch.setattr(
        command_tower.automation_service,
        "run_command",
        lambda command, env, requested_by: captured.append(
            {"command": command, "env": dict(env), "requested_by": requested_by}
        )
        or _snapshot(f"task-{len(captured)}"),
    )

    replay = command_tower.replay_latest_flow(SimpleNamespace(actor="actor-a"))
    assert replay.task.task_id == "task-1"
    assert captured[-1]["env"] == {}

    replay_from_step = command_tower.replay_latest_flow_from_step(
        command_tower.ReplayFromStepRequest(step_id="s1", replay_preconditions=False),
        SimpleNamespace(actor="actor-a"),
    )
    assert replay_from_step.task.task_id == "task-2"
    assert captured[-1]["env"] == {"FLOW_FROM_STEP_ID": "s1"}

    replay_step = command_tower.replay_latest_flow_step(
        command_tower.ReplayLatestStepRequest(step_id="s1"),
        SimpleNamespace(actor="actor-a"),
    )
    assert replay_step.task.task_id == "task-3"
    assert captured[-1]["env"] == {"FLOW_STEP_ID": "s1"}

    with pytest.raises(HTTPException) as missing_step_id:
        command_tower.replay_latest_flow_step(
            command_tower.ReplayLatestStepRequest(step_id=" "),
            SimpleNamespace(actor="actor-a"),
        )
    assert missing_step_id.value.status_code == 422

    with pytest.raises(HTTPException) as unknown_step:
        command_tower.replay_latest_flow_step(
            command_tower.ReplayLatestStepRequest(step_id="s404"),
            SimpleNamespace(actor="actor-a"),
        )
    assert unknown_step.value.status_code == 404


def test_command_tower_readers_and_data_url_failure_paths(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    session_dir = tmp_path / "session"
    session_dir.mkdir(parents=True, exist_ok=True)

    result = session_dir / "replay-flow-result.json"
    result.write_text("{ broken", encoding="utf-8")
    assert command_tower.read_step_result(result, "s1") is None
    result.write_text("[]", encoding="utf-8")
    assert command_tower.read_step_result(result, "s1") is None
    result.write_text(json.dumps({"stepResults": "nope"}), encoding="utf-8")
    assert command_tower.read_step_result(result, "s1") is None
    result.write_text(json.dumps({"stepResults": [{"step_id": "other"}]}), encoding="utf-8")
    assert command_tower.read_step_result(result, "s1") is None

    assert command_tower.merge_step_evidence(session_dir, "s1") is None

    result.unlink()
    assert command_tower.read_timeline_items(session_dir) == []
    result.write_text("{ nope", encoding="utf-8")
    assert command_tower.read_timeline_items(session_dir) == []
    result.write_text("[]", encoding="utf-8")
    assert command_tower.read_timeline_items(session_dir) == []
    result.write_text(json.dumps({"stepResults": "bad"}), encoding="utf-8")
    assert command_tower.read_timeline_items(session_dir) == []

    assert command_tower.to_data_url(session_dir, "evidence/missing.png") is None

    evidence_dir = session_dir / "evidence"
    evidence_dir.mkdir(parents=True, exist_ok=True)
    png = evidence_dir / "ok.png"
    png.write_bytes(b"\x89PNG\r\n\x1a\npayload")
    original_read_bytes = Path.read_bytes

    def _raise_read_bytes(self: Path) -> bytes:
        if self == png:
            raise OSError("boom")
        return original_read_bytes(self)

    monkeypatch.setattr(Path, "read_bytes", _raise_read_bytes)
    assert command_tower.to_data_url(session_dir, "evidence/ok.png") is None

    not_file = evidence_dir / "folder"
    not_file.mkdir(parents=True, exist_ok=True)
    assert command_tower._safe_screenshot_path(session_dir, "evidence/folder") is None


def test_universal_platform_session_import_cache_and_runtime_branches(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_universal_service(monkeypatch, tmp_path)
    session_a = service.start_session("https://example.com/a", "manual", owner="owner-a")
    session_b = service.start_session("https://example.com/b", "manual", owner="owner-b")

    owner_a_sessions = service.list_sessions(requester="owner-a")
    assert len(owner_a_sessions) == 1
    assert owner_a_sessions[0].session_id == session_a.session_id

    finished = service.finish_session(session_b.session_id, owner="owner-b")
    assert finished.finished_at is not None

    with pytest.raises(HTTPException) as missing_session:
        service.create_flow(
            session_id="ss-missing",
            start_url="https://example.com",
            steps=[],
            requester="owner-a",
        )
    assert missing_session.value.status_code == 404

    now = datetime.now(UTC)
    run = RunRecord(
        run_id="rn-cache",
        template_id="tp-cache",
        status="queued",
        params={"email": "user@example.com"},
        created_at=now,
        updated_at=now,
    )
    service._cache_max_entries = 2
    service._upsert_run(
        run,
        extras={
            service._LEGACY_VALIDATED_PARAMS_KEY: {"email": "user@example.com"},
            service._run_owner_key: 123,
        },
    )
    snapshot = service._get_validated_params_snapshot("rn-cache")
    assert snapshot == {"email": "user@example.com"}
    assert "rn-cache" in service._validated_params_cache
    assert service._coerce_optional_text(None, " x ") == "x"
    assert service._coerce_optional_bool(None, True) is True

    monkeypatch.setattr(
        service,
        "get_template",
        lambda *_a, **_k: (_ for _ in ()).throw(HTTPException(status_code=404, detail="missing")),
    )
    assert service._run_owner(run) is None

    original_resolve = Path.resolve

    def _raise_value_error(self: Path, *args: object, **kwargs: object) -> Path:
        if self.name == "value-error":
            raise ValueError("boom")
        return original_resolve(self, *args, **kwargs)

    monkeypatch.setattr(Path, "resolve", _raise_value_error)
    assert service._is_within_runtime_root(Path("value-error")) is False

    service._upsert_session_from_import(
        session_id=session_b.session_id,
        start_url="https://example.com/b-updated",
        owner=None,
    )
    sessions_after = service.list_sessions(limit=10)
    assert {item.session_id for item in sessions_after} >= {session_a.session_id, session_b.session_id}


def test_vonage_inbox_file_mode_and_phone_matching_branches(
    isolated_vonage, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = isolated_vonage
    service._dedupe_path.parent.mkdir(parents=True, exist_ok=True)
    service._dedupe_path.write_text("{ broken", encoding="utf-8")
    assert service.register_message_id("msg-1", 30) is True
    assert service.register_message_id("msg-1", 30) is False

    service._dedupe_path.write_text(
        json.dumps({"old": "x", "fresh": int(time.time())}),
        encoding="utf-8",
    )
    assert service.register_message_id("msg-2", 30) is True

    service._inbox_path.parent.mkdir(parents=True, exist_ok=True)
    service._inbox_path.write_text(
        "\n".join(
            [
                "",
                "{ broken",
                json.dumps({"from_number": "alpha", "to_number": "1999", "text": "Code 111111"}),
                json.dumps({"from_number": "sender-x", "to_number": "15550001111", "text": "No code"}),
                json.dumps(
                    {"from_number": "sender-ok", "to_number": "15550001111", "text": "Code 222333"}
                ),
            ]
        ),
        encoding="utf-8",
    )
    assert service.latest_otp(regex=r"\b(\d{6})\b", to_number="00000000000") is None
    assert (
        service.latest_otp(
            regex=r"\b(\d{6})\b",
            to_number="15550001111",
            sender_filter="sender-ok",
        )
        == "222333"
    )

    assert service._normalize_phone_number(None) == ""
    assert service._normalize_phone_number("1-555-000-1111") == "5550001111"
    assert service._normalize_phone_number("+44 20 1234") == "44201234"

    calls: dict[str, Any] = {}

    class _FakeRedis:
        @classmethod
        def from_url(cls, redis_url: str, decode_responses: bool):
            calls["url"] = redis_url
            calls["decode_responses"] = decode_responses
            return "redis-client"

    monkeypatch.setitem(sys.modules, "redis", SimpleNamespace(Redis=_FakeRedis))
    client = service._create_redis_client("redis://localhost:6379/0")
    assert client == "redis-client"
    assert calls == {"url": "redis://localhost:6379/0", "decode_responses": True}
