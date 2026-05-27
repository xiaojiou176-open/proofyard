import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readdir, realpath, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Page } from "playwright"
import { AUTOMATION_ENV } from "./lib/env.js"

export type RecordMode = "manual" | "midscene"

export type MidsceneTakeoverContext = {
  page: Page
  startUrl: string
  suggestedEmail: string
  suggestedPassword: string
  successSelector: string
}

export type MidsceneDriverModule = {
  runMidsceneTakeover: (context: MidsceneTakeoverContext) => Promise<void>
}

export type SessionMeta = {
  sessionId: string
  mode: RecordMode
  baseUrl: string
  startUrl: string
  suggestedEmail: string
  outputDir: string
  harPath: string | null
  tracePath: string | null
  htmlPath: string | null
  eventLogPath: string
  flowDraftPath: string
  storageStatePath: string | null
  videoDir: string | null
  midsceneDriverPath: string | null
  capturePolicy: {
    allowSensitiveCapture: boolean
    allowSensitiveTrace: boolean
    allowSensitiveStorage: boolean
    allowSensitiveInputValues: boolean
    captureHar: boolean
    captureVideo: boolean
    captureHtml: boolean
  }
  createdAt: string
}

export type CapturedEvent = {
  ts: string
  type: "navigate" | "click" | "type" | "change" | "submit" | "keydown"
  url: string
  target: {
    tag: string
    id: string | null
    name: string | null
    type: string | null
    role: string | null
    text: string | null
    classes: string[]
    cssPath: string
  }
  value?: string
  key?: string
}

export type FlowStep = {
  step_id: string
  action: "navigate" | "click" | "type"
  url?: string
  value_ref?: string
  gate_policy?: "auto" | "force_manual" | "forbid_manual"
  gate_reason?: string
  target?: {
    selectors: Array<{
      kind: "role" | "css" | "id" | "name"
      value: string
      score: number
    }>
  }
}

type SelectorCandidate = NonNullable<FlowStep["target"]>["selectors"][number]

export type FlowDraft = {
  flow_id: string
  session_id: string
  start_url: string
  generated_at: string
  source_event_count: number
  steps: FlowStep[]
}

export type ProtectedProviderConfig = {
  protectedProviderDomains: string[]
  protectedProviderGatePolicy: "auto" | "force_manual" | "forbid_manual"
}

const DEFAULT_PROTECTED_PROVIDER_DOMAINS = ["stripe.com", "js.stripe.com"]
const PROVIDER_PROTECTED_PAYMENT_REASON = "provider_protected_payment_step"
const SESSION_DIR_PREFIX = "session-"
const LEGACY_SESSION_DIR_NAME_PATTERN = /^\d{4}-\d{2}-\d{2}t\d{2}-\d{2}-\d{2}(?:-\d{3})?z?$/i

export function resolveRepoRoot(): string {
  const envRepoRoot = (process.env.UIQ_REPO_ROOT ?? "").trim()
  if (envRepoRoot) {
    return path.resolve(envRepoRoot)
  }
  let cursor = path.resolve(process.cwd())
  for (let depth = 0; depth < 10; depth += 1) {
    if (
      existsSync(path.join(cursor, ".git")) ||
      existsSync(path.join(cursor, "pnpm-workspace.yaml"))
    ) {
      return cursor
    }
    const parent = path.dirname(cursor)
    if (parent === cursor) {
      break
    }
    cursor = parent
  }
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(scriptDir, "..", "..")
}

export function resolveRuntimeCacheRoot(repoRoot: string): string {
  const envRoot =
    (process.env.UIQ_RUNTIME_CACHE_ROOT ?? "").trim() ||
    (process.env.UIQ_MCP_RUNTIME_CACHE_ROOT ?? "").trim()
  if (!envRoot) {
    return path.resolve(repoRoot, ".runtime-cache")
  }
  return path.isAbsolute(envRoot) ? path.resolve(envRoot) : path.resolve(repoRoot, envRoot)
}

export function resolveRuntimeRoot(repoRoot: string): string {
  const runtimeOverride = (process.env.UNIVERSAL_AUTOMATION_RUNTIME_DIR ?? "").trim()
  if (runtimeOverride) {
    return assertPathWithinRoots(
      path.resolve(runtimeOverride),
      [path.resolve(repoRoot, ".runtime-cache")],
      "UNIVERSAL_AUTOMATION_RUNTIME_DIR"
    )
  }
  return path.resolve(resolveRuntimeCacheRoot(repoRoot), "automation")
}

export function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath)
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
}

export function assertPathWithinRoots(
  candidatePath: string,
  allowedRoots: string[],
  label: string
): string {
  for (const root of allowedRoots) {
    if (isPathWithinRoot(candidatePath, root)) {
      return candidatePath
    }
  }
  throw new Error(`[record-session] unsafe ${label}: ${candidatePath}`)
}

export function sanitizeSessionId(raw: string | undefined): string {
  const candidate = (raw ?? "").trim()
  if (!candidate) return createSessionId()
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,120}$/.test(candidate)) {
    throw new Error(`[record-session] invalid SESSION_ID: ${candidate}`)
  }
  return candidate
}

export function sanitizeUrlForPersist(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl)
    parsed.search = ""
    parsed.hash = ""
    return parsed.toString()
  } catch {
    return rawUrl
  }
}

export function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? "")
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return parsed
}

async function directorySizeBytes(dirPath: string): Promise<number> {
  let total = 0
  const entries = await readdir(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      total += await directorySizeBytes(fullPath)
      continue
    }
    if (entry.isFile()) {
      total += (await stat(fullPath)).size
    }
  }
  return total
}

export async function triggerWorkspaceCleanup(repoRoot: string): Promise<void> {
  if (envEnabled("FLOW_DISABLE_AUTO_RUNTIME_CLEANUP")) {
    return
  }
  const runtimeCacheRoot = resolveRuntimeCacheRoot(repoRoot)
  const markerPath = path.join(runtimeCacheRoot, "cache", "record-session-cleanup-marker.json")
  const cleanupIntervalMinutes = Math.max(
    5,
    parsePositiveNumber(process.env.AUTOMATION_GLOBAL_CLEANUP_INTERVAL_MINUTES, 60)
  )
  try {
    const markerStat = await stat(markerPath)
    const elapsedMs = Date.now() - markerStat.mtimeMs
    if (elapsedMs < cleanupIntervalMinutes * 60 * 1000) {
      return
    }
  } catch {
    // marker missing is expected on first run
  }

  const scriptPath = path.join(repoRoot, "scripts", "runtime-gc.sh")
  if (!existsSync(scriptPath)) {
    return
  }
  const ttlDays = String(
    Math.max(1, parsePositiveNumber(process.env.AUTOMATION_GLOBAL_CLEANUP_TTL_HOURS, 72))
  )
  const retentionDays = String(Math.max(1, Math.ceil(Number(ttlDays) / 24)))
  const thresholdMb = String(
    Math.max(128, Math.round(parsePositiveNumber(process.env.AUTOMATION_GLOBAL_CLEANUP_MAX_SIZE_GB, 2) * 1024))
  )
  const result = spawnSync(
    "bash",
    [
      scriptPath,
      "--scope",
      "all",
      "--retention-days",
      retentionDays,
      "--dir-size-threshold-mb",
      thresholdMb,
      "--max-delete-per-run",
      "500",
    ],
    {
      cwd: repoRoot,
      encoding: "utf-8",
      timeout: 120_000,
    }
  )
  await ensureDirs([path.dirname(markerPath)])
  await writeFile(
    markerPath,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        status: result.status,
        signal: result.signal ?? null,
        stdout: result.stdout?.trim() ? result.stdout.trim().slice(0, 500) : null,
        stderr: result.stderr?.trim() ? result.stderr.trim().slice(0, 500) : null,
      },
      null,
      2
    ),
    "utf-8"
  )
  if (result.status !== 0) {
    process.stderr.write(
      `[record-session] runtime-gc failed with status=${String(result.status)}\n`
    )
  }
}

export function envEnabled(name: string): boolean {
  const value = (process.env[name] ?? "").trim().toLowerCase()
  return value === "1" || value === "true" || value === "yes"
}

export function hasOtpHint(text: string): boolean {
  return /(otp|mfa|2fa|two[-_\s]?factor|one[-_\s]?time|verification(?:[-_\s]?code)?|auth(?:entication)?[-_\s]?code)/i.test(
    text
  )
}

export function parseProtectedProviderDomains(rawValue: string | undefined): string[] {
  const raw = (rawValue ?? "").trim()
  if (!raw) {
    return DEFAULT_PROTECTED_PROVIDER_DOMAINS
  }
  return raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => item.replace(/^https?:\/\//, "").split("/")[0] ?? item)
    .filter(Boolean)
}

export function parseGatePolicy(
  rawValue: string | undefined
): "auto" | "force_manual" | "forbid_manual" {
  const normalized = (rawValue ?? "").trim().toLowerCase()
  if (normalized === "auto" || normalized === "force_manual" || normalized === "forbid_manual") {
    return normalized
  }
  return "force_manual"
}

export function extractHostname(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return null
  }
}

export function resolveProtectedProviderDomain(
  event: CapturedEvent,
  protectedDomains: string[]
): string | null {
  const hostname = extractHostname(event.url)
  if (!hostname) {
    return null
  }
  for (const domain of protectedDomains) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) {
      return domain
    }
  }
  return null
}

export function eventLooksStripeField(event: CapturedEvent): boolean {
  const blob =
    `${event.target.name ?? ""} ${event.target.type ?? ""} ${event.target.id ?? ""} ${event.target.cssPath ?? ""} ${event.target.text ?? ""}`.toLowerCase()
  return /(stripe|card.?number|cc-number|cardholder|name.?on.?card|cvc|cvv|security.?code|cc-csc|cc-exp|exp(?:iry|iration)?|postal|zip)/i.test(
    blob
  )
}

export function applyProviderProtection(
  step: FlowStep,
  event: CapturedEvent,
  config: ProtectedProviderConfig
): FlowStep {
  const protectedDomain = resolveProtectedProviderDomain(event, config.protectedProviderDomains)
  if (!protectedDomain && !eventLooksStripeField(event)) {
    return step
  }
  return {
    ...step,
    gate_policy: config.protectedProviderGatePolicy,
    gate_reason: PROVIDER_PROTECTED_PAYMENT_REASON,
  }
}

export function eventLooksSensitive(event: CapturedEvent): boolean {
  const blob =
    `${event.target.name ?? ""} ${event.target.type ?? ""} ${event.target.id ?? ""} ${event.target.cssPath ?? ""}`.toLowerCase()
  return /(password|passwd|secret|token|otp|verification|auth|code|cvc|cvv|card|cc-|exp|postal|zip)/i.test(
    blob
  )
}

export function redactEventsForPersist(
  events: CapturedEvent[],
  allowSensitiveInputValues: boolean
): CapturedEvent[] {
  return events.map((event) => {
    const sensitive = eventLooksSensitive(event)
    return {
      ...event,
      url: sanitizeUrlForPersist(event.url),
      target: {
        ...event.target,
        text: sensitive ? "__redacted__" : event.target.text,
      },
      value:
        event.value === undefined
          ? undefined
          : allowSensitiveInputValues && !sensitive
            ? event.value
            : "__redacted__",
    }
  })
}

export function createSessionId(): string {
  return `${SESSION_DIR_PREFIX}${new Date().toISOString().replace(/[:.]/g, "-")}`
}

export async function ensureDirs(paths: string[]): Promise<void> {
  await Promise.all(paths.map((target) => mkdir(target, { recursive: true })))
}

export function isSessionDirectoryName(entryName: string): boolean {
  return entryName.startsWith(SESSION_DIR_PREFIX) || LEGACY_SESSION_DIR_NAME_PATTERN.test(entryName)
}

export async function isSessionDirectory(fullPath: string, entryName: string): Promise<boolean> {
  if (isSessionDirectoryName(entryName)) {
    return true
  }
  try {
    const metadata = await stat(path.join(fullPath, "session-meta.json"))
    return metadata.isFile()
  } catch {
    return false
  }
}

export async function cleanupExpiredSessions(runtimeRoot: string): Promise<void> {
  const retentionHours = Math.max(
    1,
    parsePositiveNumber(
      AUTOMATION_ENV.AUTOMATION_RETENTION_HOURS ?? process.env.AUTOMATION_RETENTION_HOURS,
      24
    )
  )
  const runtimeMaxBytes = Math.max(
    50 * 1024 * 1024,
    parsePositiveNumber(process.env.AUTOMATION_RUNTIME_MAX_BYTES, 1024 * 1024 * 1024)
  )
  const cutoff = Date.now() - retentionHours * 60 * 60 * 1000
  const entries = await readdir(runtimeRoot, { withFileTypes: true })
  const survivors: Array<{ fullPath: string; mtimeMs: number; sizeBytes: number }> = []
  let retainedSize = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }
    const fullPath = path.join(runtimeRoot, entry.name)
    if (!(await isSessionDirectory(fullPath, entry.name))) {
      continue
    }
    const stats = await stat(fullPath)
    if (stats.mtimeMs < cutoff) {
      await rm(fullPath, { recursive: true, force: true })
      continue
    }
    const sizeBytes = await directorySizeBytes(fullPath)
    retainedSize += sizeBytes
    survivors.push({ fullPath, mtimeMs: stats.mtimeMs, sizeBytes })
  }
  survivors.sort((left, right) => left.mtimeMs - right.mtimeMs)
  for (const survivor of survivors) {
    if (retainedSize <= runtimeMaxBytes) {
      break
    }
    await rm(survivor.fullPath, { recursive: true, force: true })
    retainedSize -= survivor.sizeBytes
  }
}

function getOption(name: string): string | null {
  const prefix = `--${name}=`
  const matched = process.argv.find((arg) => arg.startsWith(prefix))
  return matched ? matched.slice(prefix.length) : null
}

export function resolveMode(): RecordMode {
  const modeCandidate =
    getOption("mode") ?? AUTOMATION_ENV.RECORD_MODE ?? process.env.RECORD_MODE ?? "manual"
  if (modeCandidate === "manual" || modeCandidate === "midscene") {
    return modeCandidate
  }
  throw new Error(`unsupported record mode: ${modeCandidate}`)
}

export function resolveMidsceneDriverPath(): string {
  const optionPath = getOption("driver")
  const configuredPath =
    optionPath ??
    AUTOMATION_ENV.MIDSCENE_DRIVER ??
    process.env.MIDSCENE_DRIVER ??
    "./scripts/midscene-driver.ts"
  return path.resolve(process.cwd(), configuredPath)
}

export async function resolveSafeMidsceneDriverPath(
  repoRoot: string,
  configuredPath: string
): Promise<string> {
  const allowedRoots = [
    path.resolve(repoRoot, "apps", "automation-runner", "scripts"),
    path.resolve(repoRoot, ".runtime-cache"),
  ]
  const absolutePath = path.resolve(configuredPath)
  const existingPath = existsSync(absolutePath) ? await realpath(absolutePath) : absolutePath
  if (!/\.(mjs|cjs|js|ts)$/i.test(existingPath)) {
    throw new Error(`[record-session] driver must be a script file: ${existingPath}`)
  }
  return assertPathWithinRoots(existingPath, allowedRoots, "midscene driver path")
}

export function buildFlowDraft(
  sessionId: string,
  startUrl: string,
  events: CapturedEvent[],
  protectedProviderConfig: ProtectedProviderConfig
): FlowDraft {
  const steps: FlowStep[] = []
  steps.push({
    step_id: "s1",
    action: "navigate",
    url: sanitizeUrlForPersist(startUrl),
  })

  let counter = 2
  for (const event of events) {
    if (event.type === "navigate") {
      continue
    }
    if (event.type === "click") {
      const selectors: SelectorCandidate[] = []
      if (event.target.role && event.target.text) {
        selectors.push({
          kind: "role",
          value: `${event.target.role}[name='${event.target.text}']`,
          score: 90,
        })
      }
      if (event.target.id) {
        selectors.push({
          kind: "id",
          value: `#${event.target.id}`,
          score: 80,
        })
      }
      if (event.target.name) {
        selectors.push({
          kind: "name",
          value: `[name='${event.target.name}']`,
          score: 75,
        })
      }
      selectors.push({
        kind: "css",
        value: event.target.cssPath,
        score: 65,
      })
      const step: FlowStep = {
        step_id: `s${counter++}`,
        action: "click",
        target: { selectors },
      }
      steps.push(applyProviderProtection(step, event, protectedProviderConfig))
      continue
    }
    if ((event.type === "type" || event.type === "change") && event.value !== undefined) {
      const selectors: SelectorCandidate[] = []
      if (event.target.id) {
        selectors.push({ kind: "id", value: `#${event.target.id}`, score: 88 })
      }
      if (event.target.name) {
        selectors.push({
          kind: "name",
          value: `[name='${event.target.name}']`,
          score: 84,
        })
      }
      selectors.push({ kind: "css", value: event.target.cssPath, score: 68 })
      const lowerName = (event.target.name ?? "").toLowerCase()
      const lowerType = (event.target.type ?? "").toLowerCase()
      const lowerId = (event.target.id ?? "").toLowerCase()
      const lowerCss = (event.target.cssPath ?? "").toLowerCase()
      const otpLike = hasOtpHint(`${lowerName} ${lowerType} ${lowerId} ${lowerCss}`)
      const isSensitive =
        lowerType === "password" ||
        lowerName.includes("password") ||
        lowerName.includes("secret") ||
        lowerName.includes("token") ||
        lowerName.includes("code") ||
        otpLike
      const step: FlowStep = {
        step_id: `s${counter++}`,
        action: "type",
        target: { selectors },
        value_ref: otpLike ? "${params.otp}" : isSensitive ? "${secrets.input}" : "${params.input}",
      }
      steps.push(applyProviderProtection(step, event, protectedProviderConfig))
    }
  }

  return {
    flow_id: `flow-${sessionId}`,
    session_id: sessionId,
    start_url: sanitizeUrlForPersist(startUrl),
    generated_at: new Date().toISOString(),
    source_event_count: events.length,
    steps,
  }
}
