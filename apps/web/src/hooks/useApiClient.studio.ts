import { useCallback } from "react"
import type {
  ConfigStudioDocument,
  ConfigStudioSavePayload,
  ProfileResolvePayload,
  ProfileTargetStudioPayload,
  ReconstructionGeneratePayload,
  ReconstructionPreviewPayload,
  RunRecoveryPlanPayload,
  TemplateReadiness,
  UniversalRun,
} from "../types"
import type { ApiClientTransport } from "./useApiClient.transport"
import type { AppStore, StudioSchemaRow } from "./useAppStore"

type StudioParams = {
  store: AppStore
  transport: ApiClientTransport
  fetchStudioData: () => Promise<void>
  fetchTasks: () => Promise<void>
}

export function useApiClientStudio({
  store,
  transport,
  fetchStudioData,
  fetchTasks,
}: StudioParams) {
  const { buildHeaders, formatActionableError, requestJson, runAction, unwrapRunPayload } =
    transport

  const resolveProfile = useCallback(async () => {
    const payload = await runAction<ProfileResolvePayload>(
      "Profile resolution failed",
      (formatted) => {
        store.setReconstructionError(formatted)
        store.pushNotice("error", formatted)
      },
      async () =>
        requestJson<ProfileResolvePayload>("/api/profiles/resolve", "Profile resolution failed", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...buildHeaders() },
          body: JSON.stringify({
            artifacts: store.reconstructionArtifacts,
            extractor_strategy: store.reconstructionStrategy,
          }),
        })
    )
    if (!payload) return
    store.setProfileResolved(payload)
    store.setReconstructionError("")
  }, [buildHeaders, requestJson, runAction, store])

  const previewReconstruction = useCallback(async () => {
    const payload = await runAction<ReconstructionPreviewPayload>(
      "Reconstruction preview failed",
      (formatted) => {
        store.setReconstructionError(formatted)
        store.pushNotice("error", formatted)
      },
      async () =>
        requestJson<ReconstructionPreviewPayload>("/api/reconstruction/preview", "Reconstruction preview failed", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...buildHeaders() },
          body: JSON.stringify({
            artifacts: store.reconstructionArtifacts,
            video_analysis_mode: store.reconstructionMode,
            extractor_strategy: store.reconstructionStrategy,
            auto_refine_iterations: 3,
          }),
        })
    )
    if (!payload) return
    store.setReconstructionPreview(payload)
    store.setReconstructionGenerated(null)
    store.setReconstructionError("")
  }, [buildHeaders, requestJson, runAction, store])

  const generateReconstruction = useCallback(async () => {
    const payload = await runAction<ReconstructionGeneratePayload>(
      "Reconstruction generation failed",
      (formatted) => {
        store.setReconstructionError(formatted)
        store.pushNotice("error", formatted)
      },
      async () => {
        const preview = store.reconstructionPreview
        if (!preview) throw new Error("Run Preview first")
        return requestJson<ReconstructionGeneratePayload>(
          "/api/reconstruction/generate",
          "Reconstruction generation failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...buildHeaders() },
            body: JSON.stringify({
              preview_id: preview.preview_id,
              template_name: store.studioTemplateName || "reconstructed-template",
              create_run: false,
              run_params: {},
            }),
          }
        )
      }
    )
    if (!payload) return
    store.setReconstructionGenerated(payload)
    store.setReconstructionError("")
    await fetchStudioData()
  }, [buildHeaders, fetchStudioData, requestJson, runAction, store])

  const orchestrateFromArtifacts = useCallback(async () => {
    try {
      await requestJson<unknown>("/api/command-tower/orchestrate-from-artifacts", "Orchestration from artifacts failed", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildHeaders() },
        body: JSON.stringify({
          artifacts: store.reconstructionArtifacts,
          video_analysis_mode: store.reconstructionMode,
          extractor_strategy: store.reconstructionStrategy,
          auto_refine_iterations: 3,
          template_name: store.studioTemplateName || "reconstructed-template",
          create_run: false,
          run_params: {},
        }),
      })
      store.pushNotice("success", "Artifacts orchestration completed")
      await fetchStudioData()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Orchestration from artifacts failed"
      const formatted = formatActionableError(message)
      store.setReconstructionError(formatted)
      store.pushNotice("error", formatted)
    }
  }, [buildHeaders, fetchStudioData, formatActionableError, requestJson, store])

  const buildStudioSchemaPayload = useCallback(() => {
    return store.studioSchemaRows
      .map((row) => (row.key.trim() ? row : null))
      .filter((row): row is StudioSchemaRow => Boolean(row))
      .map((row) => ({
        key: row.key.trim(),
        type: row.type,
        required: row.required,
        description: row.description.trim() || null,
        enum_values:
          row.type === "enum"
            ? row.enum_values
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean)
            : [],
        pattern: row.type === "regex" ? row.pattern.trim() || null : null,
      }))
  }, [store.studioSchemaRows])

  const importLatestFlow = useCallback(async () => {
    const result = await runAction<unknown>(
      "Import latest flow failed",
      (formatted) => {
        store.setStudioError(formatted)
        store.pushNotice("error", formatted)
      },
      async () =>
        requestJson<unknown>("/api/flows/import-latest", "Import latest flow failed", {
          method: "POST",
          headers: buildHeaders(),
        })
    )
    if (result === null) return
    store.pushNotice("success", "Imported the latest flow")
    await fetchStudioData()
  }, [buildHeaders, fetchStudioData, requestJson, runAction, store])

  const createTemplate = useCallback(async () => {
    try {
      const schema = buildStudioSchemaPayload()
      const defaults = { ...store.studioDefaults }
      const policies = {
        retries: store.studioPolicies.retries,
        timeout_seconds: store.studioPolicies.timeout_seconds,
        otp: {
          required: store.studioPolicies.otp.required,
          provider: store.studioPolicies.otp.provider,
          timeout_seconds: store.studioPolicies.otp.timeout_seconds,
          regex: store.studioPolicies.otp.regex,
          sender_filter: store.studioPolicies.otp.sender_filter || null,
          subject_filter: store.studioPolicies.otp.subject_filter || null,
        },
        branches: {},
      }
      const flowId = store.selectedStudioFlowId || store.flowDraft?.flow_id || ""
      if (!flowId) throw new Error("Select a flow first")
      await requestJson<unknown>("/api/templates", "Template creation failed", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildHeaders() },
        body: JSON.stringify({
          flow_id: flowId,
          name: store.studioTemplateName,
          params_schema: schema,
          defaults,
          policies,
        }),
      })
      store.pushNotice("success", "Template created successfully")
      await fetchStudioData()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Template creation failed"
      const formatted = formatActionableError(message)
      store.setStudioError(formatted)
      store.pushNotice("error", formatted)
    }
  }, [
    buildHeaders,
    buildStudioSchemaPayload,
    fetchStudioData,
    formatActionableError,
    requestJson,
    store,
  ])

  const updateTemplate = useCallback(async () => {
    try {
      if (!store.selectedStudioTemplateId) throw new Error("Select a template first")
      const schema = buildStudioSchemaPayload()
      const defaults = { ...store.studioDefaults }
      const policies = {
        retries: store.studioPolicies.retries,
        timeout_seconds: store.studioPolicies.timeout_seconds,
        otp: {
          required: store.studioPolicies.otp.required,
          provider: store.studioPolicies.otp.provider,
          timeout_seconds: store.studioPolicies.otp.timeout_seconds,
          regex: store.studioPolicies.otp.regex,
          sender_filter: store.studioPolicies.otp.sender_filter || null,
          subject_filter: store.studioPolicies.otp.subject_filter || null,
        },
        branches: {},
      }
      await requestJson<unknown>(
        `/api/templates/${store.selectedStudioTemplateId}`,
        "Template update failed",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...buildHeaders() },
          body: JSON.stringify({
            name: store.studioTemplateName,
            params_schema: schema,
            defaults,
            policies,
          }),
        }
      )
      store.pushNotice("success", "Template updated successfully")
      await fetchStudioData()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Template update failed"
      const formatted = formatActionableError(message)
      store.setStudioError(formatted)
      store.pushNotice("error", formatted)
    }
  }, [
    buildHeaders,
    buildStudioSchemaPayload,
    fetchStudioData,
    formatActionableError,
    requestJson,
    store,
  ])

  const createRun = useCallback(async () => {
    try {
      if (!store.selectedStudioTemplateId) throw new Error("Select a template first")
      const payload = await requestJson<unknown>("/api/runs", "Run creation failed", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildHeaders() },
        body: JSON.stringify({
          template_id: store.selectedStudioTemplateId,
          params: { ...store.studioRunParams },
          otp_code: store.studioOtpCode.trim() || undefined,
        }),
      })
      const run = unwrapRunPayload(payload)
      if (run?.run_id) store.setSelectedStudioRunId(run.run_id)
      store.pushNotice("success", "Run created successfully")
      await Promise.all([fetchStudioData(), fetchTasks()])
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : "Run creation failed"
      const formatted = formatActionableError(message)
      store.setStudioError(formatted)
      store.pushNotice("error", formatted)
      return false
    }
  }, [
    buildHeaders,
    fetchStudioData,
    fetchTasks,
    formatActionableError,
    requestJson,
    store,
    unwrapRunPayload,
  ])

  const submitRunOtp = useCallback(
    async (
      runId: string,
      status: UniversalRun["status"],
      waitContext?: UniversalRun["wait_context"]
    ) => {
      try {
        const isProviderProtectedWaitingUser =
          status === "waiting_user" &&
          waitContext?.reason_code === "provider_protected_payment_step"
        const inputLabel =
          status === "waiting_otp"
            ? "OTP"
            : isProviderProtectedWaitingUser
              ? "continue action"
              : "additional input"
        const normalizedOtpCode = store.studioOtpCode.trim()
        if (!normalizedOtpCode && !isProviderProtectedWaitingUser) {
          throw new Error(`Enter the required ${inputLabel}`)
        }
        const payload = await requestJson<unknown>(
          `/api/runs/${runId}/otp`,
          `Submitting ${inputLabel} failed`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...buildHeaders() },
            body: JSON.stringify({ otp_code: normalizedOtpCode || "" }),
          }
        )
        const run = unwrapRunPayload(payload)
        if (run?.run_id) store.setSelectedStudioRunId(run.run_id)
        store.pushNotice("success", `${inputLabel} submitted and the run resumed`)
        await Promise.all([fetchStudioData(), fetchTasks()])
      } catch (error) {
        const isProviderProtectedWaitingUser =
          status === "waiting_user" &&
          waitContext?.reason_code === "provider_protected_payment_step"
        const inputLabel =
          status === "waiting_otp"
            ? "OTP"
            : isProviderProtectedWaitingUser
              ? "continue action"
              : "additional input"
        const message = error instanceof Error ? error.message : `Submitting ${inputLabel} failed`
        const formatted = formatActionableError(message)
        store.setStudioError(formatted)
        store.pushNotice("error", formatted)
      }
    },
    [
      buildHeaders,
      fetchStudioData,
      fetchTasks,
      formatActionableError,
      requestJson,
      store,
      unwrapRunPayload,
    ]
  )

  const refreshStudio = useCallback(() => {
    void fetchStudioData().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Universal Studio refresh failed"
      store.setStudioError(formatActionableError(message))
    })
  }, [fetchStudioData, formatActionableError, store])

  const fetchRunRecoveryPlan = useCallback(async () => {
    const runId = store.selectedStudioRunId.trim()
    if (!runId) {
      store.setRunRecoveryPlan(null)
      store.setRunRecoveryPlanState("empty")
      store.setRunRecoveryPlanError("")
      return
    }
    try {
      store.setRunRecoveryPlanState("loading")
      const payload = await requestJson<RunRecoveryPlanPayload>(
        `/api/runs/${encodeURIComponent(runId)}/recover-plan`,
        "Run recovery plan loading failed",
        {
          headers: buildHeaders(),
        }
      )
      store.setRunRecoveryPlan(payload.plan ?? null)
      store.setRunRecoveryPlanState(payload.plan ? "success" : "empty")
      store.setRunRecoveryPlanError("")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Run recovery plan loading failed"
      const formatted = formatActionableError(message)
      store.setRunRecoveryPlan(null)
      store.setRunRecoveryPlanState("error")
      store.setRunRecoveryPlanError(formatted)
    }
  }, [buildHeaders, formatActionableError, requestJson, store])

  const fetchTemplateReadiness = useCallback(async () => {
    const templateId = store.selectedStudioTemplateId.trim()
    if (!templateId) {
      store.setTemplateReadiness(null)
      store.setTemplateReadinessState("empty")
      store.setTemplateReadinessError("")
      return
    }
    try {
      store.setTemplateReadinessState("loading")
      const payload = await requestJson<TemplateReadiness>(
        `/api/templates/${encodeURIComponent(templateId)}/readiness`,
        "Template readiness loading failed",
        { headers: buildHeaders() }
      )
      store.setTemplateReadiness(payload)
      store.setTemplateReadinessState("success")
      store.setTemplateReadinessError("")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Template readiness loading failed"
      const formatted = formatActionableError(message)
      store.setTemplateReadiness(null)
      store.setTemplateReadinessState("error")
      store.setTemplateReadinessError(formatted)
    }
  }, [buildHeaders, formatActionableError, requestJson, store])

  const fetchProfileTargetStudio = useCallback(
    async (options?: { profileName?: string; targetName?: string }) => {
      try {
        store.setProfileTargetStudioState("loading")
        const query = new URLSearchParams()
        const profileName = options?.profileName?.trim() || store.selectedProfileStudioName.trim()
        const targetName = options?.targetName?.trim() || store.selectedTargetStudioName.trim()
        if (profileName) query.set("profile_name", profileName)
        if (targetName) query.set("target_name", targetName)
        const suffix = query.size > 0 ? `?${query.toString()}` : ""
        const payload = await requestJson<ProfileTargetStudioPayload>(
          `/api/profiles/studio${suffix}`,
          "Profile/target studio loading failed",
          {
            headers: buildHeaders(),
          }
        )
        store.setProfileStudioOptions(payload.profile_options ?? [])
        store.setTargetStudioOptions(payload.target_options ?? [])
        store.setSelectedProfileStudioName(payload.selected_profile ?? "")
        store.setSelectedTargetStudioName(payload.selected_target ?? "")
        store.setProfileStudioDocument(payload.profile ?? null)
        store.setTargetStudioDocument(payload.target ?? null)
        store.setProfileTargetStudioState("success")
        store.setProfileTargetStudioError("")
      } catch (error) {
        const message = error instanceof Error ? error.message : "Profile/target studio loading failed"
        const formatted = formatActionableError(message)
        store.setProfileTargetStudioState("error")
        store.setProfileTargetStudioError(formatted)
      }
    },
    [buildHeaders, formatActionableError, requestJson, store]
  )

  const saveConfigStudio = useCallback(
    async (kind: "profile" | "target", configName: string, updates: Record<string, unknown>) => {
      try {
        const payload = await requestJson<ConfigStudioSavePayload>(
          `/api/profiles/studio/${kind === "profile" ? "profiles" : "targets"}/${encodeURIComponent(configName)}`,
          "Profile/target studio save failed",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...buildHeaders() },
            body: JSON.stringify({ updates }),
          }
        )
        const document = payload.document as ConfigStudioDocument | null
        if (kind === "profile") {
          store.setProfileStudioDocument(document)
        } else {
          store.setTargetStudioDocument(document)
        }
        store.pushNotice("success", `${kind === "profile" ? "Profile" : "Target"} studio changes saved`)
        store.setProfileTargetStudioError("")
        store.setProfileTargetStudioState("success")
        return true
      } catch (error) {
        const message = error instanceof Error ? error.message : "Profile/target studio save failed"
        const formatted = formatActionableError(message)
        store.setProfileTargetStudioError(formatted)
        store.setProfileTargetStudioState("error")
        store.pushNotice("error", formatted)
        return false
      }
    },
    [buildHeaders, formatActionableError, requestJson, store]
  )

  return {
    resolveProfile,
    previewReconstruction,
    generateReconstruction,
    orchestrateFromArtifacts,
    importLatestFlow,
    createTemplate,
    updateTemplate,
    createRun,
    submitRunOtp,
    fetchRunRecoveryPlan,
    fetchTemplateReadiness,
    fetchProfileTargetStudio,
    saveConfigStudio,
    refreshStudio,
  }
}
