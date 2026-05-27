import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { buildPromotionCandidate, writePromotionCandidateArtifacts } from "./promotion.js"

function writeRun(
  rootDir: string,
  runId: string,
  options: { provenanceSource?: string; includeProof?: boolean; writeProofFile?: boolean } = {}
): void {
  const { provenanceSource = "canonical", includeProof = true, writeProofFile = includeProof } = options
  const runDir = join(rootDir, ".runtime-cache", "artifacts", "runs", runId)
  mkdirSync(join(runDir, "reports"), { recursive: true })
  writeFileSync(
    join(runDir, "manifest.json"),
    JSON.stringify(
      {
        schemaVersion: "1.1",
        runId,
        target: { type: "web", name: "web.local" },
        profile: "pr",
        git: { branch: "main", commit: "abc123", dirty: false },
        timing: {
          startedAt: "2026-03-29T09:00:00Z",
          finishedAt: "2026-03-29T09:05:00Z",
          durationMs: 300000,
        },
        execution: { maxParallelTasks: 1, stagesMs: {}, criticalPath: [] },
        states: [],
        evidenceIndex: [
          { id: "report.report", source: "report", kind: "report", path: "reports/summary.json" },
        ],
        reports: {
          report: "reports/summary.json",
          ...(includeProof ? { proofCoverage: "reports/proof.coverage.json" } : {}),
        },
        proof: includeProof ? { coveragePath: "reports/proof.coverage.json" } : {},
        summary: {
          consoleError: 0,
          pageError: 0,
          http5xx: 0,
          aiModel: "model",
          promptVersion: "",
          cacheStats: { hit: 0, miss: 0, hitRate: 0 },
          computerUseSafetyConfirmations: 0,
        },
        gateResults: { status: "passed", checks: [] },
        toolchain: { node: process.version },
        provenance: provenanceSource ? { source: provenanceSource } : {},
      },
      null,
      2
    ),
    "utf8"
  )
  writeFileSync(join(runDir, "reports", "summary.json"), "{}", "utf8")
  if (writeProofFile) {
    writeFileSync(join(runDir, "reports", "proof.coverage.json"), "{}", "utf8")
  }
}

test("buildPromotionCandidate reads persisted review state and release references", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "webaudit-promotion-"))
  writeRun(rootDir, "run-a")
  const candidateDir = resolve(rootDir, ".runtime-cache", "artifacts", "release", "promotion-candidates")
  mkdirSync(candidateDir, { recursive: true })
  writeFileSync(
    resolve(candidateDir, "run-a.promotion-candidate.json"),
    JSON.stringify({ reviewState: "review" }),
    "utf8"
  )

  const candidate = buildPromotionCandidate("run-a", { rootDir })
  assert.equal(candidate.eligible, true)
  assert.equal(candidate.reviewState, "review")
  assert.equal(
    candidate.releaseReference,
    ".runtime-cache/artifacts/release/promotion-candidates/run-a.promotion-candidate.md"
  )
  assert.equal(candidate.showcaseReference, "docs/showcase/minimal-success-case.md#promotion-candidate-contract")
})

test("writePromotionCandidateArtifacts materializes candidate and share-pack files", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "webaudit-promotion-write-"))
  writeRun(rootDir, "run-a")
  writeRun(rootDir, "run-b")

  const candidate = writePromotionCandidateArtifacts("run-a", {
    rootDir,
    compareRunId: "run-b",
    reviewState: "approved",
  })

  assert.equal(candidate.reviewState, "approved")
  assert.ok(
    existsSync(
      resolve(rootDir, ".runtime-cache", "artifacts", "release", "promotion-candidates", "run-a.promotion-candidate.json")
    )
  )
  assert.ok(
    existsSync(
      resolve(rootDir, ".runtime-cache", "artifacts", "release", "share-pack", "run-a.share-pack.md")
    )
  )
})

test("buildPromotionCandidate refuses review escalation when eligibility failed", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "webaudit-promotion-ineligible-"))
  writeRun(rootDir, "run-a", { includeProof: true, writeProofFile: false })
  assert.throws(
    () => buildPromotionCandidate("run-a", { rootDir, reviewState: "approved" }),
    /requires an eligible retained run/i
  )
})
