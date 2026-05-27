import { memo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@uiq/ui"
import { useI18n } from "../i18n"
import type { EvidenceRunCompare, TaskState } from "../types"

type EvidenceRunComparePanelProps = {
  compare: EvidenceRunCompare | null
  state: TaskState
  error: string
}

function describeCompareState(
  compareState: EvidenceRunCompare["compare_state"],
  t: (message: string, params?: Record<string, string | number>) => string
) {
  if (compareState === "ready") {
    return {
      label: t("Ready compare"),
      summary: t("This comparison is complete enough to support operator review."),
    }
  }
  return {
    label: t("Partial compare"),
    summary: t(
      "This comparison is only partial, so keep it as context rather than as a release or promotion verdict."
    ),
  }
}

function EvidenceRunComparePanel({ compare, state, error }: EvidenceRunComparePanelProps) {
  const { t } = useI18n()
  const localizeGateStatus = (value: string | null | undefined) => t(value ?? "unknown")
  if (state === "error") {
    return (
        <Card tone="raised">
        <CardContent className="p-3">
          <p className="error-text">{error || t("Compare data is unavailable right now.")}</p>
        </CardContent>
      </Card>
    )
  }
  if (state === "loading") {
    return (
        <Card tone="raised">
        <CardContent className="p-3">
          <p className="hint-text">{t("Loading compare view...")}</p>
        </CardContent>
      </Card>
    )
  }
  if (!compare) return null
  const compareStateExplanation = describeCompareState(compare.compare_state, t)

  return (
    <Card tone="raised" data-testid="evidence-run-compare-panel">
      <CardHeader>
        <CardTitle>{t("Run Compare")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="hint-text mb-2">{`${compare.baseline_run_id} vs ${compare.candidate_run_id}`}</p>
        <div className="field-group">
          <div className="field">
            <span className="field-label">{t("Compare state")}</span>
            <span className="hint-text">{compareStateExplanation.label}</span>
          </div>
          <div className="field">
            <span className="field-label">{t("State meaning")}</span>
            <span className="hint-text">{compareStateExplanation.summary}</span>
          </div>
          <div className="field">
            <span className="field-label">{t("Gate status delta")}</span>
            <span className="hint-text">
              {`${localizeGateStatus(compare.gate_status_delta.baseline)} -> ${
                localizeGateStatus(compare.gate_status_delta.candidate)
              }`}
            </span>
          </div>
          <div className="field">
            <span className="field-label">{t("Duration delta")}</span>
            <span className="hint-text">
              {compare.summary_delta.duration_ms !== null
                ? `${compare.summary_delta.duration_ms}ms`
                : t("not available")}
            </span>
          </div>
          <div className="field">
            <span className="field-label">{t("Failed checks delta")}</span>
            <span className="hint-text">
              {compare.summary_delta.failed_checks !== null
                ? String(compare.summary_delta.failed_checks)
                : t("not available")}
            </span>
          </div>
          <div className="field">
            <span className="field-label">{t("Missing artifacts delta")}</span>
            <span className="hint-text">{compare.summary_delta.missing_artifacts}</span>
          </div>
          {(compare.artifact_delta.report_path_changes.length > 0 ||
            compare.artifact_delta.proof_path_changes.length > 0) && (
            <div className="field">
              <span className="field-label">{t("Artifact path changes")}</span>
              <span className="hint-text">
                {[
                  ...compare.artifact_delta.report_path_changes,
                  ...compare.artifact_delta.proof_path_changes,
                ].join(", ")}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default memo(EvidenceRunComparePanel)
