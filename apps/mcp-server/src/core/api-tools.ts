import * as z from "zod"
import { apiRequestTimeoutMs, backendBaseUrl, backendToken, writeAudit } from "./io.js"

export type RegisterToolWithPolicy = <TInput extends z.ZodRawShape>(
  toolName: string,
  config: {
    title?: string
    description?: string
    inputSchema: TInput
    outputSchema?: z.ZodRawShape | z.ZodTypeAny
    annotations?: unknown
    _meta?: Record<string, unknown>
  },
  handler: (args: z.infer<z.ZodObject<TInput>>, extra: unknown) => unknown
) => void

export async function apiRequest(
  path: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; body: string; json?: unknown }> {
  const url = new URL(
    path.startsWith("/") ? path : `/${path}`,
    `${backendBaseUrl().replace(/\/+$/, "")}/`
  ).toString()
  const headers = new Headers(init?.headers ?? {})
  if (!headers.has("content-type") && init?.body) {
    headers.set("content-type", "application/json")
  }
  const token = backendToken()
  if (token) headers.set("x-automation-token", token)
  const timeoutMs = apiRequestTimeoutMs()
  const controller = new AbortController()
  const externalSignal = init?.signal
  const onExternalAbort = () => controller.abort(externalSignal?.reason)
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort(externalSignal.reason)
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true })
  }
  const timeoutHandle = setTimeout(
    () => controller.abort(new Error(`request timeout after ${timeoutMs}ms`)),
    timeoutMs
  )

  const { signal: _ignoredSignal, ...restInit } = init ?? {}
  try {
    const response = await fetch(url, { ...restInit, headers, signal: controller.signal })
    const body = await response.text()
    let json: unknown
    try {
      json = body ? JSON.parse(body) : undefined
    } catch {
      json = undefined
    }
    const result = { ok: response.ok, status: response.status, body, json }
    writeAudit({
      type: "api_request",
      ok: result.ok,
      detail: `${init?.method ?? "GET"} ${path} -> ${result.status}`,
      meta: { baseUrl: backendBaseUrl(), timeoutMs },
    })
    return result
  } catch (error) {
    const isTimeout = controller.signal.aborted && !externalSignal?.aborted
    const err = error as Error
    const payload = {
      ok: false,
      error: {
        code: isTimeout ? "REQUEST_TIMEOUT" : "NETWORK_ERROR",
        message: err.message,
        path,
        method: init?.method ?? "GET",
        timeoutMs,
      },
    }
    writeAudit({
      type: "api_request",
      ok: false,
      detail: `${init?.method ?? "GET"} ${path} -> ${payload.error.code}: ${payload.error.message}`,
      meta: { baseUrl: backendBaseUrl(), timeoutMs },
    })
    return { ok: false, status: 0, body: JSON.stringify(payload), json: payload }
  } finally {
    clearTimeout(timeoutHandle)
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort)
  }
}

export function registerApiTools(registerToolWithPolicy: RegisterToolWithPolicy): void {
  const runInputSchema: Record<string, z.ZodTypeAny> = {
    commandId: z.string(),
    params: z.record(z.string(), z.string()).optional(),
    env: z.never().optional().describe("params-only: legacy env payload is not accepted"),
  }

  registerToolWithPolicy(
    "uiq_api_automation_commands",
    { description: "GET /api/automation/commands", inputSchema: {} },
    async () => {
      const res = await apiRequest("/api/automation/commands")
      return {
        content: [{ type: "text", text: JSON.stringify(res.json ?? res.body, null, 2) }],
        isError: !res.ok,
      }
    }
  )

  registerToolWithPolicy(
    "uiq_api_automation_tasks",
    {
      description: "GET /api/automation/tasks",
      inputSchema: {
        status: z.string().optional(),
        commandId: z.string().optional(),
        limit: z.number().int().optional(),
      },
    },
    async ({ status, commandId, limit }) => {
      const qp = new URLSearchParams()
      if (status) qp.set("status", status)
      if (commandId) qp.set("command_id", commandId)
      if (limit !== undefined) qp.set("limit", String(limit))
      const res = await apiRequest(`/api/automation/tasks${qp.size ? `?${qp.toString()}` : ""}`)
      return {
        content: [{ type: "text", text: JSON.stringify(res.json ?? res.body, null, 2) }],
        isError: !res.ok,
      }
    }
  )

  registerToolWithPolicy(
    "uiq_api_automation_task",
    { description: "GET /api/automation/tasks/{taskId}", inputSchema: { taskId: z.string() } },
    async ({ taskId }) => {
      const res = await apiRequest(`/api/automation/tasks/${encodeURIComponent(taskId)}`)
      return {
        content: [{ type: "text", text: JSON.stringify(res.json ?? res.body, null, 2) }],
        isError: !res.ok,
      }
    }
  )

  registerToolWithPolicy(
    "uiq_api_automation_run",
    {
      description: "POST /api/automation/run (params only)",
      inputSchema: runInputSchema,
    },
    async (rawArgs) => {
      const { commandId, params } = rawArgs as {
        commandId: string
        params?: Record<string, string>
      }
      const payload = {
        command_id: commandId,
        ...(params ? { params } : {}),
      }
      const res = await apiRequest("/api/automation/run", {
        method: "POST",
        body: JSON.stringify(payload),
      })
      return {
        content: [{ type: "text", text: JSON.stringify(res.json ?? res.body, null, 2) }],
        isError: !res.ok,
      }
    }
  )

  registerToolWithPolicy(
    "uiq_api_automation_cancel",
    {
      description: "POST /api/automation/tasks/{taskId}/cancel",
      inputSchema: { taskId: z.string() },
    },
    async ({ taskId }) => {
      const res = await apiRequest(`/api/automation/tasks/${encodeURIComponent(taskId)}/cancel`, {
        method: "POST",
      })
      return {
        content: [{ type: "text", text: JSON.stringify(res.json ?? res.body, null, 2) }],
        isError: !res.ok,
      }
    }
  )

  registerToolWithPolicy(
    "uiq_api_flows",
    {
      description: "Universal flows API: list|get|import_latest|create|update",
      inputSchema: {
        action: z.enum(["list", "get", "import_latest", "create", "update"]),
        flowId: z.string().optional(),
        limit: z.number().int().optional(),
        sessionId: z.string().optional(),
        startUrl: z.string().optional(),
        sourceEventCount: z.number().int().optional(),
        steps: z.array(z.record(z.string(), z.unknown())).optional(),
      },
    },
    async ({ action, flowId, limit, sessionId, startUrl, sourceEventCount, steps }) => {
      let res
      if (action === "list") {
        const qp = new URLSearchParams()
        if (limit !== undefined) qp.set("limit", String(limit))
        res = await apiRequest(`/api/flows${qp.size ? `?${qp.toString()}` : ""}`)
      } else if (action === "get") {
        if (!flowId) throw new Error("flowId required for action=get")
        res = await apiRequest(`/api/flows/${encodeURIComponent(flowId)}`)
      } else if (action === "import_latest") {
        res = await apiRequest("/api/flows/import-latest", { method: "POST" })
      } else if (action === "create") {
        res = await apiRequest("/api/flows", {
          method: "POST",
          body: JSON.stringify({
            session_id: sessionId,
            start_url: startUrl,
            source_event_count: sourceEventCount,
            steps: steps ?? [],
          }),
        })
      } else {
        if (!flowId) throw new Error("flowId required for action=update")
        res = await apiRequest(`/api/flows/${encodeURIComponent(flowId)}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...(startUrl ? { start_url: startUrl } : {}),
            ...(steps ? { steps } : {}),
          }),
        })
      }
      return {
        content: [{ type: "text", text: JSON.stringify(res.json ?? res.body, null, 2) }],
        isError: !res.ok,
      }
    }
  )

  registerToolWithPolicy(
    "uiq_api_templates",
    {
      description: "Universal templates API: list|get|export|create|update",
      inputSchema: {
        action: z.enum(["list", "get", "export", "create", "update"]),
        templateId: z.string().optional(),
        limit: z.number().int().optional(),
        flowId: z.string().optional(),
        name: z.string().optional(),
        paramsSchema: z.array(z.record(z.string(), z.unknown())).optional(),
        defaults: z.record(z.string(), z.unknown()).optional(),
        policies: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async ({ action, templateId, limit, flowId, name, paramsSchema, defaults, policies }) => {
      let res
      if (action === "list") {
        const qp = new URLSearchParams()
        if (limit !== undefined) qp.set("limit", String(limit))
        res = await apiRequest(`/api/templates${qp.size ? `?${qp.toString()}` : ""}`)
      } else if (action === "get") {
        if (!templateId) throw new Error("templateId required for action=get")
        res = await apiRequest(`/api/templates/${encodeURIComponent(templateId)}`)
      } else if (action === "export") {
        if (!templateId) throw new Error("templateId required for action=export")
        res = await apiRequest(`/api/templates/${encodeURIComponent(templateId)}/export`)
      } else if (action === "create") {
        res = await apiRequest("/api/templates", {
          method: "POST",
          body: JSON.stringify({
            flow_id: flowId,
            name,
            params_schema: paramsSchema ?? [],
            defaults: defaults ?? {},
            policies: policies ?? {},
          }),
        })
      } else {
        if (!templateId) throw new Error("templateId required for action=update")
        res = await apiRequest(`/api/templates/${encodeURIComponent(templateId)}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...(name ? { name } : {}),
            ...(paramsSchema ? { params_schema: paramsSchema } : {}),
            ...(defaults ? { defaults } : {}),
            ...(policies ? { policies } : {}),
          }),
        })
      }
      return {
        content: [{ type: "text", text: JSON.stringify(res.json ?? res.body, null, 2) }],
        isError: !res.ok,
      }
    }
  )

  registerToolWithPolicy(
    "uiq_api_runs",
    {
      description: "Universal runs API: list|get|create|otp|cancel",
      inputSchema: {
        action: z.enum(["list", "get", "create", "otp", "cancel"]),
        runId: z.string().optional(),
        limit: z.number().int().optional(),
        templateId: z.string().optional(),
        params: z.record(z.string(), z.unknown()).optional(),
        otpCode: z.string().optional(),
      },
    },
    async ({ action, runId, limit, templateId, params, otpCode }) => {
      let res
      if (action === "list") {
        const qp = new URLSearchParams()
        if (limit !== undefined) qp.set("limit", String(limit))
        res = await apiRequest(`/api/runs${qp.size ? `?${qp.toString()}` : ""}`)
      } else if (action === "get") {
        if (!runId) throw new Error("runId required for action=get")
        res = await apiRequest(`/api/runs/${encodeURIComponent(runId)}`)
      } else if (action === "create") {
        res = await apiRequest("/api/runs", {
          method: "POST",
          body: JSON.stringify({
            template_id: templateId,
            params: params ?? {},
            ...(otpCode ? { otp_code: otpCode } : {}),
          }),
        })
      } else if (action === "otp") {
        if (!runId) throw new Error("runId required for action=otp")
        res = await apiRequest(`/api/runs/${encodeURIComponent(runId)}/otp`, {
          method: "POST",
          body: JSON.stringify({ otp_code: otpCode }),
        })
      } else {
        if (!runId) throw new Error("runId required for action=cancel")
        res = await apiRequest(`/api/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" })
      }
      return {
        content: [{ type: "text", text: JSON.stringify(res.json ?? res.body, null, 2) }],
        isError: !res.ok,
      }
    }
  )

  registerToolWithPolicy(
    "uiq_api_reconstruction_preview",
    {
      description: "POST /api/reconstruction/preview",
      inputSchema: {
        artifacts: z.record(z.string(), z.unknown()),
        videoAnalysisMode: z.enum(["gemini", "ensemble"]).optional(),
        extractorStrategy: z.enum(["strict", "balanced", "aggressive"]).optional(),
        autoRefineIterations: z.number().int().min(1).max(10).optional(),
      },
    },
    async ({ artifacts, videoAnalysisMode, extractorStrategy, autoRefineIterations }) => {
      const payload = {
        artifacts,
        ...(videoAnalysisMode ? { video_analysis_mode: videoAnalysisMode } : {}),
        ...(extractorStrategy ? { extractor_strategy: extractorStrategy } : {}),
        ...(autoRefineIterations !== undefined
          ? { auto_refine_iterations: autoRefineIterations }
          : {}),
      }
      const res = await apiRequest("/api/reconstruction/preview", {
        method: "POST",
        body: JSON.stringify(payload),
      })
      return {
        content: [{ type: "text", text: JSON.stringify(res.json ?? res.body, null, 2) }],
        isError: !res.ok,
      }
    }
  )

  registerToolWithPolicy(
    "uiq_api_reconstruction_generate",
    {
      description: "POST /api/reconstruction/generate",
      inputSchema: {
        previewId: z.string().optional(),
        preview: z.record(z.string(), z.unknown()).optional(),
        templateName: z.string().optional(),
        createRun: z.boolean().optional(),
        runParams: z.record(z.string(), z.string()).optional(),
      },
    },
    async ({ previewId, preview, templateName, createRun, runParams }) => {
      const payload = {
        ...(previewId ? { preview_id: previewId } : {}),
        ...(preview ? { preview } : {}),
        ...(templateName ? { template_name: templateName } : {}),
        ...(createRun !== undefined ? { create_run: createRun } : {}),
        ...(runParams ? { run_params: runParams } : {}),
      }
      const res = await apiRequest("/api/reconstruction/generate", {
        method: "POST",
        body: JSON.stringify(payload),
      })
      return {
        content: [{ type: "text", text: JSON.stringify(res.json ?? res.body, null, 2) }],
        isError: !res.ok,
      }
    }
  )

  registerToolWithPolicy(
    "uiq_api_profiles_resolve",
    {
      description: "POST /api/profiles/resolve",
      inputSchema: {
        artifacts: z.record(z.string(), z.unknown()),
        extractorStrategy: z.enum(["strict", "balanced", "aggressive"]).optional(),
      },
    },
    async ({ artifacts, extractorStrategy }) => {
      const payload = {
        artifacts,
        ...(extractorStrategy ? { extractor_strategy: extractorStrategy } : {}),
      }
      const res = await apiRequest("/api/profiles/resolve", {
        method: "POST",
        body: JSON.stringify(payload),
      })
      return {
        content: [{ type: "text", text: JSON.stringify(res.json ?? res.body, null, 2) }],
        isError: !res.ok,
      }
    }
  )
}
