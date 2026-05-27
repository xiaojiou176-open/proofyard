import { memo } from "react"
import EmptyState from "../components/EmptyState"
import AutonomyLabPanel from "../components/AutonomyLabPanel"
import EvidenceScreenshotPair from "../components/EvidenceScreenshotPair"
import FlowDraftEditor from "../components/FlowDraftEditor"
import FlowReadinessPanel from "../components/FlowReadinessPanel"
import { useI18n } from "../i18n"
import ProfileTargetStudioPanel from "../components/ProfileTargetStudioPanel"
import ReconstructionReviewPanel from "../components/ReconstructionReviewPanel"
import RecoveryCenterPanel from "../components/RecoveryCenterPanel"
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox } from "@uiq/ui"
import type {
  AlertsPayload,
  ConfigStudioDocument,
  DiagnosticsPayload,
  EvidenceTimelineItem,
  FlowEditableDraft,
  FlowPreviewPayload,
  ProfileResolvePayload,
  ReconstructionArtifactsPayload,
  ReconstructionGeneratePayload,
  ReconstructionPreviewPayload,
  RunRecoveryPlan,
  StepEvidencePayload,
  TaskState,
  TemplateReadiness,
  UniversalRun,
  UniversalTemplate,
} from "../types"

interface FlowWorkshopViewProps {
  diagnostics: DiagnosticsPayload | null
  alerts: AlertsPayload | null
  diagnosticsError: string
  alertError: string
  latestFlow: FlowPreviewPayload | null
  flowError: string
  flowDraft: FlowEditableDraft | null
  selectedStepId: string
  stepEvidence: StepEvidencePayload | null
  evidenceTimeline: EvidenceTimelineItem[]
  evidenceTimelineError: string
  resumeWithPreconditions: boolean
  stepEvidenceError: string
  recoveryPlan?: RunRecoveryPlan | null
  recoveryPlanState?: TaskState
  recoveryPlanError?: string
  templateReadiness?: TemplateReadiness | null
  templateReadinessState?: TaskState
  templateReadinessError?: string
  profileTargetStudioState?: TaskState
  profileTargetStudioError?: string
  studioTemplates?: UniversalTemplate[]
  selectedStudioTemplateId?: string
  onSelectedTemplateIdChange?: (templateId: string) => void
  profileStudioOptions?: string[]
  targetStudioOptions?: string[]
  selectedProfileStudioName?: string
  selectedTargetStudioName?: string
  profileStudioDocument?: ConfigStudioDocument | null
  targetStudioDocument?: ConfigStudioDocument | null
  reconstructionArtifacts?: ReconstructionArtifactsPayload
  reconstructionMode?: "gemini"
  reconstructionStrategy?: "strict" | "balanced" | "aggressive"
  reconstructionError?: string
  profileResolved?: ProfileResolvePayload | null
  reconstructionPreview?: ReconstructionPreviewPayload | null
  reconstructionGenerated?: ReconstructionGeneratePayload | null
  otpCode?: string
  onOtpCodeChange?: (value: string) => void
  onSubmitOtp?: (
    runId: string,
    status: UniversalRun["status"],
    waitContext?: UniversalRun["wait_context"]
  ) => void
  onOpenTaskCenter?: () => void
  onFlowDraftChange: (next: FlowEditableDraft) => void
  onSelectStep: (stepId: string) => void
  onResumeWithPreconditionsChange: (enabled: boolean) => void
  onSaveFlowDraft: () => void
  onReplayLatestFlow: () => void
  onReplayStep: (stepId: string) => void
  onResumeFromStep: (stepId: string) => void
  onRefresh: () => void
  onLoadProfileTargetStudio?: (options?: { profileName?: string; targetName?: string }) => void
  onSaveConfigStudio?: (
    kind: "profile" | "target",
    configName: string,
    updates: Record<string, unknown>
  ) => Promise<boolean> | boolean
  onReconstructionArtifactsChange?: (next: ReconstructionArtifactsPayload) => void
  onReconstructionModeChange?: (mode: "gemini") => void
  onReconstructionStrategyChange?: (strategy: "strict" | "balanced" | "aggressive") => void
  onResolveProfile?: () => void
  onPreviewReconstruction?: () => void
  onGenerateReconstruction?: () => void
  onOrchestrateFromArtifacts?: () => void
}

function FlowWorkshopView({
  diagnostics,
  alerts,
  diagnosticsError,
  alertError,
  latestFlow,
  flowError,
  flowDraft,
  selectedStepId,
  stepEvidence,
  evidenceTimeline,
  evidenceTimelineError,
  resumeWithPreconditions,
  stepEvidenceError,
  recoveryPlan = null,
  recoveryPlanState = "empty",
  recoveryPlanError = "",
  templateReadiness = null,
  templateReadinessState = "empty",
  templateReadinessError = "",
  profileTargetStudioState = "empty",
  profileTargetStudioError = "",
  studioTemplates = [],
  selectedStudioTemplateId = "",
  onSelectedTemplateIdChange = () => {},
  profileStudioOptions = [],
  targetStudioOptions = [],
  selectedProfileStudioName = "pr",
  selectedTargetStudioName = "web.local",
  profileStudioDocument = null,
  targetStudioDocument = null,
  reconstructionArtifacts = {},
  reconstructionMode = "gemini",
  reconstructionStrategy = "balanced",
  reconstructionError = "",
  profileResolved = null,
  reconstructionPreview = null,
  reconstructionGenerated = null,
  otpCode = "",
  onOtpCodeChange = () => {},
  onSubmitOtp = () => {},
  onOpenTaskCenter = () => {},
  onFlowDraftChange,
  onSelectStep,
  onResumeWithPreconditionsChange,
  onSaveFlowDraft,
  onReplayLatestFlow,
  onReplayStep,
  onResumeFromStep,
  onRefresh,
  onLoadProfileTargetStudio = () => {},
  onSaveConfigStudio = async () => false,
  onReconstructionArtifactsChange = () => {},
  onReconstructionModeChange = () => {},
  onReconstructionStrategyChange = () => {},
  onResolveProfile = () => {},
  onPreviewReconstruction = () => {},
  onGenerateReconstruction = () => {},
  onOrchestrateFromArtifacts = () => {},
}: FlowWorkshopViewProps) {
  const { t } = useI18n()
  const hasDraftSteps = Boolean(flowDraft && flowDraft.steps.length > 0)
  const hasLatestSession = Boolean(latestFlow?.session_id)
  const hasEvidence = evidenceTimeline.length > 0
  const failedStep = evidenceTimeline.find((item) => !item.ok)
  const selectedTemplate =
    studioTemplates.find((template) => template.template_id === selectedStudioTemplateId) ?? null
  const latestResultText = !hasEvidence
    ? t("Not run yet")
    : failedStep
      ? t("Failed at {stepId}", { stepId: failedStep.step_id })
      : t("Passed")
  const nextActionText = !hasDraftSteps
    ? t("Start one recording run from Quick Launch first to generate the initial flow draft.")
    : !hasLatestSession
      ? t('Save the draft first, then click "Replay Latest Flow" to complete the first run.')
      : failedStep
        ? t("Resume from {stepId} and correct that step.", { stepId: failedStep.step_id })
        : t("Review the key screenshots, then reuse the flow with confidence.")

  return (
    <div className="flow-workshop-view">
      {/* Left: Diagnostics + Flow Editor */}
      <div className="flow-editor-column">
        <Card className="workshop-command-deck flow-editor-panel">
          <CardContent className="workshop-command-deck-content p-4">
            <div className="workshop-command-copy">
              <p className="launch-section-kicker">{t("Flow Control Deck")}</p>
              <h2 className="workshop-command-title">
                {t("Converge on the outcome first, then move into diagnostics, editing, and evidence review")}
              </h2>
              <p className="workshop-command-body">
                {t(
                  "This screen keeps the most important outcome and next action at the top. Advanced diagnostics and evidence drill-down stay available below without fragmenting attention too early."
                )}
              </p>
            </div>
            <div className="workshop-command-pills">
              <Badge variant={hasDraftSteps ? "success" : "default"}>
                {hasDraftSteps ? t("Draft ready") : t("Waiting for the first draft recording")}
              </Badge>
              <Badge className="workshop-pill" variant={hasEvidence ? "secondary" : "default"}>
                {hasEvidence
                  ? t("{count} evidence nodes", { count: evidenceTimeline.length })
                  : t("No evidence nodes yet")}
              </Badge>
              <Badge className="workshop-pill" variant={failedStep ? "destructive" : "success"}>
                {failedStep
                  ? t("Fix pending at {stepId}", { stepId: failedStep.step_id })
                  : t("No failures in the current replay")}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="workshop-focus-card flow-editor-panel">
          <CardHeader>
            <CardTitle>{t("Key outcome and next action")}</CardTitle>
          </CardHeader>
          <CardContent>
          <p className="workshop-advanced-note">
            {t('Flow Workshop is the advanced zone. For a first run, you only need "Save Draft → Replay Latest Flow".')}
          </p>
          <div className="field mb-3">
            <span className="field-label">{t("Optional AI assistant")}</span>
            <p className="hint-text mt-1">
              {t(
                "For AI-agent builders, this is the strongest current AI surface because it stays downstream of proof and inside a reviewable workshop lane."
              )}
            </p>
            <p className="hint-text mt-1">
              {t(
                "Use reconstruction only when artifacts already exist and a human still plans to review the generated flow. This is an advanced assistant, not the deterministic mainline."
              )}
            </p>
          </div>
          <div className="focus-kpis">
            <div className="focus-kpi">
              <span className="focus-kpi-label">{t("Draft")}</span>
              <span className="focus-kpi-value">{hasDraftSteps ? t("Ready") : t("Missing")}</span>
            </div>
            <div className="focus-kpi">
              <span className="focus-kpi-label">{t("Latest replay")}</span>
              <span className="focus-kpi-value">{latestResultText}</span>
            </div>
          </div>
          <p className="hint-text mt-2">{nextActionText}</p>
          <RecoveryCenterPanel
            plan={recoveryPlan}
            state={recoveryPlanState}
            error={recoveryPlanError}
            otpCode={otpCode}
            onOtpCodeChange={onOtpCodeChange}
            onSubmitOtp={onSubmitOtp}
            onReplayLatestFlow={onReplayLatestFlow}
            onReplayStep={onReplayStep}
            onResumeFromStep={onResumeFromStep}
            compact
            onOpenTaskCenter={onOpenTaskCenter}
          />
          <FlowReadinessPanel
            readiness={templateReadiness}
            state={templateReadinessState}
            error={templateReadinessError}
          />
          <div className="form-actions mt-2">
            <Button size="sm" onClick={onSaveFlowDraft} disabled={!hasDraftSteps}>
              {t("Save Draft")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onReplayLatestFlow}
              disabled={!hasLatestSession}
            >
              {t("Replay Latest Flow")}
            </Button>
            {failedStep && (
              <Button variant="outline" size="sm" onClick={() => onResumeFromStep(failedStep.step_id)}>
                {t("Resume from {stepId}", { stepId: failedStep.step_id })}
              </Button>
            )}
          </div>
          </CardContent>
        </Card>

        <AutonomyLabPanel
          reconstructionArtifacts={reconstructionArtifacts}
          reconstructionPreview={reconstructionPreview}
          reconstructionGenerated={reconstructionGenerated}
          hasLatestSession={hasLatestSession}
          onResolveProfile={onResolveProfile}
          onPreviewReconstruction={onPreviewReconstruction}
          onGenerateReconstruction={onGenerateReconstruction}
          onOrchestrateFromArtifacts={onOrchestrateFromArtifacts}
        />

        <Card className="flow-editor-panel">
          <CardHeader>
            <CardTitle>{t("Template reuse lane")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="hint-text mb-3">
              {t("This lane answers one operator question first: is the current template stable enough to reuse, or should it stay in workshop mode?")}
            </p>
            {studioTemplates.length === 0 ? (
              <EmptyState
                title={t("No templates available yet")}
                description={t("Import or save a flow first, then come back here to review whether it is safe to reuse.")}
              />
            ) : (
              <>
                <div className="form-row flex-wrap gap-2">
                  {studioTemplates.map((template) => (
                    <Button
                      key={template.template_id}
                      type="button"
                      size="sm"
                      variant={template.template_id === selectedStudioTemplateId ? "default" : "outline"}
                      onClick={() => onSelectedTemplateIdChange(template.template_id)}
                    >
                      {template.name}
                    </Button>
                  ))}
                </div>
                {selectedTemplate && (
                  <div className="field-group mt-3">
                    <div className="field">
                      <span className="field-label">{t("Selected template")}</span>
                      <span className="hint-text">{selectedTemplate.name}</span>
                    </div>
                    <div className="field">
                      <span className="field-label">{t("Why this lane exists")}</span>
                      <span className="hint-text">
                        {t("Use template reuse only after the canonical and workshop path already feels trustworthy. A template is an operator shortcut, not the first proof step.")}
                      </span>
                    </div>
                    <div className="field">
                      <span className="field-label">{t("Template signals")}</span>
                      <span className="hint-text">
                        {`${t("{count} params", { count: selectedTemplate.params_schema.length })} · ${
                          selectedTemplate.policies.otp.required ? t("OTP policy present") : t("No OTP policy")
                        } · timeout ${selectedTemplate.policies.timeout_seconds}s`}
                      </span>
                    </div>
                    <div className="field">
                      <span className="field-label">{t("Template Exchange")}</span>
                      <span className="hint-text">
                        {t("Wave 5 keeps this intentionally small: export a scrubbed template bundle, review the payload, then import it into another checkout that already has the matching flow.")}
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <details className="workshop-advanced-panel">
          <summary>{t("Advanced workshop (optional): system diagnostics, flow editing, and debugging evidence")}</summary>
          <div className="workshop-advanced-body">
            {/* Diagnostic Metrics */}
            <Card>
              <CardHeader>
                <CardTitle>{t("System status")}</CardTitle>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-uiq-ignore-button-inventory="workshop-diagnostics-refresh-secondary-action"
                  onClick={onRefresh}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 2v6h-6" />
                    <path d="M3 12a9 9 0 0115-6.7L21 8" />
                    <path d="M3 22v-6h6" />
                    <path d="M21 12a9 9 0 01-15 6.7L3 16" />
                  </svg>
                  {t("Refresh")}
                </Button>
              </CardHeader>
              <CardContent>
              {diagnosticsError && <p className="error-text">{diagnosticsError}</p>}
              {alertError && <p className="error-text">{alertError}</p>}
              {flowError && <p className="error-text">{flowError}</p>}
              <div className="metrics-grid">
                <div className="metric-card">
                  <div className="metric-label">{t("Uptime")}</div>
                  <div className="metric-value">
                    {diagnostics ? `${Math.round(diagnostics.uptime_seconds / 60)}m` : "\u2014"}
                  </div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">{t("Total tasks")}</div>
                  <div className="metric-value">{diagnostics?.task_total ?? 0}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">{t("Running")}</div>
                  <div className="metric-value">{diagnostics?.task_counts.running ?? 0}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">{t("Succeeded")}</div>
                  <div className="metric-value">{diagnostics?.task_counts.success ?? 0}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">{t("Failed")}</div>
                  <div className="metric-value">{diagnostics?.task_counts.failed ?? 0}</div>
                </div>
                <div className={`metric-card ${alerts?.state === "degraded" ? "warn" : "ok"}`}>
                  <div className="metric-label">{t("Health")}</div>
                  <div className="metric-value">
                    {alerts?.state === "ok"
                      ? t("Healthy")
                      : alerts?.state === "degraded"
                        ? t("Degraded")
                        : "\u2014"}
                  </div>
                </div>
              </div>
              </CardContent>
            </Card>
            <div>
              <p className="launch-section-kicker">{t("Optional AI assistant")}</p>
              <p className="hint-text mb-3">
                {t("Use reconstruction only when artifacts already exist and a human still plans to review the generated flow. This is an advanced assistant, not the deterministic mainline.")}
                {" "}
                {t(
                  "For AI-agent builders, this is the strongest current AI surface because it stays downstream of proof and inside a reviewable workshop lane."
                )}
              </p>
              <ReconstructionReviewPanel
                artifacts={reconstructionArtifacts}
                mode={reconstructionMode}
                strategy={reconstructionStrategy}
                error={reconstructionError}
                profileResolved={profileResolved}
                preview={reconstructionPreview}
                generated={reconstructionGenerated}
                onArtifactsChange={onReconstructionArtifactsChange}
                onModeChange={onReconstructionModeChange}
                onStrategyChange={onReconstructionStrategyChange}
                onResolveProfile={onResolveProfile}
                onPreview={onPreviewReconstruction}
                onGenerate={onGenerateReconstruction}
                onOrchestrate={onOrchestrateFromArtifacts}
              />
            </div>
            <ProfileTargetStudioPanel
              state={profileTargetStudioState}
              error={profileTargetStudioError}
              profileOptions={profileStudioOptions}
              targetOptions={targetStudioOptions}
              selectedProfile={selectedProfileStudioName}
              selectedTarget={selectedTargetStudioName}
              profileDocument={profileStudioDocument}
              targetDocument={targetStudioDocument}
              onLoad={onLoadProfileTargetStudio}
              onSave={onSaveConfigStudio}
            />

            {/* Latest flow preview */}
            <Card>
              <CardHeader>
                <CardTitle>{t("Latest flow")}</CardTitle>
                <Button variant="outline" size="sm" onClick={onReplayLatestFlow} disabled={!hasLatestSession}>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  {t("Replay")}
                </Button>
              </CardHeader>
              <CardContent>
              {latestFlow?.session_id ? (
                <>
                  <p className="hint-text mb-2">
                    {t("Session #{id} · {stepCount} steps · {eventCount} events", {
                      id: latestFlow.session_id.slice(0, 8),
                      stepCount: latestFlow.step_count,
                      eventCount: latestFlow.source_event_count,
                    })}
                  </p>
                  <ul className="task-list vlist-flow" role="list" aria-label={t("Latest flow steps")}>
                    {latestFlow.steps.slice(0, 10).map((step) => (
                      <li key={step.step_id} className="task-item">
                        <div className="task-item-info">
                          <strong>{`${step.step_id} \u00B7 ${step.action}`}</strong>
                          <p>{step.url || step.selector || step.value_ref || t("No additional detail")}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <EmptyState
                  icon={
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
                    </svg>
                  }
                  title={t("No flow data yet")}
                  description={t("Run one recording command and the generated flow data will appear here automatically.")}
                />
              )}
              </CardContent>
            </Card>

            {/* Flow draft editor */}
            <Card>
              <CardHeader>
                <CardTitle>{t("Flow editor")}</CardTitle>
              </CardHeader>
              <CardContent>
              <FlowDraftEditor
                draft={flowDraft}
                selectedStepId={selectedStepId}
                onSelectStep={onSelectStep}
                onChange={onFlowDraftChange}
                onSave={onSaveFlowDraft}
                onRunStep={onReplayStep}
                onResumeFromStep={onResumeFromStep}
              />
              <div className="form-row mt-2">
                <label className="inline-check">
                  <Checkbox
                    checked={resumeWithPreconditions}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      onResumeWithPreconditionsChange(e.target.checked)
                    }
                  />
                  {t("Replay prerequisite waiting conditions during breakpoint resume")}
                </label>
              </div>
              </CardContent>
            </Card>
          </div>
        </details>
      </div>

      {/* Right: Evidence */}
      <div className="flow-evidence-column">
        <Card className="workshop-evidence-hero flow-evidence-panel">
          <CardContent className="p-4">
            <p className="launch-section-kicker">{t("Evidence Rail")}</p>
            <h3 className="launch-section-title">{t("Evidence and status converge here")}</h3>
            <p className="hint-text">
              {t("Use this side to answer two questions first: which step failed, and what did the page look like before and after that step? Read the timeline before jumping back to the editor.")}
            </p>
          </CardContent>
        </Card>
        {stepEvidenceError && <p className="error-text">{stepEvidenceError}</p>}
        <details className="workshop-advanced-panel">
          <summary>{t("Advanced debugging evidence (optional)")}</summary>
          <div className="workshop-advanced-body">
            {/* Evidence Timeline */}
            <div>
              <h3 className="section-title">{t("Evidence timeline")}</h3>
              {evidenceTimelineError && <p className="error-text">{evidenceTimelineError}</p>}
              {evidenceTimeline.length === 0 ? (
                <EmptyState
                  icon={
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="M21 15l-5-5L5 21" />
                    </svg>
                  }
                  title={t("No evidence screenshots yet")}
                  description={t("After a replay finishes, before/after screenshots for each step appear here.")}
                />
              ) : (
                <ul className="task-list vlist-lg" role="list" aria-label="Evidence timeline">
                  {evidenceTimeline.map((item) => (
                    <li key={item.step_id}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={`task-item task-item-button flex-col ${selectedStepId === item.step_id ? "active" : ""}`}
                        aria-label={t("Open step evidence details")}
                        data-uiq-ignore-button-inventory="repeated-step-evidence-selection"
                        onClick={() => onSelectStep(item.step_id)}
                      >
                        <div className="flex-row justify-between gap-2">
                              <strong>{`${item.step_id} \u00B7 ${item.action ?? t("Unknown")}`}</strong>
                          <span className="hint-text">{`${item.ok ? t("Passed") : t("Failed")} \u00B7 ${item.duration_ms ?? 0}ms`}</span>
                        </div>
                        <p className="hint-text">{item.detail ?? t("No additional detail")}</p>
                        <EvidenceScreenshotPair
                          beforeImageUrl={item.screenshot_before_data_url}
                          afterImageUrl={item.screenshot_after_data_url}
                          beforeAlt={t("Before execution - {stepId}", { stepId: item.step_id })}
                          afterAlt={t("After execution - {stepId}", { stepId: item.step_id })}
                        />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Step Evidence Detail */}
            <div>
              <h3 className="section-title">{t("Step evidence details")}</h3>
              {!selectedStepId ? (
                <EmptyState
                  icon={
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  }
                  title={t("Select a step to inspect the evidence")}
                  description={t("Choose a step from the timeline or the editor to inspect its detailed evidence.")}
                />
              ) : !stepEvidence ? (
                <p className="hint-text p-4">
                  {t("Step {stepId} has no evidence yet. Replay or rerun it first.", {
                    stepId: selectedStepId,
                  })}
                </p>
              ) : (
                <Card tone="raised">
                  <div className="field-group">
                    <div className="form-row">
                      <div className="field">
                        <span className="field-label">{t("Step")}</span>
                        <span className="text-sm">{`${stepEvidence.step_id} \u00B7 ${stepEvidence.action ?? t("Unknown")}`}</span>
                      </div>
                      <div className="field">
                        <span className="field-label">{t("Status")}</span>
                        <span className="text-sm">{stepEvidence.ok ? t("Passed") : t("Failed")}</span>
                      </div>
                      <div className="field">
                        <span className="field-label">{t("Duration")}</span>
                        <span className="text-sm">{`${stepEvidence.duration_ms ?? 0}ms`}</span>
                      </div>
                    </div>
                    <div className="field">
                      <span className="field-label">{t("Matched selector")}</span>
                      <span className="hint-text">{`[${stepEvidence.selector_index ?? "-"}] ${stepEvidence.matched_selector ?? t("None")}`}</span>
                    </div>
                    {stepEvidence.detail && (
                      <div className="field">
                        <span className="field-label">{t("Detail")}</span>
                        <span className="hint-text">{stepEvidence.detail}</span>
                      </div>
                    )}
                    <EvidenceScreenshotPair
                      beforeImageUrl={stepEvidence.screenshot_before_data_url}
                      afterImageUrl={stepEvidence.screenshot_after_data_url}
                      beforeAlt={t("Evidence before execution - {stepId}", { stepId: stepEvidence.step_id })}
                      afterAlt={t("Evidence after execution - {stepId}", { stepId: stepEvidence.step_id })}
                      emptyHint={t("No screenshot evidence exists for this step")}
                    />
                    <details className="debug-disclosure">
                      <summary>{t("Advanced debugging: selector fallback trail")}</summary>
                      <div className="debug-disclosure-body">
                        {stepEvidence.fallback_trail.length === 0 ? (
                          <p className="hint-text">{t("No fallback was triggered for this step.")}</p>
                        ) : (
                          <ul
                            className="task-list vlist-sm"
                            role="list"
                            aria-label={t("Selector fallback trail")}
                          >
                            {stepEvidence.fallback_trail.map((attempt) => (
                              <li
                                key={`${attempt.selector_index}-${attempt.value}`}
                                className="task-item"
                              >
                                <div className="task-item-info">
                                  <strong>{`#${attempt.selector_index} [${attempt.kind}] ${attempt.normalized ?? attempt.value}`}</strong>
                                  <p>
                                    {attempt.success
                                      ? t("Matched successfully")
                                      : t("Failed: {error}", { error: attempt.error ?? t("Unknown error") })}
                                  </p>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </details>
                  </div>
                </Card>
              )}
            </div>
          </div>
        </details>
      </div>
    </div>
  )
}

export default memo(FlowWorkshopView)
