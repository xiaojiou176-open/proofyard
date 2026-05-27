import { memo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@uiq/ui"
import { useI18n } from "../i18n"
import type { TaskState, TemplateReadiness } from "../types"

type FlowReadinessPanelProps = {
  readiness: TemplateReadiness | null
  state: TaskState
  error: string
}

function riskReasonLabel(
  reason: string,
  t: (message: string, params?: Record<string, string | number>) => string
) {
  if (reason === "weak_selector") return t("Weak selector coverage")
  if (reason === "missing_selector") return t("Missing selector coverage")
  if (reason === "manual_gate") return t("Manual gate still required")
  if (reason === "low_confidence") return t("Low-confidence step")
  return reason
}

function buildReuseVerdict(
  readiness: TemplateReadiness,
  t: (message: string, params?: Record<string, string | number>) => string
) {
  if (readiness.risk_level === "low") {
    return {
      badge: t("Ready to reuse"),
      summary: t(
        "This template is stable enough to reuse after one clean replay. Treat it like an operator-ready shortcut, not a draft."
      ),
      nextStep: t(
        "Reuse it with confidence, then compare the next retained run before promoting it wider."
      ),
    }
  }
  if (readiness.risk_level === "medium") {
    return {
      badge: t("Review before reuse"),
      summary: t(
        "This template is reusable, but it still needs a human review before it becomes the default shortcut for operators."
      ),
      nextStep: t(
        "Inspect the risky steps first, then run one retained comparison before wider reuse."
      ),
    }
  }
  return {
    badge: t("Keep in workshop"),
    summary: t(
      "This template is still draft-quality. Keep it in Flow Workshop until the risky steps and manual gates are reduced."
    ),
    nextStep: t("Fix the highest-risk steps before handing this flow to someone else."),
  }
}

function summarizeRiskSignals(
  readiness: TemplateReadiness,
  t: (message: string, params?: Record<string, string | number>) => string
): string[] {
  const signals = new Set<string>()
  for (const step of readiness.high_risk_steps.slice(0, 4)) {
    for (const reason of step.reasons) {
      signals.add(riskReasonLabel(reason, t))
    }
  }
  if (signals.size === 0 && readiness.selector_risk_count > 0) {
    signals.add(t("Selector coverage needs review"))
  }
  if (signals.size === 0 && readiness.manual_gate_density > 0) {
    signals.add(t("Manual handoff still exists"))
  }
  return Array.from(signals)
}

function FlowReadinessPanel({ readiness, state, error }: FlowReadinessPanelProps) {
  const { t } = useI18n()
  const localizeRiskLevel = (value: string) => t(value)
  if (state === "error") {
    return (
        <Card tone="raised">
        <CardContent className="p-3">
          <p className="error-text">{error || t("Template readiness is unavailable right now.")}</p>
        </CardContent>
      </Card>
    )
  }
  if (state === "loading") {
    return (
        <Card tone="raised">
        <CardContent className="p-3">
          <p className="hint-text">{t("Loading template readiness...")}</p>
        </CardContent>
      </Card>
    )
  }
  if (!readiness) return null

  const verdict = buildReuseVerdict(readiness, t)
  const riskSignals = summarizeRiskSignals(readiness, t)
  const highRiskPreview = readiness.high_risk_steps
    .slice(0, 3)
    .map(
      (step) =>
        `${step.step_id}: ${step.reasons.map((reason) => riskReasonLabel(reason, t)).join(", ")}`
    )

  return (
    <Card tone="raised" data-testid="flow-readiness-panel">
      <CardHeader>
        <CardTitle>{t("Template Readiness")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="field mb-3">
          <span className="field-label">{t("Reuse verdict")}</span>
          <strong className="hint-text">{verdict.badge}</strong>
          <p className="hint-text mt-1">{verdict.summary}</p>
        </div>
        <div className="field-group">
          <div className="field">
            <span className="field-label">{t("Readiness score")}</span>
            <span className="hint-text">{readiness.readiness_score}</span>
          </div>
          <div className="field">
            <span className="field-label">{t("Risk level")}</span>
            <span className="hint-text">{localizeRiskLevel(readiness.risk_level)}</span>
          </div>
          <div className="field">
            <span className="field-label">{t("Average confidence")}</span>
            <span className="hint-text">{readiness.average_confidence}</span>
          </div>
          <div className="field">
            <span className="field-label">{t("Selector risk count")}</span>
            <span className="hint-text">{readiness.selector_risk_count}</span>
          </div>
          <div className="field">
            <span className="field-label">{t("Manual gate density")}</span>
            <span className="hint-text">{readiness.manual_gate_density}</span>
          </div>
          {riskSignals.length > 0 && (
            <div className="field">
              <span className="field-label">{t("Why this is the verdict")}</span>
              <ul className="hint-text">
                {riskSignals.map((signal) => (
                  <li key={signal}>{signal}</li>
                ))}
              </ul>
            </div>
          )}
          {highRiskPreview.length > 0 && (
            <div className="field">
              <span className="field-label">{t("Inspect first")}</span>
              <ul className="hint-text">
                {highRiskPreview.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="field mt-3">
          <span className="field-label">{t("Suggested next step")}</span>
          <span className="hint-text">{verdict.nextStep}</span>
        </div>
      </CardContent>
    </Card>
  )
}

export default memo(FlowReadinessPanel)
