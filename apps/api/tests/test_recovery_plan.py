from __future__ import annotations

from datetime import UTC, datetime
from apps.api.app.models.run import RunLogEntry, RunRecord, RunWaitContext
from apps.api.app.services.universal_platform import recovery as recovery_ops


def _build_run(
    *,
    status: str,
    wait_context: RunWaitContext | None = None,
    linked_task_id: str | None = None,
) -> RunRecord:
    now = datetime.now(UTC)
    return RunRecord(
        run_id="run_1",
        template_id="tpl_1",
        status=status,  # type: ignore[arg-type]
        step_cursor=2,
        params={"email": "user@example.com"},
        task_id=linked_task_id,
        correlation_id="corr_123",
        artifacts_ref={"linked_task_id": linked_task_id or ""} if linked_task_id else {},
        wait_context=wait_context,
        created_at=now,
        updated_at=now,
        logs=[RunLogEntry(ts=now, level="info", message="seed")],
    )


class _FakeService:
    def __init__(self, run: RunRecord) -> None:
        self._run = run

    def get_run(self, run_id: str, requester: str | None = None) -> RunRecord:
        _ = requester
        assert run_id == self._run.run_id
        return self._run

    def _resolve_resume_from_step_id(self, wait_context: RunWaitContext | None) -> str | None:
        if wait_context is None:
            return None
        return wait_context.resume_from_step_id or wait_context.after_step_id or wait_context.at_step_id


def test_recovery_plan_waiting_otp_prefers_submit() -> None:
    run = _build_run(status="waiting_otp", wait_context=RunWaitContext(reason_code="otp_required"))
    plan = recovery_ops.build_recovery_plan(_FakeService(run), run.run_id)

    assert plan.primary_action is not None
    assert plan.primary_action.action_id == "submit_otp"
    assert plan.primary_action.requires_input is True
    assert plan.primary_action.safety_level == "manual_only"
    assert "OTP" in plan.headline


def test_recovery_plan_waiting_user_provider_protected_prefers_continue() -> None:
    run = _build_run(
        status="waiting_user",
        wait_context=RunWaitContext(reason_code="provider_protected_payment_step", after_step_id="step_9"),
        linked_task_id="task_123",
    )
    plan = recovery_ops.build_recovery_plan(_FakeService(run), run.run_id)

    assert plan.primary_action is not None
    assert plan.primary_action.action_id == "continue_manual_gate"
    assert plan.primary_action.safety_level == "manual_only"
    replay_action = next(action for action in plan.actions if action.action_id == "resume_from_step")
    assert replay_action.safety_level == "confirm_before_apply"
    assert any(action.action_id == "resume_from_step" for action in plan.actions)
    assert plan.suggested_step_id == "step_9"


def test_recovery_plan_failed_prefers_resume_from_step_when_available() -> None:
    run = _build_run(
        status="failed",
        wait_context=RunWaitContext(resume_from_step_id="step_42"),
        linked_task_id="task_123",
    )
    plan = recovery_ops.build_recovery_plan(_FakeService(run), run.run_id)

    assert plan.primary_action is not None
    assert plan.primary_action.action_id == "resume_from_step"
    assert plan.primary_action.safety_level == "confirm_before_apply"
    assert any(action.action_id == "replay_step" for action in plan.actions)
    assert plan.linked_task_id == "task_123"


def test_recovery_plan_running_prefers_inspect_task() -> None:
    run = _build_run(status="running", linked_task_id="task_999")
    plan = recovery_ops.build_recovery_plan(_FakeService(run), run.run_id)

    assert plan.primary_action is not None
    assert plan.primary_action.action_id == "inspect_task"
    assert plan.primary_action.safety_level == "safe_suggestion"
    assert plan.correlation_id == "corr_123"
