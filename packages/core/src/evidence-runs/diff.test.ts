import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { compareEvidenceRuns } from "./diff.js"

function writeRun(
  rootDir: string,
  runId: string,
  options: { gateStatus: string; durationMs: number; failed: number }
) {
  const { gateStatus, durationMs, failed } = options
  const runDir = join(rootDir, ".runtime-cache", "artifacts", "runs", runId)
  mkdirSync(join(runDir, "reports"), { recursive: true })
  const checks = Array.from({ length: failed }).map((_, index) => ({
    id: `check_${index + 1}`,
    expected: 0,
    actual: 1,
    severity: "BLOCKER",
    status: "failed",
    reasonCode: "gate.failed.unspecified",
    evidencePath: "reports/summary.json",
  }))
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
        gateResults: { status: gateStatus, checks },
        toolchain: { node: process.version },
      },
      null,
      2
    ),
    "utf8"
  )
  writeFileSync(join(runDir, "reports", "summary.json"), "{}", "utf8")
}

test("compareEvidenceRuns returns gate, summary and artifact deltas", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "webaudit-evidence-compare-"))
  writeRun(rootDir, "run-a", { gateStatus: "passed", durationMs: 1000, failed: 0 })
  writeRun(rootDir, "run-b", { gateStatus: "failed", durationMs: 1600, failed: 2 })

  const diff = compareEvidenceRuns("run-a", "run-b", rootDir)
  assert.equal(diff.compareState, "ready")
  assert.equal(diff.gateStatusDelta.baseline, "passed")
  assert.equal(diff.gateStatusDelta.candidate, "failed")
  assert.equal(diff.summaryDelta.durationMs, 600)
  assert.equal(diff.summaryDelta.failedChecks, 2)
})
