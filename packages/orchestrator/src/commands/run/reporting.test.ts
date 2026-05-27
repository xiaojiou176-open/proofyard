import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"

import {
  collectFailureLocations,
  normalizeDiagnosticsSection,
  normalizeList,
  resolveAcId,
  writeDiagnosticsIndex,
} from "./reporting.js"

test("resolveAcId prefers explicit acId and falls back to check id", () => {
  assert.equal(resolveAcId({ id: "check.alpha", acId: " AC-1 " }), "AC-1")
  assert.equal(resolveAcId({ id: "check.beta", acId: "   " }), "check.beta")
  assert.equal(resolveAcId({ id: "check.gamma" }), "check.gamma")
})

test("collectFailureLocations maps failed and blocked checks to step ids", () => {
  const result = collectFailureLocations([
    {
      id: "console.error",
      acId: "AC-console",
      expected: 0,
      actual: 1,
      severity: "BLOCKER",
      status: "failed",
      reasonCode: "gate.console_error.failed.threshold_exceeded",
      evidencePath: "logs/console.log",
    },
    {
      id: "desktop.smoke",
      expected: "passed",
      actual: "blocked",
      severity: "BLOCKER",
      status: "blocked",
      reasonCode: "gate.desktop_smoke.blocked.unsupported_target",
      evidencePath: "reports/desktop-smoke.json",
    },
    {
      id: "custom.check",
      expected: "ok",
      actual: "ok",
      severity: "MINOR",
      status: "passed",
      evidencePath: "reports/custom.json",
    },
  ])

  assert.deepEqual(result, [
    {
      acId: "AC-console",
      checkId: "console.error",
      status: "failed",
      reasonCode: "gate.console_error.failed.threshold_exceeded",
      stepId: "capture",
      artifactPath: "logs/console.log",
    },
    {
      acId: "desktop.smoke",
      checkId: "desktop.smoke",
      status: "blocked",
      reasonCode: "gate.desktop_smoke.blocked.unsupported_target",
      stepId: "desktop_smoke",
      artifactPath: "reports/desktop-smoke.json",
    },
  ])
})

test("normalizeList deduplicates values and records truncation metadata", () => {
  const normalized = normalizeList(["a", "b", "a", "c", "d"], 3)

  assert.deepEqual(normalized.items, ["a", "b", "c"])
  assert.deepEqual(normalized.truncation, {
    originalCount: 5,
    uniqueCount: 4,
    keptCount: 3,
    truncated: true,
  })
})

test("normalizeDiagnosticsSection truncates each diagnostics bucket independently", () => {
  const normalized = normalizeDiagnosticsSection(
    {
      consoleErrors: ["c1", "c2", "c1"],
      pageErrors: ["p1", "p2", "p3"],
      http5xxUrls: ["u1", "u1", "u2"],
    },
    2
  )

  assert.deepEqual(normalized.consoleErrors, ["c1", "c2"])
  assert.deepEqual(normalized.pageErrors, ["p1", "p2"])
  assert.deepEqual(normalized.http5xxUrls, ["u1", "u2"])
  assert.equal(normalized.truncation.consoleErrors.truncated, false)
  assert.equal(normalized.truncation.pageErrors.truncated, true)
  assert.equal(normalized.truncation.http5xxUrls.uniqueCount, 2)
})

test("writeDiagnosticsIndex persists the expected report path and payload", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "uiq-reporting-index-"))
  try {
    mkdirSync(resolve(dir, "reports"), { recursive: true })
    const relativePath = writeDiagnosticsIndex(dir, {
      runId: "run-123",
      status: "failed",
      profile: "nightly",
      target: { type: "web", name: "web.local" },
      reports: { summary: "reports/summary.json" },
      diagnostics: {
        capture: { consoleErrors: 1, pageErrors: 2, http5xxUrls: 3 },
        explore: { consoleErrors: 4, pageErrors: 5, http5xxUrls: 6 },
        chaos: { consoleErrors: 7, pageErrors: 8, http5xxUrls: 9 },
        aggregateHttp5xx: 10,
        blockedSteps: ["visual"],
        blockedStepDetails: [
          {
            stepId: "visual",
            reasonCode: "gate.visual.blocked.baseline_missing",
            detail: "baseline missing",
            artifactPath: "visual/report.json",
          },
        ],
        failureLocations: [
          {
            acId: "AC-1",
            checkId: "visual.diff_pixels",
            status: "failed",
            reasonCode: "gate.visual.failed.diff_pixels",
            stepId: "visual",
            artifactPath: "visual/report.json",
          },
        ],
        execution: {
          maxParallelTasks: 3,
          stagesMs: { capture: 120, visual: 340 },
          criticalPath: ["visual", "capture"],
        },
      },
    })

    const absolutePath = resolve(dir, relativePath)
    assert.equal(relativePath, "reports/diagnostics.index.json")
    assert.equal(existsSync(absolutePath), true)
    const payload = JSON.parse(readFileSync(absolutePath, "utf8")) as {
      runId: string
      diagnostics: { execution: { criticalPath: string[] } }
    }
    assert.equal(payload.runId, "run-123")
    assert.deepEqual(payload.diagnostics.execution.criticalPath, ["visual", "capture"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
