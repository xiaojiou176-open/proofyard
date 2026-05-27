import { resolve } from "node:path"
import { readManifest } from "../manifest/io.js"
import type { Manifest } from "../manifest/types.js"
import { readEvidenceRunDetail, resolveRunsRoot } from "./read-model.js"
import type { EvidenceRunCompare } from "./types.js"

function failedCheckCount(manifest: Manifest | null): number | null {
  if (!manifest) return null
  return manifest.gateResults.checks.filter(
    (check) => check.status === "failed" || check.status === "blocked"
  ).length
}

function manifestForRun(runId: string, rootDir = process.cwd()): Manifest | null {
  try {
    return readManifest(resolve(resolveRunsRoot(rootDir), runId, "manifest.json")).manifest
  } catch {
    return null
  }
}

function changedKeys(
  baseline: Record<string, string>,
  candidate: Record<string, string>
): string[] {
  const keys = new Set([...Object.keys(baseline), ...Object.keys(candidate)])
  return Array.from(keys).filter((key) => baseline[key] !== candidate[key])
}

export function compareEvidenceRuns(
  baselineRunId: string,
  candidateRunId: string,
  rootDir = process.cwd()
): EvidenceRunCompare {
  const baseline = readEvidenceRunDetail(baselineRunId, rootDir)
  const candidate = readEvidenceRunDetail(candidateRunId, rootDir)
  const baselineManifest = manifestForRun(baselineRunId, rootDir)
  const candidateManifest = manifestForRun(candidateRunId, rootDir)
  const compareState =
    baseline.retentionState === "retained" && candidate.retentionState === "retained"
      ? "ready"
      : "partial_compare"

  return {
    baselineRunId,
    candidateRunId,
    compareState,
    baselineRetentionState: baseline.retentionState,
    candidateRetentionState: candidate.retentionState,
    gateStatusDelta: {
      baseline: baseline.gateStatus,
      candidate: candidate.gateStatus,
    },
    summaryDelta: {
      durationMs:
        baseline.durationMs !== null && candidate.durationMs !== null
          ? candidate.durationMs - baseline.durationMs
          : null,
      failedChecks:
        failedCheckCount(baselineManifest) !== null && failedCheckCount(candidateManifest) !== null
          ? failedCheckCount(candidateManifest)! - failedCheckCount(baselineManifest)!
          : null,
      missingArtifacts: candidate.missingPaths.length - baseline.missingPaths.length,
    },
    artifactDelta: {
      baselineMissingPaths: baseline.missingPaths,
      candidateMissingPaths: candidate.missingPaths,
      reportPathChanges: changedKeys(baseline.reports, candidate.reports),
      proofPathChanges: changedKeys(baseline.proofPaths, candidate.proofPaths),
    },
  }
}
