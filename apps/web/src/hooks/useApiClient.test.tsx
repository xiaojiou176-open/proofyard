/* @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, it as caseIt, describe, expect, vi } from "vitest"
import { buildApiUrl, useApiClient } from "./useApiClient"
import type { AppStore } from "./useAppStore"

type StoreStub = {
  params: {
    baseUrl: string
    automationToken: string
    automationClientId: string
  }
  studioOtpCode: string
  evidenceTimeline: Array<{ step_id: string }>
  setCommands: ReturnType<typeof vi.fn>
  setCommandState: ReturnType<typeof vi.fn>
  setTaskState: ReturnType<typeof vi.fn>
  setTaskSyncError: ReturnType<typeof vi.fn>
  setTasks: ReturnType<typeof vi.fn>
  setSelectedTaskId: ReturnType<typeof vi.fn>
  setStepEvidence: ReturnType<typeof vi.fn>
  setStepEvidenceError: ReturnType<typeof vi.fn>
  setEvidenceTimeline: ReturnType<typeof vi.fn>
  setEvidenceTimelineError: ReturnType<typeof vi.fn>
  setDiagnostics: ReturnType<typeof vi.fn>
  setDiagnosticsError: ReturnType<typeof vi.fn>
  setAlerts: ReturnType<typeof vi.fn>
  setAlertError: ReturnType<typeof vi.fn>
  setFlowError: ReturnType<typeof vi.fn>
  setLatestFlow: ReturnType<typeof vi.fn>
  setFlowDraft: ReturnType<typeof vi.fn>
  setSelectedStepId: ReturnType<typeof vi.fn>
  setStudioError: ReturnType<typeof vi.fn>
  setSubmittingId: ReturnType<typeof vi.fn>
  setActionState: ReturnType<typeof vi.fn>
  setFeedbackText: ReturnType<typeof vi.fn>
  addLog: ReturnType<typeof vi.fn>
  pushNotice: ReturnType<typeof vi.fn>
  statusFilter: string
  commandFilter: string
  taskLimit: number
}

function createStore(baseUrl: string): AppStore & StoreStub {
  return {
    params: { baseUrl, automationToken: "", automationClientId: "client-001" },
    studioOtpCode: "",
    evidenceTimeline: [],
    setCommands: vi.fn(),
    setCommandState: vi.fn(),
    setTaskState: vi.fn(),
    setTaskSyncError: vi.fn(),
    setTasks: vi.fn(),
    setSelectedTaskId: vi.fn(),
    setStepEvidence: vi.fn(),
    setStepEvidenceError: vi.fn(),
    setEvidenceTimeline: vi.fn(),
    setEvidenceTimelineError: vi.fn(),
    setDiagnostics: vi.fn(),
    setDiagnosticsError: vi.fn(),
    setAlerts: vi.fn(),
    setAlertError: vi.fn(),
    setFlowError: vi.fn(),
    setLatestFlow: vi.fn(),
    setFlowDraft: vi.fn(),
    setSelectedStepId: vi.fn(),
    setStudioError: vi.fn(),
    setSubmittingId: vi.fn(),
    setActionState: vi.fn(),
    setFeedbackText: vi.fn(),
    addLog: vi.fn(),
    pushNotice: vi.fn(),
    statusFilter: "all",
    commandFilter: "",
    taskLimit: 100,
  } as unknown as AppStore & StoreStub
}

function createSuccessResponse() {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({ commands: [] }),
  } as unknown as Response
}

function createErrorResponse(status = 400, detail = "invalid request") {
  return {
    ok: false,
    status,
    statusText: "Bad Request",
    headers: new Headers(),
    json: vi.fn().mockResolvedValue({ detail }),
  } as unknown as Response
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("useApiClient baseUrl routing", () => {
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

  caseIt("builds absolute API URL when baseUrl is absolute", () => {
    expect(buildApiUrl("http://127.0.0.1:8000", "/api/automation/commands")).toBe(
      "http://127.0.0.1:8000/api/automation/commands"
    )
  })

  caseIt("supports root-relative base path for API proxy prefix", () => {
    expect(buildApiUrl("/gateway", "/api/automation/commands")).toBe(
      "/gateway/api/automation/commands"
    )
  })

  caseIt("falls back to relative API path when baseUrl is not absolute", () => {
    expect(buildApiUrl("backend.local", "/api/automation/commands")).toBe(
      "/api/automation/commands"
    )
  })

  caseIt("uses resolved baseUrl when fetching commands", async () => {
    const store = createStore("/gateway")
    const fetchMock = vi.fn().mockResolvedValue(createSuccessResponse())
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
    })

    expect(fetchMock).toHaveBeenCalledWith("/gateway/api/automation/commands", { headers: {} })
    expect(store.setCommands).toHaveBeenCalledWith([])
    expect(store.setCommandState).toHaveBeenCalledWith("empty")
  })

  caseIt("marks command state as success when command list is non-empty", async () => {
    const store = createStore("/gateway")
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        commands: [{ command_id: "cmd-success", title: "Run", description: "", tags: [] }],
      }),
    } as unknown as Response)
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
    })

    expect(store.setCommandState).toHaveBeenCalledWith("success")
  })

  caseIt("includes token and client id headers when automationToken exists", async () => {
    const store = createStore("/gateway")
    store.params.automationToken = "token-123"
    store.params.automationClientId = "client-xyz"
    const fetchMock = vi.fn().mockResolvedValue(createSuccessResponse())
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
    })

    expect(fetchMock).toHaveBeenCalledWith("/gateway/api/automation/commands", {
      headers: {
        "x-automation-token": "token-123",
        "x-automation-client-id": "client-xyz",
      },
    })
  })

  caseIt("sends GEMINI_API_KEY and never sends OPENAI_API_KEY in run params", async () => {
    const store = {
      params: {
        baseUrl: "/gateway",
        startUrl: "",
        successSelector: "#ok",
        modelName: "gemini-3.1-pro-preview",
        geminiApiKey: "gemini-key-123",
        registerPassword: "",
        automationToken: "",
        automationClientId: "client-001",
        headless: false,
        midsceneStrict: false,
      },
      setSubmittingId: vi.fn(),
      setActionState: vi.fn(),
      addLog: vi.fn(),
      setFeedbackText: vi.fn(),
      pushNotice: vi.fn(),
    } as unknown as AppStore
    const fetchMock = vi.fn().mockResolvedValue(createErrorResponse(400, "invalid request"))
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    await act(async () => {
      await api?.runCommand({ command_id: "cmd-gemini", title: "Gemini 运行" } as never)
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    const requestBody = JSON.parse(String(requestInit.body)) as { params: Record<string, string> }
    expect(requestBody.params.GEMINI_API_KEY).toBe("gemini-key-123")
    expect(requestBody.params).not.toHaveProperty("OPENAI_API_KEY")
  })

  caseIt("does not request evidence when step is missing in evidenceTimeline", async () => {
    const store = createStore("/gateway")
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    await act(async () => {
      await api?.fetchStepEvidence("s-not-in-timeline")
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.setStepEvidence).toHaveBeenCalledWith(null)
    expect(store.setStepEvidenceError).toHaveBeenCalledWith("")
  })

  caseIt("submits empty otp_code when waiting_user is provider protected", async () => {
    const store = createStore("/gateway")
    store.studioOtpCode = "   "
    const fetchMock = vi.fn().mockResolvedValue(createErrorResponse(400, "still waiting"))
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    await act(async () => {
      await api?.submitRunOtp("run-provider-protected", "waiting_user", {
        reason_code: "provider_protected_payment_step",
      })
    })

    expect(fetchMock).toHaveBeenCalledWith("/gateway/api/runs/run-provider-protected/otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otp_code: "" }),
    })
  })

  caseIt("keeps non-provider waiting_user empty input blocked before request", async () => {
    const store = createStore("/gateway")
    store.studioOtpCode = "   "
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    await act(async () => {
      await api?.submitRunOtp("run-waiting-user", "waiting_user", {
        reason_code: "manual_input_required",
      })
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.setStudioError).toHaveBeenCalled()
  })

  caseIt("keeps waiting_otp empty input blocked before request", async () => {
    const store = createStore("/gateway")
    store.studioOtpCode = "   "
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    await act(async () => {
      await api?.submitRunOtp("run-waiting-otp", "waiting_otp")
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.setStudioError).toHaveBeenCalled()
  })

  caseIt("sets actionable evidence timeline error when fetch fails", async () => {
    const store = createStore("/gateway")
    const fetchMock = vi.fn().mockResolvedValue(createErrorResponse(503, "service unavailable"))
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
    })

    expect(store.setEvidenceTimeline).toHaveBeenCalledWith([])
    expect(store.setEvidenceTimelineError).toHaveBeenCalledTimes(1)
    const [message] = store.setEvidenceTimelineError.mock.calls[0] as [string]
    expect(message).toContain("Issue:")
    expect(message).toContain("Suggested action:")
    expect(message).toContain("Troubleshooting:")
    expect(message).toContain("\n")
  })

  caseIt("ignores stale fetchTasks failure when newer request already completed", async () => {
    const store = createStore("/gateway")
    const deferred = createDeferred<Response>()
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => deferred.promise)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ tasks: [{ task_id: "task-latest" }] }),
      } as unknown as Response)
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    let staleRequest: Promise<void> = Promise.resolve()
    await act(async () => {
      staleRequest = api!.fetchTasks()
      await api!.fetchTasks()
    })

    deferred.reject(new Error("stale failure"))
    await expect(staleRequest).resolves.toBeUndefined()
    expect(store.setTaskState).toHaveBeenCalledWith("success")
    expect(store.setTaskState).not.toHaveBeenCalledWith("error")
  })

  caseIt("ignores stale fetchTasks success payload after a newer request has completed", async () => {
    const store = createStore("/gateway")
    const deferred = createDeferred<Response>()
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => deferred.promise)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ tasks: [{ task_id: "task-new" }] }),
      } as unknown as Response)
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    let staleRequest: Promise<void> = Promise.resolve()
    await act(async () => {
      staleRequest = api!.fetchTasks()
      await api!.fetchTasks()
    })

    deferred.resolve({
      ok: true,
      json: vi.fn().mockResolvedValue({ tasks: [{ task_id: "task-stale" }] }),
    } as unknown as Response)

    await staleRequest
    expect(store.setTasks).toHaveBeenCalledWith([{ task_id: "task-new" }])
    expect(store.setTasks).not.toHaveBeenCalledWith([{ task_id: "task-stale" }])
  })

  caseIt("invalidates stale step evidence response when selection is cleared", async () => {
    const store = createStore("/gateway")
    store.evidenceTimeline = [
      {
        step_id: "s1",
        action: "click",
        ok: true,
        detail: null,
        duration_ms: 1,
        matched_selector: null,
        selector_index: null,
        screenshot_before_path: null,
        screenshot_after_path: null,
        screenshot_before_data_url: null,
        screenshot_after_data_url: null,
        fallback_trail: [],
      },
    ]
    const deferred = createDeferred<Response>()
    const fetchMock = vi.fn().mockImplementationOnce(() => deferred.promise)
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    let firstRequest: Promise<void> = Promise.resolve()
    await act(async () => {
      firstRequest = api!.fetchStepEvidence("s1")
      await api!.fetchStepEvidence("")
    })

    deferred.resolve({
      ok: true,
      json: vi.fn().mockResolvedValue({ step_id: "s1", event_count: 1 }),
    } as unknown as Response)
    await firstRequest
    expect(store.setStepEvidence).not.toHaveBeenCalledWith(
      expect.objectContaining({ step_id: "s1" })
    )
  })

  caseIt("ignores stale step evidence payload after response body resolves", async () => {
    const store = createStore("/gateway")
    store.evidenceTimeline = [{ step_id: "s-json-stale" }]
    const deferredPayload = createDeferred<unknown>()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockImplementation(() => deferredPayload.promise),
    } as unknown as Response)
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    let firstRequest: Promise<void> = Promise.resolve()
    await act(async () => {
      firstRequest = api!.fetchStepEvidence("s-json-stale")
      await api!.fetchStepEvidence("")
    })

    deferredPayload.resolve({ step_id: "s-json-stale", ok: true })
    await firstRequest

    expect(store.setStepEvidence).not.toHaveBeenCalledWith(
      expect.objectContaining({ step_id: "s-json-stale" })
    )
  })

  caseIt("ignores stale step evidence transport error when request sequence has moved on", async () => {
    const store = createStore("/gateway")
    store.evidenceTimeline = [{ step_id: "s-error-stale" }]
    const deferredPayload = createDeferred<unknown>()
    void deferredPayload.promise.catch(() => undefined)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockImplementation(() => deferredPayload.promise),
    } as unknown as Response)
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    let firstRequest: Promise<void> = Promise.resolve()
    await act(async () => {
      firstRequest = api!.fetchStepEvidence("s-error-stale")
      await api!.fetchStepEvidence("")
    })

    await act(async () => {
      deferredPayload.reject(new Error("stale-step-error"))
      await firstRequest
    })

    expect(store.setStepEvidenceError).toHaveBeenCalledWith("")
    const actionableErrorCalls = store.setStepEvidenceError.mock.calls.filter(
      (call) => typeof call[0] === "string" && String(call[0]).includes("Issue:")
    )
    expect(actionableErrorCalls).toHaveLength(0)
  })

  caseIt("keeps submittingId when stale run request settles before active one", async () => {
    const deferredFirst = createDeferred<Response>()
    const deferredSecond = createDeferred<Response>()
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => deferredFirst.promise)
      .mockImplementationOnce(() => deferredSecond.promise)
    vi.stubGlobal("fetch", fetchMock)

    let currentSubmittingId = ""
    const setSubmittingId = vi.fn((next: string | ((prev: string) => string)) => {
      currentSubmittingId = typeof next === "function" ? next(currentSubmittingId) : next
    })

    const store = {
      ...createStore("/gateway"),
      params: {
        baseUrl: "/gateway",
        startUrl: "",
        successSelector: "#ok",
        modelName: "gemini-3.1-pro-preview",
        geminiApiKey: "",
        registerPassword: "",
        automationToken: "",
        automationClientId: "client-001",
        headless: false,
        midsceneStrict: false,
      },
      setSubmittingId,
    } as unknown as AppStore

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    const cmd = { command_id: "run-ui", title: "Run UI", description: "", tags: [] } as never
    const first = api!.runCommand(cmd)
    const second = api!.runCommand(cmd)
    expect(currentSubmittingId).toBe("run-ui")

    deferredFirst.resolve(createErrorResponse(400, "first failed"))
    await first
    expect(currentSubmittingId).toBe("run-ui")

    deferredSecond.resolve(createErrorResponse(400, "second failed"))
    await second
    expect(currentSubmittingId).toBe("")
  })

  caseIt("sets diagnostics error when diagnostics response is non-ok", async () => {
    const store = createStore("/gateway")
    const fetchMock = vi.fn().mockResolvedValue(createErrorResponse(502, "gateway unavailable"))
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
    })

    expect(store.setDiagnostics).toHaveBeenCalledWith(null)
    expect(store.setDiagnosticsError).toHaveBeenCalledTimes(1)
    const [message] = store.setDiagnosticsError.mock.calls[0] as [string]
    expect(message).toContain("Diagnostics failed")
    expect(message).toContain("Suggested action:")
  })

  caseIt("sets alert error when alerts request throws transport exception", async () => {
    const store = createStore("/gateway")
    const fetchMock = vi.fn().mockRejectedValue(new Error("socket hang up"))
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    await act(async () => {
      await api?.fetchAlerts()
    })

    expect(store.setAlerts).toHaveBeenCalledWith(null)
    expect(store.setAlertError).toHaveBeenCalledTimes(1)
    const [message] = store.setAlertError.mock.calls[0] as [string]
    expect(message).toContain("Alert refresh failed")
    expect(message).toContain("Troubleshooting:")
  })

  caseIt("sets flowDraft null when latest draft payload misses required shape", async () => {
    const store = createStore("/gateway")
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ flow: { steps: [] } }),
    } as unknown as Response)
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    await act(async () => {
      await api?.fetchLatestFlowDraft()
    })

    expect(store.setFlowError).toHaveBeenCalledWith("")
    expect(store.setFlowDraft).toHaveBeenCalledWith(null)
  })

  caseIt("clears step evidence silently on 404 response", async () => {
    const store = createStore("/gateway")
    store.evidenceTimeline = [{ step_id: "step-404" }]
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: new Headers(),
      json: vi.fn().mockResolvedValue({ detail: "missing step" }),
    } as unknown as Response)
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    await act(async () => {
      await api?.fetchStepEvidence("step-404")
    })

    expect(store.setStepEvidence).toHaveBeenCalledWith(null)
    expect(store.setStepEvidenceError).toHaveBeenCalledWith("")
  })

  caseIt("updates selected task id via fetchTasks callback semantics", async () => {
    const store = createStore("/gateway")
    let selectedTaskId = "task-stale"
    store.setSelectedTaskId = vi.fn(
      (next: string | ((prev: string) => string)) =>
        (selectedTaskId = typeof next === "function" ? next(selectedTaskId) : next)
    )
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ tasks: [{ task_id: "task-1" }] }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ tasks: [{ task_id: "task-2" }] }),
      } as unknown as Response)
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    await act(async () => {
      await api?.fetchTasks()
    })
    expect(selectedTaskId).toBe("")

    selectedTaskId = ""
    await act(async () => {
      await api?.fetchTasks()
    })
    expect(selectedTaskId).toBe("task-2")
  })

  caseIt("keeps or resets selectedStepId when draft steps change", async () => {
    const store = createStore("/gateway")
    let selectedStepId = "missing-step"
    store.setSelectedStepId = vi.fn(
      (next: string | ((prev: string) => string)) =>
        (selectedStepId = typeof next === "function" ? next(selectedStepId) : next)
    )

    const validFlowDraft = {
      flow: {
        start_url: "https://example.com",
        steps: [
          {
            step_id: "s1",
            action: "click",
            selected_selector_index: 0,
            target: { selectors: [] },
          },
        ],
      },
    }

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(validFlowDraft),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(validFlowDraft),
      } as unknown as Response)
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    await act(async () => {
      await api?.fetchLatestFlowDraft()
    })
    expect(selectedStepId).toBe("s1")

    selectedStepId = "s1"
    await act(async () => {
      await api?.fetchLatestFlowDraft()
    })
    expect(selectedStepId).toBe("s1")
  })

  caseIt("sets selectedStepId to empty when draft has no steps", async () => {
    const store = createStore("/gateway")
    let selectedStepId = "stale-step"
    store.setSelectedStepId = vi.fn(
      (next: string | ((prev: string) => string)) =>
        (selectedStepId = typeof next === "function" ? next(selectedStepId) : next)
    )
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        flow: {
          start_url: "https://example.com",
          steps: [],
        },
      }),
    } as unknown as Response)
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    await act(async () => {
      await api?.fetchLatestFlowDraft()
    })

    expect(selectedStepId).toBe("")
  })

  caseIt("runs command success flow and clears register password", async () => {
    let paramsState = {
      baseUrl: "/gateway",
      startUrl: "https://example.com/register",
      successSelector: "#ok",
      modelName: "models/gemini-3.1-pro-preview",
      geminiApiKey: "gemini-key-001",
      registerPassword: "secret-123",
      automationToken: "",
      automationClientId: "client-001",
      headless: false,
      midsceneStrict: false,
    }
    const store = {
      ...createStore("/gateway"),
      params: paramsState,
      setParams: vi.fn(
        (
          next:
            | typeof paramsState
            | ((prev: typeof paramsState) => typeof paramsState)
        ) => {
          paramsState = typeof next === "function" ? next(paramsState) : next
        }
      ),
    } as unknown as AppStore & StoreStub & {
      setParams: ReturnType<typeof vi.fn>
    }

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ task: { task_id: "task-success-1", command_id: "run-ui" } }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ tasks: [] }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ uptime_seconds: 1, task_total: 0, task_counts: {}, metrics: {} }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ state: "ok", failure_rate: 0, threshold: 0.2, completed: 0, failed: 0 }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ session_id: "session-1", start_url: "https://example.com", generated_at: "", source_event_count: 0, step_count: 0, steps: [] }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          flow: {
            start_url: "https://example.com",
            steps: [{ step_id: "s1", action: "click", selected_selector_index: 0, target: { selectors: [] } }],
          },
        }),
      } as unknown as Response)
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    const ok = await api?.runCommand({
      command_id: "run-ui",
      title: "运行 UI",
      description: "",
      tags: [],
    } as never)

    expect(ok).toBe(true)
    expect(store.setActionState).toHaveBeenCalledWith("success")
    expect(store.pushNotice).toHaveBeenCalledWith("success", "Submitted 运行 UI")
    expect(paramsState.registerPassword).toBe("")
  })

  caseIt("marks foreground fetchTasks as error when request fails", async () => {
    const store = createStore("/gateway")
    const fetchMock = vi.fn().mockResolvedValue(createErrorResponse(500, "tasks failed"))
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    await expect(api?.fetchTasks()).rejects.toThrow("Run list loading failed")
    expect(store.setTaskState).toHaveBeenCalledWith("loading")
    expect(store.setTaskState).toHaveBeenCalledWith("error")
  })

  caseIt("keeps selected task id when latest tasks still contain current selection", async () => {
    const store = createStore("/gateway")
    let selectedTaskId = "task-keep"
    store.setSelectedTaskId = vi.fn(
      (next: string | ((prev: string) => string)) =>
        (selectedTaskId = typeof next === "function" ? next(selectedTaskId) : next)
    )
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ tasks: [{ task_id: "task-keep" }] }),
    } as unknown as Response)
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    await act(async () => {
      await api?.fetchTasks()
    })

    expect(selectedTaskId).toBe("task-keep")
  })

  caseIt("sets flow error when latest flow request is non-ok", async () => {
    const store = createStore("/gateway")
    const fetchMock = vi.fn().mockResolvedValue(createErrorResponse(503, "flow unavailable"))
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    await act(async () => {
      await api?.fetchLatestFlow()
    })

    expect(store.setLatestFlow).toHaveBeenCalledWith(null)
    expect(store.setFlowError).toHaveBeenCalledTimes(1)
    const [message] = store.setFlowError.mock.calls[0] as [string]
    expect(message).toContain("Flow preview failed")
  })

  caseIt("sets step evidence actionable error when non-404 response returns", async () => {
    const store = createStore("/gateway")
    store.evidenceTimeline = [{ step_id: "step-error" }]
    const fetchMock = vi.fn().mockResolvedValue(createErrorResponse(500, "evidence failed"))
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    await act(async () => {
      await api?.fetchStepEvidence("step-error")
    })

    expect(store.setStepEvidence).toHaveBeenCalledWith(null)
    expect(store.setStepEvidenceError).toHaveBeenCalledTimes(1)
    const [message] = store.setStepEvidenceError.mock.calls[0] as [string]
    expect(message).toContain("Step evidence loading failed")
  })

  caseIt("handles step evidence transport failure with actionable message", async () => {
    const store = createStore("/gateway")
    store.evidenceTimeline = [{ step_id: "step-transport" }]
    const fetchMock = vi.fn().mockRejectedValue(new Error("socket closed"))
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    await act(async () => {
      await api?.fetchStepEvidence("step-transport")
    })

    expect(store.setStepEvidence).toHaveBeenCalledWith(null)
    expect(store.setStepEvidenceError).toHaveBeenCalledTimes(1)
    const [message] = store.setStepEvidenceError.mock.calls[0] as [string]
    expect(message).toContain("Issue:")
  })

  caseIt("refreshes diagnostics and requests selected step evidence", async () => {
    const store = createStore("/gateway") as AppStore & StoreStub & { selectedStepId: string }
    store.selectedStepId = "s-refresh"
    store.evidenceTimeline = [{ step_id: "s-refresh" }]
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ uptime_seconds: 1, task_total: 0, task_counts: {}, metrics: {} }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ state: "ok", failure_rate: 0, threshold: 0.2, completed: 0, failed: 0 }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ session_id: "session-refresh", steps: [], step_count: 0, source_event_count: 0 }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          flow: {
            start_url: "https://example.com",
            steps: [{ step_id: "s-refresh", action: "click", selected_selector_index: 0, target: { selectors: [] } }],
          },
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ items: [{ step_id: "s-refresh" }] }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ step_id: "s-refresh", ok: true }),
      } as unknown as Response)
    vi.stubGlobal("fetch", fetchMock)

    function Harness() {
      api = useApiClient(store)
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    await act(async () => {
      api?.refreshDiagnostics()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "/gateway/api/command-tower/evidence?step_id=s-refresh",
      { headers: {} }
    )
  })
})
