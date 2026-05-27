import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { listEvidenceRuns, readEvidenceRunDetail, readLatestEvidenceRun } from "./read-model.js"

function writeRun(rootDir: string, runId: string, correlationId?: string): void {
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
        reports: { report: "reports/summary.json", proofCoverage: "reports/proof.coverage.json" },
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
        provenance: correlationId
          ? {
              source: "canonical",
              correlationId,
              linkedRunIds: ["rn_1"],
              linkedTaskIds: ["task_1"],
            }
          : undefined,
      },
      null,
      2
    ),
    "utf8"
  )
  writeFileSync(join(runDir, "reports", "summary.json"), "{}", "utf8")
}

test("evidence run read-model exposes retention and provenance", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "proofyard-evidence-runs-"))
  writeRun(rootDir, "run-older")
  writeRun(rootDir, "run-latest", "corr-1")

  const listed = listEvidenceRuns(10, rootDir)
  assert.equal(listed.registryState, "available")
  assert.equal(listed.runs[0]?.runId, "run-latest")
  assert.equal(listed.runs[0]?.retentionState, "partial")

  const detail = readEvidenceRunDetail("run-latest", rootDir)
  assert.equal(detail.provenance.correlationId, "corr-1")
  assert.deepEqual(detail.provenance.linkedTaskIds, ["task_1"])
  assert.ok(detail.missingPaths.includes("reports/proof.coverage.json"))

  const latest = readLatestEvidenceRun(rootDir)
  assert.equal(latest.run?.runId, "run-latest")
})
