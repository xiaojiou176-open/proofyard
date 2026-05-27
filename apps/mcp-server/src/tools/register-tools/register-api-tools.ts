import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import * as z from "zod"
import { apiRequest } from "../../core/api-client.js"
import { redactSensitiveText } from "../../core/redaction.js"

type ApiResponse = Awaited<ReturnType<typeof apiRequest>>

type ToolInputSchema = Record<string, z.ZodTypeAny>
type JsonMap = Record<string, unknown>

type WorkflowEntity = "flows" | "templates" | "runs"
type WorkflowAction =
  | "list"
  | "get"
  | "import_latest"
  | "export"
  | "create"
  | "update"
  | "otp"
  | "cancel"
type AutomationAction = "list_commands" | "list_tasks" | "get_task" | "run" | "cancel"

type FlowActionInput = {
  action: "list" | "get" | "import_latest" | "create" | "update"
  flowId?: string
  limit?: number
  sessionId?: string
  startUrl?: string
  sourceEventCount?: number
  steps?: Array<JsonMap>
}

type TemplateActionInput = {
  action: "list" | "get" | "export" | "create" | "update"
  templateId?: string
  limit?: number
  flowId?: string
  name?: string
  paramsSchema?: Array<JsonMap>
  defaults?: JsonMap
  policies?: JsonMap
}

type RunActionInput = {
  action: "list" | "get" | "create" | "otp" | "cancel"
  runId?: string
  limit?: number
  templateId?: string
  params?: JsonMap
  otpCode?: string
}

type AutomationActionInput = {
  action: AutomationAction
  status?: string
  commandId?: string
  limit?: number
  taskId?: string
  params?: Record<string, string>
}

type WorkflowAggregateInput = {
  entity: WorkflowEntity
  action: WorkflowAction
  flowId?: string
  templateId?: string
  runId?: string
  limit?: number
  sessionId?: string
  startUrl?: string
  sourceEventCount?: number
  steps?: Array<JsonMap>
  name?: string
  paramsSchema?: Array<JsonMap>
  defaults?: JsonMap
  policies?: JsonMap
  params?: JsonMap
  otpCode?: string
}

function formatApiToolResult(res: ApiResponse): {
  content: Array<{ type: "text"; text: string }>
  isError: boolean
} {
  const payload = sanitizeApiPayload(res)
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    isError: !res.ok,
  }
}

function registerApiTool<TInput extends Record<string, unknown>>(
  mcpServer: McpServer,
  name: string,
  description: string,
  inputSchema: ToolInputSchema,
  handler: (input: TInput) => Promise<ApiResponse>
): void {
  mcpServer.registerTool(name, { description, inputSchema }, async (input) =>
    formatApiToolResult(await handler(input as TInput))
  )
}

function requireNonEmpty(value: string | undefined, fieldName: string, action: string): string {
  if (!String(value ?? "").trim()) throw new Error(`${fieldName} required for action=${action}`)
  return String(value)
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value))
  }
  return query.size ? `?${query.toString()}` : ""
}

async function handleFlowsAction({
  action,
  flowId,
  limit,
  sessionId,
  startUrl,
  sourceEventCount,
  steps,
}: FlowActionInput): Promise<ApiResponse> {
  if (action === "list") {
    return apiRequest(`/api/flows${toQuery({ limit })}`)
  }
  if (action === "get") {
    return apiRequest(`/api/flows/${encodeURIComponent(requireNonEmpty(flowId, "flowId", action))}`)
  }
  if (action === "import_latest") {
    return apiRequest("/api/flows/import-latest", { method: "POST" })
  }
  if (action === "create") {
    return apiRequest("/api/flows", {
      method: "POST",
      body: JSON.stringify({
        session_id: requireNonEmpty(sessionId, "sessionId", action),
        start_url: requireNonEmpty(startUrl, "startUrl", action),
        source_event_count: sourceEventCount,
        steps: steps ?? [],
      }),
    })
  }
  requireNonEmpty(flowId, "flowId", action)
  if (!startUrl && !steps) throw new Error("startUrl or steps required for action=update")
  return apiRequest(`/api/flows/${encodeURIComponent(String(flowId))}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...(startUrl ? { start_url: startUrl } : {}),
      ...(steps ? { steps } : {}),
    }),
  })
}

async function handleTemplatesAction({
  action,
  templateId,
  limit,
  flowId,
  name,
  paramsSchema,
  defaults,
  policies,
}: TemplateActionInput): Promise<ApiResponse> {
  if (action === "list") {
    return apiRequest(`/api/templates${toQuery({ limit })}`)
  }
  if (action === "get") {
    return apiRequest(
      `/api/templates/${encodeURIComponent(requireNonEmpty(templateId, "templateId", action))}`
    )
  }
  if (action === "export") {
    return apiRequest(
      `/api/templates/${encodeURIComponent(requireNonEmpty(templateId, "templateId", action))}/export`
    )
  }
  if (action === "create") {
    return apiRequest("/api/templates", {
      method: "POST",
      body: JSON.stringify({
        flow_id: requireNonEmpty(flowId, "flowId", action),
        name: requireNonEmpty(name, "name", action),
        params_schema: paramsSchema ?? [],
        defaults: defaults ?? {},
        policies: policies ?? {},
      }),
    })
  }
  requireNonEmpty(templateId, "templateId", action)
  if (!name && !paramsSchema && !defaults && !policies) {
    throw new Error(
      "at least one of name/paramsSchema/defaults/policies required for action=update"
    )
  }
  return apiRequest(`/api/templates/${encodeURIComponent(String(templateId))}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...(name ? { name } : {}),
      ...(paramsSchema ? { params_schema: paramsSchema } : {}),
      ...(defaults ? { defaults } : {}),
      ...(policies ? { policies } : {}),
    }),
  })
}

async function handleRunsAction({
  action,
  runId,
  limit,
  templateId,
  params,
  otpCode,
}: RunActionInput): Promise<ApiResponse> {
  if (action === "list") {
    return apiRequest(`/api/runs${toQuery({ limit })}`)
  }
  if (action === "get") {
    return apiRequest(`/api/runs/${encodeURIComponent(requireNonEmpty(runId, "runId", action))}`)
  }
  if (action === "create") {
    return apiRequest("/api/runs", {
      method: "POST",
      body: JSON.stringify({
        template_id: requireNonEmpty(templateId, "templateId", action),
        params: params ?? {},
        ...(otpCode ? { otp_code: otpCode } : {}),
      }),
    })
  }
  if (action === "otp") {
    const resolvedRunId = requireNonEmpty(runId, "runId", action)
    return apiRequest(`/api/runs/${encodeURIComponent(resolvedRunId)}/otp`, {
      method: "POST",
      body: JSON.stringify({ otp_code: requireNonEmpty(otpCode, "otpCode", action) }),
    })
  }
  return apiRequest(
    `/api/runs/${encodeURIComponent(requireNonEmpty(runId, "runId", action))}/cancel`,
    { method: "POST" }
  )
}

async function handleAutomationAction({
  action,
  status,
  commandId,
  limit,
  taskId,
  params,
}: AutomationActionInput): Promise<ApiResponse> {
  if (action === "list_commands") {
    return apiRequest("/api/automation/commands")
  }
  if (action === "list_tasks") {
    return apiRequest(`/api/automation/tasks${toQuery({ status, command_id: commandId, limit })}`)
  }
  if (action === "get_task") {
    return apiRequest(
      `/api/automation/tasks/${encodeURIComponent(requireNonEmpty(taskId, "taskId", action))}`
    )
  }
  if (action === "run") {
    return apiRequest("/api/automation/run", {
      method: "POST",
      body: JSON.stringify({
        command_id: requireNonEmpty(commandId, "commandId", action),
        ...(params ? { params } : {}),
      }),
    })
  }
  return apiRequest(
    `/api/automation/tasks/${encodeURIComponent(requireNonEmpty(taskId, "taskId", action))}/cancel`,
    {
      method: "POST",
    }
  )
}

function assertWorkflowAction(entity: WorkflowEntity, action: WorkflowAction): void {
  const allowedByEntity: Record<WorkflowEntity, WorkflowAction[]> = {
    flows: ["list", "get", "import_latest", "create", "update"],
    templates: ["list", "get", "export", "create", "update"],
    runs: ["list", "get", "create", "otp", "cancel"],
  }
  if (!allowedByEntity[entity].includes(action)) {
    throw new Error(`action=${action} is not supported for entity=${entity}`)
  }
}

export function registerApiTools(mcpServer: McpServer): void {
  registerApiTool(
    mcpServer,
    "uiq_api_workflow",
    "Aggregated workflow API for flows/templates/runs via one tool entrypoint.",
    {
      entity: z.enum(["flows", "templates", "runs"]),
      action: z.enum([
        "list",
        "get",
        "import_latest",
        "export",
        "create",
        "update",
        "otp",
        "cancel",
      ]),
      flowId: z.string().optional(),
      templateId: z.string().optional(),
      runId: z.string().optional(),
      limit: z.number().int().min(1).optional(),
      sessionId: z.string().optional(),
      startUrl: z.string().optional(),
      sourceEventCount: z.number().int().optional(),
      steps: z.array(z.record(z.string(), z.unknown())).optional(),
      name: z.string().optional(),
      paramsSchema: z.array(z.record(z.string(), z.unknown())).optional(),
      defaults: z.record(z.string(), z.unknown()).optional(),
      policies: z.record(z.string(), z.unknown()).optional(),
      params: z.record(z.string(), z.unknown()).optional(),
      otpCode: z.string().optional(),
    },
    async (rawInput) => {
      const input = rawInput as WorkflowAggregateInput
      const { entity, action } = input
      assertWorkflowAction(entity, action)
      if (entity === "flows") {
        return handleFlowsAction({
          action: action as FlowActionInput["action"],
          flowId: input.flowId,
          limit: input.limit,
          sessionId: input.sessionId,
          startUrl: input.startUrl,
          sourceEventCount: input.sourceEventCount,
          steps: input.steps,
        })
      }
      if (entity === "templates") {
        return handleTemplatesAction({
          action: action as TemplateActionInput["action"],
          templateId: input.templateId,
          limit: input.limit,
          flowId: input.flowId,
          name: input.name,
          paramsSchema: input.paramsSchema,
          defaults: input.defaults,
          policies: input.policies,
        })
      }
      return handleRunsAction({
        action: action as RunActionInput["action"],
        runId: input.runId,
        limit: input.limit,
        templateId: input.templateId,
        params: input.params,
        otpCode: input.otpCode,
      })
    }
  )

  registerApiTool(
    mcpServer,
    "uiq_api_automation",
    "Aggregated automation API for list_commands/list_tasks/get_task/run/cancel.",
    {
      action: z.enum(["list_commands", "list_tasks", "get_task", "run", "cancel"]),
      status: z.string().optional(),
      commandId: z.string().optional(),
      limit: z.number().int().min(1).optional(),
      taskId: z.string().optional(),
      params: z.record(z.string(), z.string()).optional(),
      env: z.never().optional().describe("params-only: legacy env payload is not accepted"),
    },
    async (input) => handleAutomationAction(input as AutomationActionInput)
  )
}

function sanitizeApiPayload(res: ApiResponse): unknown {
  if (res.ok) {
    return redactUnknown(res.json ?? res.body)
  }
  if (!res.json && typeof res.body === "string") {
    return redactSensitiveText(res.body)
  }
  if (res.status >= 500) {
    return {
      ok: false,
      status: res.status,
      reasonCode: "UPSTREAM_ERROR",
      detail: "upstream service error",
    }
  }
  const redacted = redactUnknown(res.json ?? res.body)
  if (typeof redacted === "object" && redacted !== null) {
    return redacted
  }
  return {
    ok: false,
    status: res.status,
    reasonCode: "REQUEST_FAILED",
    detail: String(redacted),
  }
}

function redactUnknown(value: unknown): unknown {
  try {
    const serialized = typeof value === "string" ? value : JSON.stringify(value)
    const redacted = redactSensitiveText(serialized)
    return typeof value === "string" ? redacted : JSON.parse(redacted)
  } catch {
    return value
  }
}
