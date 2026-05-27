import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import {
  DEFAULT_GOVERN_RATE_LIMIT_CALLS,
  DEFAULT_GOVERN_RATE_LIMIT_WINDOW_SECONDS,
  DEFAULT_GOVERN_SESSION_BUDGET_MS,
  DEFAULT_GOVERN_TIMEOUT_MS,
  DEFAULT_WORKSPACE_ALLOWLIST_ENV,
  envPositiveInt,
  isPathInside,
  workspaceRoot,
  writeAudit,
} from "./constants.js"
import { redactSensitiveText } from "./redaction.js"
import type { JsonObject, ToolTextResult, UiqRunResult } from "./types.js"

const governedToolState = {
  callTimestampsMs: [] as number[],
  consumedBudgetMs: 0,
}

function governedRateLimitCalls(): number {
  return envPositiveInt("UIQ_MCP_GOVERN_RATE_LIMIT_CALLS", DEFAULT_GOVERN_RATE_LIMIT_CALLS, 1, 1000)
}

function governedRateLimitWindowSeconds(): number {
  return envPositiveInt(
    "UIQ_MCP_GOVERN_RATE_LIMIT_WINDOW_SECONDS",
    DEFAULT_GOVERN_RATE_LIMIT_WINDOW_SECONDS,
    1,
    3600
  )
}

function governedTimeoutMs(): number {
  return envPositiveInt("UIQ_MCP_GOVERN_TIMEOUT_MS", DEFAULT_GOVERN_TIMEOUT_MS, 1, 30 * 60 * 1000)
}

function governedSessionBudgetMs(): number {
  return envPositiveInt(
    "UIQ_MCP_GOVERN_SESSION_BUDGET_MS",
    DEFAULT_GOVERN_SESSION_BUDGET_MS,
    1,
    24 * 60 * 60 * 1000
  )
}

function rateLimitEnabled(): boolean {
  return process.env.UIQ_MCP_GOVERN_RATE_LIMIT_CALLS !== undefined
}

function sessionBudgetEnabled(): boolean {
  return process.env.UIQ_MCP_GOVERN_SESSION_BUDGET_MS !== undefined
}

function normalizeWorkspaceAllowlist(): string[] {
  const raw = process.env[DEFAULT_WORKSPACE_ALLOWLIST_ENV]?.trim()
  const entries = raw
    ? raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [workspaceRoot()]
  if (entries.length === 0) return [workspaceRoot()]
  return entries.map((entry) => resolve(entry))
}

function governedWorkspaceAllowlist(): string[] {
  return normalizeWorkspaceAllowlist().map((entry) => {
    const normalized = entry.trim()
    if (!normalized) {
      throw new Error(`invalid workspace allowlist entry in ${DEFAULT_WORKSPACE_ALLOWLIST_ENV}`)
    }
    try {
      return realpathSync(normalized)
    } catch {
      throw new Error(`workspace allowlist path does not exist: ${normalized}`)
    }
  })
}

export function governedErrorPayload(
  tool: string,
  reasonCode: string,
  detail: string,
  meta?: JsonObject
): { ok: false; tool: string; reasonCode: string; detail: string; meta?: JsonObject } {
  return {
    ok: false,
    tool,
    reasonCode,
    detail,
    ...(meta ? { meta } : {}),
  }
}

export function governedErrorResponse(
  tool: string,
  reasonCode: string,
  detail: string,
  meta?: JsonObject
): ToolTextResult {
  const safeDetail = sanitizeGovernedDetail(reasonCode, detail)
  const payload = governedErrorPayload(tool, reasonCode, safeDetail, sanitizeGovernedMeta(meta))
  writeAudit({
    type: tool,
    ok: false,
    detail: safeDetail,
    meta: { reasonCode, ...(sanitizeGovernedMeta(meta) ?? {}) },
  })
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    isError: true,
  }
}

export function classifyGovernedToolError(
  tool: string,
  error: unknown
): { reasonCode: string; detail: string; meta?: JsonObject } {
  const detail = error instanceof Error ? error.message : String(error)
  if (detail.includes("workspace allowlist")) {
    return { reasonCode: "WORKSPACE_ALLOWLIST_INVALID", detail }
  }
  if (detail.includes("workspace is not allowlisted")) {
    return { reasonCode: "WORKSPACE_NOT_ALLOWLISTED", detail }
  }
  if (detail.includes("rate limit exceeded")) {
    return { reasonCode: "RATE_LIMIT_EXCEEDED", detail }
  }
  if (detail.includes("session budget exceeded")) {
    return { reasonCode: "BUDGET_EXCEEDED", detail }
  }
  if (detail.includes("timed out")) {
    return { reasonCode: "TIMEOUT_BUDGET_EXCEEDED", detail }
  }
  return { reasonCode: "TOOL_EXECUTION_FAILED", detail, meta: { tool } }
}

export function classifyRunFailureReasonCode(result: UiqRunResult): string {
  const detail = result.detail.toLowerCase()
  if (detail.includes("timed out") || detail.includes("etimedout")) return "TIMEOUT_BUDGET_EXCEEDED"
  if (detail.includes("invalid")) return "INVALID_INPUT"
  return "TOOL_EXECUTION_FAILED"
}

function assertGovernedWorkspaceAllowed(tool: string): void {
  const workspace = realpathSync(workspaceRoot())
  const allowlist = governedWorkspaceAllowlist()
  if (!allowlist.some((entry) => isPathInside(entry, workspace))) {
    throw new Error(`workspace is not allowlisted for ${tool}: workspace=${workspace}`)
  }
}

function enforceGovernedRateLimit(tool: string): void {
  if (!rateLimitEnabled()) return
  const now = Date.now()
  const windowMs = governedRateLimitWindowSeconds() * 1000
  const maxCalls = governedRateLimitCalls()
  governedToolState.callTimestampsMs = governedToolState.callTimestampsMs.filter(
    (ts) => now - ts < windowMs
  )
  if (governedToolState.callTimestampsMs.length >= maxCalls) {
    throw new Error(`${tool} rate limit exceeded: ${maxCalls}/${governedRateLimitWindowSeconds()}s`)
  }
  governedToolState.callTimestampsMs.push(now)
}

function resolveGovernedTimeoutMs(tool: string): number {
  if (!sessionBudgetEnabled()) return governedTimeoutMs()
  const remainingBudgetMs = governedSessionBudgetMs() - governedToolState.consumedBudgetMs
  if (remainingBudgetMs <= 0) {
    throw new Error(`${tool} session budget exceeded`)
  }
  return Math.max(1, Math.min(governedTimeoutMs(), remainingBudgetMs))
}

export async function withGovernedExecution<T>(
  tool: string,
  execute: (context: { timeoutMs: number }) => Promise<T>
): Promise<T> {
  assertGovernedWorkspaceAllowed(tool)
  enforceGovernedRateLimit(tool)
  const timeoutMs = resolveGovernedTimeoutMs(tool)
  const startedAt = Date.now()
  try {
    const result = await execute({ timeoutMs })
    const elapsedMs = Date.now() - startedAt
    if (elapsedMs > timeoutMs) {
      throw new Error(`${tool} timed out after ${timeoutMs}ms`)
    }
    return result
  } finally {
    governedToolState.consumedBudgetMs += Date.now() - startedAt
  }
}

function sanitizeGovernedMeta(meta?: JsonObject): JsonObject | undefined {
  if (!meta) return undefined
  try {
    return JSON.parse(redactSensitiveText(JSON.stringify(meta))) as JsonObject
  } catch {
    return undefined
  }
}

function sanitizeGovernedDetail(reasonCode: string, detail: string): string {
  const fallback: Record<string, string> = {
    WORKSPACE_ALLOWLIST_INVALID: "workspace allowlist configuration is invalid",
    WORKSPACE_NOT_ALLOWLISTED: "workspace is not allowed by governance policy",
    RATE_LIMIT_EXCEEDED: "governed tool rate limit exceeded",
    BUDGET_EXCEEDED: "governed session budget exceeded",
    TIMEOUT_BUDGET_EXCEEDED: "governed tool timed out",
    TOOL_EXECUTION_FAILED: "governed tool execution failed",
    INVALID_INPUT: "invalid input",
  }
  const canonical = fallback[reasonCode]
  if (canonical) return canonical
  const redacted = redactSensitiveText(detail)
  return redacted.length > 180 ? `${redacted.slice(0, 180)}...` : redacted
}
