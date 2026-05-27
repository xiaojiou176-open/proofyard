from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import apps.api.app.services.universal_platform.run as run_ops
from apps.api.app.models.run import RunRecord, RunWaitContext


def _build_run(
    *,
    status: str = "running",
    task_id: str | None = "task-1",
    wait_context: RunWaitContext | None = None,
) -> RunRecord:
    now = datetime.now(UTC)
    return RunRecord(
        run_id="rn-1",
        template_id="tp-1",
        status=status,  # type: ignore[arg-type]
        params={},
        task_id=task_id,
        created_at=now,
        updated_at=now,
        wait_context=wait_context,
    )


def test_cancel_run_reraises_non_404_cancel_error(monkeypatch: pytest.MonkeyPatch) -> None:
    run = _build_run(status="queued", task_id="task-err")
    service = SimpleNamespace(get_run=lambda *_a, **_k: run)

    def _raise_server_error(*_a, **_k):
        raise HTTPException(status_code=500, detail="boom")

    monkeypatch.setattr(run_ops.automation_service, "cancel_task", _raise_server_error)

    with pytest.raises(HTTPException) as err:
        run_ops.cancel_run(service, "rn-1", actor="owner-a")
    assert err.value.status_code == 500


def test_sync_run_status_clears_wait_context_and_persists_progress_same_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    run = _build_run(
        status="running",
        task_id="task-progress",
        wait_context=RunWaitContext(reason_code="captcha"),
    )
    upserted_runs: list[RunRecord] = []
    service = SimpleNamespace(
        _redact_text=lambda text: text,
        _upsert_run=lambda item: upserted_runs.append(item.model_copy(deep=True)),
    )
    task = SimpleNamespace(
        status="running",
        output_tail='{"stepId":"s1","action":"click","ok":true,"detail":"done"}',
    )
    monkeypatch.setattr(run_ops.automation_service, "get_task", lambda _task_id: task)

    run_ops.sync_run_status(service, run)

    assert run.wait_context is None
    assert run.step_cursor == 1
    assert upserted_runs, "status unchanged + progress should still persist run snapshot"


def test_wait_context_and_env_helper_branches() -> None:
    assert run_ops.extract_wait_context({"manualGate": {"required": "false"}}) is None
    assert run_ops.resolve_resume_from_step_id(None) is None
    assert run_ops.coerce_optional_bool(" no ") is False

    env = run_ops.build_env(
        "https://example.com",
        {"account_password": "pw", "email_otp": "123456", "username": "alice"},
        otp_code=None,
        stripe_param_keys=(),
        is_secret_param_key=lambda _k: False,
    )
    assert env["FLOW_SECRET_INPUT"] == "pw"
    assert env["FLOW_OTP_CODE"] == "123456"
    assert env["FLOW_INPUT"] == "alice"


def test_extract_progress_and_coercion_skip_blank_or_missing_candidates() -> None:
    cursor, logs, wait_context = run_ops.extract_progress(
        '{"stepResults":[{"action":"click","ok":false,"detail":"skip-without-step-id"}]}',
        redact_text=lambda text: text,
    )
    assert cursor == 0
    assert logs == []
    assert wait_context is None

    assert run_ops.coerce_optional_text("   ", "resolved-value") == "resolved-value"
    assert run_ops.coerce_optional_bool("maybe", "yes") is True


def test_list_get_and_extract_progress_additional_branches() -> None:
    now = datetime.now(UTC)
    first = RunRecord(
        run_id="rn-1",
        template_id="tp-1",
        status="queued",
        params={},
        created_at=now,
        updated_at=now,
    )
    second = RunRecord(
        run_id="rn-2",
        template_id="tp-2",
        status="running",
        params={},
        created_at=now,
        updated_at=now,
    )
    service = SimpleNamespace(
        _runs_path="unused",
        _read_json=lambda _path: [first.model_dump(mode="json"), second.model_dump(mode="json")],
        _sync_run_status=lambda _run: None,
        _run_owner=lambda run: "owner-a" if run.run_id == "rn-1" else "owner-b",
        list_runs=lambda **kwargs: run_ops.list_runs(service, **kwargs),
    )

    assert [item.run_id for item in run_ops.list_runs(service, limit=0, requester="owner-a")] == ["rn-1"]
    with pytest.raises(HTTPException) as missing_run:
        run_ops.get_run(service, "rn-missing", requester="owner-a")
    assert missing_run.value.status_code == 404

    cursor, logs, wait_context = run_ops.extract_progress(
        '{"stepId":"s1","action":"click","ok":true,"detail":"done","manualGate":{"manualGateRequired":"true","afterStepId":"s1"}}',
        redact_text=lambda text: text,
    )
    assert cursor == 1
    assert logs and logs[0].level == "info"
    assert wait_context is not None
    assert wait_context.after_step_id == "s1"


def test_list_cancel_and_sync_remaining_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime.now(UTC)
    upsert_calls: list[str] = []
    run = RunRecord(
        run_id="rn-no-task",
        template_id="tp-1",
        status="running",
        params={},
        created_at=now,
        updated_at=now,
        task_id=None,
    )
    service = SimpleNamespace(
        _runs_path="unused",
        _read_json=lambda _path: [run.model_dump(mode="json")],
        _sync_run_status=lambda _run: None,
        _run_owner=lambda _run: "owner-a",
        _redact_text=lambda text: text,
        _audit=lambda *_a, **_k: None,
        list_runs=lambda **kwargs: run_ops.list_runs(service, **kwargs),
        get_run=lambda run_id, requester=None: run_ops.get_run(service, run_id, requester=requester),
        _upsert_run=lambda *_a, **_k: upsert_calls.append("upsert"),
    )

    listed = run_ops.list_runs(service, limit=0, requester=None)
    assert [item.run_id for item in listed] == ["rn-no-task"]

    cancelled = run_ops.cancel_run(service, "rn-no-task", actor="owner-a")
    assert cancelled.status == "cancelled"
    assert cancelled.logs[-1].message == "cancelled by user"

    upsert_calls.clear()
    task = SimpleNamespace(status="running", output_tail='{"manualGate":{"required":"false"}}')
    monkeypatch.setattr(run_ops.automation_service, "get_task", lambda _task_id: task)
    active_run = _build_run(status="running", task_id="task-sync")
    run_ops.sync_run_status(service, active_run)
    assert active_run.step_cursor == 0
    assert active_run.wait_context is None
    assert upsert_calls == []
