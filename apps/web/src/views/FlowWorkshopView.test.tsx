/* @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../i18n"
import type {
  AlertsPayload,
  DiagnosticsPayload,
  EvidenceTimelineItem,
  FlowEditableDraft,
  FlowPreviewPayload,
  ReconstructionPreviewPayload,
  StepEvidencePayload,
} from "../types"
import FlowWorkshopView from "./FlowWorkshopView"

type WorkshopProps = React.ComponentProps<typeof FlowWorkshopView>

function createProps(overrides: Partial<WorkshopProps> = {}): WorkshopProps {
  return {
    diagnostics: null,
    alerts: null,
    diagnosticsError: "",
    alertError: "",
    latestFlow: null,
    flowError: "",
    flowDraft: null,
    selectedStepId: "",
    stepEvidence: null,
    evidenceTimeline: [],
    evidenceTimelineError: "",
    resumeWithPreconditions: false,
    stepEvidenceError: "",
    onFlowDraftChange: vi.fn(),
    onSelectStep: vi.fn(),
    onResumeWithPreconditionsChange: vi.fn(),
    onSaveFlowDraft: vi.fn(),
    onReplayLatestFlow: vi.fn(),
    onReplayStep: vi.fn(),
    onResumeFromStep: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  }
}

const diagnostics: DiagnosticsPayload = {
  uptime_seconds: 360,
  task_total: 12,
  task_counts: {
    queued: 1,
    running: 2,
    success: 7,
    failed: 2,
  },
  metrics: {
    requests_total: 32,
    rate_limited: 0,
  },
}

const alerts: AlertsPayload = {
  state: "degraded",
  failure_rate: 0.2,
  threshold: 0.1,
  completed: 7,
  failed: 2,
}

const latestFlow: FlowPreviewPayload = {
  session_id: "session-abc-123",
  start_url: "https://example.com",
  generated_at: "2026-03-01T00:00:00Z",
  source_event_count: 4,
  step_count: 2,
  steps: [
    { step_id: "s1", action: "navigate", url: "https://example.com" },
    { step_id: "s2", action: "click", selector: "#submit" },
  ],
}

const flowDraft: FlowEditableDraft = {
  flow_id: "flow-1",
  session_id: "session-abc-123",
  start_url: "https://example.com",
  steps: [
    {
      step_id: "s1",
      action: "click",
      selected_selector_index: 0,
      target: { selectors: [{ kind: "css", value: "#submit", score: 90 }] },
    },
  ],
}

const evidenceTimeline: EvidenceTimelineItem[] = [
  {
    step_id: "s2",
    action: "click",
    ok: false,
    detail: "click failed",
    duration_ms: 200,
    matched_selector: "#submit",
    selector_index: 0,
    screenshot_before_path: null,
    screenshot_after_path: null,
    screenshot_before_data_url: null,
    screenshot_after_data_url: null,
    fallback_trail: [
      {
        selector_index: 0,
        kind: "css",
        value: "#submit",
        normalized: "#submit",
        success: false,
        error: "not found",
      },
    ],
  },
]

const stepEvidence: StepEvidencePayload = {
  ...evidenceTimeline[0],
}

describe("FlowWorkshopView", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.restoreAllMocks()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  it("shows beginner guidance when no draft/session/evidence", function () {
    act(() => {
      root.render(<FlowWorkshopView {...createProps()} />)
    })

    expect(container.textContent).toContain("Flow Workshop is the advanced zone")
    expect(container.textContent).toContain("Autonomy Lab Phase 1")
    expect(container.textContent).toContain("Blocked until you attach artifacts or keep one recorded session available.")
    expect(container.textContent).toContain("Draft")
    expect(container.textContent).toContain("Missing")
    expect(container.textContent).toContain("Latest replay")
    expect(container.textContent).toContain("Not run yet")
    expect(container.textContent).toContain("Start one recording run")
    expect(container.textContent).toContain("No flow draft yet")

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save Draft"
    ) as HTMLButtonElement | undefined
    const replayButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Replay Latest Flow"
    ) as HTMLButtonElement | undefined
    const resolveProfileButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Resolve profile from artifacts"
    ) as HTMLButtonElement | undefined
    const previewButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Preview reviewable draft"
    ) as HTMLButtonElement | undefined
    const generateLabDraftButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Generate lab draft"
    ) as HTMLButtonElement | undefined
    expect(saveButton?.disabled).toBe(true)
    expect(replayButton?.disabled).toBe(true)
    expect(resolveProfileButton?.disabled).toBe(true)
    expect(previewButton?.disabled).toBe(true)
    expect(generateLabDraftButton?.disabled).toBe(true)
  })

  it("covers live draft/evidence actions and callbacks", function () {
    const onSaveFlowDraft = vi.fn()
    const onReplayLatestFlow = vi.fn()
    const onResumeFromStep = vi.fn()
    const onReplayStep = vi.fn()
    const onSelectStep = vi.fn()
    const onResumeWithPreconditionsChange = vi.fn()
    const onRefresh = vi.fn()

    act(() => {
      root.render(
        <FlowWorkshopView
          {...createProps({
            diagnostics,
            alerts,
            latestFlow,
            flowDraft,
            selectedStepId: "s2",
            stepEvidence,
            evidenceTimeline,
            resumeWithPreconditions: true,
            onSaveFlowDraft,
            onReplayLatestFlow,
            onResumeFromStep,
            onReplayStep,
            onSelectStep,
            onResumeWithPreconditionsChange,
            onRefresh,
          })}
        />
      )
    })

    expect(container.textContent).toContain("Resume from s2 and correct that step.")
    expect(container.textContent).toContain("Failed at s2")
    expect(container.textContent).toContain("Step")
    expect(container.textContent).toContain("fallback trail")

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save Draft"
    ) as HTMLButtonElement | undefined
    const replayButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Replay Latest Flow"
    ) as HTMLButtonElement | undefined
    const resumeButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Resume from s2"
    ) as HTMLButtonElement | undefined

    expect(saveButton?.disabled).toBe(false)
    expect(replayButton?.disabled).toBe(false)

    act(() => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      replayButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      resumeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onSaveFlowDraft).toHaveBeenCalledTimes(1)
    expect(onReplayLatestFlow).toHaveBeenCalledTimes(1)
    expect(onResumeFromStep).toHaveBeenCalledWith("s2")

    const timelineButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("s2 · click")
    ) as HTMLButtonElement | undefined
    act(() => {
      timelineButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onSelectStep).toHaveBeenCalledWith("s2")

    const resumeLabel = Array.from(container.querySelectorAll("label")).find((label) =>
      label.textContent?.includes("Replay prerequisite waiting conditions during breakpoint resume")
    ) as HTMLLabelElement | undefined
    const resumeWithPreconditions = resumeLabel?.querySelector("input") as
      | HTMLInputElement
      | undefined
    act(() => {
      resumeWithPreconditions?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onResumeWithPreconditionsChange).toHaveBeenCalledWith(false)

    const refreshButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Refresh"
    ) as HTMLButtonElement | undefined
    act(() => {
      refreshButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it("shows passed state guidance when timeline has no failure", function () {
    const cleanTimeline: EvidenceTimelineItem[] = [
      {
        step_id: "s-pass",
        action: null,
        ok: true,
        detail: null,
        duration_ms: null,
        matched_selector: null,
        selector_index: null,
        screenshot_before_path: null,
        screenshot_after_path: null,
        screenshot_before_data_url: null,
        screenshot_after_data_url: null,
        fallback_trail: [],
      },
    ]

    act(() => {
      root.render(
        <FlowWorkshopView
          {...createProps({
            diagnostics,
            alerts: { ...alerts, state: "ok" },
            latestFlow: {
              ...latestFlow,
              steps: [{ step_id: "s-pass", action: "type", value_ref: "email", selector: null, url: null }],
            },
            flowDraft,
            selectedStepId: "s-pass",
            stepEvidence: { ...stepEvidence, step_id: "s-pass", ok: true, detail: null, fallback_trail: [] },
            evidenceTimeline: cleanTimeline,
          })}
        />
      )
    })

    expect(container.textContent).toContain("Passed")
    expect(container.textContent).toContain("Review the key screenshots, then reuse the flow with confidence.")
    expect(container.textContent).toContain("Healthy")
    expect(container.textContent).toContain("No fallback was triggered for this step.")
    expect(container.textContent).not.toContain("Resume from s-pass")
  })

  it("shows missing evidence hint when a step is selected without evidence payload", function () {
    act(() => {
      root.render(
        <FlowWorkshopView
          {...createProps({
            flowDraft,
            latestFlow,
            selectedStepId: "s-pending",
            stepEvidence: null,
            evidenceTimeline: [{ ...evidenceTimeline[0], step_id: "s-pending", ok: true }],
            stepEvidenceError: "Evidence loading interrupted",
          })}
        />
      )
    })

    expect(container.textContent).toContain("Evidence loading interrupted")
    expect(container.textContent).toContain("Step s-pending has no evidence yet. Replay or rerun it first.")
  })

  it("covers no-session guidance, error banners and fallback detail variants", function () {
    act(() => {
      root.render(
        <FlowWorkshopView
          {...createProps({
            diagnostics,
            diagnosticsError: "Diagnostics failed",
            alertError: "Alert refresh failed",
            flowError: "Flow preview failed",
            latestFlow: { ...latestFlow, session_id: "", steps: [{ step_id: "s-x", action: "type", value_ref: null, selector: null, url: null }] },
            flowDraft,
            selectedStepId: "s-x",
            stepEvidence: {
              ...stepEvidence,
              step_id: "s-x",
              action: null,
              duration_ms: null,
              matched_selector: null,
              selector_index: null,
              detail: "detail",
              fallback_trail: [
                {
                  selector_index: 0,
                  kind: "css",
                  value: ".missing",
                  normalized: null,
                  success: false,
                  error: null,
                },
                {
                  selector_index: 1,
                  kind: "xpath",
                  value: "//button",
                  normalized: "//button",
                  success: true,
                  error: null,
                },
              ],
            },
            evidenceTimeline: [{ ...evidenceTimeline[0], step_id: "s-x", ok: true, detail: null }],
            evidenceTimelineError: "Timeline loading failed",
          })}
        />
      )
    })

    expect(container.textContent).toContain('Save the draft first, then click "Replay Latest Flow" to complete the first run.')
    expect(container.textContent).toContain("Diagnostics failed")
    expect(container.textContent).toContain("Alert refresh failed")
    expect(container.textContent).toContain("Flow preview failed")
    expect(container.textContent).toContain("Timeline loading failed")
    expect(container.textContent).toContain("No additional detail")
    expect(container.textContent).toContain("Failed: Unknown error")
    expect(container.textContent).toContain("Matched successfully")
  })

  it("renders hero and focus copy in Chinese under zh-CN locale", function () {
    act(() => {
      root.render(
        <I18nProvider locale="zh-CN" setLocale={() => {}}>
          <FlowWorkshopView {...createProps()} />
        </I18nProvider>
      )
    })

    expect(container.textContent).toContain("流程控制面板")
    expect(container.textContent).toContain("关键结果与下一步动作")
    expect(container.textContent).toContain("流程工坊是高级区域")
    expect(container.textContent).toContain("尚未运行")
  })

  it("surfaces stronger AI-builder bridge copy in english", function () {
    act(() => {
      root.render(<FlowWorkshopView {...createProps()} />)
    })

    expect(container.textContent).toContain("Optional AI assistant")
    expect(container.textContent).toContain("AI-agent builders")
    expect(container.textContent).toContain("reviewable workshop lane")
    expect(container.querySelector(".workshop-focus-card")?.textContent).toContain(
      "Optional AI assistant"
    )
    expect(container.querySelector(".workshop-focus-card")?.textContent).toContain(
      "reviewable workshop lane"
    )
  })

  it("surfaces a bounded autonomy lab with real reconstruction actions", function () {
    const onResolveProfile = vi.fn()
    const onPreviewReconstruction = vi.fn()
    const onGenerateReconstruction = vi.fn()
    const onOrchestrateFromArtifacts = vi.fn()

    act(() => {
      root.render(
        <FlowWorkshopView
          {...createProps({
            latestFlow,
            reconstructionArtifacts: { session_dir: "reconstruction/session-1", har_path: "run.har" },
            reconstructionPreview: {
              preview_id: "preview-1",
              flow_draft: {},
              reconstructed_flow_quality: 0.93,
              step_confidence: [],
              unresolved_segments: [],
              manual_handoff_required: false,
              unsupported_reason: null,
              generator_outputs: {},
            } as ReconstructionPreviewPayload,
            onResolveProfile,
            onPreviewReconstruction,
            onGenerateReconstruction,
            onOrchestrateFromArtifacts,
          })}
        />
      )
    })

    expect(container.textContent).toContain("Autonomy Lab Phase 1")
    expect(container.textContent).toContain("Manual-only gates stay manual")
    expect(container.textContent).toContain(
      "A preview exists. Generate a reviewable draft before you promote this into a reusable template."
    )
    expect(container.textContent).toContain("Why this is safe")

    const resolveProfileButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Resolve profile from artifacts"
    ) as HTMLButtonElement | undefined
    const previewButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Preview reviewable draft"
    ) as HTMLButtonElement | undefined
    const generateLabDraftButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Generate lab draft"
    ) as HTMLButtonElement | undefined
    const createTemplateButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Create template from artifacts"
    ) as HTMLButtonElement | undefined

    expect(resolveProfileButton?.disabled).toBe(false)
    expect(previewButton?.disabled).toBe(false)
    expect(generateLabDraftButton?.disabled).toBe(false)
    expect(createTemplateButton?.disabled).toBe(false)

    act(() => {
      resolveProfileButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      previewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      generateLabDraftButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      createTemplateButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onResolveProfile).toHaveBeenCalledTimes(1)
    expect(onPreviewReconstruction).toHaveBeenCalledTimes(1)
    expect(onGenerateReconstruction).toHaveBeenCalledTimes(1)
    expect(onOrchestrateFromArtifacts).toHaveBeenCalledTimes(1)
  })

  it("renders autonomy lab copy in Chinese under zh-CN locale", function () {
    act(() => {
      root.render(
        <I18nProvider locale="zh-CN" setLocale={() => {}}>
          <FlowWorkshopView {...createProps()} />
        </I18nProvider>
      )
    })

    expect(container.textContent).toContain("自治实验室第 1 阶段")
    expect(container.textContent).toContain("手动门继续保持手动")
    expect(container.textContent).toContain("当前实验室状态")
  })
})
