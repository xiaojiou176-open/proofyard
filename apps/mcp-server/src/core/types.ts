import * as z from "zod"

export type JsonObject = Record<string, unknown>

export type StreamEvent = {
  ts: string
  stream: "stdout" | "stderr"
  line: string
}

export type UiqRunResult = {
  ok: boolean
  detail: string
  stdout: string
  stderr: string
  runId?: string
  manifest?: string
  exitCode: number | null
}

export type RuntimeState = {
  running: boolean
  pid: number | null
  port: number | null
  baseUrl: string
  healthOk: boolean
  pidFile: string
  portFile: string
  logFile: string
}

export type SessionRecordLike = {
  session_id?: string
  start_url?: string
  mode?: string
  started_at?: string
  finished_at?: string
}
export type FlowRecordLike = { flow_id?: string; session_id?: string; start_url?: string }
export type TemplateRecordLike = {
  template_id?: string
  flow_id?: string
  name?: string
  params_schema?: unknown[]
  defaults?: JsonObject
  policies?: JsonObject
}
export type RunRecordLike = {
  run_id?: string
  status?: string
  template_id?: string
  task_id?: string | null
  last_error?: string | null
  updated_at?: string
  logs?: unknown[]
}

export type ToolTextResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean }
export type GovernedToolName = "uiq_run_profile" | "uiq_read_manifest" | "uiq_summarize_failures"

export type GovernedErrorPayload = {
  ok: false
  tool: GovernedToolName
  reasonCode: string
  detail: string
  meta?: JsonObject
}

export const runOverrideSchema = {
  baseUrl: z.string().optional(),
  app: z.string().optional(),
  bundleId: z.string().optional(),
  diagnosticsMaxItems: z.number().int().optional(),
  exploreBudgetSeconds: z.number().int().optional(),
  exploreMaxDepth: z.number().int().optional(),
  exploreMaxStates: z.number().int().optional(),
  chaosSeed: z.number().int().optional(),
  chaosBudgetSeconds: z.number().int().optional(),
  chaosClickRatio: z.number().optional(),
  chaosInputRatio: z.number().optional(),
  chaosScrollRatio: z.number().optional(),
  chaosKeyboardRatio: z.number().optional(),
  loadVus: z.number().int().optional(),
  loadDurationSeconds: z.number().int().optional(),
  loadRequestTimeoutMs: z.number().int().optional(),
  loadEngine: z.enum(["builtin", "artillery", "k6", "both"]).optional(),
  a11yMaxIssues: z.number().int().optional(),
  a11yEngine: z.enum(["axe", "builtin"]).optional(),
  perfPreset: z.enum(["mobile", "desktop"]).optional(),
  perfEngine: z.enum(["lhci", "builtin"]).optional(),
  visualMode: z.enum(["diff", "update"]).optional(),
  soakDurationSeconds: z.number().int().optional(),
  soakIntervalSeconds: z.number().int().optional(),
  autostartTarget: z.boolean().optional(),
} as const

export type RunOverrideValues = Partial<Record<keyof typeof runOverrideSchema, unknown>>
