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
    statusText: ok ? "OK" : "Bad Request",
    headers: new Headers(),
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response
}

function responseWithRejectedJson(reason: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers(),
    json: vi.fn().mockRejectedValue(reason),
  } as unknown as Response
}

function createStore(
  overrides: Record<string, unknown> = {}
): AppStore & Record<string, unknown> {
  return {
    params: {
      baseUrl: "/gateway",
      startUrl: "https://example.com/register",
      successSelector: "#ok",
      modelName: "gemini-3-flash-preview",
      geminiApiKey: "gem-key",
      registerPassword: "secret",
      automationToken: "",
      automationClientId: "client-001",
      headless: false,
      midsceneStrict: false,
    },
    studioOtpCode: "",
    selectedStepId: "step-1",
    evidenceTimeline: [{ step_id: "step-1" }],
    flowDraft: {
      flow_id: "flow-1",
      session_id: "session-1",
      start_url: "https://example.com",
      generated_at: "2026-03-08T00:00:00Z",
      source_event_count: 1,
      steps: [{ step_id: "step-1", action: "click", selected_selector_index: 0, target: { selectors: [] } }],
    },
    reconstructionArtifacts: {
      session_dir: "/tmp/session",
      video_path: "video.mp4",
      har_path: "flow.har",
      html_path: "page.html",
    },
    reconstructionMode: "gemini",
    reconstructionStrategy: "balanced",
    reconstructionPreview: null,
    studioTemplateName: "",
    studioSchemaRows: [],
    studioDefaults: {},
    studioPolicies: {
      retries: 1,
      timeout_seconds: 120,
      otp: {
        required: false,
        provider: "manual",
        timeout_seconds: 90,
        regex: "\\d{6}",
        sender_filter: "",
        subject_filter: "",
      },
    },
    selectedStudioFlowId: "",
    selectedStudioTemplateId: "",
    selectedStudioRunId: "",
    studioRunParams: {},
    resumeWithPreconditions: false,
    statusFilter: "all",
    commandFilter: "",
    taskLimit: 20,
    setDiagnosticsError: vi.fn(),
    setDiagnostics: vi.fn(),
    setAlertError: vi.fn(),
    setAlerts: vi.fn(),
    setFlowError: vi.fn(),
    setLatestFlow: vi.fn(),
    setFlowDraft: vi.fn(),
    setSelectedStepId: vi.fn(),
    setStepEvidence: vi.fn(),
    setStepEvidenceError: vi.fn(),
    setEvidenceTimelineError: vi.fn(),
    setEvidenceTimeline: vi.fn(),
    setStudioError: vi.fn(),
    setStudioFlows: vi.fn(),
    setStudioTemplates: vi.fn(),
    setStudioRuns: vi.fn(),
    setSelectedStudioFlowId: vi.fn(),
    setSelectedStudioTemplateId: vi.fn(),
    setSelectedStudioRunId: vi.fn(),
    setProfileResolved: vi.fn(),
    setReconstructionPreview: vi.fn(),
    setReconstructionGenerated: vi.fn(),
    setReconstructionError: vi.fn(),
    setTasks: vi.fn(),
    setTaskState: vi.fn(),
    setTaskSyncError: vi.fn(),
    setSelectedTaskId: vi.fn(),
    setCommands: vi.fn(),
    setCommandState: vi.fn(),
    setSubmittingId: vi.fn(),
    setActionState: vi.fn(),
    setFeedbackText: vi.fn(),
    addLog: vi.fn(),
    pushNotice: vi.fn(),
    setParams: vi.fn(),
    ...overrides,
  } as unknown as AppStore & Record<string, unknown>
}

function createMutableStore(overrides: Record<string, unknown> = {}) {
  const store = createStore(overrides)
  const applyValue = <T,>(value: T | ((prev: T) => T), prev: T): T =>
    typeof value === "function" ? (value as (input: T) => T)(prev) : value

  store.setSelectedTaskId = vi.fn((next: string | ((prev: string) => string)) => {
    store.selectedTaskId = applyValue(next, String(store.selectedTaskId ?? ""))
  })
  store.setSelectedStepId = vi.fn((next: string | ((prev: string) => string)) => {
    store.selectedStepId = applyValue(next, String(store.selectedStepId ?? ""))
  })
  store.setSelectedStudioFlowId = vi.fn((next: string | ((prev: string) => string)) => {
    store.selectedStudioFlowId = applyValue(next, String(store.selectedStudioFlowId ?? ""))
  })
  store.setSelectedStudioTemplateId = vi.fn((next: string | ((prev: string) => string)) => {
    store.selectedStudioTemplateId = applyValue(next, String(store.selectedStudioTemplateId ?? ""))
  })
  store.setSelectedStudioRunId = vi.fn((next: string | ((prev: string) => string)) => {
    store.selectedStudioRunId = applyValue(next, String(store.selectedStudioRunId ?? ""))
  })
  store.setFlowDraft = vi.fn((next: unknown) => {
    store.flowDraft = next
  })
  store.setReconstructionPreview = vi.fn((next: unknown) => {
    store.reconstructionPreview = next
  })
  store.setReconstructionGenerated = vi.fn((next: unknown) => {
    store.reconstructionGenerated = next
  })
  store.setEvidenceTimeline = vi.fn((next: unknown[]) => {
    store.evidenceTimeline = next
  })
  store.setTasks = vi.fn((next: unknown[]) => {
    store.tasks = next
  })
  store.setParams = vi.fn((next: unknown) => {
    store.params =
      typeof next === "function"
        ? (next as (prev: Record<string, unknown>) => Record<string, unknown>)(store.params)
        : next
  })

  return store
}

describe("useApiClient error branches", () => {
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
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.restoreAllMocks()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  it("covers fetch and reconstruction failure branches with actionable errors", async function () {
    const store = createStore()
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("diagnostics offline"))
      .mockResolvedValueOnce(responseOf({ detail: "alerts degraded" }, false, 503))
      .mockResolvedValueOnce(responseOf({ detail: "preview failed" }, false, 500))
      .mockResolvedValueOnce(responseOf({ detail: "draft failed" }, false, 500))
      .mockResolvedValueOnce(responseOf({ flow: null }))
      .mockResolvedValueOnce(responseOf({ detail: "resolve failed" }, false, 500))
      .mockResolvedValueOnce(responseOf({ detail: "preview failed" }, false, 500))
      .mockResolvedValueOnce(responseOf({ detail: "orchestrate failed" }, false, 500))
    vi.stubGlobal("fetch", fetchMock)

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
      await api?.fetchLatestFlowDraft()
      await api?.resolveProfile()
      await api?.previewReconstruction()
      await api?.generateReconstruction()
      await api?.orchestrateFromArtifacts()
    })

    expect(store.setDiagnostics).toHaveBeenCalledWith(null)
    expect(store.setDiagnosticsError).toHaveBeenCalledWith(expect.stringContaining("Diagnostics failed"))
    expect(store.setAlertError).toHaveBeenCalledWith(expect.stringContaining("alerts degraded"))
    expect(store.setAlerts).toHaveBeenCalledWith(null)
    expect(store.setFlowError).toHaveBeenCalledWith(expect.stringContaining("Flow preview failed"))
    expect(store.setLatestFlow).toHaveBeenCalledWith(null)
    expect(store.setFlowDraft).toHaveBeenNthCalledWith(1, null)
    expect(store.setFlowDraft).toHaveBeenNthCalledWith(2, null)
    expect(store.setReconstructionError).toHaveBeenCalledWith(expect.stringContaining("Run Preview first"))
    expect(store.pushNotice).toHaveBeenCalledWith("error", expect.stringContaining("orchestrate failed"))
    expect(store.setProfileResolved).not.toHaveBeenCalled()
    expect(store.setReconstructionPreview).not.toHaveBeenCalled()
    expect(store.setReconstructionGenerated).not.toHaveBeenCalled()
  })

  it("covers action catch branches, early exits and schema filtering", async function () {
    const store = createStore({
      params: {
        baseUrl: "/gateway",
        startUrl: "",
        successSelector: "#ok",
        modelName: "",
        geminiApiKey: "",
        registerPassword: "",
        automationToken: "",
        automationClientId: "client-001",
        headless: false,
        midsceneStrict: false,
      },
      flowDraft: null,
      selectedStudioFlowId: "flow-keep",
      selectedStudioTemplateId: "tpl-keep",
      studioSchemaRows: [
        { key: "", type: "string", required: false, description: "", enum_values: "", pattern: "" },
        { key: "level", type: "enum", required: true, description: "", enum_values: "A, B, ,C", pattern: "" },
        { key: "rule", type: "regex", required: false, description: "", enum_values: "", pattern: "\\d{6}" },
      ],
      selectedStepId: "step-1",
      studioOtpCode: "",
    })
    const sampleTask = { task_id: "task-1", command_id: "cmd-1" }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(responseOf({ items: undefined }))
      .mockResolvedValueOnce(responseOf({ detail: "not found" }, false, 404))
      .mockRejectedValueOnce(new Error("run failed"))
      .mockRejectedValueOnce(new Error("cancel failed"))
      .mockRejectedValueOnce(new Error("replay latest failed"))
      .mockRejectedValueOnce(new Error("replay step failed"))
      .mockRejectedValueOnce(new Error("replay from step failed"))
      .mockResolvedValueOnce(responseOf({ template_id: "tpl-created" }))
      .mockResolvedValueOnce(responseOf({ flows: [] }))
      .mockResolvedValueOnce(responseOf({ templates: [] }))
      .mockResolvedValueOnce(responseOf({ runs: [] }))
      .mockResolvedValueOnce(responseOf({ template_id: "tpl-updated" }))
      .mockResolvedValueOnce(responseOf({ flows: [] }))
      .mockResolvedValueOnce(responseOf({ templates: [] }))
      .mockResolvedValueOnce(responseOf({ runs: [] }))
      .mockResolvedValueOnce(responseOf({}))
      .mockResolvedValueOnce(responseOf({ flows: [] }))
      .mockResolvedValueOnce(responseOf({ templates: [] }))
      .mockResolvedValueOnce(responseOf({ runs: [] }))
      .mockResolvedValueOnce(responseOf({ tasks: [] }))
      .mockResolvedValueOnce(responseOf({}))
      .mockResolvedValueOnce(responseOf({ flows: [] }))
      .mockResolvedValueOnce(responseOf({ templates: [] }))
      .mockResolvedValueOnce(responseOf({ runs: [] }))
      .mockResolvedValueOnce(responseOf({ tasks: [] }))
      .mockRejectedValueOnce("studio explode")
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    await act(async () => {
      await api?.fetchEvidenceTimeline()
      await api?.fetchStepEvidence("step-1")
      await api?.runCommand({ command_id: "cmd-1", title: "Cmd" } as never)
      await api?.cancelTask(sampleTask as never)
      await api?.replayLatestFlow()
      await api?.replayStep("step-1")
      await api?.replayFromStep("step-1")
      await api?.createTemplate()
      await api?.updateTemplate()
      await api?.createRun()
      await api?.submitRunOtp("run-1", "waiting_user", {
        reason_code: "provider_protected_payment_step",
      })
      api?.refreshStudio()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(store.setEvidenceTimeline).toHaveBeenCalledWith([])
    expect(store.setStepEvidence).toHaveBeenCalledWith(null)
    expect(store.setStepEvidenceError).toHaveBeenCalledWith("")
    expect(store.setFeedbackText).toHaveBeenCalledWith(expect.stringContaining("run failed"))
    expect(store.pushNotice).toHaveBeenCalledWith("error", expect.stringContaining("cancel failed"))
    expect(store.pushNotice).toHaveBeenCalledWith("error", expect.stringContaining("replay latest failed"))
    expect(store.pushNotice).toHaveBeenCalledWith("error", expect.stringContaining("replay step failed"))
    expect(store.pushNotice).toHaveBeenCalledWith("error", expect.stringContaining("replay from step failed"))
    expect(store.pushNotice).toHaveBeenCalledWith("success", "Template created successfully")
    expect(store.pushNotice).toHaveBeenCalledWith("success", "Template updated successfully")
    expect(store.pushNotice).toHaveBeenCalledWith("success", "Run created successfully")
    expect(store.pushNotice).toHaveBeenCalledWith("success", "continue action submitted and the run resumed")
    expect(store.setStudioError).toHaveBeenCalledWith(expect.stringContaining("studio explode"))

    const createTemplateCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/api/templates"))
    const createTemplateBody = JSON.parse(String(createTemplateCall?.[1]?.body)) as {
      params_schema: Array<{ key: string; enum_values: string[]; pattern: string | null }>
    }
    expect(createTemplateBody.params_schema).toEqual([
      { key: "level", type: "enum", required: true, description: null, enum_values: ["A", "B", "C"], pattern: null },
      { key: "rule", type: "regex", required: false, description: null, enum_values: [], pattern: "\\d{6}" },
    ])
  })

  it("covers non-Error fallback branches across command and studio actions", async function () {
    const store = createStore({
      params: {
        baseUrl: "/gateway",
        startUrl: "https://example.com/register",
        successSelector: "#ok",
        modelName: "gemini-3-flash-preview",
        geminiApiKey: undefined,
        registerPassword: "",
        automationToken: "",
        automationClientId: "client-001",
        headless: false,
        midsceneStrict: false,
      },
      selectedStudioFlowId: "",
      selectedStudioTemplateId: "tpl-non-error",
      studioSchemaRows: [
        {
          key: "regex_fallback",
          type: "regex",
          required: false,
          description: "",
          enum_values: "",
          pattern: "   ",
        },
      ],
      reconstructionPreview: { preview_id: "preview-1" },
      studioOtpCode: "123456",
    })
    const task = { task_id: "task-non-error", command_id: "cmd-non-error" }

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    const runWithJsonReject = async (
      action: () => Promise<unknown> | undefined,
      reason: unknown
    ) => {
      const fetchMock = vi.fn().mockResolvedValue(responseWithRejectedJson(reason))
      vi.stubGlobal("fetch", fetchMock)
      await act(async () => {
        await action()
      })
      return fetchMock
    }

    await runWithJsonReject(() => api?.fetchDiagnostics(), "diag-raw")
    await runWithJsonReject(() => api?.fetchAlerts(), "alerts-raw")
    await runWithJsonReject(() => api?.importLatestFlow(), "import-latest-raw")
    await runWithJsonReject(() => api?.resolveProfile(), "resolve-raw")
    await runWithJsonReject(() => api?.orchestrateFromArtifacts(), "orchestrate-raw")

    const runCommandFetch = await runWithJsonReject(
      () => api?.runCommand({ command_id: "cmd-run", title: "Run" } as never),
      "run-raw"
    )
    const runCommandBody = JSON.parse(
      String((runCommandFetch.mock.calls[0] as [string, RequestInit])[1].body)
    ) as { params: Record<string, string> }
    expect(runCommandBody.params).not.toHaveProperty("GEMINI_API_KEY")

    await runWithJsonReject(() => api?.cancelTask(task as never), "cancel-raw")
    await runWithJsonReject(() => api?.saveFlowDraft(), "save-flow-raw")
    await runWithJsonReject(() => api?.replayLatestFlow(), "replay-latest-raw")
    await runWithJsonReject(() => api?.replayStep("step-1"), "replay-step-raw")
    await runWithJsonReject(() => api?.replayFromStep("step-1"), "replay-from-step-raw")

    const createTemplateFetch = await runWithJsonReject(
      () => api?.createTemplate(),
      "create-template-raw"
    )
    const createTemplateBody = JSON.parse(
      String((createTemplateFetch.mock.calls[0] as [string, RequestInit])[1].body)
    ) as {
      flow_id: string
      params_schema: Array<{ key: string; pattern: string | null }>
    }
    expect(createTemplateBody.flow_id).toBe("flow-1")
    expect(createTemplateBody.params_schema).toMatchObject([
      { key: "regex_fallback", pattern: null },
    ])

    await runWithJsonReject(() => api?.updateTemplate(), "update-template-raw")
    await runWithJsonReject(() => api?.createRun(), "create-run-raw")
    await runWithJsonReject(
      () => api?.submitRunOtp("run-non-error", "waiting_otp"),
      "submit-otp-raw"
    )

    expect(store.setDiagnosticsError).toHaveBeenCalledWith(expect.stringContaining("Diagnostics failed"))
    expect(store.setAlertError).toHaveBeenCalledWith(expect.stringContaining("Alert refresh failed"))
    expect(store.setReconstructionError).toHaveBeenCalledWith(
      expect.stringContaining("Profile resolution failed")
    )
    expect(store.setFeedbackText).toHaveBeenCalledWith(
      expect.stringContaining("Command execution failed")
    )

    const errorNotices = store.pushNotice.mock.calls
      .filter((call) => call[0] === "error")
      .map((call) => String(call[1]))
    expect(errorNotices.some((message) => message.includes("Orchestration from artifacts failed"))).toBe(true)
    expect(errorNotices.some((message) => message.includes("Import latest flow failed"))).toBe(true)
    expect(errorNotices.some((message) => message.includes("Task cancel failed"))).toBe(true)
    expect(errorNotices.some((message) => message.includes("Flow draft save failed"))).toBe(true)
    expect(errorNotices.some((message) => message.includes("Replay trigger failed"))).toBe(true)
    expect(errorNotices.some((message) => message.includes("Step replay trigger failed"))).toBe(true)
    expect(errorNotices.some((message) => message.includes("Resume from step trigger failed"))).toBe(true)
    expect(errorNotices.some((message) => message.includes("Template creation failed"))).toBe(true)
    expect(errorNotices.some((message) => message.includes("Template update failed"))).toBe(true)
    expect(errorNotices.some((message) => message.includes("Run creation failed"))).toBe(true)
    expect(errorNotices.some((message) => message.includes("Submitting OTP failed"))).toBe(true)
  })

  it("covers success branches for action flows, replay flows and studio persistence", async function () {
    const store = createMutableStore({
      statusFilter: "running",
      commandFilter: " cmd-1 ",
      taskLimit: 5,
      selectedTaskId: "task-stale",
      selectedStepId: "step-1",
      selectedStudioFlowId: "",
      selectedStudioTemplateId: "tpl-1",
      studioTemplateName: "",
      studioOtpCode: "654321",
      studioRunParams: { email: "demo@example.com" },
      studioSchemaRows: [
        { key: "env", type: "enum", required: true, description: "  ", enum_values: "dev, prod", pattern: "" },
        { key: "otp", type: "regex", required: false, description: "", enum_values: "", pattern: "\\d{6}" },
      ],
    })

    const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? "GET"

      if (url.endsWith("/api/automation/commands")) {
        return Promise.resolve(responseOf({ commands: [{ command_id: "cmd-1" }] }))
      }
      if (url.includes("/api/automation/tasks?")) {
        return Promise.resolve(
          responseOf({ tasks: [{ task_id: "task-1", command_id: "cmd-1", status: "success" }] })
        )
      }
      if (url.endsWith("/health/diagnostics")) {
        return Promise.resolve(
          responseOf({ uptime_seconds: 1, task_total: 1, task_counts: {}, metrics: {} })
        )
      }
      if (url.endsWith("/health/alerts")) {
        return Promise.resolve(
          responseOf({ state: "ok", failure_rate: 0, threshold: 0.2, completed: 1, failed: 0 })
        )
      }
      if (url.endsWith("/api/command-tower/latest-flow")) {
        return Promise.resolve(
          responseOf({
            session_id: "session-1",
            start_url: "https://example.com",
            generated_at: "2026-03-08T00:00:00Z",
            source_event_count: 1,
            step_count: 1,
            steps: [],
          })
        )
      }
      if (url.endsWith("/api/command-tower/latest-flow-draft") && method === "PATCH") {
        return Promise.resolve(responseOf({}))
      }
      if (url.endsWith("/api/command-tower/latest-flow-draft")) {
        return Promise.resolve(
          responseOf({
            flow: {
              flow_id: "flow-1",
              session_id: "session-1",
              start_url: "https://example.com",
              steps: [
                {
                  step_id: "step-1",
                  action: "click",
                  selected_selector_index: 0,
                  target: { selectors: [] },
                },
              ],
            },
          })
        )
      }
      if (url.endsWith("/api/command-tower/evidence-timeline")) {
        return Promise.resolve(responseOf({ items: [{ step_id: "step-1" }] }))
      }
      if (url.includes("/api/command-tower/evidence?")) {
        return Promise.resolve(responseOf({ step_id: "step-1", ok: true }))
      }
      if (url.endsWith("/api/flows?limit=100")) {
        return Promise.resolve(responseOf({ flows: [{ flow_id: "flow-1" }] }))
      }
      if (url.endsWith("/api/templates?limit=100")) {
        return Promise.resolve(responseOf({ templates: [{ template_id: "tpl-1" }] }))
      }
      if (url.endsWith("/api/runs?limit=100")) {
        return Promise.resolve(responseOf({ runs: [{ run_id: "run-1" }] }))
      }
      if (url.endsWith("/api/profiles/resolve")) {
        return Promise.resolve(responseOf({ profile_id: "profile-1" }))
      }
      if (url.endsWith("/api/reconstruction/preview")) {
        return Promise.resolve(responseOf({ preview_id: "preview-1" }))
      }
      if (url.endsWith("/api/reconstruction/generate")) {
        return Promise.resolve(responseOf({ generated_id: "gen-1" }))
      }
      if (url.endsWith("/api/command-tower/orchestrate-from-artifacts")) {
        return Promise.resolve(responseOf({ accepted: true }))
      }
      if (url.endsWith("/api/automation/tasks/task-1/cancel")) {
        return Promise.resolve(responseOf({ ok: true }))
      }
      if (url.endsWith("/api/command-tower/replay-latest")) {
        return Promise.resolve(responseOf({ task: { task_id: "task-replay-1", command_id: "cmd-1" } }))
      }
      if (url.endsWith("/api/command-tower/replay-latest-step")) {
        return Promise.resolve(responseOf({ task: { task_id: "task-replay-2", command_id: "cmd-1" } }))
      }
      if (url.endsWith("/api/command-tower/replay-latest-from-step")) {
        return Promise.resolve(responseOf({ task: { task_id: "task-replay-3", command_id: "cmd-1" } }))
      }
      if (url.endsWith("/api/flows/import-latest")) {
        return Promise.resolve(responseOf({ imported: true }))
      }
      if (url.endsWith("/api/templates") && method === "POST") {
        return Promise.resolve(responseOf({ template_id: "tpl-created" }))
      }
      if (url.includes("/api/templates/") && method === "PATCH") {
        return Promise.resolve(responseOf({ template_id: "tpl-updated" }))
      }
      if (url.endsWith("/api/runs") && method === "POST") {
        return Promise.resolve(responseOf({ run_id: "run-created" }))
      }
      if (url.endsWith("/api/runs/run-submit/otp")) {
        return Promise.resolve(responseOf({ run_id: "run-submit" }))
      }
      return Promise.resolve(responseOf({}))
    })
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    await act(async () => {
      await api?.fetchCommands()
      await api?.fetchTasks()
      store.selectedTaskId = ""
      await api?.fetchTasks({ background: true })
      await api?.resolveProfile()
      await api?.previewReconstruction()
      await api?.generateReconstruction()
      await api?.orchestrateFromArtifacts()
      await api?.cancelTask({ task_id: "task-1", command_id: "cmd-1" } as never)
      await api?.saveFlowDraft()
      await api?.replayLatestFlow()
      await api?.replayStep("step-1")
      await api?.replayFromStep("step-1")
      await api?.importLatestFlow()
      await api?.createTemplate()
      await api?.updateTemplate()
      await api?.createRun()
      await api?.submitRunOtp("run-submit", "waiting_otp")
    })

    expect(store.setCommandState).toHaveBeenCalledWith("success")
    expect(store.setTaskState).toHaveBeenCalledWith("success")
    expect(store.setProfileResolved).toHaveBeenCalledWith({ profile_id: "profile-1" })
    expect(store.setReconstructionPreview).toHaveBeenCalledWith({ preview_id: "preview-1" })
    expect(store.setReconstructionGenerated).toHaveBeenCalledWith({ generated_id: "gen-1" })
    expect(store.pushNotice).toHaveBeenCalledWith("success", "Artifacts orchestration completed")
    expect(store.pushNotice).toHaveBeenCalledWith("warn", "Cancelled task task-1")
    expect(store.pushNotice).toHaveBeenCalledWith("success", "Flow replay triggered")
    expect(store.pushNotice).toHaveBeenCalledWith("success", "Step replay triggered for step-1")
    expect(store.pushNotice).toHaveBeenCalledWith("success", "Resume from step step-1 triggered")
    expect(store.pushNotice).toHaveBeenCalledWith("success", "Imported the latest flow")
    expect(store.pushNotice).toHaveBeenCalledWith("success", "Template created successfully")
    expect(store.pushNotice).toHaveBeenCalledWith("success", "Template updated successfully")
    expect(store.pushNotice).toHaveBeenCalledWith("success", "Run created successfully")
    expect(store.pushNotice).toHaveBeenCalledWith("success", "OTP submitted and the run resumed")
    expect(store.setSelectedStudioRunId).toHaveBeenCalledWith("run-submit")
    expect(store.setStepEvidence).toHaveBeenCalledWith({ step_id: "step-1", ok: true })

    const taskQueryCalls = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes("/api/automation/tasks?"))
    expect(taskQueryCalls.some((url) => url.includes("status=running"))).toBe(true)
    expect(taskQueryCalls.some((url) => url.includes("command_id=cmd-1"))).toBe(true)
  })

  it("covers successful reconstruction/createRun branches and refreshStudio error fallback", async function () {
    const store = createStore({
      reconstructionPreview: { preview_id: "preview-success" },
      selectedStudioTemplateId: "tpl-success",
      studioRunParams: { email: "demo@example.com" },
      studioOtpCode: "",
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(responseOf({ generated_id: "gen-1" }))
      .mockResolvedValueOnce(responseOf({ flows: [] }))
      .mockResolvedValueOnce(responseOf({ templates: [] }))
      .mockResolvedValueOnce(responseOf({ runs: [] }))
      .mockResolvedValueOnce(responseOf({ run_id: "run-success" }))
      .mockResolvedValueOnce(responseOf({ flows: [] }))
      .mockResolvedValueOnce(responseOf({ templates: [] }))
      .mockResolvedValueOnce(responseOf({ runs: [] }))
      .mockResolvedValueOnce(responseOf({ tasks: [] }))
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    await act(async () => {
      await api?.generateReconstruction()
    })
    let runCreated: boolean | undefined
    await act(async () => {
      runCreated = await api?.createRun()
    })

    const generateBody = JSON.parse(
      String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)
    ) as { template_name: string }
    expect(generateBody.template_name).toBe("reconstructed-template")
    expect(runCreated).toBe(true)
    expect(store.setSelectedStudioRunId).toHaveBeenCalledWith("run-success")

    const refreshFetch = vi
      .fn()
      .mockResolvedValueOnce(responseOf({ detail: "flow failed" }, false, 500))
      .mockResolvedValueOnce(responseOf({ templates: [] }))
      .mockResolvedValueOnce(responseOf({ runs: [] }))
    vi.stubGlobal("fetch", refreshFetch)

    await act(async () => {
      api?.refreshStudio()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(store.setStudioError).toHaveBeenCalledWith(
      expect.stringContaining("Universal Studio data loading failed")
    )
  })

  it("covers importLatestFlow success path", async function () {
    const store = createStore()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(responseOf({ imported: true }))
      .mockResolvedValueOnce(responseOf({ flows: [] }))
      .mockResolvedValueOnce(responseOf({ templates: [] }))
      .mockResolvedValueOnce(responseOf({ runs: [] }))
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    await act(async () => {
      await api?.importLatestFlow()
    })

    expect(store.pushNotice).toHaveBeenCalledWith("success", "Imported the latest flow")
  })

  it("covers studio selection callbacks, guard branches, and non-Error fallbacks", async function () {
    let selectedFlowId = ""
    let selectedTemplateId = ""
    let selectedRunId = ""
    const store = createStore({
      flowDraft: null,
      selectedStudioFlowId: "",
      selectedStudioTemplateId: "",
      setSelectedStudioFlowId: vi.fn((next: string | ((prev: string) => string)) => {
        selectedFlowId = typeof next === "function" ? next(selectedFlowId) : next
      }),
      setSelectedStudioTemplateId: vi.fn((next: string | ((prev: string) => string)) => {
        selectedTemplateId = typeof next === "function" ? next(selectedTemplateId) : next
      }),
      setSelectedStudioRunId: vi.fn((next: string | ((prev: string) => string)) => {
        selectedRunId = typeof next === "function" ? next(selectedRunId) : next
      }),
    })

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    const fetchStudioDataMock = vi
      .fn()
      .mockResolvedValueOnce(responseOf({ flows: [{ flow_id: "flow-a" }] }))
      .mockResolvedValueOnce(responseOf({ templates: [{ template_id: "tpl-a" }] }))
      .mockResolvedValueOnce(responseOf({ runs: [{ run_id: "run-a" }] }))
      .mockResolvedValueOnce(responseOf({ flows: [] }))
      .mockResolvedValueOnce(responseOf({ templates: [] }))
      .mockResolvedValueOnce(responseOf({ runs: [] }))
    vi.stubGlobal("fetch", fetchStudioDataMock)
    await act(async () => {
      await api?.fetchStudioData()
      await api?.fetchStudioData()
    })

    expect(selectedFlowId).toBe("flow-a")
    expect(selectedTemplateId).toBe("tpl-a")
    expect(selectedRunId).toBe("run-a")

    const stepEvidenceFetch = vi.fn().mockRejectedValue("step-raw-error")
    vi.stubGlobal("fetch", stepEvidenceFetch)
    store.evidenceTimeline = [{ step_id: "step-raw" }]
    await act(async () => {
      await api?.fetchStepEvidence("step-raw")
    })
    expect(store.setStepEvidenceError).toHaveBeenCalledWith(
      expect.stringContaining("Issue: step-raw-error")
    )

    await act(async () => {
      await api?.createTemplate()
      await api?.updateTemplate()
      await api?.createRun()
      await api?.saveFlowDraft()
    })

    const errorNotices = store.pushNotice.mock.calls
      .filter((call) => call[0] === "error")
      .map((call) => String(call[1]))
    expect(errorNotices.some((message) => message.includes("Select a flow first"))).toBe(true)
    expect(errorNotices.some((message) => message.includes("Select a template first"))).toBe(true)
    expect(errorNotices.some((message) => message.includes("Flow draft is empty"))).toBe(true)

    store.setSelectedStudioFlowId = vi.fn(() => {
      throw "raw-refresh-failure"
    })
    const refreshFetch = vi
      .fn()
      .mockResolvedValueOnce(responseOf({ flows: [{ flow_id: "flow-1" }] }))
      .mockResolvedValueOnce(responseOf({ templates: [] }))
      .mockResolvedValueOnce(responseOf({ runs: [] }))
    vi.stubGlobal("fetch", refreshFetch)

    await act(async () => {
      api?.refreshStudio()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(store.setStudioError).toHaveBeenCalledWith(
      expect.stringContaining("Universal Studio refresh failed")
    )
  })
})
