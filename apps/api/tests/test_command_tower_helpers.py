from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

import apps.api.app.api.command_tower as command_tower
import apps.api.app.core.access_control as access_control
from apps.api.app.core.task_store import FileTaskStore, SqlTaskStore, TaskStore, build_task_store
from apps.api.app.models.automation import TaskSnapshot


def _request(
    host: str = "127.0.0.1",
    path: str = "/api/automation/commands",
    headers: list[tuple[bytes, bytes]] | None = None,
) -> Request:
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("utf-8"),
        "query_string": b"",
        "headers": headers or [],
        "client": (host, 12345),
        "server": ("testserver", 80),
    }
    return Request(scope)


def _snapshot(task_id: str, status: str = "queued") -> TaskSnapshot:
    now = datetime.now(timezone.utc)
    return TaskSnapshot(
        task_id=task_id,
        command="run",
        command_id="run",
        status=status,  # type: ignore[arg-type]
        created_at=now,
        updated_at=now,
        output_tail="",
    )


def _security(actor: str = "tester") -> SimpleNamespace:
    return SimpleNamespace(actor=actor)


def test_requester_id_and_local_client_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    request = _request(
        host="8.8.8.8",
        headers=[(b"x-automation-client-id", b"pytest-client")],
    )
    monkeypatch.setenv("AUTOMATION_API_TOKEN", "expected")
    assert access_control.requester_id(request, "client-token").startswith("token:")
    assert access_control.requester_id(request, None) == "token:anonymous"

    monkeypatch.delenv("AUTOMATION_API_TOKEN", raising=False)
    assert access_control.requester_id(request, None) == "8.8.8.8:pytest-client"

    monkeypatch.setenv("AUTOMATION_ALLOW_LOCAL_NO_TOKEN", "false")
    assert access_control._is_local_client(_request(host="127.0.0.1")) is False
    monkeypatch.setenv("AUTOMATION_ALLOW_LOCAL_NO_TOKEN", "true")
    assert access_control._is_local_client(_request(host="127.0.0.1")) is True


def test_check_token_and_redis_rate_limit_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AUTOMATION_API_TOKEN", raising=False)
    monkeypatch.delenv("AUTOMATION_REQUIRE_TOKEN", raising=False)
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("AUTOMATION_ALLOW_LOCAL_NO_TOKEN", "true")
    with pytest.raises(HTTPException) as non_local:
        access_control.check_token(_request(host="8.8.8.8"), None)
    assert non_local.value.status_code == 401

    class AllowRedis:
        def eval(self, *args, **kwargs):
            return 1

    class BlockRedis:
        def eval(self, *args, **kwargs):
            return 0

    access_control.reset_for_tests()
    monkeypatch.setenv("REDIS_URL", "redis://example.local/0")
    monkeypatch.setattr(access_control, "_REDIS_CLIENT", None)
    monkeypatch.setattr(access_control, "_REDIS_URL_CACHE", "")
    monkeypatch.setattr(access_control, "_create_redis_client", lambda _: AllowRedis())
    assert access_control._check_rate_limit_via_redis(_request()) is True

    monkeypatch.setattr(access_control, "_REDIS_CLIENT", BlockRedis())
    monkeypatch.setattr(access_control, "_REDIS_URL_CACHE", "redis://example.local/0")
    with pytest.raises(HTTPException) as limited:
        access_control._check_rate_limit_via_redis(_request())
    assert limited.value.status_code == 429


def test_task_store_base_file_and_sql_paths(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    base = TaskStore()
    with pytest.raises(NotImplementedError):
        _ = base.kind
    with pytest.raises(NotImplementedError):
        base.load()
    with pytest.raises(NotImplementedError):
        base.upsert(_snapshot("x"))
    with pytest.raises(NotImplementedError):
        base.delete("x")
    with pytest.raises(NotImplementedError):
        base.summary()
    assert base.close() is None

    file_store = FileTaskStore(tmp_path / "tasks.json")
    file_store._save_all([_snapshot("a", "queued"), _snapshot("b", "failed")])
    assert file_store.kind == "file"
    assert file_store.summary()["failed"] == 1
    file_store.delete("a")
    remaining = file_store.load()
    assert len(remaining) == 1
    assert remaining[0].task_id == "b"

    sqlite_path = tmp_path / "store.db"
    sql_store = SqlTaskStore(f"sqlite+pysqlite:///{sqlite_path}")
    try:
        assert sql_store.kind == "sql"
        sql_store.upsert(_snapshot("sql-1", "running"))
        assert [item.task_id for item in sql_store.load()] == ["sql-1"]
        assert sql_store.summary()["running"] == 1
        sql_store.delete("sql-1")
        assert sql_store.summary()["total"] == 0
    finally:
        sql_store.close()

    monkeypatch.delenv("DATABASE_URL", raising=False)
    file_backend = build_task_store(tmp_path)
    assert isinstance(file_backend, FileTaskStore)
    assert str(file_backend._state_path).endswith(".runtime-cache/automation/tasks.json")

    monkeypatch.setenv("DATABASE_URL", f"sqlite+pysqlite:///{tmp_path / 'build.db'}")
    sql_backend = build_task_store(tmp_path)
    assert isinstance(sql_backend, SqlTaskStore)
    sql_backend.close()


def test_command_tower_session_resolution_and_flow_loading(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("UNIVERSAL_AUTOMATION_RUNTIME_DIR", raising=False)
    monkeypatch.setattr(command_tower, "_RUNTIME_AUTOMATION_ROOT", tmp_path)
    latest = tmp_path / "latest-session.json"
    session_dir = tmp_path / "s1"
    session_dir.mkdir(parents=True)

    assert command_tower.resolve_latest_session() is None
    latest.write_text("{ invalid json", encoding="utf-8")
    assert command_tower.resolve_latest_session() is None

    latest.write_text(json.dumps({"sessionId": "s1"}), encoding="utf-8")
    assert command_tower.resolve_latest_session() is None

    latest.write_text(json.dumps({"sessionId": "s1", "sessionDir": "../escape"}), encoding="utf-8")
    assert command_tower.resolve_latest_session() is None

    latest.write_text(
        json.dumps({"sessionId": "s1", "sessionDir": str(session_dir)}), encoding="utf-8"
    )
    assert command_tower.resolve_latest_session() == ("s1", session_dir.resolve())

    assert command_tower.load_latest_flow_draft() is None
    flow_path = session_dir / "flow-draft.json"
    flow_path.write_text("{ nope", encoding="utf-8")
    assert command_tower.load_latest_flow_draft() is None
    flow_path.write_text("[]", encoding="utf-8")
    assert command_tower.load_latest_flow_draft() is None
    flow_path.write_text(
        json.dumps({"start_url": "https://example.com", "steps": [{"action": "navigate"}]}),
        encoding="utf-8",
    )
    loaded = command_tower.load_latest_flow_draft()
    assert loaded is not None
    assert loaded[0] == "s1"


def test_command_tower_validated_session_dir_accepts_runtime_absolute_path_only(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(command_tower, "_RUNTIME_AUTOMATION_ROOT", tmp_path)
    session_dir = tmp_path / "safe-session"
    session_dir.mkdir(parents=True)

    assert command_tower._validated_session_dir(tmp_path, "safe-session") == session_dir.resolve()
    assert command_tower._validated_session_dir(tmp_path, str(session_dir.resolve())) == session_dir.resolve()
    assert command_tower._validated_session_dir(tmp_path, str(tmp_path.parent / "escape")) is None
    assert command_tower._validated_session_dir(tmp_path, "../escape") is None


def test_command_tower_normalize_and_evidence_helpers(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    with pytest.raises(HTTPException) as missing_start_url:
        command_tower.normalize_flow_draft_update({"steps": []}, {})
    assert missing_start_url.value.status_code == 422
    assert missing_start_url.value.detail == "start_url is required"
    with pytest.raises(HTTPException) as invalid_steps:
        command_tower.normalize_flow_draft_update({"start_url": "https://x", "steps": "nope"}, {})
    assert invalid_steps.value.status_code == 422
    assert invalid_steps.value.detail == "steps must be a list"
    with pytest.raises(HTTPException):
        command_tower.normalize_flow_draft_update({"start_url": "https://x", "steps": [1]}, {})
    with pytest.raises(HTTPException):
        command_tower.normalize_flow_draft_update({"start_url": "https://x", "steps": [{}]}, {})

    normalized = command_tower.normalize_flow_draft_update(
        {"start_url": " https://x ", "steps": [{"action": "navigate"}]},
        {"source_event_count": 1},
    )
    assert normalized["start_url"] == "https://x"
    assert normalized["steps"][0]["step_id"] == "s1"

    session_dir = tmp_path / "session"
    session_dir.mkdir(parents=True)
    image = session_dir / "evidence.gif"
    image.write_bytes(b"GIF89aabcdef")
    (session_dir / "replay-flow-result.json").write_text(
        json.dumps(
            {
                "stepResults": [
                    "ignored",
                    {
                        "step_id": "s2",
                        "action": "click",
                        "ok": True,
                        "screenshot_path": "evidence.gif",
                        "fallback_trail": [
                            {"selector_index": "1", "kind": "css", "value": "#ok", "success": True},
                            "x",
                        ],
                    },
                ]
            }
        ),
        encoding="utf-8",
    )
    merged = command_tower.merge_step_evidence(session_dir, "s2")
    assert merged is not None
    assert merged.screenshot_before_path == "evidence.gif"
    assert merged.screenshot_before_data_url is not None

    items = command_tower.read_timeline_items(session_dir)
    assert len(items) == 1
    assert items[0].fallback_trail[0].selector_index == 1
    assert command_tower.parse_fallback_trail({"fallback_trail": "not-list"}) == []

    assert command_tower._detect_image_mime(b"\xff\xd8\xffaaa") == "image/jpeg"
    assert command_tower._detect_image_mime(b"RIFF1234WEBPmore") == "image/webp"

    monkeypatch.setenv("COMMAND_TOWER_EVIDENCE_MAX_BYTES", "not-int")
    assert command_tower._max_evidence_bytes() == 1_048_576
    monkeypatch.setenv("COMMAND_TOWER_EVIDENCE_MAX_BYTES", "0")
    assert command_tower._max_evidence_bytes() == 1
    monkeypatch.setenv("COMMAND_TOWER_EVIDENCE_MAX_BYTES", "4")
    assert command_tower.to_data_url(session_dir, "evidence.gif") is None


def test_command_tower_evidence_path_and_mime_edge_branches(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    session_dir = tmp_path / "session"
    evidence_dir = session_dir / "evidence"
    evidence_dir.mkdir(parents=True)
    png = evidence_dir / "ok.png"
    png.write_bytes(b"\x89PNG\r\n\x1a\npayload")

    # happy path: allowed evidence file should be converted to png data url
    data_url = command_tower.to_data_url(session_dir, "evidence/ok.png")
    assert data_url is not None
    assert data_url.startswith("data:image/png;base64,")

    # traversal should be rejected by safe path resolver
    outside = tmp_path / "outside.png"
    outside.write_bytes(b"\x89PNG\r\n\x1a\noutside")
    assert command_tower.to_data_url(session_dir, "../outside.png") is None

    # symlink path resolves to a different absolute target and must be rejected
    alias = session_dir / "alias.png"
    alias.symlink_to(png)
    assert command_tower._safe_screenshot_path(session_dir, "alias.png") is None

    # guard against filesystem resolution failures
    original_resolve = Path.resolve

    def _raise_resolve(self: Path, *args: object, **kwargs: object) -> Path:
        if self.name == "boom.png":
            raise OSError("boom")
        return original_resolve(self, *args, **kwargs)

    monkeypatch.setattr(Path, "resolve", _raise_resolve)
    assert command_tower._safe_screenshot_path(session_dir, "boom.png") is None

    # fallback MIME path should remain png for unknown bytes
    assert command_tower._detect_image_mime(b"not-an-image-but-safe") == "image/png"


def test_command_tower_route_branches_for_draft_replay_and_evidence(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    flow_path = tmp_path / "flow-draft.json"
    flow_path.write_text("{}", encoding="utf-8")

    monkeypatch.setattr(command_tower, "load_latest_flow_draft", lambda *_args, **_kwargs: None)
    assert command_tower.latest_flow_draft(_security()).flow is None
    with pytest.raises(HTTPException) as no_draft:
        command_tower.update_latest_flow_draft(
            command_tower.FlowDraftDocumentUpdateRequest(
                flow={"start_url": "https://example.com", "steps": [{"action": "navigate"}]}
            ),
            _security(),
        )
    assert no_draft.value.status_code == 404

    monkeypatch.setattr(
        command_tower,
        "load_latest_flow_draft",
        lambda *_args, **_kwargs: ("s1", flow_path, {"start_url": " https://a ", "steps": []}),
    )
    captured: dict[str, object] = {}
    monkeypatch.setattr(
        command_tower.automation_service,
        "run_command",
        lambda command, env, requested_by: captured.update(
            {"command": command, "env": env, "actor": requested_by}
        )
        or _snapshot("task-1"),
    )

    updated = command_tower.update_latest_flow_draft(
        command_tower.FlowDraftDocumentUpdateRequest(
            flow={"start_url": "https://example.com", "steps": [{"action": "click"}]}
        ),
        _security("actor-1"),
    )
    assert updated.session_id == "s1"
    assert updated.flow is not None and updated.flow["steps"][0]["step_id"] == "s1"
    assert command_tower.replay_latest_flow(_security("actor-1")).task.task_id == "task-1"
    assert captured == {
        "command": "automation-replay-flow",
        "env": {"START_URL": "https://a"},
        "actor": "actor-1",
    }

    with pytest.raises(HTTPException) as missing_step:
        command_tower.replay_latest_flow_from_step(
            command_tower.ReplayFromStepRequest(step_id=" "), _security()
        )
    assert missing_step.value.status_code == 422
    with pytest.raises(HTTPException) as unknown_step:
        command_tower.replay_latest_flow_from_step(
            command_tower.ReplayFromStepRequest(step_id="s404"), _security()
        )
    assert unknown_step.value.status_code == 404

    monkeypatch.setattr(
        command_tower,
        "load_latest_flow_draft",
        lambda *_args, **_kwargs: (
            "s2",
            flow_path,
            {"start_url": "https://b", "steps": [{"step_id": "s2", "selected_selector_index": -3}]},
        ),
    )
    command_tower.replay_latest_flow_from_step(
        command_tower.ReplayFromStepRequest(step_id="s2", replay_preconditions=True),
        _security("actor-2"),
    )
    assert captured["command"] == "automation-replay-flow"
    assert captured["env"] == {
        "FLOW_FROM_STEP_ID": "s2",
        "FLOW_REPLAY_PRECONDITIONS": "true",
        "START_URL": "https://b",
    }
    command_tower.replay_latest_flow_step(
        command_tower.ReplayLatestStepRequest(step_id="s2"), _security()
    )
    assert captured["command"] == "automation-replay-flow-step"
    assert captured["env"] == {
        "FLOW_STEP_ID": "s2",
        "START_URL": "https://b",
        "FLOW_SELECTOR_INDEX": "0",
    }

    monkeypatch.setattr(
        command_tower, "resolve_session_for_requester", lambda *_args, **_kwargs: None
    )
    with pytest.raises(HTTPException) as no_session:
        command_tower.step_evidence("step-1", _security())
    assert no_session.value.status_code == 404
    assert command_tower.evidence_timeline(_security()).items == []


def test_command_tower_latest_flow_draft_happy_path_and_missing_paths(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    flow_path = tmp_path / "flow-draft.json"
    flow_path.write_text(
        json.dumps(
            {"start_url": "https://example.com", "steps": [{"step_id": "s1", "action": "navigate"}]}
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        command_tower,
        "load_latest_flow_draft",
        lambda *_a, **_k: ("session-1", flow_path, {"start_url": "https://example.com", "steps": []}),
    )
    payload = command_tower.latest_flow_draft(_security("actor-x"))
    assert payload.session_id == "session-1"
    assert payload.flow is not None

    monkeypatch.setattr(command_tower, "load_latest_flow_draft", lambda *_a, **_k: None)
    with pytest.raises(HTTPException) as replay_missing:
        command_tower.replay_latest_flow(_security("actor-x"))
    assert replay_missing.value.status_code == 404

    with pytest.raises(HTTPException) as replay_from_step_missing:
        command_tower.replay_latest_flow_from_step(
            command_tower.ReplayFromStepRequest(step_id="s1"), _security("actor-x")
        )
    assert replay_from_step_missing.value.status_code == 404

    with pytest.raises(HTTPException) as empty_step:
        command_tower.step_evidence("   ", _security("actor-x"))
    assert empty_step.value.status_code == 422


def test_command_tower_resolve_session_for_requester_directory_guards(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Session:
        def __init__(self, session_id: str) -> None:
            self.session_id = session_id

    monkeypatch.setattr(
        command_tower.universal_platform_service,
        "get_session",
        lambda session_id, requester=None: Session(session_id),
    )
    monkeypatch.setattr(command_tower, "_validated_session_dir", lambda *_a, **_k: None)
    with pytest.raises(HTTPException) as missing_dir:
        command_tower.resolve_session_for_requester("actor-y", "session-y")
    assert missing_dir.value.status_code == 404

    monkeypatch.setattr(
        command_tower.universal_platform_service,
        "list_sessions",
        lambda limit=1, requester=None: [Session("session-z")],
    )
    assert command_tower.resolve_session_for_requester("actor-y") is None


def test_command_tower_route_and_session_resolution_remaining_branches(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("UNIVERSAL_AUTOMATION_RUNTIME_DIR", raising=False)
    class Session:
        def __init__(self, session_id: str) -> None:
            self.session_id = session_id
    original_resolve_session_for_requester = command_tower.resolve_session_for_requester

    orchestrate_payload = command_tower.OrchestrateFromArtifactsRequest(artifacts={})
    monkeypatch.setattr(
        command_tower.universal_platform_service,
        "create_template_from_artifacts",
        lambda payload, actor=None: command_tower.OrchestrateFromArtifactsResponse(
            template_id="tp-branch",
            reconstructed_flow_quality=87,
        ),
    )
    orchestrated = command_tower.orchestrate_from_artifacts(orchestrate_payload, _security("actor-ct"))
    assert orchestrated.template_id == "tp-branch"

    monkeypatch.setattr(command_tower, "load_latest_flow_draft", lambda *_a, **_k: None)
    with pytest.raises(HTTPException) as missing_replay_step:
        command_tower.replay_latest_flow_step(
            command_tower.ReplayLatestStepRequest(step_id="s1"),
            _security("actor-ct"),
        )
    assert missing_replay_step.value.status_code == 404

    monkeypatch.setattr(command_tower, "resolve_session_for_requester", lambda *_a, **_k: ("s1", tmp_path))
    monkeypatch.setattr(command_tower, "merge_step_evidence", lambda *_a, **_k: None)
    with pytest.raises(HTTPException) as no_evidence:
        command_tower.step_evidence("s1", _security("actor-ct"))
    assert no_evidence.value.status_code == 404

    monkeypatch.setattr(
        command_tower,
        "read_timeline_items",
        lambda *_a, **_k: [command_tower.EvidenceTimelineItemResponse(step_id="s1")],
    )
    timeline = command_tower.evidence_timeline(_security("actor-ct"))
    assert [item.step_id for item in timeline.items] == ["s1"]

    monkeypatch.setattr(
        command_tower, "resolve_session_for_requester", original_resolve_session_for_requester
    )
    with pytest.raises(HTTPException) as blank_session_id:
        command_tower.resolve_session_for_requester("actor-ct", "   ")
    assert blank_session_id.value.status_code == 422

    monkeypatch.setattr(command_tower, "_RUNTIME_AUTOMATION_ROOT", tmp_path)
    explicit_dir = tmp_path / "session-explicit"
    explicit_dir.mkdir(parents=True)
    monkeypatch.setattr(
        command_tower.universal_platform_service,
        "get_session",
        lambda session_id, requester=None: Session(session_id),
    )
    explicit = command_tower.resolve_session_for_requester("actor-ct", "session-explicit")
    assert explicit is not None
    assert explicit[0] == "session-explicit"
    assert explicit[1] == explicit_dir.resolve()

    monkeypatch.setattr(
        command_tower.universal_platform_service, "list_sessions", lambda limit=1, requester=None: []
    )
    assert command_tower.resolve_session_for_requester("actor-ct") is None

    latest_dir = tmp_path / "session-latest"
    latest_dir.mkdir(parents=True)
    monkeypatch.setattr(
        command_tower.universal_platform_service,
        "list_sessions",
        lambda limit=1, requester=None: [Session("session-latest")],
    )
    latest = command_tower.resolve_session_for_requester("actor-ct")
    assert latest is not None
    assert latest[0] == "session-latest"
    assert latest[1] == latest_dir.resolve()


def test_command_tower_session_resolution_explicit_directory_and_preview_branches(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("UNIVERSAL_AUTOMATION_RUNTIME_DIR", raising=False)
    class Session:
        def __init__(self, session_id: str) -> None:
            self.session_id = session_id

    monkeypatch.setattr(command_tower, "_RUNTIME_AUTOMATION_ROOT", tmp_path)
    monkeypatch.setattr(
        command_tower.universal_platform_service,
        "get_session",
        lambda session_id, requester=None: Session(session_id),
    )

    with pytest.raises(HTTPException) as missing_explicit_dir:
        command_tower.resolve_session_for_requester("actor-x", "session-missing")
    assert missing_explicit_dir.value.status_code == 404

    preview_dir = tmp_path / "session-preview"
    preview_dir.mkdir(parents=True, exist_ok=True)
    (preview_dir / "flow-draft.json").write_text(
        json.dumps(
            {
                "start_url": "https://example.com",
                "generated_at": "not-a-timestamp",
                "steps": [
                    {"step_id": "s1", "action": "navigate", "url": "https://example.com"},
                    {"step_id": "s2", "action": "click", "target": {"selectors": ["bad-selector"]}},
                ],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        command_tower.universal_platform_service,
        "get_session",
        lambda session_id, requester=None: Session("session-preview"),
    )
    preview = command_tower.latest_flow_preview("actor-x", session_id="session-preview")
    assert preview.generated_at is None
    assert preview.steps[1].selector is None


def test_command_tower_load_and_path_guards_additional_branches(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("UNIVERSAL_AUTOMATION_RUNTIME_DIR", raising=False)
    monkeypatch.setattr(command_tower, "_RUNTIME_AUTOMATION_ROOT", tmp_path)

    latest = tmp_path / "latest-session.json"
    latest.write_text("[]", encoding="utf-8")
    assert command_tower.resolve_latest_session() is None

    latest.write_text(
        json.dumps({"sessionId": "  ", "sessionDir": str(tmp_path / "s1")}),
        encoding="utf-8",
    )
    assert command_tower.resolve_latest_session() is None

    assert command_tower.load_latest_flow_draft() is None

    original_resolve = Path.resolve

    def _raise_resolve(self: Path, *args: object, **kwargs: object) -> Path:
        if self.name == "boom":
            raise OSError("boom")
        return original_resolve(self, *args, **kwargs)

    monkeypatch.setattr(Path, "resolve", _raise_resolve)
    assert command_tower._validated_session_dir(tmp_path, "boom") is None

    file_target = tmp_path / "plain-file"
    file_target.write_text("x", encoding="utf-8")
    assert command_tower._validated_session_dir(tmp_path, "plain-file") is None

    outside_dir = tmp_path.parent / "ct-outside-dir"
    outside_dir.mkdir(parents=True, exist_ok=True)
    assert command_tower._validated_session_dir(tmp_path, str(outside_dir)) is None

    session_dir = tmp_path / "session-for-draft"
    session_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(
        command_tower, "resolve_session_for_requester", lambda *_a, **_k: ("session-for-draft", session_dir)
    )

    assert command_tower.load_latest_flow_draft("actor-ct", session_id="session-for-draft") is None

    flow_path = session_dir / "flow-draft.json"
    flow_path.write_text("{broken", encoding="utf-8")
    assert command_tower.load_latest_flow_draft("actor-ct", session_id="session-for-draft") is None

    flow_path.write_text("[]", encoding="utf-8")
    assert command_tower.load_latest_flow_draft("actor-ct", session_id="session-for-draft") is None

    flow_path.write_text(
        json.dumps({"start_url": "https://example.com", "steps": [{"step_id": "s1", "action": "navigate"}]}),
        encoding="utf-8",
    )
    loaded = command_tower.load_latest_flow_draft("actor-ct", session_id="session-for-draft")
    assert loaded is not None
    assert loaded[0] == "session-for-draft"

    assert command_tower.to_data_url(session_dir / "missing.png") is None


def test_command_tower_preview_and_normalization_remaining_branches(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    normalized = command_tower.normalize_flow_draft_update(
        {
            "start_url": " https://preview.example ",
            "steps": [{"step_id": "kept-step-id", "action": "click"}],
        },
        {"source_event_count": 0},
    )
    assert normalized["steps"][0]["step_id"] == "kept-step-id"

    monkeypatch.setattr(
        command_tower,
        "load_latest_flow_draft",
        lambda *_a, **_k: (
            "session-preview",
            tmp_path / "flow-draft.json",
            {
                "start_url": "https://preview.example",
                "generated_at": "not-an-iso-time",
                "source_event_count": "bad-number",
                "steps": [
                    {
                        "step_id": "s1",
                        "action": "click",
                        "target": {"selectors": [{"kind": "css", "value": "#submit"}]},
                    },
                    {
                        "step_id": "s2",
                        "action": "type",
                        "target": {"selectors": ["invalid-selector-shape"]},
                    },
                ],
            },
        ),
    )
    preview = command_tower.latest_flow_preview("actor-preview")
    assert preview.session_id == "session-preview"
    assert preview.generated_at is None
    assert preview.source_event_count == 0
    assert len(preview.steps) == 2
    assert preview.steps[0].selector == "#submit"
    assert preview.steps[1].selector is None
