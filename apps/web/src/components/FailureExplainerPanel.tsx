import { memo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@uiq/ui"
import { useI18n } from "../i18n"
import type { FailureExplanation, TaskState } from "../types"

type FailureExplainerPanelProps = {
  explanation: FailureExplanation | null
  state: TaskState
  error: string
}

function localizeFailureSummary(
  summary: string,
  t: (message: string, params?: Record<string, string | number>) => string
) {
  const summaryPattern = /^Run (.+) is in (.+) state with gate status (.+)\.$/
  const comparePattern = /^Compared with (.+), the failed check delta is (.+)\.$/
  const parts = summary.split(" ")
  const match = summary.match(/^Run (.+) is in (.+) state with gate status (.+)\.(?: Compared with (.+), the failed check delta is (.+)\.)?$/)
  if (match) {
    const [, runId, retentionState, gateStatus, candidateRunId, failedCheckDelta] = match
    const first = t("Run {runId} is in {retentionState} state with gate status {gateStatus}.", {
      runId,
      retentionState: t(retentionState),
      gateStatus: t(gateStatus),
    })
    if (candidateRunId && failedCheckDelta) {
      return `${first} ${t("Compared with {candidateRunId}, the failed check delta is {failedCheckDelta}.", {
        candidateRunId,
        failedCheckDelta,
      })}`
    }
    return first
  }
  if (summaryPattern.test(summary) || comparePattern.test(summary) || parts.length > 0) {
    return t(summary)
  }
  return summary
}

function FailureExplainerPanel({ explanation, state, error }: FailureExplainerPanelProps) {
  const { t } = useI18n()
  if (state === "error") {
    return (
        <Card tone="raised">
        <CardContent className="p-3">
          <p className="error-text">{error || t("Failure explanation is unavailable right now.")}</p>
        </CardContent>
      </Card>
    )
  }
  if (state === "loading") {
    return (
        <Card tone="raised">
        <CardContent className="p-3">
          <p className="hint-text">{t("Loading failure explanation...")}</p>
        </CardContent>
      </Card>
    )
  }
  if (!explanation) return null

  const primaryNextAction = explanation.next_actions[0] ?? null
  const secondaryActions = explanation.next_actions.slice(1)

  return (
    <Card tone="raised" data-testid="failure-explainer-panel">
      <CardHeader>
        <CardTitle>{t("Explain this run")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="field-label mb-2">{t("Start here before raw logs")}</p>
        <p className="hint-text mb-2">{localizeFailureSummary(explanation.summary, t)}</p>
        <p className="hint-text mb-3">{t(explanation.uncertainty)}</p>
        <p className="hint-text mb-3">
          {t("The explainer is the first reading step. Use it to stabilize the operator story before you compare, share, or open promotion guidance.")}
        </p>
        {primaryNextAction && (
          <div className="field mb-3">
            <span className="field-label">{t("Recommended next step")}</span>
            <span className="hint-text">{t(primaryNextAction)}</span>
          </div>
        )}
        {explanation.evidence_anchors.length > 0 && (
          <div className="field">
            <span className="field-label">{t("Evidence anchors")}</span>
            <ul className="hint-text">
              {explanation.evidence_anchors.map((anchor) => (
                <li key={`${anchor.label}-${anchor.path}`}>{`${t(anchor.label)}: ${anchor.path}`}</li>
              ))}
            </ul>
          </div>
        )}
        {secondaryActions.length > 0 && (
          <div className="field mt-2">
            <span className="field-label">{t("Other options")}</span>
            <ul className="hint-text">
              {secondaryActions.map((action, index) => (
                <li key={`${explanation.run_id}-${index}`}>{t(action)}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default memo(FailureExplainerPanel)
