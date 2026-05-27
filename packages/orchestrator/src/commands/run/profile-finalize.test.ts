import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"

import { finalizeProfileRunArtifacts } from "./profile-finalize.js"

function createBaseDir(prefix: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), prefix))
  mkdirSync(resolve(dir, "reports"), { recursive: true })
  mkdirSync(resolve(dir, "logs"), { recursive: true })
  mkdirSync(resolve(dir, "metrics"), { recursive: true })
  mkdirSync(resolve(dir, "a11y"), { recursive: true })
  mkdirSync(resolve(dir, "perf"), { recursive: true })
  mkdirSync(resolve(dir, "visual"), { recursive: true })
  mkdirSync(resolve(dir, "security"), { recursive: true })
  writeFileSync(resolve(dir, "logs/home.log"), "log", "utf8")
  return dir
}

test("finalizeProfileRunArtifacts writes rich web manifest/report/proof bundle", () => {
  const baseDir = createBaseDir("uiq-profile-finalize-web-")
  try {
    const result = finalizeProfileRunArtifacts({
      baseDir,
      resolvedRunId: "run-web",
      startedAt: "2026-03-09T00:00:00.000Z",
      profile: {
        name: "nightly",
        steps: ["capture", "explore", "chaos", "a11y", "perf", "visual", "load", "security", "unit", "contract", "ct", "e2e"],
        gates: {
          consoleErrorMax: 0,
          pageErrorMax: 0,
          http5xxMax: 0,
          contractStatus: "passed",
          perfEngineReadyRequired: true,
          visualBaselineReadyRequired: true,
        },
      },
      target: { type: "web", name: "web.local", driver: "web-playwright", baseUrl: "http://127.0.0.1:4173" },
      effectiveBaseUrl: "http://127.0.0.1:4173",
      effectiveApp: undefined,
      effectiveBundleId: undefined,
      stateModel: {
        configuredRoutes: [{ id: "home" }],
        configuredStories: [{ id: "story" }],
        configuredTotal: 2,
      },
      states: [
        { id: "home", source: "routes", artifacts: { log: "logs/home.log", screenshot: "screenshots/home.png" } },
        { id: "discover", source: "discovery", artifacts: {} },
      ],
      captureSummary: { consoleError: 1, pageError: 1, http5xx: 1 },
      consoleErrorFromExplore: 2,
      consoleErrorFromChaos: 1,
      pageErrorFromChaos: 1,
      pageErrorFromExplore: 1,
      http5xxFromExplore: 1,
      http5xxFromChaos: 2,
      highVulnCount: 3,
      mediumVulnCount: 2,
      lowVulnCount: 1,
      securityResult: {
        totalIssueCount: 6,
        dedupedIssueCount: 5,
        tickets: [{ ticketId: "SEC-1", severity: "high", impactScope: "auth", affectedFiles: ["a.ts"] }],
        clusters: { byRule: [{ id: "r1" }], byComponent: [{ id: "c1" }] },
      },
      securityBlocked: false,
      securityBlockedReason: undefined,
      securityFailed: false,
      securityFailedReason: undefined,
      securityReportPath: "security/report.json",
      securityTicketsPath: "metrics/security-tickets.json",
      loadSummary: {
        totalRequests: 100,
        failedRequests: 3,
        http5xx: 1,
        requestsPerSecond: 4.2,
        latencyP95Ms: 900,
        latencyP99Ms: 1200,
        errorBudgetRate: 0.03,
        stageFailedCount: 1,
        engineReady: false,
        engines: [],
      },
      a11ySummary: { serious: 4, total: 9 },
      a11yResultData: { engine: "axe", standard: "wcag2.2aa", counts: { total: 9, critical: 1, serious: 3 } },
      perfSummary: { lcpMs: 2800, fcpMs: 1200 },
      perfResultData: {
        engine: "lhci",
        preset: "mobile",
        metrics: { largestContentfulPaintMs: 2800, firstContentfulPaintMs: 1200 },
        fallbackUsed: true,
        metricsCompleteness: "builtin_partial",
      },
      visualSummary: { diffPixels: 18, baselineCreated: true },
      visualResultData: {
        engine: "lostpixel",
        mode: "diff",
        baselineCreated: true,
        diffPixels: 18,
        totalPixels: 1000,
        diffRatio: 0.018,
        baselinePath: "visual/base.png",
        currentPath: "visual/current.png",
        diffPath: "visual/diff.png",
      },
      loadReportPath: "metrics/load-summary.json",
      a11yReportPath: "a11y/axe.json",
      perfReportPath: "perf/lighthouse.json",
      visualReportPath: "visual/report.json",
      unitTestResult: { status: "failed", reportPath: "reports/unit.json" },
      contractTestResult: { status: "failed", reportPath: "reports/contract.json" },
      ctTestResult: { status: "failed", reportPath: "reports/ct.json" },
      e2eTestResult: { status: "passed", reportPath: "reports/e2e.json" },
      generatedReports: { custom: "reports/custom.json" },
      maxParallelTasks: 3,
      stageDurationsMs: { capture: 100, explore: 200, chaos: 300 },
      runtimeStart: {
        started: true,
        autostart: true,
        healthcheckPassed: false,
        healthcheckUrl: "http://127.0.0.1:4173/health",
        reportPath: "reports/runtime.json",
      },
      blockedStepReasons: ["step.visual unsupported"],
      blockedStepDetails: [
        {
          stepId: "visual",
          reasonCode: "gate.driver_capability.blocked.unsupported_target_type",
          detail: "unsupported",
          artifactPath: "reports/summary.json",
        },
      ],
      exploreResultData: { discoveredStates: 0 },
      captureDiagnostics: { consoleErrors: ["c1"], pageErrors: ["p1"], http5xxUrls: ["u1"] },
      exploreDiagnostics: { consoleErrors: ["ec1"], pageErrors: ["ep1"], http5xxUrls: ["eu1"] },
      chaosDiagnostics: { consoleErrors: ["cc1"], pageErrors: ["cp1"], http5xxUrls: ["cu1"] },
      effectiveDiagnosticsConfig: { maxItems: 5 },
      effectiveGeminiStrategy: { model: "models/gemini-3.1-pro-preview", thinking: "high" },
      desktopReadinessPath: undefined,
      desktopReadinessResult: undefined,
      desktopSmokePath: undefined,
      desktopSmokeResult: undefined,
      desktopE2EPath: undefined,
      desktopE2EResult: undefined,
      desktopSoakPath: undefined,
      desktopSoakResult: undefined,
      effectiveExploreConfig: { engine: "crawlee" },
      effectiveChaosConfig: { enabled: true },
      effectiveLoadConfig: { engines: ["builtin", "k6"] },
      effectiveA11yConfig: { engine: "axe" },
      effectivePerfConfig: { engine: "lhci" },
      effectiveVisualConfig: { mode: "diff" },
      effectiveSecurityConfig: { engine: "semgrep" },
      baseUrlPolicy: { enabled: true, matched: true },
    })

    const manifest = JSON.parse(readFileSync(resolve(baseDir, result.manifestPath), "utf8")) as {
      gateResults: { status: string; checks: Array<{ id: string }> }
      reports: Record<string, string>
      proof: { coveragePath: string }
      diagnostics: { blockedSteps: string[]; execution: { criticalPath: string[] } }
      stateModel: { modelType: string; configuredTotal: number; capturedRoutes: number }
    }
    assert.equal(result.runId, "run-web")
    assert.equal(manifest.stateModel.modelType, "web")
    assert.equal(manifest.stateModel.configuredTotal, 2)
    assert.equal(manifest.stateModel.capturedRoutes, 1)
    assert.ok(manifest.gateResults.checks.some((check) => check.id === "test.unit"))
    assert.ok(manifest.gateResults.checks.some((check) => check.id === "runtime.healthcheck"))
    assert.equal(manifest.reports.report, "reports/summary.json")
    assert.equal(manifest.reports.logIndex, "reports/log-index.json")
    assert.equal(manifest.proof.coveragePath, "reports/proof.coverage.json")
    assert.deepEqual(manifest.diagnostics.blockedSteps, ["step.visual unsupported"])
    assert.equal(manifest.diagnostics.execution.criticalPath.length > 0, true)
    const logIndex = JSON.parse(readFileSync(resolve(baseDir, "reports/log-index.json"), "utf8")) as {
      runId: string
      entries: Array<{ channel: string; path: string }>
    }
    assert.equal(logIndex.runId, "run-web")
    assert.ok(logIndex.entries.some((entry) => entry.channel === "runtime" && entry.path === "logs/home.log"))
    assert.ok(logIndex.entries.some((entry) => entry.channel === "test" && entry.path === "reports/unit.json"))
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("finalizeProfileRunArtifacts writes desktop state model when target is desktop", () => {
  const baseDir = createBaseDir("uiq-profile-finalize-desktop-")
  try {
    const result = finalizeProfileRunArtifacts({
      baseDir,
      resolvedRunId: "run-desktop",
      startedAt: "2026-03-09T00:00:00.000Z",
      profile: { name: "desktop", steps: ["desktop_readiness", "desktop_smoke", "desktop_e2e", "desktop_soak"], gates: {} },
      target: { type: "desktop", name: "tauri.local", driver: "tauri-webdriver" },
      effectiveBaseUrl: "",
      effectiveApp: "/Applications/App.app",
      effectiveBundleId: "com.example.app",
      stateModel: { configuredRoutes: [], configuredStories: [], configuredTotal: 0 },
      states: [{ id: "manual-1", source: "manual", artifacts: {} }],
      captureSummary: { consoleError: 0, pageError: 0, http5xx: 0 },
      consoleErrorFromExplore: 0,
      consoleErrorFromChaos: 0,
      pageErrorFromChaos: 0,
      pageErrorFromExplore: 0,
      http5xxFromExplore: 0,
      http5xxFromChaos: 0,
      highVulnCount: 0,
      mediumVulnCount: 0,
      lowVulnCount: 0,
      securityResult: undefined,
      securityBlocked: false,
      securityBlockedReason: undefined,
      securityFailed: false,
      securityFailedReason: undefined,
      securityReportPath: undefined,
      securityTicketsPath: undefined,
      loadSummary: undefined,
      a11ySummary: undefined,
      a11yResultData: undefined,
      perfSummary: undefined,
      perfResultData: undefined,
      visualSummary: undefined,
      visualResultData: undefined,
      loadReportPath: undefined,
      a11yReportPath: undefined,
      perfReportPath: undefined,
      visualReportPath: undefined,
      unitTestResult: undefined,
      contractTestResult: undefined,
      ctTestResult: undefined,
      e2eTestResult: undefined,
      generatedReports: {},
      maxParallelTasks: 1,
      stageDurationsMs: { desktop_smoke: 10 },
      runtimeStart: { started: false, autostart: false, healthcheckPassed: false, reportPath: "reports/runtime.json" },
      blockedStepReasons: [],
      blockedStepDetails: [],
      exploreResultData: undefined,
      captureDiagnostics: { consoleErrors: [], pageErrors: [], http5xxUrls: [] },
      exploreDiagnostics: { consoleErrors: [], pageErrors: [], http5xxUrls: [] },
      chaosDiagnostics: { consoleErrors: [], pageErrors: [], http5xxUrls: [] },
      effectiveDiagnosticsConfig: { maxItems: 5 },
      effectiveGeminiStrategy: { model: "models/gemini-3.1-pro-preview" },
      desktopReadinessPath: "reports/desktop-readiness.json",
      desktopReadinessResult: { status: "passed", reportPath: "reports/desktop-readiness.json" },
      desktopSmokePath: "reports/desktop-smoke.json",
      desktopSmokeResult: { status: "passed", reportPath: "reports/desktop-smoke.json" },
      desktopE2EPath: "reports/desktop-e2e.json",
      desktopE2EResult: { status: "failed", reportPath: "reports/desktop-e2e.json" },
      desktopSoakPath: "reports/desktop-soak.json",
      desktopSoakResult: { status: "passed", reportPath: "reports/desktop-soak.json" },
      effectiveExploreConfig: undefined,
      effectiveChaosConfig: undefined,
      effectiveLoadConfig: undefined,
      effectiveA11yConfig: undefined,
      effectivePerfConfig: undefined,
      effectiveVisualConfig: undefined,
      effectiveSecurityConfig: undefined,
      baseUrlPolicy: undefined,
    })

    const manifest = JSON.parse(readFileSync(resolve(baseDir, result.manifestPath), "utf8")) as {
      stateModel: {
        modelType: string
        configuredDesktopScenarios: number
        capturedDesktopScenarios: number
      }
    }
    assert.equal(manifest.stateModel.modelType, "desktop")
    assert.equal(manifest.stateModel.configuredDesktopScenarios, 4)
    assert.equal(manifest.stateModel.capturedDesktopScenarios, 3)
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})
