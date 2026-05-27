from __future__ import annotations

from typing import Any

from apps.api.app.models.universal_api import RunRecoveryAction, RunRecoveryPlan


def build_recovery_plan(service: Any, run_id: str, requester: str | None = None) -> RunRecoveryPlan:
    run = service.get_run(run_id, requester=requester)
    suggested_step_id = service._resolve_resume_from_step_id(run.wait_context)
    linked_task_id = run.task_id or run.artifacts_ref.get("linked_task_id")
    correlation_id = run.correlation_id or run.artifacts_ref.get("correlation_id")
    reason_code = run.wait_context.reason_code if run.wait_context else None

    actions: list[RunRecoveryAction] = []
    primary_action: RunRecoveryAction | None = None
    headline = "No recovery action is needed right now."
    summary = "This run is not currently blocked on user input or recovery."

    if run.status == "waiting_otp":
        primary_action = RunRecoveryAction(
            action_id="submit_otp",
            label="Submit OTP",
            description="Provide the OTP code and resume the current run from the same recovery path.",
            kind="resume",
            requires_input=True,
            input_label="OTP",
            safety_level="manual_only",
            safety_reason="OTP is a sensitive user-provided credential and must stay manually confirmed.",
        )
        actions = [primary_action]
        if linked_task_id:
            actions.append(
                RunRecoveryAction(
                    action_id="inspect_task",
                    label="Inspect linked task",
                    description="Open the linked task context before resuming if you need more detail.",
                    kind="inspect",
                    safety_level="safe_suggestion",
                    safety_reason="Inspection is read-only and does not trigger external side effects.",
                )
            )
        headline = "This run is waiting for an OTP. Enter it and submit to continue:"
        summary = "Submit the required OTP first, then the run can resume without switching to legacy helper paths."
    elif run.status == "waiting_user":
        is_provider_protected = reason_code == "provider_protected_payment_step"
        if is_provider_protected:
            primary_action = RunRecoveryAction(
                action_id="continue_manual_gate",
                label="Continue after provider step",
                description="Complete the provider-hosted challenge or payment step, then continue the current run.",
                kind="resume",
                safety_level="manual_only",
                safety_reason="Provider-hosted challenges or payment steps can carry external side effects and must stay manual.",
            )
        else:
            primary_action = RunRecoveryAction(
                action_id="submit_input",
                label="Submit additional input",
                description="Provide the missing manual input and resume the current run.",
                kind="resume",
                requires_input=True,
                input_label="Additional Input",
                safety_level="manual_only",
                safety_reason="Additional input can change external workflow state and should remain operator-confirmed.",
            )
        actions = [primary_action]
        if suggested_step_id:
            actions.append(
                RunRecoveryAction(
                    action_id="resume_from_step",
                    label=f"Replay from {suggested_step_id}",
                    description="Replay from the suggested recovery step if you need to re-establish the flow before resuming.",
                    kind="replay",
                    step_id=suggested_step_id,
                    safety_level="confirm_before_apply",
                    safety_reason="Replay can change runtime state, so review the step first and trigger it intentionally.",
                )
            )
        if linked_task_id:
            actions.append(
                RunRecoveryAction(
                    action_id="inspect_task",
                    label="Inspect linked task",
                    description="Review the linked task output before continuing if the wait reason is unclear.",
                    kind="inspect",
                    safety_level="safe_suggestion",
                    safety_reason="Inspection is safe because it only surfaces existing task context.",
                )
            )
        if is_provider_protected:
            headline = "The payment page is already open. Complete the provider step manually, then continue here."
            summary = "Continue the same run after the provider-hosted step is complete, then use replay only if the flow still needs a guided retry."
        else:
            headline = "This run is waiting for additional input. Provide it and submit to continue:"
            summary = (
                "Use the guided resume action first. If that is not enough, replay from the suggested step instead of guessing the right endpoint."
            )
    elif run.status == "failed":
        if suggested_step_id:
            primary_action = RunRecoveryAction(
                action_id="resume_from_step",
                label=f"Resume from {suggested_step_id}",
                description="Replay from the nearest recovery step and correct the failure before retrying the full path.",
                kind="replay",
                step_id=suggested_step_id,
                safety_level="confirm_before_apply",
                safety_reason="Replay is useful for guided recovery, but it still changes runtime state and should stay human-confirmed.",
            )
        else:
            primary_action = RunRecoveryAction(
                action_id="replay_latest",
                label="Replay latest flow",
                description="Rerun the latest flow draft to reproduce the failure under the current workspace state.",
                kind="replay",
                safety_level="confirm_before_apply",
                safety_reason="A full replay is valuable for reproduction, but it should remain an operator-triggered choice.",
            )
        actions = [primary_action]
        if suggested_step_id:
            actions.append(
                RunRecoveryAction(
                    action_id="replay_step",
                    label=f"Replay step {suggested_step_id}",
                    description="Replay only the failing step when you want a tighter debugging loop.",
                    kind="replay",
                    step_id=suggested_step_id,
                    safety_level="confirm_before_apply",
                    safety_reason="Step replay stays human-confirmed because it can still change runtime state.",
                )
            )
        if linked_task_id:
            actions.append(
                RunRecoveryAction(
                    action_id="inspect_task",
                    label="Inspect linked task",
                    description="Review the task output and run log before retrying.",
                    kind="inspect",
                    safety_level="safe_suggestion",
                    safety_reason="Inspection is read-only and safe to recommend immediately.",
                )
            )
        headline = "This run failed and needs a guided retry."
        summary = (
            "Start from the suggested replay action instead of jumping straight to raw logs or manual shell commands."
        )
    elif run.status in {"queued", "running"}:
        if linked_task_id:
            primary_action = RunRecoveryAction(
                action_id="inspect_task",
                label="Inspect linked task",
                description="Review the linked task output while this run is still active.",
                kind="inspect",
                safety_level="safe_suggestion",
                safety_reason="Inspection is safe because it does not modify the active run.",
            )
            actions = [primary_action]
        headline = "This run is still active."
        summary = "Recovery is not needed yet. Inspect the linked task first if you need more context."
    else:
        if linked_task_id:
            actions.append(
                RunRecoveryAction(
                    action_id="inspect_task",
                    label="Inspect linked task",
                    description="Open the linked task context for more detail about the last run attempt.",
                    kind="inspect",
                    safety_level="safe_suggestion",
                    safety_reason="Inspection is read-only and safe to recommend.",
                )
            )
        headline = "This run does not currently require guided recovery."
        summary = "Use the evidence and linked task details if you need to inspect what happened."

    return RunRecoveryPlan(
        run_id=run.run_id,
        status=run.status,
        headline=headline,
        summary=summary,
        reason_code=reason_code,
        primary_action=primary_action,
        actions=actions,
        suggested_step_id=suggested_step_id,
        linked_task_id=linked_task_id,
        correlation_id=correlation_id,
    )
