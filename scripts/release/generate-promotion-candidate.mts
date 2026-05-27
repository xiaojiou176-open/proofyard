#!/usr/bin/env node

import { resolve } from "node:path"
import {
  type PromotionReviewState,
  writePromotionCandidateArtifacts,
} from "../../packages/core/src/index.ts"

const args = process.argv.slice(2)
const runId = args[0]
const compareRunId = args[1] || undefined
const reviewStateArg = args[2] || "candidate"
const outDir = resolve(args[3] || ".runtime-cache/artifacts/release/promotion-candidates")
const sharePackOutDir = resolve(args[4] || ".runtime-cache/artifacts/release/share-pack")

if (!runId) {
  throw new Error(
    "usage: node --import tsx scripts/release/generate-promotion-candidate.mts <runId> [compareRunId] [reviewState] [outDir] [sharePackOutDir]"
  )
}

if (!["candidate", "review", "approved"].includes(reviewStateArg)) {
  throw new Error("reviewState must be one of candidate|review|approved")
}

const candidate = writePromotionCandidateArtifacts(runId, {
  compareRunId,
  reviewState: reviewStateArg as PromotionReviewState,
  outDir,
  sharePackOutDir,
})

console.log(
  JSON.stringify({
    runId,
    compareRunId: compareRunId ?? null,
    reviewState: candidate.reviewState,
    outDir,
    sharePackOutDir,
  })
)
