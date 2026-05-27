/* @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useApiClient } from "./useApiClient"
import type { AppStore } from "./useAppStore"

function responseOf(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: new Headers(),
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response
}

function createStore(): AppStore & Record<string, unknown> {
  return {
    params: {
      baseUrl: "/gateway",
      startUrl: "https://example.com/register",
      successSelector: "#ok",
      modelName: "gemini-3.1-pro-preview",
      geminiApiKey: "gem-key",
      registerPassword: "secret",
      automationToken: "token-123",
      automationClientId: "client-123",
      headless: false,
      midsceneStrict: false,
    },
    flowDraft: {
      flow_id: "flow-1",
      session_id: "session-1",
      start_url: "https://example.com",
      generated_at: "2026-03-08T00:00:00Z",
      source_event_count: 2,
      steps: [{ step_id: "s1", action: "click", selected_selector_index: 0, target: { selectors: [] } }],
    },
    selectedStepId: "s1",
    selectedStudioFlowId: "flow-1",
    selectedStudioTemplateId: "tpl-1",
    selectedStudioRunId: "",
    selectedProfileStudioName: "pr",
    selectedTargetStudioName: "web.local",
    studioTemplateName: "template-demo",
    studioSchemaRows: [
      {
        key: "email",
        type: "email",
        required: true,
        description: "Email",
        enum_values: "",
        pattern: "",
      },
    ],
    studioDefaults: { email: "demo@example.com" },
    studioPolicies: {
      retries: 1,
      timeout_seconds: 120,
      otp: {
        required: true,
        provider: "manual",
        timeout_seconds: 90,
        regex: "\\d{6}",
        sender_filter: "",
        subject_filter: "",
      },
    },
    studioRunParams: { email: "demo@example.com" },
    studioOtpCode: "654321",
    resumeWithPreconditions: true,
    reconstructionArtifacts: {
      session_dir: "/tmp/session",
      video_path: "video.mp4",
      har_path: "flow.har",
      html_path: "index.html",
    },
    reconstructionMode: "gemini",
    reconstructionStrategy: "balanced",
    reconstructionPreview: { preview_id: "preview-1" },
    evidenceTimeline: [{ step_id: "s1" }],
    statusFilter: "running",
    commandFilter: "run-ui",
    taskLimit: 20,
    setCommands: vi.fn(),
    setCommandState: vi.fn(),
    setTaskState: vi.fn(),
    setTaskSyncError: vi.fn(),
    setTasks: vi.fn(),
    setSelectedTaskId: vi.fn((value) => value),
    setSelectedStepId: vi.fn((value) => value),
    setStepEvidence: vi.fn(),
    setStepEvidenceError: vi.fn(),
    setEvidenceTimeline: vi.fn(),
    setEvidenceTimelineError: vi.fn(),
    setStudioError: vi.fn(),
    setSubmittingId: vi.fn(),
    setActionState: vi.fn(),
    setFeedbackText: vi.fn(),
    addLog: vi.fn(),
    pushNotice: vi.fn(),
    setDiagnosticsError: vi.fn(),
    setDiagnostics: vi.fn(),
    setAlertError: vi.fn(),
    setAlerts: vi.fn(),
    setFlowError: vi.fn(),
    setLatestFlow: vi.fn(),
    setFlowDraft: vi.fn(),
    setProfileResolved: vi.fn(),
    setReconstructionPreview: vi.fn(),
    setReconstructionGenerated: vi.fn(),
    setReconstructionError: vi.fn(),
    setStudioFlows: vi.fn(),
    setStudioTemplates: vi.fn(),
    setStudioRuns: vi.fn(),
    setSelectedStudioFlowId: vi.fn((updater) => updater),
    setSelectedStudioTemplateId: vi.fn((updater) => updater),
    setSelectedStudioRunId: vi.fn(),
    setProfileTargetStudioState: vi.fn(),
    setProfileTargetStudioError: vi.fn(),
    setProfileStudioOptions: vi.fn(),
    setTargetStudioOptions: vi.fn(),
    setSelectedProfileStudioName: vi.fn(),
    setSelectedTargetStudioName: vi.fn(),
    setProfileStudioDocument: vi.fn(),
    setTargetStudioDocument: vi.fn(),
    setParams: vi.fn((updater) => updater),
  } as unknown as AppStore & Record<string, unknown>
}

describe("useApiClient studio and diagnostics flows", () => {
  let container: HTMLDivElement
  let root: Root
  let api: ReturnType<typeof useApiClient> | null

  beforeEach(() => {
    api = null
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  it("covers diagnostics, alerts, flow draft, studio actions and refresh paths", async function () {
    const store = createStore()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    fetchMock
      .mockResolvedValueOnce(responseOf({ uptime_seconds: 1, task_total: 2, task_counts: {}, metrics: {} }))
      .mockResolvedValueOnce(responseOf({ state: "ok", failure_rate: 0, threshold: 0.2, completed: 1, failed: 0 }))
      .mockResolvedValueOnce(responseOf({ session_id: "session-1", start_url: "https://example.com", generated_at: "", source_event_count: 2, step_count: 1, steps: [] }))
      .mockResolvedValueOnce(responseOf({ flow: store.flowDraft }))
      .mockResolvedValueOnce(responseOf({ items: [{ step_id: "s1" }] }))
      .mockResolvedValueOnce(responseOf({ step_id: "s1", ok: true }))
      .mockResolvedValueOnce(responseOf({ flows: [{ flow_id: "flow-1" }] }))
      .mockResolvedValueOnce(responseOf({ templates: [{ template_id: "tpl-1" }] }))
      .mockResolvedValueOnce(responseOf({ runs: [{ run_id: "run-1" }] }))
      .mockResolvedValueOnce(responseOf({ profile: "strict", dom_alignment_score: 90, har_alignment_score: 80, manual_handoff_required: false }))
      .mockResolvedValueOnce(responseOf({ preview_id: "preview-1", reconstructed_flow_quality: 91, unresolved_segments: [] }))
      .mockResolvedValueOnce(responseOf({ flow_id: "flow-1", template_id: "tpl-1", manual_handoff_required: false }))
      .mockResolvedValueOnce(responseOf({ ok: true }))
      .mockResolvedValueOnce(responseOf({ flows: [{ flow_id: "flow-1" }] }))
      .mockResolvedValueOnce(responseOf({ templates: [{ template_id: "tpl-1" }] }))
      .mockResolvedValueOnce(responseOf({ runs: [{ run_id: "run-1" }] }))
      .mockResolvedValueOnce(responseOf({ flow_id: "flow-2" }))
      .mockResolvedValueOnce(responseOf({ flows: [{ flow_id: "flow-2" }] }))
      .mockResolvedValueOnce(responseOf({ templates: [{ template_id: "tpl-1" }] }))
      .mockResolvedValueOnce(responseOf({ runs: [{ run_id: "run-1" }] }))
      .mockResolvedValueOnce(responseOf({ template_id: "tpl-2" }))
      .mockResolvedValueOnce(responseOf({ flows: [{ flow_id: "flow-2" }] }))
      .mockResolvedValueOnce(responseOf({ templates: [{ template_id: "tpl-2" }] }))
      .mockResolvedValueOnce(responseOf({ runs: [{ run_id: "run-1" }] }))
      .mockResolvedValueOnce(responseOf({ template_id: "tpl-1" }))
      .mockResolvedValueOnce(responseOf({ flows: [{ flow_id: "flow-2" }] }))
      .mockResolvedValueOnce(responseOf({ templates: [{ template_id: "tpl-2" }] }))
      .mockResolvedValueOnce(responseOf({ runs: [{ run_id: "run-1" }] }))
      .mockResolvedValueOnce(responseOf({ run: { run_id: "run-new", status: "queued" } }))
      .mockResolvedValueOnce(responseOf({ flows: [{ flow_id: "flow-2" }] }))
      .mockResolvedValueOnce(responseOf({ templates: [{ template_id: "tpl-2" }] }))
      .mockResolvedValueOnce(responseOf({ runs: [{ run_id: "run-new" }] }))
      .mockResolvedValueOnce(responseOf({ tasks: [] }))
      .mockResolvedValueOnce(responseOf({ run: { run_id: "run-new", status: "running" } }))
      .mockResolvedValueOnce(responseOf({ flows: [{ flow_id: "flow-2" }] }))
      .mockResolvedValueOnce(responseOf({ templates: [{ template_id: "tpl-2" }] }))
      .mockResolvedValueOnce(responseOf({ runs: [{ run_id: "run-new" }] }))
      .mockResolvedValueOnce(responseOf({ tasks: [] }))
      .mockResolvedValueOnce(responseOf({ tasks: [] }))
      .mockResolvedValueOnce(responseOf({ uptime_seconds: 1, task_total: 2, task_counts: {}, metrics: {} }))
      .mockResolvedValueOnce(responseOf({ state: "ok", failure_rate: 0, threshold: 0.2, completed: 1, failed: 0 }))
      .mockResolvedValueOnce(responseOf({ session_id: "session-1", start_url: "https://example.com", generated_at: "", source_event_count: 2, step_count: 1, steps: [] }))
      .mockResolvedValueOnce(responseOf({ flow: store.flowDraft }))
      .mockResolvedValueOnce(responseOf({ items: [{ step_id: "s1" }] }))
      .mockResolvedValueOnce(responseOf({ step_id: "s1", ok: true }))
      .mockResolvedValueOnce(responseOf({ flows: [{ flow_id: "flow-2" }] }))
      .mockResolvedValueOnce(responseOf({ templates: [{ template_id: "tpl-2" }] }))
      .mockResolvedValueOnce(responseOf({ runs: [{ run_id: "run-new" }] }))

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    await act(async () => {
      await api?.fetchDiagnostics()
      await api?.fetchAlerts()
      await api?.fetchLatestFlow()
      await api?.fetchLatestFlowDraft()
      await api?.fetchEvidenceTimeline()
      await api?.fetchStepEvidence("s1")
      await api?.fetchStudioData()
      await api?.resolveProfile()
      await api?.previewReconstruction()
      await api?.generateReconstruction()
      await api?.orchestrateFromArtifacts()
      await api?.importLatestFlow()
      await api?.createTemplate()
      await api?.updateTemplate()
      await api?.createRun()
      await api?.submitRunOtp("run-new", "waiting_otp")
    })

    expect(store.setDiagnostics).toHaveBeenCalled()
    expect(store.setAlerts).toHaveBeenCalled()
    expect(store.setLatestFlow).toHaveBeenCalled()
    expect(store.setFlowDraft).toHaveBeenCalled()
    expect(store.setEvidenceTimeline).toHaveBeenCalled()
    expect(store.setStepEvidence).toHaveBeenCalled()
    expect(store.setStudioFlows).toHaveBeenCalled()
    expect(store.setProfileResolved).toHaveBeenCalled()
    expect(store.setReconstructionPreview).toHaveBeenCalled()
    expect(store.setReconstructionGenerated).toHaveBeenCalled()
    expect(store.pushNotice).toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalled()
  })

  it("covers cancel/save/replay branches and studio error handling paths", async function () {
    const store = createStore()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    const sampleTask = {
      task_id: "task-cancel-1",
      command_id: "cmd-cancel",
    } as never

    fetchMock
      .mockReset()
      .mockResolvedValueOnce(responseOf({ ok: true }))
      .mockResolvedValueOnce(responseOf({ tasks: [] }))
      .mockResolvedValueOnce(responseOf({ uptime_seconds: 1, task_total: 0, task_counts: {}, metrics: {} }))
      .mockResolvedValueOnce(responseOf({ state: "ok", failure_rate: 0, threshold: 0.2, completed: 0, failed: 0 }))
      .mockResolvedValueOnce(responseOf({ session_id: "session-1", start_url: "https://example.com", generated_at: "", source_event_count: 0, step_count: 0, steps: [] }))
      .mockResolvedValueOnce(responseOf({ flow: store.flowDraft }))

    await act(async () => {
      await api?.cancelTask(sampleTask)
    })
    expect(store.setFeedbackText).toHaveBeenCalledWith("Cancelled task task-cancel-1")

    fetchMock.mockReset().mockResolvedValueOnce(responseOf({ detail: "cancel failed" }, false, 500))
    await act(async () => {
      await api?.cancelTask(sampleTask)
    })
    expect(store.setActionState).toHaveBeenCalledWith("error")

    fetchMock
      .mockReset()
      .mockResolvedValueOnce(responseOf({ ok: true }))
      .mockResolvedValueOnce(responseOf({ session_id: "session-1", start_url: "https://example.com", generated_at: "", source_event_count: 0, step_count: 0, steps: [] }))
      .mockResolvedValueOnce(responseOf({ flow: store.flowDraft }))
      .mockResolvedValueOnce(responseOf({ items: [{ step_id: "s1" }] }))
      .mockResolvedValueOnce(responseOf({ step_id: "s1", ok: true }))

    await act(async () => {
      await api?.saveFlowDraft()
    })
    expect(store.addLog).toHaveBeenCalledWith("success", "Flow draft saved successfully")

    store.flowDraft = null
    fetchMock.mockReset()
    await act(async () => {
      await api?.saveFlowDraft()
    })
    expect(store.pushNotice).toHaveBeenCalledWith("error", expect.stringContaining("Flow draft is empty"))
    store.flowDraft = {
      flow_id: "flow-1",
      session_id: "session-1",
      start_url: "https://example.com",
      generated_at: "2026-03-08T00:00:00Z",
      source_event_count: 2,
      steps: [{ step_id: "s1", action: "click", selected_selector_index: 0, target: { selectors: [] } }],
    }

    fetchMock
      .mockReset()
      .mockResolvedValueOnce(responseOf({ task: { task_id: "task-replay", command_id: "replay" } }))
      .mockResolvedValueOnce(responseOf({ tasks: [] }))
      .mockResolvedValueOnce(responseOf({ uptime_seconds: 1, task_total: 0, task_counts: {}, metrics: {} }))
      .mockResolvedValueOnce(responseOf({ state: "ok", failure_rate: 0, threshold: 0.2, completed: 0, failed: 0 }))
      .mockResolvedValueOnce(responseOf({ items: [{ step_id: "s1" }] }))
      .mockResolvedValueOnce(responseOf({ step_id: "s1", ok: true }))

    await act(async () => {
      await api?.replayLatestFlow()
    })
    expect(store.setSelectedTaskId).toHaveBeenCalledWith("task-replay")

    fetchMock.mockReset().mockResolvedValueOnce(responseOf({ detail: "replay failed" }, false, 500))
    await act(async () => {
      await api?.replayLatestFlow()
    })
    expect(store.pushNotice).toHaveBeenCalledWith("error", expect.stringContaining("Replay trigger failed"))

    fetchMock
      .mockReset()
      .mockResolvedValueOnce(responseOf({ task: { task_id: "task-step", command_id: "replay-step" } }))
      .mockResolvedValueOnce(responseOf({ tasks: [] }))
      .mockResolvedValueOnce(responseOf({ uptime_seconds: 1, task_total: 0, task_counts: {}, metrics: {} }))
      .mockResolvedValueOnce(responseOf({ state: "ok", failure_rate: 0, threshold: 0.2, completed: 0, failed: 0 }))
      .mockResolvedValueOnce(responseOf({ items: [{ step_id: "s1" }] }))
      .mockResolvedValueOnce(responseOf({ step_id: "s1", ok: true }))

    await act(async () => {
      await api?.replayStep("s1")
    })
    expect(store.setSelectedStepId).toHaveBeenCalledWith("s1")

    fetchMock
      .mockReset()
      .mockResolvedValueOnce(responseOf({ task: { task_id: "task-from-step", command_id: "resume-step" } }))
      .mockResolvedValueOnce(responseOf({ tasks: [] }))
      .mockResolvedValueOnce(responseOf({ uptime_seconds: 1, task_total: 0, task_counts: {}, metrics: {} }))
      .mockResolvedValueOnce(responseOf({ state: "ok", failure_rate: 0, threshold: 0.2, completed: 0, failed: 0 }))
      .mockResolvedValueOnce(responseOf({ items: [{ step_id: "s1" }] }))

    await act(async () => {
      await api?.replayFromStep("s1")
    })
    expect(store.addLog).toHaveBeenCalledWith(
      "success",
      expect.stringContaining("Triggered replay resume from step s1"),
      "resume-step"
    )

    fetchMock.mockReset().mockResolvedValueOnce(responseOf({ detail: "import failed" }, false, 500))
    await act(async () => {
      await api?.importLatestFlow()
    })
    expect(store.setStudioError).toHaveBeenCalled()

    store.studioSchemaRows = [
      {
        key: "level",
        type: "enum",
        required: true,
        description: "",
        enum_values: "A, B, ,C",
        pattern: "",
      },
      {
        key: "otp_rule",
        type: "regex",
        required: false,
        description: "otp rule",
        enum_values: "",
        pattern: "\\d{6}",
      },
    ]
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(responseOf({ template_id: "tpl-2" }))
      .mockResolvedValueOnce(responseOf({ flows: [{ flow_id: "flow-1" }] }))
      .mockResolvedValueOnce(responseOf({ templates: [{ template_id: "tpl-2" }] }))
      .mockResolvedValueOnce(responseOf({ runs: [{ run_id: "run-1" }] }))

    await act(async () => {
      await api?.createTemplate()
    })
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    const requestBody = JSON.parse(String(requestInit.body)) as {
      params_schema: Array<{ key: string; enum_values: string[]; pattern: string | null }>
    }
    expect(requestBody.params_schema[0]?.enum_values).toEqual(["A", "B", "C"])
    expect(requestBody.params_schema[0]?.pattern).toBeNull()
    expect(requestBody.params_schema[1]?.pattern).toBe("\\d{6}")

    fetchMock
      .mockReset()
      .mockResolvedValueOnce(responseOf({ detail: "studio fetch failed" }, false, 500))
    act(() => {
      api?.refreshStudio()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(store.setStudioError).toHaveBeenCalled()
  })

  it("covers studio validation failures and replay error branches", async function () {
    const store = createStore()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    store.selectedStudioFlowId = ""
    store.flowDraft = null
    await act(async () => {
      await api?.createTemplate()
    })
    expect(store.setStudioError).toHaveBeenCalledWith(expect.stringContaining("Select a flow first"))

    store.selectedStudioTemplateId = ""
    await act(async () => {
      await api?.updateTemplate()
    })
    expect(store.setStudioError).toHaveBeenCalledWith(expect.stringContaining("Select a template first"))

    const created = await api?.createRun()
    expect(created).toBe(false)
    expect(store.setStudioError).toHaveBeenCalledWith(expect.stringContaining("Select a template first"))

    fetchMock.mockReset().mockResolvedValueOnce(responseOf({ detail: "step failed" }, false, 500))
    await act(async () => {
      await api?.replayStep("s1")
    })
    expect(store.pushNotice).toHaveBeenCalledWith("error", expect.stringContaining("Step replay trigger failed"))

    fetchMock.mockReset().mockResolvedValueOnce(responseOf({ detail: "resume failed" }, false, 500))
    await act(async () => {
      await api?.replayFromStep("s1")
    })
    expect(store.pushNotice).toHaveBeenCalledWith(
      "error",
      expect.stringContaining("Resume from step trigger failed")
    )
  })

  it("covers createRun without run_id and submitRunOtp success for waiting_user input", async function () {
    const store = createStore()
    store.selectedStudioTemplateId = "tpl-1"
    store.studioOtpCode = "manual-input"
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    fetchMock
      .mockResolvedValueOnce(responseOf({ run: { status: "queued" } }))
      .mockResolvedValueOnce(responseOf({ flows: [] }))
      .mockResolvedValueOnce(responseOf({ templates: [] }))
      .mockResolvedValueOnce(responseOf({ runs: [] }))
      .mockResolvedValueOnce(responseOf({ tasks: [] }))

    const created = await api?.createRun()
    expect(created).toBe(true)
    expect(store.pushNotice).toHaveBeenCalledWith("success", "Run created successfully")

    fetchMock
      .mockReset()
      .mockResolvedValueOnce(responseOf({ run: { run_id: "run-input-1", status: "running" } }))
      .mockResolvedValueOnce(responseOf({ flows: [] }))
      .mockResolvedValueOnce(responseOf({ templates: [] }))
      .mockResolvedValueOnce(responseOf({ runs: [{ run_id: "run-input-1" }] }))
      .mockResolvedValueOnce(responseOf({ tasks: [] }))

    await act(async () => {
      await api?.submitRunOtp("run-input-1", "waiting_user", { reason_code: "manual_input_required" })
    })
    expect(store.pushNotice).toHaveBeenCalledWith("success", expect.stringContaining("additional input submitted"))
  })

  it("loads and saves profile-target studio documents", async function () {
    const store = createStore()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    fetchMock
      .mockResolvedValueOnce(
        responseOf({
          trusted_mode: true,
          profile_options: ["pr"],
          target_options: ["web.local"],
          selected_profile: "pr",
          selected_target: "web.local",
          profile: {
            kind: "profile",
            config_name: "pr",
            file_path: "configs/profiles/pr.yaml",
            editable_fields: [],
            readonly_fields: [],
            validation_summary: [],
          },
          target: {
            kind: "target",
            config_name: "web.local",
            file_path: "configs/targets/web.local.yaml",
            editable_fields: [],
            readonly_fields: [],
            validation_summary: [],
          },
        })
      )
      .mockResolvedValueOnce(
        responseOf({
          document: {
            kind: "profile",
            config_name: "pr",
            file_path: "configs/profiles/pr.yaml",
            editable_fields: [
              {
                path: "gates.consoleErrorMax",
                label: "Console error max",
                group: "Gates",
                field_type: "integer",
                value: 3,
                description: "Maximum allowed console errors.",
                min_value: 0,
                max_value: 1000000,
                enum_values: [],
              },
            ],
            readonly_fields: [],
            validation_summary: ["schema"],
          },
          saved: true,
          audit: ["schema-precheck:ok"],
        })
      )

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    await act(async () => {
      await api?.fetchProfileTargetStudio()
      await api?.saveConfigStudio("profile", "pr", { "gates.consoleErrorMax": 3 })
    })

    expect(store.setProfileStudioOptions).toHaveBeenCalledWith(["pr"])
    expect(store.setTargetStudioOptions).toHaveBeenCalledWith(["web.local"])
    expect(store.setProfileStudioDocument).toHaveBeenCalled()
    expect(store.pushNotice).toHaveBeenCalledWith("success", "Profile studio changes saved")
  })
})
