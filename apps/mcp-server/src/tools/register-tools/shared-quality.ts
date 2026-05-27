import { existsSync } from "node:fs"
import { readJson, runsRoot, safeResolveUnder } from "../../core/constants.js"
import type { JsonObject } from "../../core/types.js"

function readRunJson(runId: string, rel: string): unknown {
  return readJson(safeResolveUnder(runsRoot(), runId, rel))
}

export function analyzeA11y(runId: string, topN: number): JsonObject {
  const data = readRunJson(runId, "a11y/axe.json") as {
    counts?: JsonObject
    issues?: Array<{ id?: string; severity?: string; message?: string; selector?: string }>
    scannedAt?: string
  }
  const issues = (data.issues ?? []).slice(0, Math.max(1, topN)).map((it, index) => ({
    rank: index + 1,
    id: it.id ?? "unknown",
    severity: it.severity ?? "unknown",
    message: it.message ?? "",
    selector: it.selector ?? "",
  }))
  return {
    runId,
    counts: data.counts ?? {},
    scannedAt: data.scannedAt ?? null,
    topIssues: issues,
  }
}

export function analyzePerf(runId: string): JsonObject {
  const data = readRunJson(runId, "perf/lighthouse.json") as {
    engine?: string
    preset?: string
    metrics?: JsonObject
    measuredAt?: string
    fallbackUsed?: boolean
    deterministic?: JsonObject
  }
  return {
    runId,
    engine: data.engine ?? null,
    preset: data.preset ?? null,
    measuredAt: data.measuredAt ?? null,
    fallbackUsed: data.fallbackUsed ?? null,
    metrics: data.metrics ?? {},
    deterministic: data.deterministic ?? {},
  }
}

export function analyzeVisual(runId: string): JsonObject {
  const data = readRunJson(runId, "visual/report.json") as {
    mode?: string
    diffPixels?: number
    totalPixels?: number
    diffRatio?: number
    baselineCreated?: boolean
    baselinePath?: string
    currentPath?: string
    diffPath?: string
  }
  return {
    runId,
    mode: data.mode ?? null,
    diffPixels: data.diffPixels ?? null,
    totalPixels: data.totalPixels ?? null,
    diffRatio: data.diffRatio ?? null,
    baselineCreated: data.baselineCreated ?? null,
    baselinePath: data.baselinePath ?? null,
    currentPath: data.currentPath ?? null,
    diffPath: data.diffPath ?? null,
  }
}

export function analyzeSecurity(runId: string): JsonObject {
  const reportPath = safeResolveUnder(runsRoot(), runId, "security/report.json")
  const ticketsPath = safeResolveUnder(runsRoot(), runId, "metrics/security-tickets.json")
  const report = existsSync(reportPath) ? (readJson(reportPath) as JsonObject) : {}
  const tickets = existsSync(ticketsPath) ? (readJson(ticketsPath) as unknown[]) : []
  return {
    runId,
    hasReport: existsSync(reportPath),
    hasTickets: existsSync(ticketsPath),
    report,
    ticketCount: tickets.length,
    ticketsSample: tickets.slice(0, 20),
  }
}

export function comparePerf(runA: string, runB: string): JsonObject {
  const a = analyzePerf(runA) as { metrics?: JsonObject }
  const b = analyzePerf(runB) as { metrics?: JsonObject }
  const metricsA = a.metrics ?? {}
  const metricsB = b.metrics ?? {}
  const keys = new Set([...Object.keys(metricsA), ...Object.keys(metricsB)])
  const deltas: JsonObject = {}
  for (const key of keys) {
    const va = metricsA[key]
    const vb = metricsB[key]
    if (typeof va === "number" && typeof vb === "number") {
      deltas[key] = { from: va, to: vb, delta: Number((vb - va).toFixed(3)) }
    }
  }
  return { runA, runB, deltas }
}
