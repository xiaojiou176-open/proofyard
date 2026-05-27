/* @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import App from "./App"
import type { Command, Task } from "./types"

const mocked = vi.hoisted(() => {
  return {
    store: null as Record<string, unknown> | null,
    api: null as Record<string, unknown> | null,
    pollingImpl: vi.fn(),
    isDangerousImpl: vi.fn((command: Command) => command.command_id === "danger"),
  }
})

vi.mock("./hooks/useAppStore", () => ({
  useAppStore: () => mocked.store,
}))

vi.mock("./hooks/useApiClient", () => ({
  useApiClient: () => mocked.api,
}))

vi.mock("./hooks/usePolling", () => ({
  usePolling: (...args: unknown[]) => mocked.pollingImpl(...args),
}))

vi.mock("./utils/commands", () => ({
  isDangerous: (command: Command) => mocked.isDangerousImpl(command),
}))

vi.mock("./components/ToastStack", () => ({
  default: () => <div data-testid="mock-toast-stack" />,
}))

vi.mock("./components/OnboardingTour", () => ({
  default: ({ active, onComplete }: { active: boolean; onComplete: () => void }) => (
    <button type="button" data-testid="mock-onboarding" data-active={String(active)} onClick={onComplete}>
      onboarding
    </button>
  ),
}))

vi.mock("./components/ConsoleHeader", () => ({
  default: ({ onViewChange, onOpenHelp }: { onViewChange: (view: string) => void; onOpenHelp: () => void }) => (
    <div data-testid="mock-header">
      <button type="button" data-testid="mock-nav-launch" onClick={() => onViewChange("launch")}>
        launch
      </button>
      <button type="button" data-testid="mock-nav-tasks" onClick={() => onViewChange("tasks")}>
        tasks
      </button>
      <button type="button" data-testid="mock-nav-workshop" onClick={() => onViewChange("workshop")}>
        workshop
      </button>
      <button type="button" data-testid="mock-open-help" onClick={onOpenHelp}>
        help
      </button>
    </div>
  ),
}))

vi.mock("./components/HelpPanel", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <button type="button" data-testid="mock-help-panel" onClick={onClose}>
      close-help
    </button>
  ),
}))

vi.mock("./components/ConfirmDialog", () => ({
  default: ({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) => (
    <div data-testid="mock-confirm-dialog">
      <button type="button" data-testid="mock-confirm-yes" onClick={onConfirm}>
        yes
      </button>
      <button type="button" data-testid="mock-confirm-no" onClick={onCancel}>
        no
      </button>
    </div>
  ),
}))

vi.mock("./views/QuickLaunchView", () => ({
  default: ({
    onRunCommand,
    onCreateRun,
  }: {
    onRunCommand: (command: Command) => Promise<void>
    onCreateRun: () => Promise<void>
  }) => (
    <div data-testid="mock-quick-launch">
      <button
        type="button"
        data-testid="mock-run-safe"
        onClick={() => {
          void onRunCommand({
            command_id: "safe",
            title: "safe command",
            description: "safe",
            tags: ["safe"],
          })
        }}
      >
        run-safe
      </button>
      <button
        type="button"
        data-testid="mock-run-danger"
        onClick={() => {
          void onRunCommand({
            command_id: "danger",
            title: "danger command",
            description: "danger",
            tags: ["danger"],
          })
        }}
      >
        run-danger
      </button>
      <button
        type="button"
        data-testid="mock-create-run"
        onClick={() => {
          void onCreateRun()
        }}
      >
        create-run
      </button>
    </div>
  ),
}))

vi.mock("./views/TaskCenterView", () => ({
  default: ({ onGoToLaunch }: { onGoToLaunch: () => void }) => (
    <button type="button" data-testid="mock-task-center" onClick={onGoToLaunch}>
      go-launch
    </button>
  ),
}))

vi.mock("./views/FlowWorkshopView", () => ({
  default: () => <div data-testid="mock-workshop" />,
}))

function makeTask(status: Task["status"]): Task {
  return {
    task_id: "task-1",
    command_id: "cmd-1",
    status,
    requested_by: null,
    attempt: 1,
    max_attempts: 3,
    created_at: "2026-03-01T00:00:00Z",
    started_at: null,
    finished_at: null,
    exit_code: null,
    message: null,
    output_tail: "",
  }
}

function createStore(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    locale: "en",
    setLocale: vi.fn(),
    isFirstUseActive: true,
    firstUseStage: "configure",
    setFirstUseStage: vi.fn(),
    firstUseProgress: { configValid: true, runTriggered: false, resultSeen: false },
    canCompleteFirstUse: false,
    markFirstUseRunTriggered: vi.fn(),
    markFirstUseResultSeen: vi.fn(),
    completeFirstUse: vi.fn(),
    selectedStudioTemplateId: "tpl-1",
    studioTemplates: [
      {
        template_id: "tpl-1",
        flow_id: "flow-1",
        name: "Template 1",
        params_schema: [
          {
            key: "email",
            type: "email",
            required: true,
            description: "账号邮箱",
            enum_values: [],
            pattern: "",
          },
        ],
        defaults: { email: "demo@example.com" },
        policies: {
          retries: 1,
          timeout_seconds: 100,
          otp: {
            required: true,
            provider: "manual",
            timeout_seconds: 90,
            regex: "\\b(\\d{6})\\b",
            sender_filter: "",
            subject_filter: "",
          },
        },
      },
    ],
    selectedStepId: "",
    setCommandState: vi.fn(),
    setTaskState: vi.fn(),
    setFeedbackText: vi.fn(),
    addLog: vi.fn(),
    pushNotice: vi.fn(),
    setStudioTemplateName: vi.fn(),
    setStudioSchemaRows: vi.fn(),
    setStudioDefaults: vi.fn(),
    setStudioPolicies: vi.fn(),
    setStudioRunParams: vi.fn(),
    setSelectedStudioFlowId: vi.fn(),
    setConfirmDialog: vi.fn(),
    showOnboarding: false,
    notices: [],
    dismissNotice: vi.fn(),
    completeOnboarding: vi.fn(),
    runningCount: 0,
    successCount: 0,
    failedCount: 0,
    activeView: "launch",
    setActiveView: vi.fn(),
    setShowHelp: vi.fn(),
    restartOnboarding: vi.fn(),
    commands: [],
    commandState: "success",
    activeTab: "all",
    submittingId: "",
    feedbackText: "",
    params: {},
    handleParamsChange: vi.fn(),
    studioRunParams: {},
    setSelectedStudioTemplateId: vi.fn(),
    taskState: "success",
    tasks: [makeTask("success")],
    selectedTaskId: "task-1",
    taskErrorMessage: "",
    setSelectedTaskId: vi.fn(),
    setStatusFilter: vi.fn(),
    statusFilter: "all",
    commandFilter: "",
    setCommandFilter: vi.fn(),
    taskLimit: 20,
    setTaskLimit: vi.fn(),
    logs: [],
    selectedTask: makeTask("success"),
    terminalRows: 12,
    setTerminalRows: vi.fn(),
    terminalFilter: "all",
    setTerminalFilter: vi.fn(),
    autoScroll: true,
    setAutoScroll: vi.fn(),
    clearLogs: vi.fn(),
    studioRuns: [],
    selectedStudioRunId: "",
    setSelectedStudioRunId: vi.fn(),
    studioOtpCode: "",
    setStudioOtpCode: vi.fn(),
    runRecoveryPlan: null,
    runRecoveryPlanState: "empty",
    runRecoveryPlanError: "",
    setRunRecoveryPlan: vi.fn(),
    setRunRecoveryPlanState: vi.fn(),
    setRunRecoveryPlanError: vi.fn(),
    templateReadiness: null,
    templateReadinessState: "empty",
    templateReadinessError: "",
    setTemplateReadiness: vi.fn(),
    setTemplateReadinessState: vi.fn(),
    setTemplateReadinessError: vi.fn(),
    diagnostics: null,
    alerts: null,
    diagnosticsError: "",
    alertError: "",
    latestFlow: null,
    flowError: "",
    flowDraft: null,
    stepEvidence: null,
    evidenceTimeline: [],
    evidenceTimelineError: "",
    evidenceRuns: [],
    evidenceRegistryState: "missing",
    selectedEvidenceRunId: "",
    selectedEvidenceRun: null,
    evidenceRunsState: "empty",
    evidenceRunsError: "",
    evidenceRunCompare: null,
    evidenceRunCompareState: "empty",
    evidenceRunCompareError: "",
    evidenceSharePack: null,
    evidenceSharePackState: "empty",
    evidenceSharePackError: "",
    failureExplanation: null,
    failureExplanationState: "empty",
    failureExplanationError: "",
    promotionCandidate: null,
    promotionCandidateState: "empty",
    promotionCandidateError: "",
    hostedReviewWorkspace: null,
    hostedReviewWorkspaceState: "empty",
    hostedReviewWorkspaceError: "",
    setEvidenceRuns: vi.fn(),
    setEvidenceRegistryState: vi.fn(),
    setSelectedEvidenceRunId: vi.fn(),
    setSelectedEvidenceRun: vi.fn(),
    setEvidenceRunsState: vi.fn(),
    setEvidenceRunsError: vi.fn(),
    setEvidenceRunCompare: vi.fn(),
    setEvidenceRunCompareState: vi.fn(),
    setEvidenceRunCompareError: vi.fn(),
    setEvidenceSharePack: vi.fn(),
    setEvidenceSharePackState: vi.fn(),
    setEvidenceSharePackError: vi.fn(),
    setFailureExplanation: vi.fn(),
    setFailureExplanationState: vi.fn(),
    setFailureExplanationError: vi.fn(),
    setPromotionCandidate: vi.fn(),
    setPromotionCandidateState: vi.fn(),
    setPromotionCandidateError: vi.fn(),
    setHostedReviewWorkspace: vi.fn(),
    setHostedReviewWorkspaceState: vi.fn(),
    setHostedReviewWorkspaceError: vi.fn(),
    resumeWithPreconditions: false,
    stepEvidenceError: "",
    setFlowDraft: vi.fn(),
    setSelectedStepId: vi.fn(),
    setResumeWithPreconditions: vi.fn(),
    showHelp: false,
    confirmDialog: null,
    ...overrides,
  }
}

function createApi(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fetchCommands: vi.fn().mockResolvedValue(undefined),
    fetchTasks: vi.fn().mockResolvedValue(undefined),
    fetchDiagnostics: vi.fn().mockResolvedValue(undefined),
    fetchAlerts: vi.fn().mockResolvedValue(undefined),
    fetchLatestFlow: vi.fn().mockResolvedValue(undefined),
    fetchLatestFlowDraft: vi.fn().mockResolvedValue(undefined),
    fetchEvidenceTimeline: vi.fn().mockResolvedValue(undefined),
    fetchEvidenceRuns: vi.fn().mockResolvedValue(undefined),
    fetchEvidenceRunDetail: vi.fn().mockResolvedValue(undefined),
    fetchEvidenceRunCompare: vi.fn().mockResolvedValue(undefined),
    fetchEvidenceSharePack: vi.fn().mockResolvedValue(undefined),
    fetchFailureExplanation: vi.fn().mockResolvedValue(undefined),
    fetchPromotionCandidate: vi.fn().mockResolvedValue(undefined),
    fetchHostedReviewWorkspace: vi.fn().mockResolvedValue(undefined),
    fetchRunRecoveryPlan: vi.fn().mockResolvedValue(undefined),
    fetchTemplateReadiness: vi.fn().mockResolvedValue(undefined),
    fetchStudioData: vi.fn().mockResolvedValue(undefined),
    fetchStepEvidence: vi.fn().mockResolvedValue(undefined),
    runCommand: vi.fn().mockResolvedValue(true),
    createRun: vi.fn().mockResolvedValue(true),
    cancelTask: vi.fn().mockResolvedValue(undefined),
    refreshTasks: vi.fn().mockResolvedValue(undefined),
    submitRunOtp: vi.fn().mockResolvedValue(undefined),
    saveFlowDraft: vi.fn().mockResolvedValue(undefined),
    replayLatestFlow: vi.fn().mockResolvedValue(undefined),
    replayStep: vi.fn().mockResolvedValue(undefined),
    replayFromStep: vi.fn().mockResolvedValue(undefined),
    refreshDiagnostics: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

describe("App", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    mocked.pollingImpl.mockReset()
    mocked.isDangerousImpl.mockClear()

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

  it("bootstraps successfully and syncs template selection + evidence step", async function () {
    const store = createStore({
      selectedStepId: "",
      tasks: [makeTask("success")],
      showHelp: true,
      confirmDialog: {
        title: "Confirm",
        message: "Continue?",
        onConfirm: vi.fn(),
      },
    })
    const api = createApi()

    mocked.store = store
    mocked.api = api
    mocked.pollingImpl.mockImplementation((_store: unknown, bootstrap: () => Promise<void>) => {
      void bootstrap()
    })

    await act(async () => {
      root.render(<App />)
      await flushMicrotasks()
    })

    expect((store.setCommandState as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("loading")
    expect((store.setTaskState as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("loading")
    expect(store.setFeedbackText).toHaveBeenCalledWith("System ready")
    expect(store.addLog).toHaveBeenCalledWith("success", "System initialization completed")
    expect(store.pushNotice).toHaveBeenCalledWith("success", "System ready. Welcome to Proofyard.")

    expect(store.setStudioTemplateName).toHaveBeenCalledWith("Template 1")
    expect(store.setStudioDefaults).toHaveBeenCalledWith({ email: "demo@example.com" })
    expect(store.setStudioRunParams).toHaveBeenCalledWith({ email: "demo@example.com" })
    expect(store.setSelectedStudioFlowId).toHaveBeenCalledWith("flow-1")

    expect(api.fetchEvidenceRuns).toHaveBeenCalledTimes(1)
    expect(api.fetchEvidenceRunDetail).toHaveBeenCalledTimes(1)
    expect(api.fetchStepEvidence).toHaveBeenCalledWith("")
    expect(store.markFirstUseResultSeen).toHaveBeenCalledTimes(1)

    expect(container.querySelector('[data-testid="mock-help-panel"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="mock-confirm-dialog"]')).not.toBeNull()
  })

  it("handles core bootstrap failure", async function () {
    const store = createStore()
    const api = createApi({
      fetchCommands: vi.fn().mockRejectedValue(new Error("core failed")),
      fetchTasks: vi.fn().mockResolvedValue(undefined),
    })

    mocked.store = store
    mocked.api = api
    mocked.pollingImpl.mockImplementation((_store: unknown, bootstrap: () => Promise<void>) => {
      void bootstrap()
    })

    await act(async () => {
      root.render(<App />)
      await flushMicrotasks()
    })

    expect(store.setCommandState).toHaveBeenCalledWith("error")
    expect(store.setTaskState).toHaveBeenCalledWith("error")
    expect(store.setFeedbackText).toHaveBeenCalledWith("core failed")
    expect(store.addLog).toHaveBeenCalledWith("error", "core failed")
    expect(store.pushNotice).toHaveBeenCalledWith("error", "core failed")
    expect(api.fetchEvidenceRuns).not.toHaveBeenCalled()
  })

  it("uses fallback messages for non-Error bootstrap failures and ignores empty template selection", async function () {
    const store = createStore({
      selectedStudioTemplateId: "",
      studioTemplates: [],
    })
    const api = createApi({
      fetchCommands: vi.fn().mockRejectedValue("string core failure"),
      fetchTasks: vi.fn().mockResolvedValue(undefined),
    })

    mocked.store = store
    mocked.api = api
    mocked.pollingImpl.mockImplementation((_store: unknown, bootstrap: () => Promise<void>) => {
      void bootstrap()
    })

    await act(async () => {
      root.render(<App />)
      await flushMicrotasks()
    })

    expect(store.setFeedbackText).toHaveBeenCalledWith("Core data loading failed")
    expect(store.setStudioTemplateName).not.toHaveBeenCalled()
    expect(store.setStudioSchemaRows).not.toHaveBeenCalled()
  })

  it("opens confirm dialog for dangerous command and runs safe command directly", async function () {
    const setConfirmDialog = vi.fn()
    const store = createStore({ setConfirmDialog, isFirstUseActive: true })
    const api = createApi({ runCommand: vi.fn().mockResolvedValue(true) })

    mocked.store = store
    mocked.api = api
    mocked.pollingImpl.mockImplementation(() => {})

    await act(async () => {
      root.render(<App />)
      await flushMicrotasks()
    })

    const runDanger = container.querySelector('[data-testid="mock-run-danger"]') as HTMLButtonElement
    await act(async () => {
      runDanger.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flushMicrotasks()
    })

    expect(setConfirmDialog).toHaveBeenCalledTimes(1)
    const confirmPayload = (setConfirmDialog as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      onConfirm: () => void
    }

    await act(async () => {
      confirmPayload.onConfirm()
      await flushMicrotasks()
    })

    expect(api.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command_id: "danger", title: "danger command" })
    )
    expect(store.markFirstUseRunTriggered).toHaveBeenCalledTimes(1)
    expect(store.setActiveView).toHaveBeenCalledWith("tasks")

    const nonFirstUseStore = createStore({ isFirstUseActive: false })
    const nonFirstUseApi = createApi({ runCommand: vi.fn().mockResolvedValue(true) })
    mocked.store = nonFirstUseStore
    mocked.api = nonFirstUseApi

    await act(async () => {
      root.render(<App />)
      await flushMicrotasks()
    })

    const runSafe = container.querySelector('[data-testid="mock-run-safe"]') as HTMLButtonElement
    await act(async () => {
      runSafe.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flushMicrotasks()
    })

    expect(nonFirstUseApi.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command_id: "safe", title: "safe command" })
    )
    expect(nonFirstUseStore.markFirstUseRunTriggered).not.toHaveBeenCalled()
    expect(nonFirstUseStore.setActiveView).not.toHaveBeenCalledWith("tasks")
  })

  it("handles create run branch and auxiliary bootstrap warning", async function () {
    const store = createStore({ selectedStepId: "step-1" })
    const api = createApi({
      fetchDiagnostics: vi.fn().mockRejectedValue(new Error("diag down")),
      createRun: vi.fn().mockResolvedValue(false),
    })

    mocked.store = store
    mocked.api = api
    mocked.pollingImpl.mockImplementation((_store: unknown, bootstrap: () => Promise<void>) => {
      void bootstrap()
    })

    await act(async () => {
      root.render(<App />)
      await flushMicrotasks()
    })

    expect(store.setFeedbackText).toHaveBeenCalledWith(
      "Core data is ready, but some supporting data failed to load: diag down"
    )
    expect(store.addLog).toHaveBeenCalledWith(
      "warn",
      "Core data is ready, but some supporting data failed to load: diag down"
    )
    expect(store.pushNotice).toHaveBeenCalledWith(
      "warn",
      "Core data is ready, but some supporting data failed to load: diag down"
    )

    expect(api.fetchStepEvidence).toHaveBeenCalledWith("step-1")

    const createRunButton = container.querySelector(
      '[data-testid="mock-create-run"]'
    ) as HTMLButtonElement
    await act(async () => {
      createRunButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flushMicrotasks()
    })

    expect(api.createRun).toHaveBeenCalledTimes(1)
    expect(store.setActiveView).not.toHaveBeenCalledWith("tasks")
  })

  it("uses fallback text for non-Error auxiliary failures", async function () {
    const store = createStore()
    const api = createApi({
      fetchDiagnostics: vi.fn().mockRejectedValue("aux failed"),
    })

    mocked.store = store
    mocked.api = api
    mocked.pollingImpl.mockImplementation((_store: unknown, bootstrap: () => Promise<void>) => {
      void bootstrap()
    })

    await act(async () => {
      root.render(<App />)
      await flushMicrotasks()
    })

    expect(store.setFeedbackText).toHaveBeenCalledWith(
      "Core data is ready, but some supporting data failed to load: Unknown error"
    )
  })

  it("runs safe command for first-use users and navigates to tasks", async function () {
    const store = createStore({ isFirstUseActive: true })
    const api = createApi({ runCommand: vi.fn().mockResolvedValue(true) })

    mocked.store = store
    mocked.api = api
    mocked.pollingImpl.mockImplementation(() => {})

    await act(async () => {
      root.render(<App />)
      await flushMicrotasks()
    })

    const runSafe = container.querySelector('[data-testid="mock-run-safe"]') as HTMLButtonElement
    await act(async () => {
      runSafe.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flushMicrotasks()
    })

    expect(api.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command_id: "safe", title: "safe command" })
    )
    expect(store.markFirstUseRunTriggered).toHaveBeenCalledTimes(1)
    expect(store.setActiveView).toHaveBeenCalledWith("tasks")
  })

  it("handles first-use outcomes from studio runs and go-launch callback", async function () {
    const store = createStore({
      tasks: [makeTask("running")],
      studioRuns: [{ status: "failed" }],
      activeView: "tasks",
    })
    const api = createApi({ createRun: vi.fn().mockResolvedValue(true) })

    mocked.store = store
    mocked.api = api
    mocked.pollingImpl.mockImplementation(() => {})

    await act(async () => {
      root.render(<App />)
      await flushMicrotasks()
    })

    expect(store.markFirstUseResultSeen).toHaveBeenCalledTimes(1)

    const createRunButton = container.querySelector(
      '[data-testid="mock-create-run"]'
    ) as HTMLButtonElement
    await act(async () => {
      createRunButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flushMicrotasks()
    })

    expect(api.createRun).toHaveBeenCalledTimes(1)
    expect(store.markFirstUseRunTriggered).toHaveBeenCalledTimes(1)
    expect(store.setActiveView).toHaveBeenCalledWith("tasks")

    const goLaunchButton = container.querySelector(
      '[data-testid="mock-task-center"]'
    ) as HTMLButtonElement
    await act(async () => {
      goLaunchButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flushMicrotasks()
    })

    expect(store.setActiveView).toHaveBeenCalledWith("launch")
  })

  it("wires help open/close and dangerous confirm cancel callbacks", async function () {
    const setConfirmDialog = vi.fn()
    const setShowHelp = vi.fn()
    const store = createStore({
      setConfirmDialog,
      setShowHelp,
      showHelp: true,
      confirmDialog: {
        title: "Confirm",
        message: "危险操作",
        onConfirm: vi.fn(),
      },
    })
    const api = createApi()

    mocked.store = store
    mocked.api = api
    mocked.pollingImpl.mockImplementation(() => {})

    await act(async () => {
      root.render(<App />)
      await flushMicrotasks()
    })

    const openHelpButton = container.querySelector('[data-testid="mock-open-help"]') as HTMLButtonElement
    const closeHelpButton = container.querySelector('[data-testid="mock-help-panel"]') as HTMLButtonElement
    const closeConfirmButton = container.querySelector('[data-testid="mock-confirm-no"]') as HTMLButtonElement

    act(() => {
      openHelpButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      closeHelpButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      closeConfirmButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(setShowHelp).toHaveBeenCalledWith(true)
    expect(setShowHelp).toHaveBeenCalledWith(false)
    expect(setConfirmDialog).toHaveBeenCalledWith(null)
  })

  it("skips template sync when selected template is missing and avoids duplicate step evidence fetch", async function () {
    const store = createStore({
      selectedStudioTemplateId: "template-not-found",
      selectedStepId: "step-2",
    })
    const api = createApi()

    mocked.store = store
    mocked.api = api
    mocked.pollingImpl.mockImplementation(() => {})

    await act(async () => {
      root.render(<App />)
      await flushMicrotasks()
    })

    expect(store.setStudioTemplateName).not.toHaveBeenCalled()
    expect(api.fetchStepEvidence).toHaveBeenCalledWith("step-2")
    expect(api.fetchStepEvidence).toHaveBeenCalledTimes(1)

    store.selectedStepId = " step-2 "
    await act(async () => {
      root.render(<App />)
      await flushMicrotasks()
    })

    expect(api.fetchStepEvidence).toHaveBeenCalledTimes(1)
  })

  it("applies fallback template defaults and stops dangerous flow when command fails", async function () {
    const store = createStore({
      selectedStudioTemplateId: "tpl-fallback",
      studioTemplates: [
        {
          template_id: "tpl-fallback",
          flow_id: "flow-fallback",
          name: "Fallback Template",
          params_schema: [{}],
          defaults: undefined,
          policies: {},
        },
      ],
      isFirstUseActive: true,
    })
    const api = createApi({ runCommand: vi.fn().mockResolvedValue(false) })

    mocked.store = store
    mocked.api = api
    mocked.pollingImpl.mockImplementation(() => {})

    await act(async () => {
      root.render(<App />)
      await flushMicrotasks()
    })

    expect(store.setStudioSchemaRows).toHaveBeenCalledWith([
      {
        key: "",
        type: "string",
        required: false,
        description: "",
        enum_values: "",
        pattern: "",
      },
    ])
    expect(store.setStudioDefaults).toHaveBeenCalledWith({})
    expect(store.setStudioRunParams).toHaveBeenCalledWith({})
    expect(store.setStudioPolicies).toHaveBeenCalledWith({
      retries: 0,
      timeout_seconds: 120,
      otp: {
        required: false,
        provider: "manual",
        timeout_seconds: 120,
        regex: "\\b(\\d{6})\\b",
        sender_filter: "",
        subject_filter: "",
      },
    })

    const runDanger = container.querySelector('[data-testid="mock-run-danger"]') as HTMLButtonElement
    await act(async () => {
      runDanger.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flushMicrotasks()
    })
    const confirmPayload = (store.setConfirmDialog as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as {
      onConfirm: () => void
    }
    await act(async () => {
      confirmPayload.onConfirm()
      await flushMicrotasks()
    })

    expect(api.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command_id: "danger", title: "danger command" })
    )
    expect(store.markFirstUseRunTriggered).not.toHaveBeenCalled()
    expect(store.setActiveView).not.toHaveBeenCalledWith("tasks")
  })
})
