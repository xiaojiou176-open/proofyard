import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { UniversalTemplate } from "../types"
import FlowWorkshopView from "./FlowWorkshopView"

vi.mock("../components/FlowDraftEditor", () => ({
  default: () => <div data-testid="mock-flow-draft-editor" />,
}))

vi.mock("../components/EvidenceScreenshotPair", () => ({
  default: () => null,
}))

const template: UniversalTemplate = {
  template_id: "tpl-1",
  flow_id: "flow-1",
  name: "Operator Signup",
  params_schema: [{ key: "email", type: "email", required: true }],
  defaults: { email: "demo@example.com" },
  policies: {
    retries: 0,
    timeout_seconds: 120,
    otp: {
      required: true,
      provider: "manual",
      timeout_seconds: 120,
      regex: "\\d{6}",
      sender_filter: "",
      subject_filter: "",
    },
    branches: {},
  },
  created_by: null,
  created_at: "2026-03-31T09:00:00Z",
  updated_at: "2026-03-31T09:05:00Z",
}

describe("FlowWorkshopView Wave 3 surfaces", () => {
  it("shows template reuse lane and AI reconstruction assistant copy", () => {
    const html = renderToStaticMarkup(
      <FlowWorkshopView
        diagnostics={null}
        alerts={null}
        diagnosticsError=""
        alertError=""
        latestFlow={null}
        flowError=""
        flowDraft={null}
        selectedStepId=""
        stepEvidence={null}
        evidenceTimeline={[]}
        evidenceTimelineError=""
        resumeWithPreconditions={false}
        stepEvidenceError=""
        studioTemplates={[template]}
        selectedStudioTemplateId={template.template_id}
        onSelectedTemplateIdChange={() => {}}
        templateReadiness={{
          template_id: template.template_id,
          flow_id: template.flow_id,
          readiness_score: 82,
          risk_level: "low",
          step_count: 3,
          average_confidence: 0.92,
          selector_risk_count: 0,
          manual_gate_density: 0,
          low_confidence_steps: [],
          selectorless_steps: [],
          high_risk_steps: [],
        }}
        templateReadinessState="success"
        templateReadinessError=""
        profileTargetStudioState="empty"
        profileTargetStudioError=""
        profileStudioOptions={[]}
        targetStudioOptions={[]}
        selectedProfileStudioName="pr"
        selectedTargetStudioName="web.local"
        profileStudioDocument={null}
        targetStudioDocument={null}
        reconstructionArtifacts={{ session_dir: "reconstruction/session-1" }}
        reconstructionMode="gemini"
        reconstructionStrategy="balanced"
        reconstructionError=""
        profileResolved={null}
        reconstructionPreview={null}
        reconstructionGenerated={null}
        otpCode=""
        onOtpCodeChange={() => {}}
        onSubmitOtp={() => {}}
        onOpenTaskCenter={() => {}}
        onFlowDraftChange={() => {}}
        onSelectStep={() => {}}
        onResumeWithPreconditionsChange={() => {}}
        onSaveFlowDraft={() => {}}
        onReplayLatestFlow={() => {}}
        onReplayStep={() => {}}
        onResumeFromStep={() => {}}
        onRefresh={() => {}}
        onLoadProfileTargetStudio={() => {}}
        onSaveConfigStudio={async () => false}
        onReconstructionArtifactsChange={() => {}}
        onReconstructionModeChange={() => {}}
        onReconstructionStrategyChange={() => {}}
        onResolveProfile={() => {}}
        onPreviewReconstruction={() => {}}
        onGenerateReconstruction={() => {}}
        onOrchestrateFromArtifacts={() => {}}
      />
    )

    expect(html).toContain("Template reuse lane")
    expect(html).toContain("Operator Signup")
    expect(html).toContain("Optional AI assistant")
    expect(html).toContain("Reconstruction Review")
    expect(html).toContain("Template Readiness")
    expect(html).toContain("Template Exchange")
  })
})
