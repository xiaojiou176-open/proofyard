import { memo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@uiq/ui"
import { useI18n } from "../i18n"
import type { EvidenceSharePack, TaskState } from "../types"

type EvidenceSharePackPanelProps = {
  sharePack: EvidenceSharePack | null
  state: TaskState
  error: string
}

function EvidenceSharePackPanel({ sharePack, state, error }: EvidenceSharePackPanelProps) {
  const { t } = useI18n()
  if (state === "error") {
    return (
        <Card tone="raised">
        <CardContent className="p-3">
          <p className="error-text">{error || t("Evidence share pack is unavailable right now.")}</p>
        </CardContent>
      </Card>
    )
  }
  if (state === "loading") {
    return (
        <Card tone="raised">
        <CardContent className="p-3">
          <p className="hint-text">{t("Loading evidence share pack...")}</p>
        </CardContent>
      </Card>
    )
  }
  if (!sharePack) return null

  return (
    <Card tone="raised" data-testid="evidence-share-pack-panel">
      <CardHeader>
        <CardTitle>{t("Evidence Share Pack")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="field-group">
          <div className="field">
            <span className="field-label">{t("Markdown summary")}</span>
            <pre className="hint-text whitespace-pre-wrap">{sharePack.markdown_summary}</pre>
          </div>
          <div className="field">
            <span className="field-label">{t("Issue-ready snippet")}</span>
            <pre className="hint-text whitespace-pre-wrap">{sharePack.issue_ready_snippet}</pre>
          </div>
          <div className="field">
            <span className="field-label">{t("Release appendix")}</span>
            <pre className="hint-text whitespace-pre-wrap">{sharePack.release_appendix}</pre>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default memo(EvidenceSharePackPanel)
