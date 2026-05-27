import type { Dirent } from "node:fs"
import { readdir } from "node:fs/promises"
import path from "node:path"

type GeneratedStep = {
  step_id: string
  action: string
  unsupported_reason?: string | null
}

const MANUAL_GATE_REASON_CODES = [
  "cloudflare",
  "captcha",
  "otp",
  "csrf",
  "token",
  "unknown",
] as const

export type ManualGateReasonCode = (typeof MANUAL_GATE_REASON_CODES)[number]

type ManualGateReasonRow = {
  stepId: string
  reason: string
  reasonCodes: ManualGateReasonCode[]
}

export type ManualGateReasonMatrix = {
  reasonCodes: ManualGateReasonCode[]
  byStep: ManualGateReasonRow[]
  counts: Record<ManualGateReasonCode, number>
}

export type ManualGateStatsPanel = {
  totalManualGateSteps: number
  totalReasonCodeHits: number
  knownReasonCodeHits: number
  unknownReasonCodeHits: number
  dominantReasonCode: ManualGateReasonCode | null
  reasonCodeBreakdown: Array<{
    code: ManualGateReasonCode
    count: number
    ratio: number
  }>
}

export type ReplayAttempt = {
  attempted: boolean
  success: boolean | null
  status: string
}

export type ReplaySla = {
  windowDays: number
  replaySuccessRate7d: number | null
  replaySuccessSamples7d: number
  replaySuccesses7d: number
  evaluatedAt: string
}

const REPLAY_SLA_WINDOW_DAYS = 7

const MANUAL_GATE_REASON_PATTERNS: Array<{
  code: Exclude<ManualGateReasonCode, "unknown">
  pattern: RegExp
}> = [
  { code: "cloudflare", pattern: /cloudflare|cf_clearance|__cf_bm|turnstile/i },
  { code: "captcha", pattern: /captcha|hcaptcha|recaptcha/i },
  { code: "otp", pattern: /otp|one[-_ ]?time|verification code|mfa/i },
  { code: "csrf", pattern: /csrf|xsrf/i },
  { code: "token", pattern: /token|bearer|jwt/i },
]

function emptyManualGateCounts(): Record<ManualGateReasonCode, number> {
  return {
    cloudflare: 0,
    captcha: 0,
    otp: 0,
    csrf: 0,
    token: 0,
    unknown: 0,
  }
}

function classifyManualGateReason(reason: string): ManualGateReasonCode[] {
  const matched = MANUAL_GATE_REASON_PATTERNS.filter(({ pattern }) => pattern.test(reason)).map(
    ({ code }) => code
  )
  return matched.length > 0 ? matched : ["unknown"]
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function parseReplayAttempt(payload: unknown): ReplayAttempt | null {
  if (!payload || typeof payload !== "object") return null
  const record = payload as Record<string, unknown>
  const attempted = Boolean(record.attempted)
  const success = typeof record.success === "boolean" ? record.success : null
  const status =
    typeof record.status === "string" && record.status.trim()
      ? record.status
      : attempted
        ? success === true
          ? "success"
          : success === false
            ? "failed"
            : "unknown"
        : "not_attempted"
  return { attempted, success, status }
}

async function collectReadinessPaths(searchRoot: string, depth: number): Promise<string[]> {
  if (depth < 0) return []
  const results: string[] = []
  let entries: Dirent[]
  try {
    entries = await readdir(searchRoot, { withFileTypes: true })
  } catch {
    return []
  }
  for (const entry of entries) {
    const fullPath = path.join(searchRoot, entry.name)
    if (entry.isFile() && entry.name === "run-readiness-report.json") {
      results.push(fullPath)
      continue
    }
    if (entry.isDirectory()) {
      results.push(...(await collectReadinessPaths(fullPath, depth - 1)))
    }
  }
  return results
}

export function buildManualGateReport(steps: GeneratedStep[]): {
  manualGateReasons: string[]
  manualGateReasonMatrix: ManualGateReasonMatrix
  manualGateStatsPanel: ManualGateStatsPanel
} {
  const manualSteps = steps.filter((step) => step.action === "manual_gate")
  const counts = emptyManualGateCounts()
  const rows: ManualGateReasonRow[] = []
  const manualGateReasons: string[] = []
  for (const step of manualSteps) {
    const rawReason =
      typeof step.unsupported_reason === "string" ? step.unsupported_reason.trim() : ""
    const reason = rawReason || "missing unsupported_reason"
    const reasonCodes = classifyManualGateReason(reason)
    if (rawReason) manualGateReasons.push(rawReason)
    for (const code of reasonCodes) counts[code] += 1
    rows.push({ stepId: step.step_id, reason, reasonCodes })
  }

  const totalReasonCodeHits = rows.reduce((sum, row) => sum + row.reasonCodes.length, 0)
  const knownReasonCodeHits = totalReasonCodeHits - counts.unknown
  const dominantReasonCode =
    MANUAL_GATE_REASON_CODES.filter((code) => counts[code] > 0).sort(
      (left, right) => counts[right] - counts[left]
    )[0] ?? null

  return {
    manualGateReasons,
    manualGateReasonMatrix: {
      reasonCodes: [...MANUAL_GATE_REASON_CODES],
      byStep: rows,
      counts,
    },
    manualGateStatsPanel: {
      totalManualGateSteps: manualSteps.length,
      totalReasonCodeHits,
      knownReasonCodeHits,
      unknownReasonCodeHits: counts.unknown,
      dominantReasonCode,
      reasonCodeBreakdown: MANUAL_GATE_REASON_CODES.map((code) => ({
        code,
        count: counts[code],
        ratio:
          totalReasonCodeHits > 0 ? Number((counts[code] / totalReasonCodeHits).toFixed(4)) : 0,
      })),
    },
  }
}

export async function computeReplaySla(args: {
  outDir: string
  readinessPath: string
  now: Date
  readJson: <T>(filePath: string) => Promise<T>
}): Promise<ReplaySla> {
  const { outDir, readinessPath, now, readJson } = args
  const roots = Array.from(new Set([path.resolve(outDir), path.resolve(path.dirname(outDir))]))
  const candidatePaths = new Set<string>()
  for (const root of roots) {
    for (const item of await collectReadinessPaths(root, 2)) {
      candidatePaths.add(path.resolve(item))
    }
  }

  const currentPath = path.resolve(readinessPath)
  const windowStartAt = new Date(now.getTime() - REPLAY_SLA_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  let replaySuccessSamples7d = 0
  let replaySuccesses7d = 0

  for (const candidatePath of candidatePaths) {
    if (candidatePath === currentPath) continue
    let record: Record<string, unknown>
    try {
      record = await readJson<Record<string, unknown>>(candidatePath)
    } catch {
      continue
    }
    const generatedAt = parseIsoDate(record.generatedAt ?? record.generated_at)
    if (!generatedAt) continue
    if (generatedAt.getTime() < windowStartAt.getTime() || generatedAt.getTime() > now.getTime()) {
      continue
    }
    const replayAttempt = parseReplayAttempt(record.replayAttempt ?? record.replay_attempt)
    if (!replayAttempt || !replayAttempt.attempted || typeof replayAttempt.success !== "boolean") {
      continue
    }
    replaySuccessSamples7d += 1
    if (replayAttempt.success) replaySuccesses7d += 1
  }

  return {
    windowDays: REPLAY_SLA_WINDOW_DAYS,
    replaySuccessRate7d:
      replaySuccessSamples7d > 0
        ? Number((replaySuccesses7d / replaySuccessSamples7d).toFixed(4))
        : null,
    replaySuccessSamples7d,
    replaySuccesses7d,
    evaluatedAt: now.toISOString(),
  }
}
