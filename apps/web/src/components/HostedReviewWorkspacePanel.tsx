import { memo } from "react"
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@uiq/ui"
import { useI18n } from "../i18n"
import type { HostedReviewWorkspace, TaskState } from "../types"

type HostedReviewWorkspacePanelProps = {
  workspace: HostedReviewWorkspace | null
  state: TaskState
  error: string
}

function HostedReviewWorkspacePanel({
  workspace,
  state,
  error,
}: HostedReviewWorkspacePanelProps) {
  const { t } = useI18n()
  const localizeReviewState = (value: string) => t(value)
  const localizeCompareState = (value: string) => t(value)
  const localizeRetentionState = (value: string) => t(value)
  if (state === "error") {
    return (
        <Card tone="raised">
        <CardContent className="p-3">
          <p className="error-text">{error || t("Review workspace is unavailable right now.")}</p>
        </CardContent>
      </Card>
    )
  }
  if (state === "loading") {
    return (
        <Card tone="raised">
        <CardContent className="p-3">
          <p className="hint-text">{t("Loading review workspace...")}</p>
        </CardContent>
      </Card>
    )
  }
  if (!workspace) {
    return null
  }

  return (
    <Card tone="raised">
      <CardHeader>
        <CardTitle>{t("Review Workspace")}</CardTitle>
        <Badge variant={workspace.workspace_state === "review_ready" ? "success" : "secondary"}>
          {workspace.workspace_state === "review_ready"
            ? t("Review-ready")
            : t("Review with caution")}
        </Badge>
      </CardHeader>
      <CardContent>
        <p className="hint-text mb-2">{t(workspace.review_summary)}</p>
        <p className="hint-text mb-3">
          {t(
            "Local-first review packet. It packages evidence, explanation, compare context, and promotion guidance without pretending to be a hosted collaboration plane."
          )}
        </p>
        <div className="field-group">
          <div className="field">
            <span className="field-label">{t("Next review step")}</span>
            <span className="hint-text">{t(workspace.next_review_step)}</span>
          </div>
          <div className="field">
            <span className="field-label">{t("Packet health")}</span>
            <span className="hint-text">
              {`${localizeRetentionState(workspace.retention_state)} ${t("retention")} · ${localizeCompareState(workspace.compare_state)} ${t("compare")} · ${localizeReviewState(workspace.promotion_candidate.review_state)} ${t("promotion state")}`}
            </span>
          </div>
          <div className="field">
            <span className="field-label">{t("Recommended order")}</span>
            <span className="hint-text">{workspace.recommended_order.map((item) => t(item)).join(" -> ")}</span>
          </div>
          <div className="field">
            <span className="field-label">{t("Review ladder meaning")}</span>
            <span className="hint-text">
              {t("This surface is downstream of explanation, share pack, and compare. Treat it as the maintainer-facing packet before promotion becomes the next move.")}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default memo(HostedReviewWorkspacePanel)
