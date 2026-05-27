import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  buildPromotionCandidateRecord,
  buildEvidenceSharePackRecord,
  compareEvidenceRunRecords,
  listEvidenceRunSummaries,
  readEvidenceRunRecord,
  readLatestEvidenceRunRecord,
} from "../src/core/run-artifacts.js"

function writeRun(
  rootDir: string,
  runId: string,
  options: { gateStatus?: string; durationMs?: number } = {}
): void {
  const { gateStatus = "passed", durationMs = 300000 } = options
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
          durationMs,
        },
        execution: { maxParallelTasks: 1, stagesMs: {}, criticalPath: [] },
        states: [],
        evidenceIndex: [
          { id: "report.report", source: "report", kind: "report", path: "reports/summary.json" },
        ],
        reports: { report: "reports/summary.json", proofCoverage: "reports/proof.coverage.json" },
        proof: { coveragePath: "reports/proof.coverage.json" },
        summary: {
          consoleError: 0,
          pageError: 0,
          http5xx: 0,
          aiModel: "model",
          promptVersion: "",
          cacheStats: { hit: 0, miss: 0, hitRate: 0 },
          computerUseSafetyConfirmations: 0,
        },
        gateResults: { status: gateStatus, checks: [] },
        toolchain: { node: process.version },
        provenance: { source: "canonical" },
      },
      null,
      2
    ),
    "utf8"
  )
  writeFileSync(join(runDir, "reports", "summary.json"), "{}", "utf8")
  writeFileSync(join(runDir, "reports", "proof.coverage.json"), "{}", "utf8")
}

test("mcp evidence registry helpers expose shared evidence run data", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "webaudit-mcp-evidence-"))
  writeRun(rootDir, "run-a", { gateStatus: "passed", durationMs: 300000 })
  writeRun(rootDir, "run-b", { gateStatus: "failed", durationMs: 301000 })
  const previousCwd = process.cwd()
  process.chdir(rootDir)
  try {
    const listed = listEvidenceRunSummaries(10) as { registryState: string; runs: Array<{ runId: string }> }
    assert.equal(listed.registryState, "available")
    assert.equal(listed.runs.length, 2)

    const detail = readEvidenceRunRecord("run-a") as { runId: string; manifestPath: string | null }
    assert.equal(detail.runId, "run-a")
    assert.equal(detail.manifestPath, "manifest.json")

    const latest = readLatestEvidenceRunRecord() as { run?: { runId: string } | null }
    assert.ok(latest.run?.runId)

    const compare = compareEvidenceRunRecords("run-a", "run-b") as {
      gateStatusDelta: { baseline: string; candidate: string }
      summaryDelta: { durationMs: number }
    }
    assert.equal(compare.gateStatusDelta.baseline, "passed")
    assert.equal(compare.gateStatusDelta.candidate, "failed")
    assert.equal(compare.summaryDelta.durationMs, 1000)

    const sharePack = buildEvidenceSharePackRecord("run-a", "run-b") as {
      markdownSummary: string
      issueReadySnippet: string
    }
    assert.match(sharePack.markdownSummary, /Evidence Share Pack/)
    assert.match(sharePack.issueReadySnippet, /Failure Digest/)

    const promotion = buildPromotionCandidateRecord("run-a", "run-b") as {
      eligible: boolean
      reviewState: string
      supportingSharePackReference: string
    }
    assert.equal(promotion.eligible, true)
    assert.equal(promotion.reviewState, "candidate")
    assert.match(promotion.supportingSharePackReference, /share-pack\.md$/)
  } finally {
    process.chdir(previousCwd)
  }
})
