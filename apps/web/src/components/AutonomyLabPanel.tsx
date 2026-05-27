import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@uiq/ui"
import { useI18n } from "../i18n"
import type {
  ReconstructionArtifactsPayload,
  ReconstructionGeneratePayload,
  ReconstructionPreviewPayload,
} from "../types"

type AutonomyLabPanelProps = {
  reconstructionArtifacts: ReconstructionArtifactsPayload
  reconstructionPreview: ReconstructionPreviewPayload | null
  reconstructionGenerated: ReconstructionGeneratePayload | null
  hasLatestSession: boolean
  onResolveProfile: () => void
  onPreviewReconstruction: () => void
  onGenerateReconstruction: () => void
  onOrchestrateFromArtifacts: () => void
}

export default function AutonomyLabPanel({
  reconstructionArtifacts,
  reconstructionPreview,
  reconstructionGenerated,
  hasLatestSession,
  onResolveProfile,
  onPreviewReconstruction,
  onGenerateReconstruction,
  onOrchestrateFromArtifacts,
}: AutonomyLabPanelProps) {
  const { t } = useI18n()
  const autonomyArtifactAnchorCount = [
    reconstructionArtifacts.session_dir,
    reconstructionArtifacts.har_path,
    reconstructionArtifacts.html_path,
    reconstructionArtifacts.video_path,
  ].filter(Boolean).length
  const autonomyHasAnchors = autonomyArtifactAnchorCount > 0 || hasLatestSession
  const autonomyLabStatusText = !autonomyHasAnchors
    ? t("Blocked until you attach artifacts or keep one recorded session available.")
    : !reconstructionPreview
      ? t("Artifact anchors are ready. Resolve the profile or preview a draft before generation.")
      : !reconstructionGenerated
        ? t("A preview exists. Generate a reviewable draft before you promote this into a reusable template.")
        : t("A generated draft exists. You can now turn it into a template while keeping human review in the loop.")

  return (
    <Card className="flow-editor-panel">
      <CardHeader>
        <CardTitle>{t("Autonomy Lab Phase 1")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="form-row flex-wrap gap-2 mb-3">
          <Badge variant="outline">{t("Experimental")}</Badge>
          <Badge variant={autonomyHasAnchors ? "secondary" : "default"}>
            {t("{count} artifact anchors", { count: autonomyArtifactAnchorCount })}
          </Badge>
          <Badge variant="secondary">{t("Manual-only gates stay manual")}</Badge>
        </div>
        <p className="hint-text mb-2">
          {t("Autonomy Lab is the bounded experiment lane for artifact-driven reconstruction after proof already exists. It exposes real reviewable actions without reopening autonomous self-heal or hidden write paths.")}
        </p>
        <p className="hint-text mb-3">
          {t("Phase 1 stays anchored to reconstruction and orchestration. OTP, provider challenges, and other manual gates remain human-confirmed outside this lab.")}
        </p>
        <div className="field-group">
          <div className="field">
            <span className="field-label">{t("Current lab status")}</span>
            <span className="hint-text">{autonomyLabStatusText}</span>
          </div>
          <div className="field">
            <span className="field-label">{t("Why this is safe")}</span>
            <span className="hint-text">
              {t("The lab is downstream of evidence, uses reviewable reconstruction outputs, and keeps all external-state changes behind explicit human confirmation.")}
            </span>
          </div>
        </div>
        <div className="form-actions mt-2">
          <Button type="button" variant="outline" size="sm" onClick={onResolveProfile} disabled={!autonomyHasAnchors}>
            {t("Resolve profile from artifacts")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onPreviewReconstruction}
            disabled={!autonomyHasAnchors}
          >
            {t("Preview reviewable draft")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onGenerateReconstruction}
            disabled={!reconstructionPreview}
          >
            {t("Generate lab draft")}
          </Button>
          <Button type="button" size="sm" onClick={onOrchestrateFromArtifacts} disabled={!autonomyHasAnchors}>
            {t("Create template from artifacts")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
