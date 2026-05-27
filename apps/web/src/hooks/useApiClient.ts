import { useCallback, useRef } from "react"
import type { Command, FetchTaskOptions, Task } from "../types"
import { useApiClientStudio } from "./useApiClient.studio"
import { useApiClientTransport } from "./useApiClient.transport"
import { useApiClientWorkshop } from "./useApiClient.workshop"
import type { AppStore } from "./useAppStore"

export { buildApiUrl } from "./useApiClient.helpers"

export function useApiClient(store: AppStore) {
  const fetchTasksRequestSeqRef = useRef(0)
  const fetchStepEvidenceRequestSeqRef = useRef(0)
  const submittingRequestSeqRef = useRef(0)

  const transport = useApiClientTransport(store)
  const { buildHeaders, formatActionableError, requestJson } = transport

  const fetchCommands = useCallback(async () => {
    const data = await requestJson<{ commands: Command[] }>(
      "/api/automation/commands",
      "Command list loading failed",
      {
        headers: buildHeaders(),
      }
    )
    store.setCommands(data.commands)
    store.setCommandState(data.commands.length > 0 ? "success" : "empty")
  }, [buildHeaders, requestJson, store])

  const fetchTasks = useCallback(
    async ({ background = false }: FetchTaskOptions = {}) => {
      const requestSeq = ++fetchTasksRequestSeqRef.current
      if (!background) store.setTaskState("loading")
      try {
        const urlParams = new URLSearchParams()
        if (store.statusFilter !== "all") urlParams.set("status", store.statusFilter)
        if (store.commandFilter.trim()) urlParams.set("command_id", store.commandFilter.trim())
        urlParams.set("limit", String(store.taskLimit))
        const data = await requestJson<{ tasks: Task[] }>(
          `/api/automation/tasks?${urlParams.toString()}`,
          "Run list loading failed",
          {
            headers: buildHeaders(),
          }
        )
        if (requestSeq !== fetchTasksRequestSeqRef.current) return
        store.setTasks(data.tasks)
        store.setTaskState(data.tasks.length > 0 ? "success" : "empty")
        store.setTaskSyncError("")
        store.setSelectedTaskId((prev) => {
          if (prev && !data.tasks.some((task) => task.task_id === prev)) return ""
          if (!prev && data.tasks[0]) return data.tasks[0].task_id
          return prev
        })
      } catch (error) {
        if (requestSeq !== fetchTasksRequestSeqRef.current) return
        if (!background) store.setTaskState("error")
        throw error
      }
    },
    [buildHeaders, requestJson, store]
  )

  const workshop = useApiClientWorkshop({
    store,
    transport,
    fetchTasks,
    fetchStepEvidenceRequestSeqRef,
  })

  const studio = useApiClientStudio({
    store,
    transport,
    fetchStudioData: workshop.fetchStudioData,
    fetchTasks,
  })

  const runCommand = useCallback(
    async (command: Command) => {
      const requestSeq = ++submittingRequestSeqRef.current
      store.setSubmittingId(command.command_id)
      store.setActionState("idle")
      store.addLog("info", `Preparing command ${command.command_id}`, command.command_id)
      try {
        const params: Record<string, string> = {
          UIQ_BASE_URL: store.params.baseUrl,
          START_URL: store.params.startUrl,
          SUCCESS_SELECTOR: store.params.successSelector,
          HEADLESS: String(store.params.headless),
          MIDSCENE_STRICT: String(store.params.midsceneStrict),
        }
        if (store.params.modelName.trim()) {
          params.MIDSCENE_MODEL_NAME = store.params.modelName.trim()
        }
        if (store.params.registerPassword.trim()) {
          params.REGISTER_PASSWORD = store.params.registerPassword.trim()
        }
        const maybeGeminiApiKey = String(
          (store.params as unknown as { geminiApiKey?: string }).geminiApiKey ?? ""
        ).trim()
        if (maybeGeminiApiKey) params.GEMINI_API_KEY = maybeGeminiApiKey

        const payload = await requestJson<{ task: Task }>("/api/automation/run", "Command execution failed", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...buildHeaders() },
          body: JSON.stringify({ command: command.command_id, params }),
        })
        store.setSelectedTaskId(payload.task.task_id)
        store.setActionState("success")
        store.setFeedbackText(`Submitted: ${command.title} (task ID: ${payload.task.task_id})`)
        store.addLog("success", `Command submitted successfully, task ${payload.task.task_id}`, command.command_id)
        store.pushNotice("success", `Submitted ${command.title}`)
        store.setParams((paramsState) => ({ ...paramsState, registerPassword: "" }))
        await Promise.all([
          fetchTasks(),
          workshop.fetchDiagnostics(),
          workshop.fetchAlerts(),
          workshop.fetchLatestFlow(),
          workshop.fetchLatestFlowDraft(),
        ])
        return true
      } catch (error) {
        const message = error instanceof Error ? error.message : "Command execution failed"
        const formatted = formatActionableError(message)
        store.setActionState("error")
        store.setFeedbackText(formatted)
        store.addLog("error", formatted, command.command_id)
        store.pushNotice("error", formatted)
        return false
      } finally {
        store.setSubmittingId((prev) =>
          requestSeq === submittingRequestSeqRef.current ? "" : prev
        )
      }
    },
    [buildHeaders, fetchTasks, formatActionableError, requestJson, store, workshop]
  )

  const cancelTask = useCallback(
    async (task: Task) => {
      try {
        await requestJson<unknown>(`/api/automation/tasks/${task.task_id}/cancel`, "Task cancel failed", {
          method: "POST",
          headers: buildHeaders(),
        })
        store.setFeedbackText(`Cancelled task ${task.task_id}`)
        store.addLog("warn", `Task cancelled ${task.task_id}`, task.command_id)
        store.pushNotice("warn", `Cancelled task ${task.task_id.slice(0, 8)}`)
        await Promise.all([
          fetchTasks(),
          workshop.fetchDiagnostics(),
          workshop.fetchAlerts(),
          workshop.fetchLatestFlow(),
          workshop.fetchLatestFlowDraft(),
        ])
      } catch (error) {
        const message = error instanceof Error ? error.message : "Task cancel failed"
        const formatted = formatActionableError(message)
        store.setFeedbackText(formatted)
        store.setActionState("error")
        store.addLog("error", formatted, task.command_id)
        store.pushNotice("error", formatted)
      }
    },
    [buildHeaders, fetchTasks, formatActionableError, requestJson, store, workshop]
  )

  const refreshTasks = useCallback(() => void fetchTasks(), [fetchTasks])

  return {
    buildHeaders,
    fetchCommands,
    fetchTasks,
    fetchDiagnostics: workshop.fetchDiagnostics,
    fetchAlerts: workshop.fetchAlerts,
    fetchLatestFlow: workshop.fetchLatestFlow,
    fetchLatestFlowDraft: workshop.fetchLatestFlowDraft,
    fetchStepEvidence: workshop.fetchStepEvidence,
    fetchEvidenceTimeline: workshop.fetchEvidenceTimeline,
    fetchEvidenceRuns: workshop.fetchEvidenceRuns,
    fetchEvidenceRunDetail: workshop.fetchEvidenceRunDetail,
    fetchEvidenceRunCompare: workshop.fetchEvidenceRunCompare,
    fetchEvidenceSharePack: workshop.fetchEvidenceSharePack,
    fetchFailureExplanation: workshop.fetchFailureExplanation,
    fetchPromotionCandidate: workshop.fetchPromotionCandidate,
    fetchHostedReviewWorkspace: workshop.fetchHostedReviewWorkspace,
    fetchStudioData: workshop.fetchStudioData,
    resolveProfile: studio.resolveProfile,
    previewReconstruction: studio.previewReconstruction,
    generateReconstruction: studio.generateReconstruction,
    orchestrateFromArtifacts: studio.orchestrateFromArtifacts,
    runCommand,
    cancelTask,
    saveFlowDraft: workshop.saveFlowDraft,
    replayLatestFlow: workshop.replayLatestFlow,
    replayStep: workshop.replayStep,
    replayFromStep: workshop.replayFromStep,
    importLatestFlow: studio.importLatestFlow,
    createTemplate: studio.createTemplate,
    updateTemplate: studio.updateTemplate,
    createRun: studio.createRun,
    submitRunOtp: studio.submitRunOtp,
    fetchRunRecoveryPlan: studio.fetchRunRecoveryPlan,
    fetchTemplateReadiness: studio.fetchTemplateReadiness,
    fetchProfileTargetStudio: studio.fetchProfileTargetStudio,
    saveConfigStudio: studio.saveConfigStudio,
    refreshDiagnostics: workshop.refreshDiagnostics,
    refreshStudio: studio.refreshStudio,
    refreshTasks,
  }
}
