import { useCallback, useEffect, useMemo, useState } from "react"
import type { AppLocale } from "../i18n"
import { isSupportedLocale } from "../i18n"
import type { ParamsState } from "../components/ParamsPanel"
import type {
  ActionState,
  AlertsPayload,
  Command,
  CommandCategory,
  CommandState,
  ConfigStudioDocument,
  DiagnosticsPayload,
  EvidenceRegistryState,
  EvidenceRun,
  EvidenceRunCompare,
  EvidenceSharePack,
  HostedReviewWorkspace,
  PromotionCandidate,
  EvidenceRunSummary,
  EvidenceTimelineItem,
  FailureExplanation,
  FlowEditableDraft,
  FlowPreviewPayload,
  LogEntry,
  LogLevel,
  ProfileResolvePayload,
  ReconstructionArtifactsPayload,
  ReconstructionGeneratePayload,
  ReconstructionPreviewPayload,
  RunRecoveryPlan,
  StepEvidencePayload,
  Task,
  TaskState,
  TemplateReadiness,
  UiNotice,
  UniversalFlow,
  UniversalRun,
  UniversalTemplate,
} from "../types"

const MAX_LOG_SIZE = 500

export type StudioSchemaRow = {
  key: string
  type: "string" | "secret" | "enum" | "regex" | "email"
  required: boolean
  description: string
  enum_values: string
  pattern: string
}

export type StudioPolicies = {
  retries: number
  timeout_seconds: number
  otp: {
    required: boolean
    provider: "manual" | "gmail" | "imap" | "vonage"
    timeout_seconds: number
    regex: string
    sender_filter: string
    subject_filter: string
  }
}

export type AppView = "launch" | "tasks" | "workshop"
export type FirstUseStage = "welcome" | "configure" | "run" | "verify"
type FirstUseProgress = {
  configValid: boolean
  runTriggered: boolean
  resultSeen: boolean
}

const FIRST_USE_DONE_KEY = "ab_first_use_done"
const FIRST_USE_STAGE_KEY = "ab_first_use_stage"
const FIRST_USE_PROGRESS_KEY = "ab_first_use_progress"
const AUTOMATION_CLIENT_ID_KEY = "ab_automation_client_id"
const LOCALE_PREFERENCE_KEY = "proofyard_locale"
const VISUAL_DETERMINISTIC_CLIENT_ID = "client-visual-ci"
const LEGACY_DEFAULT_BASE_URL = "http://127.0.0.1:17380"

const FIRST_USE_STAGE_INDEX: Record<FirstUseStage, number> = {
  welcome: 0,
  configure: 1,
  run: 2,
  verify: 3,
}

function isValidHttpUrl(raw: string) {
  if (!raw.trim()) return false
  try {
    const parsed = new URL(raw.trim())
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

export function isFirstUseConfigValid(params: ParamsState) {
  if (!isValidHttpUrl(params.baseUrl)) return false
  if (params.startUrl.trim() && !isValidHttpUrl(params.startUrl)) return false
  return Boolean(params.successSelector.trim())
}

function clampFirstUseStage(stage: FirstUseStage, progress: FirstUseProgress) {
  const maxUnlocked: FirstUseStage = progress.runTriggered
    ? "verify"
    : progress.configValid
      ? "run"
      : "configure"
  if (stage === "welcome") return "welcome"
  return FIRST_USE_STAGE_INDEX[stage] <= FIRST_USE_STAGE_INDEX[maxUnlocked] ? stage : maxUnlocked
}

function createAutomationClientId() {
  try {
    return crypto.randomUUID()
  } catch {
    return `client-${Date.now()}`
  }
}

function readRuntimeOrigin() {
  if (typeof window === "undefined") return ""
  return window.location.origin
}

function isVisualSnapshotMode() {
  if (typeof document === "undefined") return false
  return document.documentElement.getAttribute("data-uiq-visual") === "1"
}

function isCiRuntime() {
  const env = import.meta.env as ImportMetaEnv & {
    VITEST?: boolean
    VITE_CI?: string
  }
  if (env.VITEST) return true
  if (env.VITE_CI?.trim().toLowerCase() === "true") return true
  const maybeProcess = (globalThis as { process?: { env?: { CI?: string } } }).process
  return maybeProcess?.env?.CI === "true"
}

export function resolveDefaultBaseUrl(defaultFromEnv: string | undefined, runtimeOrigin: string) {
  const explicit = defaultFromEnv?.trim()
  if (explicit) return explicit
  const sameOrigin = runtimeOrigin.trim()
  if (isValidHttpUrl(sameOrigin)) return sameOrigin
  return LEGACY_DEFAULT_BASE_URL
}

function resolveDefaultString(defaultFromEnv: string | undefined) {
  const explicit = defaultFromEnv?.trim()
  return explicit ? explicit : ""
}

function shouldUseDeterministicClientId() {
  return isVisualSnapshotMode() || isCiRuntime()
}

export function resolveAutomationClientId(
  storedClientId: string | undefined,
  deterministicMode: boolean
) {
  if (deterministicMode) return VISUAL_DETERMINISTIC_CLIENT_ID
  if (storedClientId?.trim()) return storedClientId.trim()
  return createAutomationClientId()
}

function readAutomationClientId() {
  try {
    const stored = localStorage.getItem(AUTOMATION_CLIENT_ID_KEY)?.trim()
    const generated = resolveAutomationClientId(stored, shouldUseDeterministicClientId())
    localStorage.setItem(AUTOMATION_CLIENT_ID_KEY, generated)
    return generated
  } catch {
    return resolveAutomationClientId(undefined, shouldUseDeterministicClientId())
  }
}

function readStoredFirstUseProgress(defaultConfigValid: boolean): FirstUseProgress {
  try {
    const raw = localStorage.getItem(FIRST_USE_PROGRESS_KEY)
    if (!raw) return { configValid: defaultConfigValid, runTriggered: false, resultSeen: false }
    const parsed = JSON.parse(raw) as Partial<FirstUseProgress>
    return {
      configValid: defaultConfigValid,
      runTriggered: Boolean(parsed.runTriggered),
      resultSeen: Boolean(parsed.resultSeen),
    }
  } catch {
    return { configValid: defaultConfigValid, runTriggered: false, resultSeen: false }
  }
}

function readStoredFirstUseStage(progress: FirstUseProgress): FirstUseStage {
  try {
    const raw = localStorage.getItem(FIRST_USE_STAGE_KEY)
    if (!raw) return "welcome"
    if (raw !== "welcome" && raw !== "configure" && raw !== "run" && raw !== "verify")
      return "welcome"
    return clampFirstUseStage(raw, progress)
  } catch {
    return "welcome"
  }
}

function readStoredLocale(): AppLocale {
  try {
    const stored = localStorage.getItem(LOCALE_PREFERENCE_KEY)?.trim()
    return isSupportedLocale(stored) ? stored : "en"
  } catch {
    return "en"
  }
}

export function useAppStore() {
  const defaultBaseUrl = resolveDefaultBaseUrl(
    import.meta.env.VITE_DEFAULT_BASE_URL as string | undefined,
    readRuntimeOrigin()
  )
  const initialParams: ParamsState = {
    baseUrl: defaultBaseUrl,
    startUrl: "",
    successSelector: "#result.ok",
    modelName: "models/gemini-3.1-pro-preview",
    geminiApiKey: "",
    registerPassword: "",
    automationToken: resolveDefaultString(
      import.meta.env.VITE_DEFAULT_AUTOMATION_TOKEN as string | undefined
    ),
    automationClientId:
      resolveDefaultString(import.meta.env.VITE_DEFAULT_AUTOMATION_CLIENT_ID as string | undefined) ||
      readAutomationClientId(),
    headless: false,
    midsceneStrict: false,
  }
  const defaultConfigValid = isFirstUseConfigValid(initialParams)
  // --- View ---
  const [activeView, setActiveView] = useState<AppView>("launch")
  const [locale, setLocale] = useState<AppLocale>(() => readStoredLocale())
  const [isFirstUseActive, setIsFirstUseActive] = useState(() => {
    try {
      return localStorage.getItem(FIRST_USE_DONE_KEY) !== "1"
    } catch {
      return true
    }
  })
  const [firstUseProgress, setFirstUseProgress] = useState<FirstUseProgress>(() =>
    readStoredFirstUseProgress(defaultConfigValid)
  )
  const [firstUseStageState, setFirstUseStageState] = useState<FirstUseStage>(() =>
    readStoredFirstUseStage(readStoredFirstUseProgress(defaultConfigValid))
  )

  // --- Onboarding & Help ---
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try {
      return localStorage.getItem("ab_onboarding_done") !== "1"
    } catch {
      return true
    }
  })
  const [showHelp, setShowHelp] = useState(false)

  const completeOnboarding = useCallback(() => {
    setShowOnboarding(false)
    try {
      localStorage.setItem("ab_onboarding_done", "1")
    } catch {
      /* noop */
    }
  }, [])

  const restartOnboarding = useCallback(() => {
    setShowOnboarding(true)
    try {
      localStorage.removeItem("ab_onboarding_done")
    } catch {
      /* noop */
    }
  }, [])

  const setFirstUseStage = useCallback(
    (stage: FirstUseStage) => {
      setFirstUseStageState(clampFirstUseStage(stage, firstUseProgress))
    },
    [firstUseProgress]
  )

  const markFirstUseRunTriggered = useCallback(() => {
    if (!isFirstUseActive) return
    setFirstUseProgress((prev) => ({ ...prev, runTriggered: true }))
    setFirstUseStageState("verify")
  }, [isFirstUseActive])

  const markFirstUseResultSeen = useCallback(() => {
    if (!isFirstUseActive) return
    setFirstUseProgress((prev) => ({ ...prev, runTriggered: true, resultSeen: true }))
    setFirstUseStageState("verify")
  }, [isFirstUseActive])

  const canCompleteFirstUse = useMemo(
    () =>
      firstUseProgress.configValid && firstUseProgress.runTriggered && firstUseProgress.resultSeen,
    [firstUseProgress.configValid, firstUseProgress.resultSeen, firstUseProgress.runTriggered]
  )

  const completeFirstUse = useCallback(() => {
    if (!firstUseProgress.configValid) {
      setFirstUseStageState("configure")
      return
    }
    if (!firstUseProgress.runTriggered) {
      setFirstUseStageState("run")
      return
    }
    if (!firstUseProgress.resultSeen) {
      setFirstUseStageState("verify")
      return
    }
    setIsFirstUseActive(false)
    setFirstUseStageState("verify")
    try {
      localStorage.setItem(FIRST_USE_DONE_KEY, "1")
      localStorage.removeItem(FIRST_USE_STAGE_KEY)
      localStorage.removeItem(FIRST_USE_PROGRESS_KEY)
    } catch {
      /* noop */
    }
  }, [firstUseProgress.configValid, firstUseProgress.resultSeen, firstUseProgress.runTriggered])

  // --- Core data ---
  const [commands, setCommands] = useState<Command[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState("")

  // --- UI states ---
  const [commandState, setCommandState] = useState<CommandState>("loading")
  const [taskState, setTaskState] = useState<TaskState>("loading")
  const [actionState, setActionState] = useState<ActionState>("idle")
  const [feedbackText, setFeedbackText] = useState("Waiting for a command")
  const [taskSyncError, setTaskSyncError] = useState("")
  const [submittingId, setSubmittingId] = useState("")
  const [activeTab, setActiveTab] = useState<"all" | CommandCategory>("all")

  // --- Task filters ---
  const [statusFilter, setStatusFilter] = useState("all")
  const [commandFilter, setCommandFilter] = useState("")
  const [taskLimit, setTaskLimit] = useState(100)

  // --- Terminal ---
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [terminalRows, setTerminalRows] = useState(14)
  const [terminalFilter, setTerminalFilter] = useState<"all" | LogLevel>("all")
  const [autoScroll, setAutoScroll] = useState(true)

  // --- Toasts ---
  const [notices, setNotices] = useState<UiNotice[]>([])

  // --- Diagnostics ---
  const [diagnostics, setDiagnostics] = useState<DiagnosticsPayload | null>(null)
  const [alerts, setAlerts] = useState<AlertsPayload | null>(null)
  const [latestFlow, setLatestFlow] = useState<FlowPreviewPayload | null>(null)
  const [flowDraft, setFlowDraft] = useState<FlowEditableDraft | null>(null)
  const [selectedStepId, setSelectedStepId] = useState("")
  const [stepEvidence, setStepEvidence] = useState<StepEvidencePayload | null>(null)
  const [evidenceTimeline, setEvidenceTimeline] = useState<EvidenceTimelineItem[]>([])
  const [evidenceTimelineError, setEvidenceTimelineError] = useState("")
  const [evidenceRuns, setEvidenceRuns] = useState<EvidenceRunSummary[]>([])
  const [evidenceRegistryState, setEvidenceRegistryState] =
    useState<EvidenceRegistryState>("missing")
  const [selectedEvidenceRunId, setSelectedEvidenceRunId] = useState("")
  const [selectedEvidenceCompareCandidateId, setSelectedEvidenceCompareCandidateId] = useState("")
  const [selectedEvidenceRun, setSelectedEvidenceRun] = useState<EvidenceRun | null>(null)
  const [evidenceRunsState, setEvidenceRunsState] = useState<TaskState>("loading")
  const [evidenceRunsError, setEvidenceRunsError] = useState("")
  const [evidenceRunCompare, setEvidenceRunCompare] = useState<EvidenceRunCompare | null>(null)
  const [evidenceRunCompareState, setEvidenceRunCompareState] = useState<TaskState>("empty")
  const [evidenceRunCompareError, setEvidenceRunCompareError] = useState("")
  const [evidenceSharePack, setEvidenceSharePack] = useState<EvidenceSharePack | null>(null)
  const [evidenceSharePackState, setEvidenceSharePackState] = useState<TaskState>("empty")
  const [evidenceSharePackError, setEvidenceSharePackError] = useState("")
  const [failureExplanation, setFailureExplanation] = useState<FailureExplanation | null>(null)
  const [failureExplanationState, setFailureExplanationState] = useState<TaskState>("empty")
  const [failureExplanationError, setFailureExplanationError] = useState("")
  const [promotionCandidate, setPromotionCandidate] = useState<PromotionCandidate | null>(null)
  const [promotionCandidateState, setPromotionCandidateState] = useState<TaskState>("empty")
  const [promotionCandidateError, setPromotionCandidateError] = useState("")
  const [hostedReviewWorkspace, setHostedReviewWorkspace] =
    useState<HostedReviewWorkspace | null>(null)
  const [hostedReviewWorkspaceState, setHostedReviewWorkspaceState] =
    useState<TaskState>("empty")
  const [hostedReviewWorkspaceError, setHostedReviewWorkspaceError] = useState("")
  const [resumeWithPreconditions, setResumeWithPreconditions] = useState(false)
  const [diagnosticsError, setDiagnosticsError] = useState("")
  const [alertError, setAlertError] = useState("")
  const [flowError, setFlowError] = useState("")
  const [stepEvidenceError, setStepEvidenceError] = useState("")
  const [reconstructionArtifacts, setReconstructionArtifacts] =
    useState<ReconstructionArtifactsPayload>({})
  const [reconstructionMode, setReconstructionMode] = useState<"gemini">("gemini")
  const [reconstructionStrategy, setReconstructionStrategy] = useState<
    "strict" | "balanced" | "aggressive"
  >("balanced")
  const [reconstructionPreview, setReconstructionPreview] =
    useState<ReconstructionPreviewPayload | null>(null)
  const [reconstructionGenerated, setReconstructionGenerated] =
    useState<ReconstructionGeneratePayload | null>(null)
  const [profileResolved, setProfileResolved] = useState<ProfileResolvePayload | null>(null)
  const [reconstructionError, setReconstructionError] = useState("")

  // --- Studio ---
  const [studioError, setStudioError] = useState("")
  const [studioFlows, setStudioFlows] = useState<UniversalFlow[]>([])
  const [studioTemplates, setStudioTemplates] = useState<UniversalTemplate[]>([])
  const [studioRuns, setStudioRuns] = useState<UniversalRun[]>([])
  const [selectedStudioFlowId, setSelectedStudioFlowId] = useState("")
  const [selectedStudioTemplateId, setSelectedStudioTemplateId] = useState("")
  const [selectedStudioRunId, setSelectedStudioRunId] = useState("")
  const [studioTemplateName, setStudioTemplateName] = useState("universal-template")
  const [studioSchemaRows, setStudioSchemaRows] = useState<StudioSchemaRow[]>([
    { key: "email", type: "email", required: true, description: "", enum_values: "", pattern: "" },
    {
      key: "password",
      type: "secret",
      required: true,
      description: "",
      enum_values: "",
      pattern: "",
    },
    { key: "otp", type: "secret", required: false, description: "", enum_values: "", pattern: "" },
  ])
  const [studioDefaults, setStudioDefaults] = useState<Record<string, string>>({
    email: "demo@example.com",
  })
  const [studioPolicies, setStudioPolicies] = useState<StudioPolicies>({
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
  const [studioRunParams, setStudioRunParams] = useState<Record<string, string>>({
    email: "demo@example.com",
  })
  const [studioOtpCode, setStudioOtpCode] = useState("")
  const [runRecoveryPlan, setRunRecoveryPlan] = useState<RunRecoveryPlan | null>(null)
  const [runRecoveryPlanState, setRunRecoveryPlanState] = useState<TaskState>("empty")
  const [runRecoveryPlanError, setRunRecoveryPlanError] = useState("")
  const [templateReadiness, setTemplateReadiness] = useState<TemplateReadiness | null>(null)
  const [templateReadinessState, setTemplateReadinessState] = useState<TaskState>("empty")
  const [templateReadinessError, setTemplateReadinessError] = useState("")
  const [profileTargetStudioState, setProfileTargetStudioState] = useState<TaskState>("empty")
  const [profileTargetStudioError, setProfileTargetStudioError] = useState("")
  const [profileStudioOptions, setProfileStudioOptions] = useState<string[]>([])
  const [targetStudioOptions, setTargetStudioOptions] = useState<string[]>([])
  const [selectedProfileStudioName, setSelectedProfileStudioName] = useState("pr")
  const [selectedTargetStudioName, setSelectedTargetStudioName] = useState("web.local")
  const [profileStudioDocument, setProfileStudioDocument] = useState<ConfigStudioDocument | null>(null)
  const [targetStudioDocument, setTargetStudioDocument] = useState<ConfigStudioDocument | null>(null)

  // --- Params ---
  const [params, setParams] = useState<ParamsState>(initialParams)

  // --- Confirm dialog ---
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string
    message: string
    onConfirm: () => void
  } | null>(null)

  // ---- Helpers ----
  const addLog = useCallback((level: LogLevel, message: string, commandId?: string) => {
    setLogs((prev) => {
      const next = [
        ...prev,
        { id: crypto.randomUUID(), ts: new Date().toISOString(), level, message, commandId },
      ]
      return next.length > MAX_LOG_SIZE ? next.slice(-MAX_LOG_SIZE) : next
    })
  }, [])

  const pushNotice = useCallback((level: LogLevel, message: string) => {
    const id = crypto.randomUUID()
    setNotices((prev) => [...prev, { id, level, message }])
    window.setTimeout(() => {
      setNotices((prev) => prev.filter((item) => item.id !== id))
    }, 4200)
  }, [])

  const dismissNotice = useCallback((id: string) => {
    setNotices((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const clearLogs = useCallback(() => setLogs([]), [])

  const handleParamsChange = useCallback((patch: Partial<ParamsState>) => {
    setParams((prev) => ({ ...prev, ...patch }))
  }, [])

  useEffect(() => {
    if (!isFirstUseActive) return
    const configValid = isFirstUseConfigValid(params)
    setFirstUseProgress((prev) =>
      prev.configValid === configValid ? prev : { ...prev, configValid }
    )
  }, [isFirstUseActive, params])

  useEffect(() => {
    if (!isFirstUseActive) return
    const stage = clampFirstUseStage(firstUseStageState, firstUseProgress)
    if (stage !== firstUseStageState) {
      setFirstUseStageState(stage)
      return
    }
    try {
      localStorage.setItem(FIRST_USE_STAGE_KEY, stage)
      localStorage.setItem(
        FIRST_USE_PROGRESS_KEY,
        JSON.stringify({
          runTriggered: firstUseProgress.runTriggered,
          resultSeen: firstUseProgress.resultSeen,
        })
      )
    } catch {
      /* noop */
    }
  }, [firstUseProgress, firstUseStageState, isFirstUseActive])

  useEffect(() => {
    const clientId = params.automationClientId.trim()
    if (!clientId) return
    try {
      localStorage.setItem(AUTOMATION_CLIENT_ID_KEY, clientId)
    } catch {
      /* noop */
    }
  }, [params.automationClientId])

  useEffect(() => {
    try {
      localStorage.setItem(LOCALE_PREFERENCE_KEY, locale)
    } catch {
      /* noop */
    }
  }, [locale])

  // ---- Derived ----
  const selectedTask = useMemo(
    () => tasks.find((t) => t.task_id === selectedTaskId) ?? null,
    [tasks, selectedTaskId]
  )
  const runningCount = useMemo(() => tasks.filter((t) => t.status === "running").length, [tasks])
  const failedCount = useMemo(() => tasks.filter((t) => t.status === "failed").length, [tasks])
  const successCount = useMemo(() => tasks.filter((t) => t.status === "success").length, [tasks])
  const taskErrorMessage = taskSyncError || (taskState === "error" ? feedbackText : "")

  return {
    // View
    activeView,
    setActiveView,
    locale,
    setLocale,
    isFirstUseActive,
    setIsFirstUseActive,
    firstUseStage: firstUseStageState,
    setFirstUseStage,
    firstUseProgress,
    canCompleteFirstUse,
    markFirstUseRunTriggered,
    markFirstUseResultSeen,
    completeFirstUse,
    // Onboarding & Help
    showOnboarding,
    completeOnboarding,
    restartOnboarding,
    showHelp,
    setShowHelp,
    // Core
    commands,
    setCommands,
    tasks,
    setTasks,
    selectedTaskId,
    setSelectedTaskId,
    // UI
    commandState,
    setCommandState,
    taskState,
    setTaskState,
    actionState,
    setActionState,
    feedbackText,
    setFeedbackText,
    taskSyncError,
    setTaskSyncError,
    submittingId,
    setSubmittingId,
    activeTab,
    setActiveTab,
    // Task filters
    statusFilter,
    setStatusFilter,
    commandFilter,
    setCommandFilter,
    taskLimit,
    setTaskLimit,
    // Terminal
    logs,
    terminalRows,
    setTerminalRows,
    terminalFilter,
    setTerminalFilter,
    autoScroll,
    setAutoScroll,
    // Toasts
    notices,
    // Diagnostics
    diagnostics,
    setDiagnostics,
    alerts,
    setAlerts,
    latestFlow,
    setLatestFlow,
    flowDraft,
    setFlowDraft,
    selectedStepId,
    setSelectedStepId,
    stepEvidence,
    setStepEvidence,
    evidenceTimeline,
    setEvidenceTimeline,
    evidenceTimelineError,
    setEvidenceTimelineError,
    evidenceRuns,
    setEvidenceRuns,
    evidenceRegistryState,
    setEvidenceRegistryState,
    selectedEvidenceRunId,
    setSelectedEvidenceRunId,
    selectedEvidenceCompareCandidateId,
    setSelectedEvidenceCompareCandidateId,
    selectedEvidenceRun,
    setSelectedEvidenceRun,
    evidenceRunsState,
    setEvidenceRunsState,
    evidenceRunsError,
    setEvidenceRunsError,
    evidenceRunCompare,
    setEvidenceRunCompare,
    evidenceRunCompareState,
    setEvidenceRunCompareState,
    evidenceRunCompareError,
    setEvidenceRunCompareError,
    evidenceSharePack,
    setEvidenceSharePack,
    evidenceSharePackState,
    setEvidenceSharePackState,
    evidenceSharePackError,
    setEvidenceSharePackError,
    failureExplanation,
    setFailureExplanation,
    failureExplanationState,
    setFailureExplanationState,
    failureExplanationError,
    setFailureExplanationError,
    promotionCandidate,
    setPromotionCandidate,
    promotionCandidateState,
    setPromotionCandidateState,
    promotionCandidateError,
    setPromotionCandidateError,
    hostedReviewWorkspace,
    setHostedReviewWorkspace,
    hostedReviewWorkspaceState,
    setHostedReviewWorkspaceState,
    hostedReviewWorkspaceError,
    setHostedReviewWorkspaceError,
    resumeWithPreconditions,
    setResumeWithPreconditions,
    diagnosticsError,
    setDiagnosticsError,
    alertError,
    setAlertError,
    flowError,
    setFlowError,
    stepEvidenceError,
    setStepEvidenceError,
    reconstructionArtifacts,
    setReconstructionArtifacts,
    reconstructionMode,
    setReconstructionMode,
    reconstructionStrategy,
    setReconstructionStrategy,
    reconstructionPreview,
    setReconstructionPreview,
    reconstructionGenerated,
    setReconstructionGenerated,
    profileResolved,
    setProfileResolved,
    reconstructionError,
    setReconstructionError,
    // Studio
    studioError,
    setStudioError,
    studioFlows,
    setStudioFlows,
    studioTemplates,
    setStudioTemplates,
    studioRuns,
    setStudioRuns,
    selectedStudioFlowId,
    setSelectedStudioFlowId,
    selectedStudioTemplateId,
    setSelectedStudioTemplateId,
    selectedStudioRunId,
    setSelectedStudioRunId,
    studioTemplateName,
    setStudioTemplateName,
    studioSchemaRows,
    setStudioSchemaRows,
    studioDefaults,
    setStudioDefaults,
    studioPolicies,
    setStudioPolicies,
    studioRunParams,
    setStudioRunParams,
    studioOtpCode,
    setStudioOtpCode,
    runRecoveryPlan,
    setRunRecoveryPlan,
    runRecoveryPlanState,
    setRunRecoveryPlanState,
    runRecoveryPlanError,
    setRunRecoveryPlanError,
    templateReadiness,
    setTemplateReadiness,
    templateReadinessState,
    setTemplateReadinessState,
    templateReadinessError,
    setTemplateReadinessError,
    profileTargetStudioState,
    setProfileTargetStudioState,
    profileTargetStudioError,
    setProfileTargetStudioError,
    profileStudioOptions,
    setProfileStudioOptions,
    targetStudioOptions,
    setTargetStudioOptions,
    selectedProfileStudioName,
    setSelectedProfileStudioName,
    selectedTargetStudioName,
    setSelectedTargetStudioName,
    profileStudioDocument,
    setProfileStudioDocument,
    targetStudioDocument,
    setTargetStudioDocument,
    // Params
    params,
    setParams,
    handleParamsChange,
    // Confirm
    confirmDialog,
    setConfirmDialog,
    // Helpers
    addLog,
    pushNotice,
    dismissNotice,
    clearLogs,
    // Derived
    selectedTask,
    runningCount,
    failedCount,
    successCount,
    taskErrorMessage,
  }
}

export type AppStore = ReturnType<typeof useAppStore>
