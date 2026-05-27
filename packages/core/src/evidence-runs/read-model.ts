import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { readManifest } from "../manifest/io.js"
import type { Manifest } from "../manifest/types.js"
import type {
  EvidenceRegistryState,
  EvidenceRetentionState,
  EvidenceRunDetail,
  EvidenceRunLatestResult,
  EvidenceRunListResult,
  EvidenceRunProvenance,
  EvidenceRunSummary,
} from "./types.js"

type RawManifest = {
  runId?: unknown
  profile?: unknown
  target?: { name?: unknown; type?: unknown } | null
  timing?: { startedAt?: unknown; finishedAt?: unknown; durationMs?: unknown } | null
  gateResults?: { status?: unknown } | null
  reports?: Record<string, unknown> | null
  proof?: {
    coveragePath?: unknown
    stabilityPath?: unknown
    gapsPath?: unknown
    reproPath?: unknown
  } | null
  evidenceIndex?: unknown[]
  states?: unknown[]
  provenance?: {
    source?: unknown
    correlationId?: unknown
    linkedRunIds?: unknown
    linkedTaskIds?: unknown
  } | null
}

const DEFAULT_REQUIRED_PATHS = ["manifest.json", "reports/summary.json"] as const

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

function resolveRegistryState(runsRoot: string): EvidenceRegistryState {
  if (!existsSync(runsRoot)) return "missing"
  const hasRunDirs = readdirSync(runsRoot, { withFileTypes: true }).some((entry) => entry.isDirectory())
  return hasRunDirs ? "available" : "empty"
}

function buildProvenance(raw: RawManifest["provenance"]): EvidenceRunProvenance {
  const source = safeString(raw?.source)
  return {
    source:
      source === "canonical" || source === "automation" || source === "operator" ? source : null,
    correlationId: safeString(raw?.correlationId),
    linkedRunIds: safeStringArray(raw?.linkedRunIds),
    linkedTaskIds: safeStringArray(raw?.linkedTaskIds),
  }
}

function collectExpectedPaths(manifest: Manifest | RawManifest | null): string[] {
  const expected = new Set<string>(DEFAULT_REQUIRED_PATHS)
  if (!manifest) return Array.from(expected)

  const reports = manifest.reports ?? {}
  for (const value of Object.values(reports)) {
    if (typeof value === "string" && value.trim().length > 0) expected.add(value)
  }

  const proof = manifest.proof ?? {}
  for (const value of [
    proof.coveragePath,
    proof.stabilityPath,
    proof.gapsPath,
    proof.reproPath,
  ]) {
    if (typeof value === "string" && value.trim().length > 0) expected.add(value)
  }

  return Array.from(expected)
}

function collectAvailablePaths(runDir: string, expectedPaths: string[]): string[] {
  return expectedPaths.filter((path) => existsSync(resolve(runDir, path)))
}

function resolveRetentionState(
  runDir: string,
  expectedPaths: string[],
  availablePaths: string[]
): EvidenceRetentionState {
  const hasVisibleEntry =
    existsSync(runDir) &&
    readdirSync(runDir, { withFileTypes: true }).some((entry) => !entry.name.startsWith("."))
  if (!hasVisibleEntry) return "empty"
  if (availablePaths.length === 0) return "missing"
  if (availablePaths.length === expectedPaths.length) return "retained"
  return "partial"
}

function readManifestSafely(runDir: string): {
  manifest: Manifest | null
  rawManifest: RawManifest | null
  missingPaths: string[]
  parseError?: string
} {
  const manifestPath = resolve(runDir, "manifest.json")
  if (!existsSync(manifestPath)) {
    return { manifest: null, rawManifest: null, missingPaths: ["manifest.json"] }
  }
  try {
    const result = readManifest(manifestPath)
    return {
      manifest: result.manifest,
      rawManifest: result.manifest as unknown as RawManifest,
      missingPaths: result.missingEvidence,
    }
  } catch (error) {
    let rawManifest: RawManifest | null = null
    try {
      rawManifest = JSON.parse(readFileSync(manifestPath, "utf8")) as RawManifest
    } catch {
      rawManifest = null
    }
    return {
      manifest: null,
      rawManifest,
      missingPaths: ["manifest.json"],
      parseError: error instanceof Error ? error.message : "failed to parse manifest",
    }
  }
}

function summarizeRun(runId: string, runDir: string): EvidenceRunSummary {
  const { manifest, rawManifest, missingPaths } = readManifestSafely(runDir)
  const expectedPaths = collectExpectedPaths(manifest ?? rawManifest)
  const availablePaths = collectAvailablePaths(runDir, expectedPaths)
  const mergedMissing = Array.from(
    new Set([...missingPaths, ...expectedPaths.filter((path) => !existsSync(resolve(runDir, path)))])
  )

  return {
    runId,
    profile: safeString(rawManifest?.profile),
    targetName: safeString(rawManifest?.target?.name),
    targetType: safeString(rawManifest?.target?.type),
    gateStatus: safeString(rawManifest?.gateResults?.status),
    retentionState: resolveRetentionState(runDir, expectedPaths, availablePaths),
    startedAt: safeString(rawManifest?.timing?.startedAt),
    finishedAt: safeString(rawManifest?.timing?.finishedAt),
    durationMs:
      typeof rawManifest?.timing?.durationMs === "number" ? rawManifest.timing.durationMs : null,
    manifestPath: existsSync(resolve(runDir, "manifest.json")) ? "manifest.json" : null,
    summaryPath: existsSync(resolve(runDir, "reports/summary.json")) ? "reports/summary.json" : null,
    missingPaths: mergedMissing,
    provenance: buildProvenance(rawManifest?.provenance),
  }
}

export function resolveRunsRoot(rootDir = process.cwd()): string {
  return resolve(rootDir, ".runtime-cache/artifacts/runs")
}

export function listEvidenceRuns(limit = 20, rootDir = process.cwd()): EvidenceRunListResult {
  const runsRoot = resolveRunsRoot(rootDir)
  const registryState = resolveRegistryState(runsRoot)
  if (registryState !== "available") {
    return { runs: [], registryState }
  }

  const entries = readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const runDir = resolve(runsRoot, entry.name)
      const manifestPath = resolve(runDir, "manifest.json")
      const mtimeMs = existsSync(manifestPath) ? statSync(manifestPath).mtimeMs : statSync(runDir).mtimeMs
      return { runId: entry.name, runDir, mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)

  return {
    runs: entries.slice(0, Math.max(1, limit)).map((entry) => summarizeRun(entry.runId, entry.runDir)),
    registryState,
  }
}

export function readEvidenceRunDetail(runId: string, rootDir = process.cwd()): EvidenceRunDetail {
  const runsRoot = resolveRunsRoot(rootDir)
  const runDir = resolve(runsRoot, runId.trim())
  if (!existsSync(runDir)) {
    throw new Error(`evidence run not found: ${runId}`)
  }

  const registryState = resolveRegistryState(runsRoot)
  const { manifest, rawManifest, parseError } = readManifestSafely(runDir)
  const expectedPaths = collectExpectedPaths(manifest ?? rawManifest)
  const availablePaths = collectAvailablePaths(runDir, expectedPaths)

  return {
    ...summarizeRun(runId.trim(), runDir),
    availablePaths,
    reports: Object.fromEntries(
      Object.entries(rawManifest?.reports ?? {}).filter(
        ([, value]) => typeof value === "string" && value.trim().length > 0
      )
    ) as Record<string, string>,
    proofPaths: {
      ...(typeof rawManifest?.proof?.coveragePath === "string"
        ? { coverage: rawManifest.proof.coveragePath }
        : {}),
      ...(typeof rawManifest?.proof?.stabilityPath === "string"
        ? { stability: rawManifest.proof.stabilityPath }
        : {}),
      ...(typeof rawManifest?.proof?.gapsPath === "string" ? { gaps: rawManifest.proof.gapsPath } : {}),
      ...(typeof rawManifest?.proof?.reproPath === "string" ? { repro: rawManifest.proof.reproPath } : {}),
    },
    evidenceIndexCount: Array.isArray(rawManifest?.evidenceIndex) ? rawManifest.evidenceIndex.length : 0,
    stateCount: Array.isArray(rawManifest?.states) ? rawManifest.states.length : 0,
    registryState,
    ...(parseError ? { parseError } : {}),
  }
}

export function readLatestEvidenceRun(rootDir = process.cwd()): EvidenceRunLatestResult {
  const list = listEvidenceRuns(1, rootDir)
  if (list.registryState !== "available" || list.runs.length === 0) {
    return { run: null, registryState: list.registryState }
  }
  return {
    run: readEvidenceRunDetail(list.runs[0].runId, rootDir),
    registryState: list.registryState,
  }
}
