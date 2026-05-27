import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { buildEvidenceSharePack } from "./share-pack.js"

function writeRun(rootDir: string, runId: string, gateStatus = "passed") {
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
        reports: { report: "reports/summary.json" },
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
      },
      null,
      2
    ),
    "utf8"
  )
  writeFileSync(join(runDir, "reports", "summary.json"), "{}", "utf8")
}

test("buildEvidenceSharePack returns markdown and json summaries", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "proofyard-share-pack-"))
  writeRun(rootDir, "run-a", "failed")
  writeRun(rootDir, "run-b", "passed")

  const pack = buildEvidenceSharePack("run-a", { compareRunId: "run-b", rootDir })
  assert.equal(pack.runId, "run-a")
  assert.match(pack.markdownSummary, /Evidence Share Pack/)
  assert.match(pack.issueReadySnippet, /Failure Digest/)
  assert.match(pack.releaseAppendix, /Evidence Appendix/)
  assert.equal(pack.jsonBundle.compare?.candidateRunId, "run-b")
})
