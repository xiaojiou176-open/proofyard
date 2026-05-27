import { memo, type ChangeEvent } from "react"
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from "@uiq/ui"
import { useI18n } from "../i18n"
import type { RunRecoveryAction, RunRecoveryPlan, TaskState, UniversalRun } from "../types"

type RecoveryCenterPanelProps = {
  plan: RunRecoveryPlan | null
  state: TaskState
  error: string
  otpCode: string
  onOtpCodeChange: (value: string) => void
  onSubmitOtp: (
    runId: string,
    status: UniversalRun["status"],
    waitContext?: UniversalRun["wait_context"]
  ) => void
  onReplayLatestFlow: () => void
  onReplayStep: (stepId: string) => void
  onResumeFromStep: (stepId: string) => void
  onInspectTask?: (taskId: string) => void
  onOpenTaskCenter?: () => void
  waitContext?: UniversalRun["wait_context"]
  compact?: boolean
}

function recoverySafetyLabel(
  action: RunRecoveryAction,
  t: (message: string, params?: Record<string, string | number>) => string
) {
  if (action.safety_level === "safe_suggestion") return t("Safe next step")
  if (action.safety_level === "confirm_before_apply") return t("Replay with confirmation")
  return t("Manual-only")
}

function localizeRecoveryActionLabel(
  label: string,
  t: (message: string, params?: Record<string, string | number>) => string
) {
  if (label.startsWith("Replay from ")) {
    return t("Replay from {stepId}", { stepId: label.slice("Replay from ".length) })
  }
  if (label.startsWith("Replay step ")) {
    return t("Replay step {stepId}", { stepId: label.slice("Replay step ".length) })
  }
  return t(label)
}

function recoverySafetyVariant(action: RunRecoveryAction): "success" | "secondary" | "destructive" {
  if (action.safety_level === "safe_suggestion") return "success"
  if (action.safety_level === "confirm_before_apply") return "secondary"
  return "destructive"
}

function RecoveryCenterPanel({
  plan,
  state,
  error,
  otpCode,
  onOtpCodeChange,
  onSubmitOtp,
  onReplayLatestFlow,
  onReplayStep,
  onResumeFromStep,
  onInspectTask,
  onOpenTaskCenter,
  waitContext,
  compact = false,
}: RecoveryCenterPanelProps) {
  const { t } = useI18n()
  const inputId = compact ? `recovery-input-${plan?.run_id ?? "unknown"}` : "task-center-run-input"
  const containerTestId =
    !compact && (plan?.status === "waiting_otp" || plan?.status === "waiting_user")
      ? "task-center-waiting-card"
      : "recovery-center-panel"
  if (state === "error") {
    return (
      <Card tone="raised">
        <CardContent className="p-3">
          <p className="error-text">{error || t("Recovery guidance is unavailable right now.")}</p>
        </CardContent>
      </Card>
    )
  }
  if (state === "loading") {
    return (
      <Card tone="raised">
        <CardContent className="p-3">
          <p className="hint-text">{t("Loading recovery guidance...")}</p>
        </CardContent>
      </Card>
    )
  }
  if (!plan) {
    return null
  }

  const handleAction = (action: RunRecoveryAction) => {
    if (action.action_id === "submit_otp" || action.action_id === "submit_input" || action.action_id === "continue_manual_gate") {
      onSubmitOtp(plan.run_id, plan.status as UniversalRun["status"], waitContext)
      return
    }
    if (action.action_id === "resume_from_step" && action.step_id) {
      onResumeFromStep(action.step_id)
      return
    }
    if (action.action_id === "replay_step" && action.step_id) {
      onReplayStep(action.step_id)
      return
    }
    if (action.action_id === "replay_latest") {
      onReplayLatestFlow()
      return
    }
    if (action.action_id === "inspect_task" && plan.linked_task_id && onInspectTask) {
      onInspectTask(plan.linked_task_id)
      return
    }
    if (action.kind === "navigate" && onOpenTaskCenter) {
      onOpenTaskCenter()
    }
  }

  const showInput = Boolean(plan.primary_action?.requires_input)
  const inputPlaceholder =
    plan.primary_action?.input_label === "OTP"
      ? t("Enter OTP")
      : plan.primary_action?.input_label === "Additional Input"
        ? t("Enter additional input")
        : plan.primary_action?.input_label ?? t("Enter input")
  const primaryActionId = plan.primary_action?.action_id ?? null
  const secondaryActions = plan.actions.filter((action) => action.action_id !== primaryActionId)

  return (
    <Card tone="raised" className={compact ? "p-3" : "mt-3 p-3"} data-testid={containerTestId}>
      <CardHeader className="px-0 pt-0">
        <CardTitle>{t("Recovery Center")}</CardTitle>
        <Badge variant={plan.status === "failed" ? "destructive" : "secondary"}>{plan.status}</Badge>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <p className="field-label mb-2">{t("Suggested action:")}</p>
        <p className="hint-text mb-2">{t(plan.headline)}</p>
        <p className="hint-text mb-3">{t(plan.summary)}</p>
        <p className="hint-text mb-3">
          {t(
            "Recovery Center is the official recovery layer inside Task Center and Flow Workshop. Use it before raw logs or shell fallbacks."
          )}
        </p>
        {showInput && (
          <div className="field-row mb-3">
            <label className="field-label" htmlFor={inputId}>
              {t(plan.primary_action?.input_label ?? "Input")}
            </label>
            <Input
              id={inputId}
              className="flex-1"
              type="text"
              value={otpCode}
              placeholder={inputPlaceholder}
              onChange={(event: ChangeEvent<HTMLInputElement>) => onOtpCodeChange(event.target.value)}
            />
          </div>
        )}
        {plan.reason_code && (
          <div className="field mb-3">
            <span className="field-label">{t("Reason")}</span>
            <span className="hint-text">{plan.reason_code}</span>
          </div>
        )}
        {plan.primary_action && (
          <div className="field mb-3">
            <span className="field-label">{t("Start here")}</span>
            <div className="form-row flex-wrap gap-2 mt-2">
              <Badge variant={recoverySafetyVariant(plan.primary_action)}>
                {recoverySafetyLabel(plan.primary_action, t)}
              </Badge>
              {plan.primary_action.safety_reason && (
                <span className="hint-text">{t(plan.primary_action.safety_reason)}</span>
              )}
            </div>
            <div className="form-row flex-wrap gap-2 mt-2">
              <Button
                key={`${plan.run_id}-${plan.primary_action.action_id}-${plan.primary_action.step_id ?? "none"}`}
                type="button"
                size="sm"
                variant="default"
                onClick={() => handleAction(plan.primary_action!)}
              >
                {plan.primary_action.action_id === "continue_manual_gate"
                  ? t("Continue")
                  : plan.primary_action.action_id === "submit_otp" ||
                      plan.primary_action.action_id === "submit_input"
                    ? t("Submit")
                    : localizeRecoveryActionLabel(plan.primary_action.label, t)}
              </Button>
            </div>
          </div>
        )}
        {secondaryActions.length > 0 && (
          <div className="field">
            <span className="field-label">{t("Other recovery options")}</span>
            <p className="hint-text mb-2">
              {t(
                "Use these only when the recommended next step still leaves you blocked or when you need deeper task-level inspection."
              )}
            </p>
            <div className="field-group">
              {secondaryActions.map((action) => {
                const ignoreInventoryReason =
                  action.action_id === "continue_manual_gate"
                    ? "waiting-user-continue-secondary-action"
                    : action.action_id === "inspect_task" || compact
                      ? "recovery-center-secondary-action"
                      : null
                return (
                  <div
                    key={`${plan.run_id}-${action.action_id}-${action.step_id ?? "none"}`}
                    className="field"
                  >
                    <div className="form-row flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        {...(ignoreInventoryReason
                          ? { "data-uiq-ignore-button-inventory": ignoreInventoryReason }
                          : {})}
                        onClick={() => handleAction(action)}
                      >
                        {action.action_id === "continue_manual_gate"
                          ? t("Continue")
                          : action.action_id === "submit_otp" || action.action_id === "submit_input"
                            ? t("Submit")
                            : localizeRecoveryActionLabel(action.label, t)}
                      </Button>
                      <Badge variant={recoverySafetyVariant(action)}>
                        {recoverySafetyLabel(action, t)}
                      </Badge>
                    </div>
                    {action.safety_reason && <p className="hint-text mt-1">{t(action.safety_reason)}</p>}
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {plan.suggested_step_id && (
          <p className="hint-text mt-3">
            {t("Suggested recovery step: {stepId}", { stepId: plan.suggested_step_id })}
          </p>
        )}
        {plan.correlation_id && (
          <p className="hint-text mt-1">
            {t("Correlation: {correlationId}", { correlationId: plan.correlation_id })}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export default memo(RecoveryCenterPanel)
