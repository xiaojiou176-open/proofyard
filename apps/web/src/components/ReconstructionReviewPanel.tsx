import type { ChangeEvent } from "react"
import type {
  ProfileResolvePayload,
  ReconstructionGeneratePayload,
  ReconstructionPreviewPayload,
} from "../types"
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Select } from "@uiq/ui"

type Props = {
  artifacts: {
    session_dir?: string
    video_path?: string
    har_path?: string
    html_path?: string
  }
  mode: "gemini"
  strategy: "strict" | "balanced" | "aggressive"
  error: string
  profileResolved: ProfileResolvePayload | null
  preview: ReconstructionPreviewPayload | null
  generated: ReconstructionGeneratePayload | null
  onArtifactsChange: (next: {
    session_dir?: string
    video_path?: string
    har_path?: string
    html_path?: string
  }) => void
  onModeChange: (mode: "gemini") => void
  onStrategyChange: (strategy: "strict" | "balanced" | "aggressive") => void
  onResolveProfile: () => void
  onPreview: () => void
  onGenerate: () => void
  onOrchestrate: () => void
}

export default function ReconstructionReviewPanel(props: Props) {
  const updateField = (key: keyof Props["artifacts"], value: string) => {
    props.onArtifactsChange({ ...props.artifacts, [key]: value })
  }
  const previewUnresolvedSegments = props.preview?.unresolved_segments ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>{"Reconstruction Review"}</CardTitle>
      </CardHeader>
      <CardContent>
      {props.error && <p className="error-text">{props.error}</p>}
      <div className="field-group">
        <div className="field">
          <label className="field-label">session_dir</label>
          <Input
            value={props.artifacts.session_dir ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) => updateField("session_dir", e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label">har_path</label>
          <Input
            value={props.artifacts.har_path ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) => updateField("har_path", e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label">html_path</label>
          <Input
            value={props.artifacts.html_path ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) => updateField("html_path", e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label">video_path</label>
          <Input
            value={props.artifacts.video_path ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) => updateField("video_path", e.target.value)}
          />
        </div>
        <div className="form-row">
          <div className="field flex-1">
            <label className="field-label">video_analysis_mode</label>
            <Select
              value={props.mode}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                props.onModeChange(e.target.value as "gemini")
              }
            >
              <option value="gemini">gemini</option>
            </Select>
          </div>
          <div className="field flex-1">
            <label className="field-label">extractor_strategy</label>
            <Select
              value={props.strategy}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                props.onStrategyChange(e.target.value as "strict" | "balanced" | "aggressive")
              }
            >
              <option value="strict">strict</option>
              <option value="balanced">balanced</option>
              <option value="aggressive">aggressive</option>
            </Select>
          </div>
        </div>
        <div className="form-actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={props.onResolveProfile}
            data-uiq-ignore-button-inventory="reconstruction-secondary-control"
          >
            {"Resolve Profile"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={props.onPreview}
            data-uiq-ignore-button-inventory="reconstruction-secondary-control"
          >
            {"Preview"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={props.onGenerate}
            data-uiq-ignore-button-inventory="reconstruction-secondary-control"
          >
            {"Generate"}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={props.onOrchestrate}
            data-uiq-ignore-button-inventory="reconstruction-secondary-control"
          >
            {"Orchestrate"}
          </Button>
        </div>
      </div>

      <div className="field-group mt-3">
        {props.profileResolved && (
          <Card tone="raised" className="p-3">
            <p>{`profile=${props.profileResolved.profile}`}</p>
            <p>{`dom_alignment=${props.profileResolved.dom_alignment_score} har_alignment=${props.profileResolved.har_alignment_score}`}</p>
            <p>{`manual_handoff_required=${props.profileResolved.manual_handoff_required}`}</p>
          </Card>
        )}
        {props.preview && (
          <Card tone="raised" className="p-3">
            <p>{`preview_id=${props.preview.preview_id}`}</p>
            <p>{`quality=${props.preview.reconstructed_flow_quality}`}</p>
            <p>{`unresolved=${previewUnresolvedSegments.join(",") || "none"}`}</p>
          </Card>
        )}
        {props.generated && (
          <Card tone="raised" className="p-3">
            <p>{`flow_id=${props.generated.flow_id}`}</p>
            <p>{`template_id=${props.generated.template_id}`}</p>
            <p>{`manual_handoff_required=${props.generated.manual_handoff_required}`}</p>
          </Card>
        )}
      </div>
      </CardContent>
    </Card>
  )
}
