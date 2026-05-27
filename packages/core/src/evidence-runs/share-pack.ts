import { compareEvidenceRuns } from "./diff.js"
import { readEvidenceRunDetail } from "./read-model.js"
import type { EvidenceSharePack } from "./types.js"

export function buildEvidenceSharePack(
  runId: string,
  options?: { compareRunId?: string; rootDir?: string }
): EvidenceSharePack {
  const rootDir = options?.rootDir ?? process.cwd()
  const detail = readEvidenceRunDetail(runId, rootDir)
  const compare = options?.compareRunId
    ? compareEvidenceRuns(runId, options.compareRunId, rootDir)
    : null

  const markdownSummary = [
    `## Evidence Share Pack`,
    `- Run ID: \`${detail.runId}\``,
    `- Retention: **${detail.retentionState}**`,
    `- Gate Status: **${detail.gateStatus ?? "unknown"}**`,
    `- Missing Paths: ${detail.missingPaths.length > 0 ? detail.missingPaths.map((item) => `\`${item}\``).join(", ") : "None"}`,
    compare
      ? `- Compare: \`${compare.baselineRunId}\` -> \`${compare.candidateRunId}\` (${compare.compareState})`
      : `- Compare: Not included`,
  ].join("\n")

  const issueReadySnippet = [
    `### Failure Digest`,
    `- run_id: \`${detail.runId}\``,
    `- retention_state: \`${detail.retentionState}\``,
    `- gate_status: \`${detail.gateStatus ?? "unknown"}\``,
    `- missing_paths: ${detail.missingPaths.length > 0 ? detail.missingPaths.join(", ") : "none"}`,
  ].join("\n")

  const releaseAppendix = [
    `### Evidence Appendix`,
    `- canonical_run: \`${detail.runId}\``,
    `- retained_state: \`${detail.retentionState}\``,
    `- proof_paths: ${Object.keys(detail.proofPaths).length > 0 ? Object.values(detail.proofPaths).join(", ") : "none"}`,
  ].join("\n")

  return {
    runId: detail.runId,
    retentionState: detail.retentionState,
    compare,
    markdownSummary,
    issueReadySnippet,
    releaseAppendix,
    jsonBundle: {
      runId: detail.runId,
      retentionState: detail.retentionState,
      gateStatus: detail.gateStatus,
      missingPaths: detail.missingPaths,
      compare,
    },
  }
}
