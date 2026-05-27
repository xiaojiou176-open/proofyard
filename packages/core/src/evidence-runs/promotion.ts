import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { buildEvidenceSharePack } from "./share-pack.js"
import { readEvidenceRunDetail } from "./read-model.js"
import type { PromotionCandidate } from "./types.js"

export type PromotionReviewState = PromotionCandidate["reviewState"]

function resolvePromotionCandidateDir(rootDir: string): string {
  return resolve(rootDir, ".runtime-cache", "artifacts", "release", "promotion-candidates")
}

function resolvePromotionCandidateJsonPath(runId: string, rootDir: string): string {
  return resolve(resolvePromotionCandidateDir(rootDir), `${runId}.promotion-candidate.json`)
}

function readPersistedReviewState(runId: string, rootDir: string): PromotionReviewState | null {
  const filePath = resolvePromotionCandidateJsonPath(runId, rootDir)
  if (!existsSync(filePath)) return null
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { reviewState?: unknown }
    if (
      parsed.reviewState === "candidate" ||
      parsed.reviewState === "review" ||
      parsed.reviewState === "approved"
    ) {
      return parsed.reviewState
    }
  } catch {
    return null
  }
  return null
}

function resolveReviewState(
  requestedReviewState: PromotionReviewState | undefined,
  persistedReviewState: PromotionReviewState | null,
  eligible: boolean
): PromotionReviewState {
  const reviewState = requestedReviewState ?? persistedReviewState ?? "candidate"
  if (!eligible && reviewState !== "candidate") {
    throw new Error("Promotion review state requires an eligible retained run with provenance")
  }
  return reviewState
}

function explainReviewState(reviewState: PromotionReviewState): string {
  if (reviewState === "review") {
    return "Promotion is staged for maintainer review before it can be cited by release or showcase surfaces."
  }
  if (reviewState === "approved") {
    return "Promotion is approved and can be cited by release or showcase surfaces without pointing at raw run artifacts."
  }
  return "Promotion remains a candidate until a maintainer advances it to review or approved."
}

export function buildPromotionCandidate(
  runId: string,
  options?: { compareRunId?: string; rootDir?: string; reviewState?: PromotionReviewState }
): PromotionCandidate {
  const rootDir = options?.rootDir ?? process.cwd()
  const detail = readEvidenceRunDetail(runId, rootDir)
  const sharePack = buildEvidenceSharePack(runId, {
    compareRunId: options?.compareRunId,
    rootDir,
  })

  const reasonCodes: string[] = []
  if (detail.retentionState !== "retained") reasonCodes.push("promotion.retention.not_retained")
  if (!detail.provenance.source) reasonCodes.push("promotion.provenance.missing")
  if (!sharePack.markdownSummary.trim()) reasonCodes.push("promotion.share_pack.empty")
  const eligible = reasonCodes.length === 0
  const reviewState = resolveReviewState(
    options?.reviewState,
    readPersistedReviewState(detail.runId, rootDir),
    eligible
  )

  return {
    runId: detail.runId,
    eligible,
    retentionState: detail.retentionState,
    provenanceReady: Boolean(detail.provenance.source),
    sharePackReady: Boolean(sharePack.markdownSummary.trim()),
    compareReady: Boolean(sharePack.compare),
    reviewState,
    reviewStateReason: explainReviewState(reviewState),
    reasonCodes,
    releaseReference: `.runtime-cache/artifacts/release/promotion-candidates/${detail.runId}.promotion-candidate.md`,
    showcaseReference: "docs/showcase/minimal-success-case.md#promotion-candidate-contract",
    supportingSharePackReference: `.runtime-cache/artifacts/release/share-pack/${detail.runId}.share-pack.md`,
  }
}

export function writePromotionCandidateArtifacts(
  runId: string,
  options?: {
    compareRunId?: string
    rootDir?: string
    reviewState?: PromotionReviewState
    outDir?: string
    sharePackOutDir?: string
  }
): PromotionCandidate {
  const rootDir = options?.rootDir ?? process.cwd()
  const sharePack = buildEvidenceSharePack(runId, {
    compareRunId: options?.compareRunId,
    rootDir,
  })
  const candidate = buildPromotionCandidate(runId, {
    compareRunId: options?.compareRunId,
    rootDir,
    reviewState: options?.reviewState,
  })
  const promotionOutDir =
    options?.outDir ?? resolvePromotionCandidateDir(rootDir)
  const sharePackOutDir =
    options?.sharePackOutDir ??
    resolve(rootDir, ".runtime-cache", "artifacts", "release", "share-pack")

  mkdirSync(promotionOutDir, { recursive: true })
  mkdirSync(sharePackOutDir, { recursive: true })

  writeFileSync(
    resolve(sharePackOutDir, `${runId}.share-pack.json`),
    `${JSON.stringify(sharePack, null, 2)}\n`,
    "utf8"
  )
  writeFileSync(
    resolve(sharePackOutDir, `${runId}.share-pack.md`),
    `${sharePack.markdownSummary}\n\n${sharePack.issueReadySnippet}\n\n${sharePack.releaseAppendix}\n`,
    "utf8"
  )
  writeFileSync(
    resolve(promotionOutDir, `${runId}.promotion-candidate.json`),
    `${JSON.stringify(candidate, null, 2)}\n`,
    "utf8"
  )
  writeFileSync(
    resolve(promotionOutDir, `${runId}.promotion-candidate.md`),
    [
      "## Promotion Candidate",
      `- Run ID: \`${candidate.runId}\``,
      `- Review State: **${candidate.reviewState}**`,
      `- Eligible: **${candidate.eligible ? "yes" : "no"}**`,
      `- Retention: **${candidate.retentionState}**`,
      `- Provenance Ready: **${candidate.provenanceReady ? "yes" : "no"}**`,
      `- Share Pack Ready: **${candidate.sharePackReady ? "yes" : "no"}**`,
      `- Compare Ready: **${candidate.compareReady ? "yes" : "no"}**`,
      `- Review Reason: ${candidate.reviewStateReason}`,
      `- Showcase Contract: \`${candidate.showcaseReference}\``,
      `- Supporting Share Pack: \`${candidate.supportingSharePackReference}\``,
      `- Reason Codes: ${candidate.reasonCodes.length > 0 ? candidate.reasonCodes.join(", ") : "none"}`,
    ].join("\n") + "\n",
    "utf8"
  )

  return candidate
}
