from __future__ import annotations

from datetime import UTC, datetime
from threading import RLock
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import apps.api.app.services.universal_platform.resume as resume_module
from apps.api.app.models.run import RunLogEntry, RunRecord, RunWaitContext


def _build_run(*, status: str, wait_context: RunWaitContext | None = None) -> RunRecord:
    now = datetime.now(UTC)
    return RunRecord(
        run_id="run_1",
        template_id="tpl_1",
        status=status,  # type: ignore[arg-type]
        params={"email": "user@example.com"},
        created_at=now,
        updated_at=now,
        wait_context=wait_context,
        logs=[RunLogEntry(ts=now, level="info", message="seed")],
    )


class _FakeService:
    def __init__(self, run: RunRecord | None) -> None:
        self._run = run
        self._lock = RLock()
        self.audits: list[tuple[str, str | None, dict[str, object]]] = []
        self.last_env: dict[str, str] | None = None
        self.materialized_flow_ids: list[str] = []

    def get_run(self, run_id: str, requester: str | None = None) -> RunRecord:
        if self._run is None or self._run.run_id != run_id:
            raise HTTPException(status_code=404, detail="run not found")
        return self._run

    def _load_run_locked(self, run_id: str) -> RunRecord | None:
        if self._run is None or self._run.run_id != run_id:
            return None
        return self._run

    def _save_run_locked(self, run: RunRecord) -> None:
        self._run = run

    def get_template(self, template_id: str, requester: str | None = None) -> SimpleNamespace:
        _ = requester
        return SimpleNamespace(
            template_id=template_id,
            flow_id="flow_1",
            policies=SimpleNamespace(otp={}),
        )

    def get_flow(self, flow_id: str, requester: str | None = None) -> SimpleNamespace:
        _ = requester
        return SimpleNamespace(
            flow_id=flow_id,
            session_id="session_1",
            start_url="https://example.com/register",
        )

    def _get_validated_params_snapshot(self, run_id: str) -> dict[str, str]:
        _ = run_id
        return {"email": "user@example.com"}

    def _validate_params(self, template: object, params: object, otp_policy: object) -> None:
        _ = (template, params, otp_policy)

    def _materialize_replay_bridge(self, flow: SimpleNamespace) -> None:
        self.materialized_flow_ids.append(flow.flow_id)

    def _build_env(self, start_url: str, params: dict[str, str], otp_value: str) -> dict[str, str]:
        env = {"START_URL": start_url, "EMAIL": params["email"], "OTP": otp_value}
        self.last_env = env
        return env

    def _resolve_resume_from_step_id(self, wait_context: RunWaitContext | None) -> str | None:
        if wait_context is None:
            return None
        return wait_context.resume_from_step_id

    def _map_task_status(self, task_status: str) -> str:
        return "queued" if task_status in {"queued", "running"} else "failed"

    def _audit(self, action: str, actor: str | None, payload: dict[str, object]) -> None:
        self.audits.append((action, actor, payload))

    def _redact_text(self, value: str) -> str:
        return value.replace("secret", "***")


def test_claim_run_for_resume_waiting_otp_and_waiting_user_paths() -> None:
    service = _FakeService(_build_run(status="waiting_otp"))
    claimed, previous = resume_module.claim_run_for_resume(service, "run_1", "alice", "123456")
    assert previous == "waiting_otp"
    assert claimed.status == "queued"
    assert "otp resume claimed" in claimed.logs[-1].message

    service_wait_user = _FakeService(
        _build_run(
            status="waiting_user",
            wait_context=RunWaitContext(resume_from_step_id="step_9"),
        )
    )
    claimed_user, previous_user = resume_module.claim_run_for_resume(
        service_wait_user, "run_1", "alice", ""
    )
    assert previous_user == "waiting_user"
    assert claimed_user.status == "queued"
    assert "manual gate resume claimed" in claimed_user.logs[-1].message


def test_claim_run_for_resume_rejects_invalid_states_and_missing_otp() -> None:
    service_missing = _FakeService(None)
    with pytest.raises(HTTPException) as missing_err:
        resume_module.claim_run_for_resume(service_missing, "run_1", "alice", "123456")
    assert missing_err.value.status_code == 404

    service_wrong_state = _FakeService(_build_run(status="running"))
    with pytest.raises(HTTPException) as conflict_err:
        resume_module.claim_run_for_resume(service_wrong_state, "run_1", "alice", "123456")
    assert conflict_err.value.status_code == 409

    service_missing_otp = _FakeService(_build_run(status="waiting_otp"))
    with pytest.raises(HTTPException) as otp_err:
        resume_module.claim_run_for_resume(service_missing_otp, "run_1", "alice", "")
    assert otp_err.value.status_code == 422


def test_mark_run_resume_failed_success_and_not_found() -> None:
    service = _FakeService(_build_run(status="waiting_otp"))
    updated = resume_module.mark_run_resume_failed(service, "run_1", "secret failure")
    assert updated.status == "failed"
    assert "*** failure" in updated.logs[-1].message

    missing_service = _FakeService(None)
    with pytest.raises(HTTPException) as err:
        resume_module.mark_run_resume_failed(missing_service, "run_1", "failure")
    assert err.value.status_code == 404


def test_submit_otp_and_resume_waiting_user_sets_resume_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    run = _build_run(
        status="waiting_user",
        wait_context=RunWaitContext(resume_from_step_id="step_42"),
    )
    service = _FakeService(run)
    monkeypatch.setattr(
        resume_module.automation_service,
        "run_command",
        lambda *_a, **_k: SimpleNamespace(task_id="task_123", status="queued"),
    )

    resumed = resume_module.submit_otp_and_resume(service, "run_1", None, actor="alice")

    assert resumed.status == "queued"
    assert resumed.task_id == "task_123"
    assert resumed.wait_context is None
    assert service.last_env is not None
    assert service.last_env["FLOW_RESUME_CONTEXT"] == "true"
    assert service.last_env["FLOW_FROM_STEP_ID"] == "step_42"
    assert any(item[0] == "run.resume_user" for item in service.audits)
    assert "manual gate resolved and resumed" in resumed.logs[-1].message


def test_submit_otp_and_resume_waiting_otp_path_and_error_handling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    run = _build_run(status="waiting_otp")
    service = _FakeService(run)
    monkeypatch.setattr(
        resume_module.automation_service,
        "run_command",
        lambda *_a, **_k: SimpleNamespace(task_id="task_otp", status="running"),
    )

    resumed = resume_module.submit_otp_and_resume(service, "run_1", "654321", actor="alice")
    assert resumed.task_id == "task_otp"
    assert any(item[0] == "run.resume_otp" for item in service.audits)
    assert "otp accepted and resumed" in resumed.logs[-1].message

    failed_service = _FakeService(_build_run(status="waiting_otp"))
    monkeypatch.setattr(
        failed_service,
        "get_template",
        lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    with pytest.raises(HTTPException) as err:
        resume_module.submit_otp_and_resume(failed_service, "run_1", "111111", actor="alice")
    assert err.value.status_code == 500
    assert err.value.detail == "failed to submit otp resume run"
    assert any(item[0] == "run.resume_otp_failed" for item in failed_service.audits)


def test_submit_otp_and_resume_waiting_user_without_resume_step_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    run = _build_run(status="waiting_user", wait_context=RunWaitContext(resume_from_step_id=None))
    service = _FakeService(run)
    monkeypatch.setattr(
        resume_module.automation_service,
        "run_command",
        lambda *_a, **_k: SimpleNamespace(task_id="task_no_step", status="queued"),
    )

    resumed = resume_module.submit_otp_and_resume(service, "run_1", None, actor="alice")
    assert resumed.task_id == "task_no_step"
    assert service.last_env is not None
    assert "FLOW_RESUME_CONTEXT" in service.last_env
    assert "FLOW_FROM_STEP_ID" not in service.last_env


def test_submit_otp_and_resume_reraises_http_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _FakeService(_build_run(status="waiting_otp"))
    monkeypatch.setattr(
        service,
        "get_template",
        lambda *_a, **_k: (_ for _ in ()).throw(HTTPException(status_code=422, detail="bad")),
    )

    with pytest.raises(HTTPException) as err:
        resume_module.submit_otp_and_resume(service, "run_1", "111111", actor="alice")
    assert err.value.status_code == 422
    assert err.value.detail == "bad"


def test_submit_otp_and_resume_not_found_after_task_scheduled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    run = _build_run(status="waiting_otp")
    service = _FakeService(run)
    monkeypatch.setattr(
        resume_module.automation_service,
        "run_command",
        lambda *_a, **_k: SimpleNamespace(task_id="task_lost", status="queued"),
    )

    original_loader = service._load_run_locked
    state = {"called": False}

    def _load_once_then_missing(run_id: str):
        if not state["called"]:
            state["called"] = True
            return original_loader(run_id)
        return None

    monkeypatch.setattr(service, "_load_run_locked", _load_once_then_missing)

    with pytest.raises(HTTPException) as err:
        resume_module.submit_otp_and_resume(service, "run_1", "111111", actor="alice")
    assert err.value.status_code == 404


def test_claim_run_for_resume_load_missing_after_authorization() -> None:
    run = _build_run(status="waiting_otp")
    service = _FakeService(run)
    service.get_run = lambda run_id, requester=None: run  # type: ignore[assignment]
    service._load_run_locked = lambda run_id: None  # type: ignore[assignment]

    with pytest.raises(HTTPException) as err:
        resume_module.claim_run_for_resume(service, "run_1", "alice", "123456")
    assert err.value.status_code == 404
