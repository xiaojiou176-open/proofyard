import { useCallback } from "react"
import type { MutableRefObject } from "react"
import type {
  AlertsPayload,
  DiagnosticsPayload,
  EvidenceRun,
  EvidenceRunComparePayload,
  EvidenceRunListPayload,
  EvidenceRunSummary,
  EvidenceSharePackPayload,
  HostedReviewWorkspacePayload,
  PromotionCandidatePayload,
  FailureExplanationPayload,
  EvidenceTimelinePayload,
  FlowDraftDocumentPayload,
  FlowEditableDraft,
  FlowPreviewPayload,
  StepEvidencePayload,
  Task,
  UniversalFlow,
  UniversalRun,
  UniversalTemplate,
} from "../types"
import { formatApiError, readErrorDetail } from "../utils/api"
import type { ApiClientTransport } from "./useApiClient.transport"
import type { AppStore } from "./useAppStore"

type WorkshopParams = {
  store: AppStore
  transport: ApiClientTransport
  fetchTasks: () => Promise<void>
  fetchStepEvidenceRequestSeqRef: MutableRefObject<number>
}

export function useApiClientWorkshop({
  store,
  transport,
  fetchTasks,
  fetchStepEvidenceRequestSeqRef,
}: WorkshopParams) {
  const { apiFetch, assertResponseOk, buildHeaders, formatActionableError, requestJson } = transport

  const resolveCompareCandidateRunId = useCallback(
    (baselineRunId: string, runs: EvidenceRunSummary[] = store.evidenceRuns) => {
      const baseline = baselineRunId.trim()
      if (!baseline) return ""
      const candidates = runs.filter((run) => run.run_id !== baseline)
      const preferred = store.selectedEvidenceCompareCandidateId.trim()
      if (preferred && candidates.some((run) => run.run_id === preferred)) {
        return preferred
      }
      return candidates.find((run) => run.retention_state === "retained")?.run_id ?? candidates[0]?.run_id ?? ""
    },
    [store.evidenceRuns, store.selectedEvidenceCompareCandidateId]
  )

  const fetchDiagnostics = useCallback(async () => {
    try {
      const response = await apiFetch("/health/diagnostics", { headers: buildHeaders() })
      if (!response.ok) {
        store.setDiagnosticsError(
          formatActionableError(
            formatApiError("Diagnostics failed", await readErrorDetail(response)),
            "Check the service state and try again.",
            "Review the health panel and backend diagnostics log."
          )
        )
        store.setDiagnostics(null)
        return
      }
      store.setDiagnosticsError("")
      store.setDiagnostics((await response.json()) as DiagnosticsPayload)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Diagnostics failed"
      store.setDiagnosticsError(
        formatActionableError(
          formatApiError("Diagnostics failed", { status: 0, detail: message, requestId: null }),
          "Check the service state and try again.",
          "Review the health panel and backend diagnostics log."
        )
      )
      store.setDiagnostics(null)
    }
  }, [apiFetch, buildHeaders, formatActionableError, store])

  const fetchAlerts = useCallback(async () => {
    try {
      const response = await apiFetch("/health/alerts", { headers: buildHeaders() })
      if (!response.ok) {
        store.setAlertError(
          formatActionableError(
            formatApiError("Alert refresh failed", await readErrorDetail(response)),
            "Verify the alert configuration and service connectivity, then try again.",
            "Review the alert panel and backend log."
          )
        )
        store.setAlerts(null)
        return
      }
      store.setAlertError("")
      store.setAlerts((await response.json()) as AlertsPayload)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Alert refresh failed"
      store.setAlertError(
        formatActionableError(
          formatApiError("Alert refresh failed", { status: 0, detail: message, requestId: null }),
          "Verify the alert configuration and service connectivity, then try again.",
          "Review the alert panel and backend log."
        )
      )
      store.setAlerts(null)
    }
  }, [apiFetch, buildHeaders, formatActionableError, store])

  const fetchLatestFlow = useCallback(async () => {
    const response = await apiFetch("/api/command-tower/latest-flow", { headers: buildHeaders() })
    if (!response.ok) {
      store.setFlowError(
        formatActionableError(
          formatApiError("Flow preview failed", await readErrorDetail(response)),
          "Review the recording result and reload the latest flow preview.",
          "Check Flow Workshop and the backend orchestration log."
        )
      )
      store.setLatestFlow(null)
      return
    }
    store.setFlowError("")
    store.setLatestFlow((await response.json()) as FlowPreviewPayload)
  }, [apiFetch, buildHeaders, formatActionableError, store])

  const fetchLatestFlowDraft = useCallback(async () => {
    const response = await apiFetch("/api/command-tower/latest-flow-draft", {
      headers: buildHeaders(),
    })
    if (!response.ok) {
      store.setFlowError(
        formatActionableError(
          formatApiError("Flow draft loading failed", await readErrorDetail(response)),
          "Confirm that a flow draft exists, then try again.",
          "Check the Flow Workshop draft area and backend orchestration log."
        )
      )
      store.setFlowDraft(null)
      return
    }
    const payload = (await response.json()) as FlowDraftDocumentPayload
    store.setFlowError("")
    if (!payload.flow || typeof payload.flow !== "object") {
      store.setFlowDraft(null)
      return
    }
    const flow = payload.flow as Partial<FlowEditableDraft>
    if (!flow.start_url || !Array.isArray(flow.steps)) {
      store.setFlowDraft(null)
      return
    }
    const steps = flow.steps as FlowEditableDraft["steps"]
    store.setFlowDraft({
      flow_id: flow.flow_id,
      session_id: flow.session_id,
      start_url: String(flow.start_url),
      generated_at: flow.generated_at,
      source_event_count: flow.source_event_count,
      steps,
    })
    store.setSelectedStepId((prev) => {
      if (prev && steps.some((step) => step.step_id === prev)) return prev
      return steps[0]?.step_id ?? ""
    })
  }, [apiFetch, buildHeaders, formatActionableError, store])

  const fetchStepEvidence = useCallback(
    async (stepId: string) => {
      const requestSeq = ++fetchStepEvidenceRequestSeqRef.current
      const step = stepId.trim()
      if (!step) {
        store.setStepEvidence(null)
        store.setStepEvidenceError("")
        return
      }
      if (!store.evidenceTimeline.some((item) => item.step_id === step)) {
        store.setStepEvidence(null)
        store.setStepEvidenceError("")
        return
      }
      try {
        const response = await apiFetch(
          `/api/command-tower/evidence?step_id=${encodeURIComponent(step)}`,
          {
            headers: buildHeaders(),
          }
        )
        if (requestSeq !== fetchStepEvidenceRequestSeqRef.current) return
        if (!response.ok) {
          if (response.status === 404) {
            store.setStepEvidence(null)
            store.setStepEvidenceError("")
            return
          }
          store.setStepEvidenceError(
            formatActionableError(
              formatApiError("Step evidence loading failed", await readErrorDetail(response)),
              "Run the step first, then inspect its evidence.",
              "Review the step detail view and backend evidence log."
            )
          )
          store.setStepEvidence(null)
          return
        }
        store.setStepEvidenceError("")
        const payload = (await response.json()) as StepEvidencePayload
        if (requestSeq !== fetchStepEvidenceRequestSeqRef.current) return
        store.setStepEvidence(payload)
      } catch (error) {
        if (requestSeq !== fetchStepEvidenceRequestSeqRef.current) return
        const message = error instanceof Error ? error.message : "Step evidence loading failed"
        store.setStepEvidence(null)
        store.setStepEvidenceError(
          formatActionableError(
            message,
            "Run the step first, then inspect its evidence.",
            "Review the step detail view and backend evidence log."
          )
        )
      }
    },
    [apiFetch, buildHeaders, fetchStepEvidenceRequestSeqRef, formatActionableError, store]
  )

  const fetchEvidenceTimeline = useCallback(async () => {
    const response = await apiFetch("/api/command-tower/evidence-timeline", {
      headers: buildHeaders(),
    })
    if (!response.ok) {
      store.setEvidenceTimelineError(
        formatActionableError(
          formatApiError("Evidence timeline loading failed", await readErrorDetail(response)),
          "Confirm that a replay has already run, then refresh the timeline again.",
          "Review the Flow Workshop evidence rail and backend evidence timeline log."
        )
      )
      store.setEvidenceTimeline([])
      return
    }
    const payload = (await response.json()) as EvidenceTimelinePayload
    store.setEvidenceTimelineError("")
    store.setEvidenceTimeline(payload.items ?? [])
  }, [apiFetch, buildHeaders, formatActionableError, store])

  const fetchEvidenceRuns = useCallback(async () => {
    try {
      store.setEvidenceRunsState("loading")
      const payload = await requestJson<EvidenceRunListPayload>(
        "/api/evidence-runs?limit=50",
        "Evidence runs loading failed",
        {
          headers: buildHeaders(),
        }
      )
      store.setEvidenceRuns(payload.runs ?? [])
      store.setEvidenceRegistryState(payload.registry_state ?? "missing")
      store.setEvidenceRunsState((payload.runs ?? []).length > 0 ? "success" : "empty")
      store.setEvidenceRunsError("")
      const baselineRunId = store.selectedEvidenceRunId.trim() || payload.runs?.[0]?.run_id || ""
      store.setSelectedEvidenceCompareCandidateId((prev) => {
        const candidates = (payload.runs ?? []).filter((run) => run.run_id !== baselineRunId)
        if (prev && candidates.some((run) => run.run_id === prev)) return prev
        return candidates.find((run) => run.retention_state === "retained")?.run_id ?? candidates[0]?.run_id ?? ""
      })
      if ((payload.runs ?? []).length === 0) {
        store.setSelectedEvidenceRun(null)
      }
      store.setSelectedEvidenceRunId((prev) => {
        if (prev && (payload.runs ?? []).some((run) => run.run_id === prev)) return prev
        return payload.runs?.[0]?.run_id ?? ""
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Evidence runs loading failed"
      store.setEvidenceRuns([])
      store.setEvidenceRunsState("error")
      store.setEvidenceRunsError(formatActionableError(message))
    }
  }, [buildHeaders, formatActionableError, requestJson, store])

  const fetchEvidenceRunDetail = useCallback(async () => {
    const runId = store.selectedEvidenceRunId.trim()
    if (!runId) {
      store.setSelectedEvidenceRun(null)
      return
    }
    try {
      const payload = await requestJson<{ run: EvidenceRun }>(
        `/api/evidence-runs/${encodeURIComponent(runId)}`,
        "Evidence run detail loading failed",
        {
          headers: buildHeaders(),
        }
      )
      store.setSelectedEvidenceRun(payload.run ?? null)
      store.setEvidenceRunsError("")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Evidence run detail loading failed"
      store.setSelectedEvidenceRun(null)
      store.setEvidenceRunsError(formatActionableError(message))
    }
  }, [buildHeaders, formatActionableError, requestJson, store])

  const fetchEvidenceRunCompare = useCallback(async () => {
    const baselineRunId = store.selectedEvidenceRunId.trim()
    const candidateRunId = resolveCompareCandidateRunId(baselineRunId)
    if (!baselineRunId || !candidateRunId) {
      store.setEvidenceRunCompare(null)
      store.setEvidenceRunCompareState("empty")
      store.setEvidenceRunCompareError("")
      return
    }
    try {
      store.setEvidenceRunCompareState("loading")
      const payload = await requestJson<EvidenceRunComparePayload>(
        `/api/evidence-runs/${encodeURIComponent(baselineRunId)}/compare/${encodeURIComponent(candidateRunId)}`,
        "Evidence run compare failed",
        { headers: buildHeaders() }
      )
      store.setEvidenceRunCompare(payload.compare ?? null)
      store.setEvidenceRunCompareState(payload.compare ? "success" : "empty")
      store.setEvidenceRunCompareError("")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Evidence run compare failed"
      store.setEvidenceRunCompare(null)
      store.setEvidenceRunCompareState("error")
      store.setEvidenceRunCompareError(formatActionableError(message))
    }
  }, [buildHeaders, formatActionableError, requestJson, resolveCompareCandidateRunId, store])

  const fetchEvidenceSharePack = useCallback(async () => {
    const runId = store.selectedEvidenceRunId.trim()
    if (!runId) {
      store.setEvidenceSharePack(null)
      store.setEvidenceSharePackState("empty")
      store.setEvidenceSharePackError("")
      return
    }
    const candidateRunId = resolveCompareCandidateRunId(runId)
    try {
      store.setEvidenceSharePackState("loading")
      const query = candidateRunId ? `?candidate_run_id=${encodeURIComponent(candidateRunId)}` : ""
      const payload = await requestJson<EvidenceSharePackPayload>(
        `/api/evidence-runs/${encodeURIComponent(runId)}/share-pack${query}`,
        "Evidence share pack loading failed",
        { headers: buildHeaders() }
      )
      store.setEvidenceSharePack(payload.share_pack ?? null)
      store.setEvidenceSharePackState(payload.share_pack ? "success" : "empty")
      store.setEvidenceSharePackError("")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Evidence share pack loading failed"
      store.setEvidenceSharePack(null)
      store.setEvidenceSharePackState("error")
      store.setEvidenceSharePackError(formatActionableError(message))
    }
  }, [buildHeaders, formatActionableError, requestJson, resolveCompareCandidateRunId, store])

  const fetchFailureExplanation = useCallback(async () => {
    const runId = store.selectedEvidenceRunId.trim()
    if (!runId) {
      store.setFailureExplanation(null)
      store.setFailureExplanationState("empty")
      store.setFailureExplanationError("")
      return
    }
    const candidateRunId = resolveCompareCandidateRunId(runId)
    try {
      store.setFailureExplanationState("loading")
      const query = candidateRunId ? `?candidate_run_id=${encodeURIComponent(candidateRunId)}` : ""
      const payload = await requestJson<FailureExplanationPayload>(
        `/api/evidence-runs/${encodeURIComponent(runId)}/explain${query}`,
        "Failure explanation loading failed",
        { headers: buildHeaders() }
      )
      store.setFailureExplanation(payload.explanation ?? null)
      store.setFailureExplanationState(payload.explanation ? "success" : "empty")
      store.setFailureExplanationError("")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failure explanation loading failed"
      store.setFailureExplanation(null)
      store.setFailureExplanationState("error")
      store.setFailureExplanationError(formatActionableError(message))
    }
  }, [buildHeaders, formatActionableError, requestJson, resolveCompareCandidateRunId, store])

  const fetchPromotionCandidate = useCallback(async () => {
    const runId = store.selectedEvidenceRunId.trim()
    if (!runId) {
      store.setPromotionCandidate(null)
      store.setPromotionCandidateState("empty")
      store.setPromotionCandidateError("")
      return
    }
    const candidateRunId = resolveCompareCandidateRunId(runId)
    try {
      store.setPromotionCandidateState("loading")
      const query = candidateRunId ? `?candidate_run_id=${encodeURIComponent(candidateRunId)}` : ""
      const payload = await requestJson<PromotionCandidatePayload>(
        `/api/evidence-runs/${encodeURIComponent(runId)}/promotion-candidate${query}`,
        "Promotion candidate loading failed",
        { headers: buildHeaders() }
      )
      store.setPromotionCandidate(payload.candidate ?? null)
      store.setPromotionCandidateState(payload.candidate ? "success" : "empty")
      store.setPromotionCandidateError("")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Promotion candidate loading failed"
      store.setPromotionCandidate(null)
      store.setPromotionCandidateState("error")
      store.setPromotionCandidateError(formatActionableError(message))
    }
  }, [buildHeaders, formatActionableError, requestJson, resolveCompareCandidateRunId, store])

  const fetchHostedReviewWorkspace = useCallback(async () => {
    const runId = store.selectedEvidenceRunId.trim()
    if (!runId) {
      store.setHostedReviewWorkspace(null)
      store.setHostedReviewWorkspaceState("empty")
      store.setHostedReviewWorkspaceError("")
      return
    }
    const candidateRunId = resolveCompareCandidateRunId(runId)
    try {
      store.setHostedReviewWorkspaceState("loading")
      const query = candidateRunId ? `?candidate_run_id=${encodeURIComponent(candidateRunId)}` : ""
      const payload = await requestJson<HostedReviewWorkspacePayload>(
        `/api/evidence-runs/${encodeURIComponent(runId)}/review-workspace${query}`,
        "Review workspace loading failed",
        { headers: buildHeaders() }
      )
      store.setHostedReviewWorkspace(payload.workspace ?? null)
      store.setHostedReviewWorkspaceState(payload.workspace ? "success" : "empty")
      store.setHostedReviewWorkspaceError("")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Review workspace loading failed"
      store.setHostedReviewWorkspace(null)
      store.setHostedReviewWorkspaceState("error")
      store.setHostedReviewWorkspaceError(formatActionableError(message))
    }
  }, [buildHeaders, formatActionableError, requestJson, resolveCompareCandidateRunId, store])

  const fetchStudioData = useCallback(async () => {
    const [flowResp, templateResp, runResp] = await Promise.all([
      apiFetch("/api/flows?limit=100", { headers: buildHeaders() }),
      apiFetch("/api/templates?limit=100", { headers: buildHeaders() }),
      apiFetch("/api/runs?limit=100", { headers: buildHeaders() }),
    ])
    await assertResponseOk(flowResp, "Universal Studio data loading failed")
    await assertResponseOk(templateResp, "Universal Studio data loading failed")
    await assertResponseOk(runResp, "Universal Studio data loading failed")
    const flowPayload = (await flowResp.json()) as { flows: UniversalFlow[] }
    const templatePayload = (await templateResp.json()) as { templates: UniversalTemplate[] }
    const runPayload = (await runResp.json()) as { runs: UniversalRun[] }
    store.setStudioFlows(flowPayload.flows ?? [])
    store.setStudioTemplates(templatePayload.templates ?? [])
    store.setStudioRuns(runPayload.runs ?? [])
    store.setStudioError("")
    store.setSelectedStudioFlowId((prev) => prev || flowPayload.flows?.[0]?.flow_id || "")
    store.setSelectedStudioTemplateId(
      (prev) => prev || templatePayload.templates?.[0]?.template_id || ""
    )
    store.setSelectedStudioRunId((prev) => prev || runPayload.runs?.[0]?.run_id || "")
  }, [apiFetch, assertResponseOk, buildHeaders, store])

  const saveFlowDraft = useCallback(async () => {
    try {
      if (!store.flowDraft) throw new Error("Flow draft is empty")
      await requestJson<unknown>("/api/command-tower/latest-flow-draft", "Flow draft save failed", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...buildHeaders() },
        body: JSON.stringify({ flow: store.flowDraft }),
      })
      store.addLog("success", "Flow draft saved successfully")
      store.pushNotice("success", "Flow draft saved successfully")
      await Promise.all([fetchLatestFlow(), fetchLatestFlowDraft(), fetchEvidenceTimeline()])
      if (store.selectedStepId) await fetchStepEvidence(store.selectedStepId)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Flow draft save failed"
      const formatted = formatActionableError(message)
      store.addLog("error", formatted)
      store.pushNotice("error", formatted)
    }
  }, [
    store,
    requestJson,
    buildHeaders,
    fetchLatestFlow,
    fetchLatestFlowDraft,
    fetchEvidenceTimeline,
    fetchStepEvidence,
    formatActionableError,
  ])

  const replayLatestFlow = useCallback(async () => {
    try {
      const payload = await requestJson<{ task: Task }>(
        "/api/command-tower/replay-latest",
        "Replay trigger failed",
        {
          method: "POST",
          headers: buildHeaders(),
        }
      )
      store.setSelectedTaskId(payload.task.task_id)
      store.addLog("success", `Triggered replay task ${payload.task.task_id}`, payload.task.command_id)
      store.pushNotice("success", "Flow replay triggered")
      await Promise.all([fetchTasks(), fetchDiagnostics(), fetchAlerts(), fetchEvidenceTimeline()])
      if (store.selectedStepId) await fetchStepEvidence(store.selectedStepId)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Replay trigger failed"
      const formatted = formatActionableError(message)
      store.addLog("error", formatted)
      store.pushNotice("error", formatted)
    }
  }, [
    store,
    requestJson,
    buildHeaders,
    fetchTasks,
    fetchDiagnostics,
    fetchAlerts,
    fetchEvidenceTimeline,
    fetchStepEvidence,
    formatActionableError,
  ])

  const replayStep = useCallback(
    async (stepId: string) => {
      try {
        const payload = await requestJson<{ task: Task }>(
          "/api/command-tower/replay-latest-step",
          "Step replay trigger failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...buildHeaders() },
            body: JSON.stringify({ step_id: stepId }),
          }
        )
        store.setSelectedTaskId(payload.task.task_id)
        store.setSelectedStepId(stepId)
        store.addLog(
          "success",
          `Triggered step replay ${stepId} -> ${payload.task.task_id}`,
          payload.task.command_id
        )
        store.pushNotice("success", `Step replay triggered for ${stepId}`)
        await Promise.all([
          fetchTasks(),
          fetchDiagnostics(),
          fetchAlerts(),
          fetchEvidenceTimeline(),
        ])
        await fetchStepEvidence(stepId)
      } catch (error) {
        const message = error instanceof Error ? error.message : "Step replay trigger failed"
        const formatted = formatActionableError(message)
        store.addLog("error", formatted)
        store.pushNotice("error", formatted)
      }
    },
    [
      store,
      requestJson,
      buildHeaders,
      fetchTasks,
      fetchDiagnostics,
      fetchAlerts,
      fetchEvidenceTimeline,
      fetchStepEvidence,
      formatActionableError,
    ]
  )

  const replayFromStep = useCallback(
    async (stepId: string) => {
      try {
        const payload = await requestJson<{ task: Task }>(
          "/api/command-tower/replay-latest-from-step",
          "Resume from step trigger failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...buildHeaders() },
            body: JSON.stringify({
              step_id: stepId,
              replay_preconditions: store.resumeWithPreconditions,
            }),
          }
        )
        store.setSelectedTaskId(payload.task.task_id)
        store.setSelectedStepId(stepId)
        store.addLog(
          "success",
          `Triggered replay resume from step ${stepId} -> ${payload.task.task_id}`,
          payload.task.command_id
        )
        store.pushNotice("success", `Resume from step ${stepId} triggered`)
        await Promise.all([
          fetchTasks(),
          fetchDiagnostics(),
          fetchAlerts(),
          fetchEvidenceTimeline(),
        ])
      } catch (error) {
        const message = error instanceof Error ? error.message : "Resume from step trigger failed"
        const formatted = formatActionableError(message)
        store.addLog("error", formatted)
        store.pushNotice("error", formatted)
      }
    },
    [
      store,
      requestJson,
      buildHeaders,
      fetchTasks,
      fetchDiagnostics,
      fetchAlerts,
      fetchEvidenceTimeline,
      formatActionableError,
    ]
  )

  const refreshDiagnostics = useCallback(() => {
    void Promise.all([
      fetchDiagnostics(),
      fetchAlerts(),
      fetchLatestFlow(),
      fetchLatestFlowDraft(),
      fetchEvidenceTimeline(),
    ])
    if (store.selectedStepId) void fetchStepEvidence(store.selectedStepId)
  }, [
    fetchAlerts,
    fetchDiagnostics,
    fetchEvidenceTimeline,
    fetchLatestFlow,
    fetchLatestFlowDraft,
    fetchStepEvidence,
    store.selectedStepId,
  ])

  return {
    fetchDiagnostics,
    fetchAlerts,
    fetchLatestFlow,
    fetchLatestFlowDraft,
    fetchStepEvidence,
    fetchEvidenceTimeline,
    fetchEvidenceRuns,
    fetchEvidenceRunDetail,
    fetchEvidenceRunCompare,
    fetchEvidenceSharePack,
    fetchFailureExplanation,
    fetchPromotionCandidate,
    fetchHostedReviewWorkspace,
    fetchStudioData,
    saveFlowDraft,
    replayLatestFlow,
    replayStep,
    replayFromStep,
    refreshDiagnostics,
  }
}
