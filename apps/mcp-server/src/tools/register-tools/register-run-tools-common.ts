import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { apiRequest, backendBaseUrl, backendToken } from "../../core/api-client.js"
import {
  ensureDirReady,
  repoRoot,
  runsRoot,
  workspaceRoot,
  writeAudit,
} from "../../core/constants.js"
import { sanitizeProfileTarget } from "../../core/redaction.js"
import type { RunOverrideValues } from "../../core/types.js"
import {
  appendRunOverrides,
  desktopInputWarnings,
  latestRunId,
  listYamlStemNames,
  runUiqSync,
} from "./shared.js"

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>
  isError?: boolean
}

type SelfcheckItem = { name: string; ok: boolean; detail: string }

export type ServerSelfcheckResult = {
  ok: boolean
  checks: SelfcheckItem[]
  latestRunId: string | null
  backendBaseUrl: string
  tokenConfigured: boolean
}

export const LOCALHOST_DEEP_LOAD_PROFILE = "deep-localhost"
export const LOCALHOST_DEEP_LOAD_TARGET = "web.any-localhost"
export const LOCALHOST_DEEP_LOAD_BASE_URL = "http://127.0.0.1:4173"

export function executeRunCommand(args: {
  command: string
  profile?: string
  target?: string
  runId?: string
  extraArgs?: string[]
  overrides?: RunOverrideValues
}): { result: ReturnType<typeof runUiqSync>; warnings: string[] } {
  const safeTarget = args.target ? sanitizeProfileTarget("target", args.target) : undefined
  const safeProfile = args.profile ? sanitizeProfileTarget("profile", args.profile) : undefined
  const commandArgs = [args.command]
  if (args.extraArgs) commandArgs.push(...args.extraArgs)
  if (safeTarget) commandArgs.push("--target", safeTarget)
  if (safeProfile) commandArgs.push("--profile", safeProfile)
  if (args.runId) commandArgs.push("--run-id", args.runId)
  const overrides = args.overrides ?? {}
  appendRunOverrides(commandArgs, overrides)
  return {
    result: runUiqSync(commandArgs),
    warnings: desktopInputWarnings({
      command: args.command,
      profile: safeProfile,
      target: safeTarget,
      app: typeof overrides.app === "string" ? overrides.app : undefined,
      bundleId: typeof overrides.bundleId === "string" ? overrides.bundleId : undefined,
    }),
  }
}

export function toolJson(payload: unknown, isError = false): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  }
}

export function invalidInput(detail: string): ToolResult {
  return toolJson({ ok: false, detail }, true)
}

export function sanitizeSlugInput(label: string, value: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label} is required`)
  if (!/^[A-Za-z0-9._-]+$/.test(normalized)) {
    throw new Error(`Invalid ${label}; only [A-Za-z0-9._-] are allowed`)
  }
  return normalized
}

export function proofCampaignsRootPath(): string {
  return resolve(workspaceRoot(), ".runtime-cache/artifacts/proof-campaigns")
}

export function writeJson(absPath: string, payload: unknown): void {
  writeFileSync(absPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

export async function runServerSelfcheck(): Promise<ServerSelfcheckResult> {
  const profiles = listYamlStemNames(resolve(workspaceRoot(), "profiles"))
  const targets = listYamlStemNames(resolve(workspaceRoot(), "targets"))
  const latest = latestRunId() ?? null
  const checks: SelfcheckItem[] = []
  checks.push({
    name: "profiles_present",
    ok: profiles.length > 0,
    detail: `profiles=${profiles.length}`,
  })
  checks.push({
    name: "targets_present",
    ok: targets.length > 0,
    detail: `targets=${targets.length}`,
  })
  checks.push({ name: "runs_dir", ok: ensureDirReady(runsRoot()), detail: runsRoot() })
  checks.push({
    name: "audit_log_dir",
    ok: ensureDirReady(resolve(repoRoot(), ".runtime-cache/logs")),
    detail: ".runtime-cache/logs",
  })

  let backendOk = false
  let backendDetail = ""
  try {
    const res = await apiRequest("/health/")
    backendOk = res.ok
    backendDetail = `status=${res.status} baseUrl=${backendBaseUrl()}`
  } catch (error) {
    backendOk = false
    backendDetail = `error=${(error as Error).message}`
  }
  checks.push({ name: "backend_health", ok: backendOk, detail: backendDetail })

  return {
    ok: checks.every((item) => item.ok),
    checks,
    latestRunId: latest,
    backendBaseUrl: backendBaseUrl(),
    tokenConfigured: Boolean(backendToken()),
  }
}

export function writeSelfcheckAudit(result: ServerSelfcheckResult): void {
  writeAudit({
    type: "server_selfcheck",
    ok: result.ok,
    detail: result.checks.map((c) => `${c.name}:${c.ok}`).join(","),
  })
}
