import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"

import {
  canForwardTokenToBaseUrl,
  extractRunId,
  isAdvancedToolsEnabled,
  isTrustedBackendBaseUrl,
  normalizeBackendBaseUrl,
  normalizeRunPayload,
  parseRunStatus,
  readFirstString,
  setBackendBaseUrlOverride,
} from "../src/core/api-client.js"
import {
  analyzeA11y,
  analyzePerf,
  analyzeSecurity,
  analyzeVisual,
  buildReportBundle,
  comparePerf,
  extractFailedChecks,
  pickRunIdOrLatest,
  readRepoTextFile,
  readRunArtifacts,
  readRunOverview,
} from "../src/core/run-artifacts.js"
import {
  buildRunProofSnapshot,
  buildProofCampaignReport,
  findProofCampaignsForRun,
  getProofContextForRun,
  pickProofCampaignIdOrLatest,
  readProofCampaignIndex,
  readProofCampaignReport,
  writeProofCampaignArtifacts,
  writeProofCampaignDiff,
  proofCampaignSummaryDiff,
} from "../src/core/proof-campaign.js"

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    fn()
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function writeJson(pathname: string, payload: unknown): void {
  mkdirSync(resolve(pathname, ".."), { recursive: true })
  writeFileSync(pathname, JSON.stringify(payload, null, 2), "utf8")
}

test("api-client trust, forwarding and run payload helpers cover pure branches", () => {
  withEnv(
    {
      UIQ_MCP_ALLOW_REMOTE_TOKEN_FORWARDING: undefined,
      UIQ_MCP_REMOTE_TOKEN_HOST_ALLOWLIST: undefined,
      UIQ_MCP_ALLOW_REMOTE_BASE_URL: undefined,
      UIQ_MCP_TOOL_GROUPS: undefined,
      UIQ_MCP_PERFECT_MODE: undefined,
      UIQ_MCP_API_BASE_URL: "https://remote.example/path/",
    },
    () => {
      setBackendBaseUrlOverride(undefined)
      assert.equal(canForwardTokenToBaseUrl("http://127.0.0.1:18080"), true)
      assert.equal(canForwardTokenToBaseUrl("https://remote.example"), false)
      assert.equal(isTrustedBackendBaseUrl("https://remote.example"), false)
      assert.equal(normalizeBackendBaseUrl("https://remote.example/path/"), "http://127.0.0.1:18080")

      process.env.UIQ_MCP_ALLOW_REMOTE_TOKEN_FORWARDING = "true"
      process.env.UIQ_MCP_REMOTE_TOKEN_HOST_ALLOWLIST = "remote.example,api.example"
      process.env.UIQ_MCP_ALLOW_REMOTE_BASE_URL = "true"
      assert.equal(canForwardTokenToBaseUrl("https://remote.example/api"), true)
      assert.equal(canForwardTokenToBaseUrl("http://remote.example/api"), false)
      assert.equal(isTrustedBackendBaseUrl("https://remote.example"), true)
      assert.equal(normalizeBackendBaseUrl("https://remote.example/path/"), "https://remote.example/path")

      const nested = normalizeRunPayload({
        task_id: "task-top",
        run: { runId: "run-1", status: "waiting_otp" },
      })
      assert.equal(readFirstString(nested, ["task_id", "taskId"]), "task-top")
      assert.equal(parseRunStatus({ run: { status: "success" } }), "success")
      assert.equal(extractRunId({ run: { run_id: "run-1" } }), "run-1")
      assert.throws(() => extractRunId({ run: {} }), /run id missing/)

      process.env.UIQ_MCP_TOOL_GROUPS = "all"
      assert.equal(isAdvancedToolsEnabled(), true)
      process.env.UIQ_MCP_PERFECT_MODE = "false"
      process.env.UIQ_MCP_TOOL_GROUPS = ""
      assert.equal(isAdvancedToolsEnabled(), false)
    }
  )
})

test("proof-campaign helpers cover fallback index, malformed campaigns and strict success policy branches", () => {
  const runtimeRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-proof-extra-"))
  const repoRoot = process.cwd()
  const runOk = "run-ok"
  const runMissing = "run-missing"
  const proofRoot = resolve(runtimeRoot, "artifacts/proof-campaigns")

  withEnv(
    {
      UIQ_MCP_RUNTIME_CACHE_ROOT: runtimeRoot,
      UIQ_MCP_WORKSPACE_ROOT: repoRoot,
    },
    () => {
      try {
        writeJson(resolve(runtimeRoot, "artifacts/runs", runOk, "manifest.json"), {
          runId: runOk,
          gateResults: {
            status: "passed",
            checks: [],
          },
        })
        writeJson(resolve(runtimeRoot, "artifacts/runs", runOk, "reports/summary.json"), {
          status: "passed",
          checks: [],
        })
        writeJson(resolve(runtimeRoot, "artifacts/runs", runOk, "a11y/axe.json"), { ok: true })
        writeJson(resolve(runtimeRoot, "artifacts/runs", runOk, "perf/lighthouse.json"), {
          metrics: { lcp: 1.5, note: "non-numeric" },
        })
        writeJson(resolve(runtimeRoot, "artifacts/runs", runOk, "visual/report.json"), { ok: true })
        writeJson(resolve(runtimeRoot, "artifacts/runs", runOk, "security/report.json"), {
          ok: true,
        })
        writeJson(resolve(runtimeRoot, "artifacts/runs", runMissing, "manifest.json"), {
          runId: runMissing,
          gateResults: {
            status: "passed",
            checks: [],
          },
        })
        writeJson(resolve(runtimeRoot, "artifacts/runs", runMissing, "reports/summary.json"), {
          status: "passed",
          checks: [],
        })

        const snapshot = buildRunProofSnapshot(runOk)
        assert.equal(snapshot.ok, true)
        assert.equal((snapshot.evidenceCoverage as { ratio?: number }).ratio, 0.4167)

        const strictFailure = buildProofCampaignReport({
          campaignId: "campaign-strict-failure",
          model: "models/gemini-3.1-pro-preview",
          runIds: [runMissing],
        })
        assert.equal(strictFailure.ok, false)
        assert.deepEqual(
          [...(strictFailure.reasonCodes as string[])].sort(),
          ["CRITICAL_EVIDENCE_MISSING", "INVALID_RUN_PRESENT"]
        )

        writeJson(resolve(proofRoot, "campaign-fallback", "campaign.report.json"), strictFailure)
        const fallbackIndex = readProofCampaignIndex("campaign-fallback")
        assert.equal(fallbackIndex.campaignId, "campaign-fallback")

        writeJson(resolve(proofRoot, "campaign-good", "campaign.report.json"), {
          campaignId: "campaign-good",
          model: "models/gemini-3.1-pro-preview",
          generatedAt: "2026-03-09T00:00:00.000Z",
          runIds: [runOk],
          stats: { runCount: 1 },
          runReports: [{ runId: runOk, gateStatus: "passed", failedCheckCount: 0 }],
        })
        writeJson(resolve(proofRoot, "campaign-good", "campaign.index.json"), {
          campaignId: "campaign-good",
          runIds: [runOk],
          stats: { runCount: 1 },
        })
        mkdirSync(resolve(proofRoot, "campaign-bad"), { recursive: true })
        writeFileSync(resolve(proofRoot, "campaign-bad", "campaign.index.json"), "{", "utf8")

        const campaigns = findProofCampaignsForRun(runOk, 10)
        assert.ok(campaigns.includes("campaign-good"))

        const context = getProofContextForRun(runOk)
        assert.ok(["campaign-good", "campaign-fallback"].includes(String(context.latestCampaignId)))
        assert.equal((context.latestRunProof as { runId?: string }).runId, runOk)

        const missingSnapshot = buildRunProofSnapshot("missing-run")
        assert.equal(missingSnapshot.ok, false)

        const perfDiff = comparePerf(runOk, runOk)
        assert.deepEqual(perfDiff.deltas, { lcp: { from: 1.5, to: 1.5, delta: 0 } })
      } finally {
        rmSync(runtimeRoot, { recursive: true, force: true })
      }
    }
  )
})

test("run-artifacts and proof-campaign helpers cover filesystem and policy branches", () => {
  const runtimeRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-artifacts-"))
  const repoRoot = process.cwd()
  const runA = "run-a"
  const runB = "run-b"
  const runsRoot = resolve(runtimeRoot, "artifacts/runs")
  const proofRoot = resolve(runtimeRoot, "artifacts/proof-campaigns")

  withEnv(
    {
      UIQ_MCP_RUNTIME_CACHE_ROOT: runtimeRoot,
      UIQ_MCP_WORKSPACE_ROOT: repoRoot,
    },
    () => {
      try {
        writeJson(resolve(runsRoot, runA, "manifest.json"), {
          runId: runA,
          reports: { custom: "reports/custom.json" },
          gateResults: {
            status: "passed",
            checks: [
              {
                id: "console.error",
                status: "failed",
                actual: 1,
                expected: 0,
                reasonCode: "gate.console_error.failed.threshold_exceeded",
                evidencePath: "",
              },
            ],
          },
        })
        writeJson(resolve(runsRoot, runA, "reports/summary.json"), {
          status: "failed",
          checks: [
            {
              id: "visual.diff_pixels_max",
              status: "blocked",
              actual: 18,
              expected: 0,
            },
          ],
        })
        writeJson(resolve(runsRoot, runA, "reports/diagnostics.index.json"), { status: "failed" })
        writeJson(resolve(runsRoot, runA, "a11y/axe.json"), {
          counts: { total: 3 },
          issues: [{ id: "a11y-1", severity: "serious", message: "issue", selector: "#cta" }],
          scannedAt: "2026-03-09T00:00:00.000Z",
        })
        writeJson(resolve(runsRoot, runA, "perf/lighthouse.json"), {
          engine: "lhci",
          preset: "mobile",
          metrics: { lcp: 2500, cls: 0.01 },
          measuredAt: "2026-03-09T00:00:00.000Z",
        })
        writeJson(resolve(runsRoot, runA, "visual/report.json"), {
          mode: "diff",
          diffPixels: 42,
          totalPixels: 1000,
          diffRatio: 0.042,
          baselineCreated: false,
        })
        writeJson(resolve(runsRoot, runA, "security/report.json"), { issues: ["x"] })
        writeJson(resolve(runsRoot, runA, "metrics/security-tickets.json"), [{ id: "SEC-1" }])
        writeJson(resolve(runsRoot, runA, "metrics/load-summary.json"), { rps: 10 })
        writeJson(resolve(runsRoot, runA, "explore/report.json"), { discovered: 4 })
        writeJson(resolve(runsRoot, runA, "chaos/report.json"), { retries: 2 })
        writeJson(resolve(runsRoot, runA, "metrics/desktop-smoke.json"), { ok: true })
        writeJson(resolve(runsRoot, runA, "metrics/desktop-e2e.json"), { ok: false })
        writeJson(resolve(runsRoot, runA, "metrics/desktop-soak.json"), { ok: false })
        writeJson(resolve(runsRoot, runA, "metrics/desktop-readiness.json"), { ok: true })
        mkdirSync(resolve(runsRoot, runA, "screenshots"), { recursive: true })
        writeFileSync(resolve(runsRoot, runA, "screenshots/home_default.png"), "png", "utf8")

        writeJson(resolve(runsRoot, runB, "reports/summary.json"), {
          status: "passed",
          checks: [{ id: "test.unit", status: "passed", actual: "passed", expected: "passed" }],
        })
        writeJson(resolve(runsRoot, runB, "perf/lighthouse.json"), {
          metrics: { lcp: 2000, cls: 0.02 },
        })

        const failures = extractFailedChecks(
          [{ id: "page.error", status: "failed", actual: 1, expected: 0 }],
          [{ id: "ignored", status: "blocked" }]
        )
        assert.equal(failures[0]?.evidencePath, "reports/summary.json")

        const artifacts = readRunArtifacts(runA)
        assert.equal(artifacts.manifest?.gateResults?.status, "passed")
        const overview = readRunOverview(runA)
        assert.equal(overview.failedChecks.length, 1)

        const a11y = analyzeA11y(runA, 1)
        const perf = analyzePerf(runA)
        const visual = analyzeVisual(runA)
        const security = analyzeSecurity(runA)
        const bundle = buildReportBundle(runA)
        const diff = comparePerf(runA, runB)

        assert.equal((a11y.topIssues as unknown[]).length, 1)
        assert.equal(perf.engine, "lhci")
        assert.equal(visual.diffPixels, 42)
        assert.equal(security.ticketCount, 1)
        assert.equal((bundle.screenshots as unknown[]).length, 1)
        assert.deepEqual(diff.deltas, {
          lcp: { from: 2500, to: 2000, delta: -500 },
          cls: { from: 0.01, to: 0.02, delta: 0.01 },
        })
        assert.equal(pickRunIdOrLatest(" explicit "), "explicit")
        assert.ok([runA, runB].includes(pickRunIdOrLatest()))
        assert.match(readRepoTextFile("README.md"), /#|##|README/i)
        assert.throws(() => readRepoTextFile("apps/mcp-server/src/core.ts"), /file extension not allowed|path not allowed/)

        const campaign = buildProofCampaignReport({
          campaignId: "campaign-a",
          model: "models/gemini-3.1-pro-preview",
          runIds: [" ", runA, runA, runB, "missing-run"],
        })
        assert.equal(campaign.ok, false)
        assert.ok((campaign.reasonCodes as string[]).includes("INVALID_RUN_PRESENT"))
        assert.ok((campaign.reasonCodes as string[]).includes("CRITICAL_EVIDENCE_MISSING"))

        const written = writeProofCampaignArtifacts(campaign)
        assert.equal(readProofCampaignReport("campaign-a").campaignId, "campaign-a")
        assert.equal(readProofCampaignIndex("campaign-a").campaignId, "campaign-a")
        assert.equal(pickProofCampaignIdOrLatest(), "campaign-a")
        assert.ok(findProofCampaignsForRun(runA).includes("campaign-a"))
        const context = getProofContextForRun(runA)
        assert.equal(context.latestCampaignId, "campaign-a")

        const campaignB = buildProofCampaignReport({
          campaignId: "campaign-b",
          model: "models/gemini-3.1-pro-preview",
          runIds: [runB],
        })
        writeProofCampaignArtifacts(campaignB)
        const summaryDiff = proofCampaignSummaryDiff(campaign, campaignB)
        const diffPath = writeProofCampaignDiff(summaryDiff)
        assert.equal(diffPath.endsWith("campaign-a__vs__campaign-b.json"), true)
        assert.equal(readFileSync(written.indexPath, "utf8").includes('"campaignId": "campaign-a"'), true)
      } finally {
        rmSync(runtimeRoot, { recursive: true, force: true })
      }
    }
  )
})

test("proof-campaign edge branches cover fallback and malformed artifacts", () => {
  const runtimeRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-proof-edges-"))
  const repoRoot = process.cwd()
  const proofRoot = resolve(runtimeRoot, "artifacts/proof-campaigns")

  withEnv(
    {
      UIQ_MCP_RUNTIME_CACHE_ROOT: runtimeRoot,
      UIQ_MCP_WORKSPACE_ROOT: repoRoot,
    },
    () => {
      try {
        assert.throws(() => pickProofCampaignIdOrLatest(), /no proof campaigns found/)
        assert.throws(() => writeProofCampaignArtifacts({}), /campaignId missing/)

        const emptyReport = buildProofCampaignReport({
          campaignId: "campaign-empty",
          model: "models/gemini-3.1-pro-preview",
          runIds: ["", " ", "\n"],
        })
        assert.equal(emptyReport.ok, true)
        assert.deepEqual(emptyReport.reasonCodes, [])
        assert.deepEqual(emptyReport.stats, {
          runCount: 0,
          validRunCount: 0,
          gatePassedCount: 0,
          gatePassRate: 0,
          avgEvidenceCoverage: 0,
        })

        writeProofCampaignArtifacts({ campaignId: "campaign-min" })
        const minIndex = readProofCampaignIndex("campaign-min")
        assert.equal(minIndex.model, null)
        assert.equal(Array.isArray(minIndex.runIds), true)
        assert.deepEqual(minIndex.stats, {})

        rmSync(resolve(proofRoot, "campaign-min", "campaign.index.json"), { force: true })
        const rebuiltIndex = readProofCampaignIndex("campaign-min")
        assert.deepEqual(rebuiltIndex, {
          campaignId: "campaign-min",
          model: null,
          generatedAt: null,
          runIds: [],
          stats: {},
        })

        writeJson(resolve(proofRoot, "campaign-match", "campaign.report.json"), {
          campaignId: "campaign-match",
          runReports: { malformed: true },
        })
        writeJson(resolve(proofRoot, "campaign-match", "campaign.index.json"), {
          campaignId: "campaign-match",
          runIds: ["run-edge"],
        })

        writeJson(resolve(proofRoot, "campaign-non-array", "campaign.report.json"), {
          campaignId: "campaign-non-array",
        })
        writeJson(resolve(proofRoot, "campaign-non-array", "campaign.index.json"), {
          campaignId: "campaign-non-array",
          runIds: { not: "an array" },
        })

        writeJson(resolve(proofRoot, "campaign-bad-index", "campaign.report.json"), {
          campaignId: "campaign-bad-index",
        })
        mkdirSync(resolve(proofRoot, "campaign-bad-index"), { recursive: true })
        writeFileSync(resolve(proofRoot, "campaign-bad-index", "campaign.index.json"), "{", "utf8")

        const matched = findProofCampaignsForRun("run-edge", 50)
        assert.ok(matched.includes("campaign-match"))
        assert.ok(!matched.includes("campaign-non-array"))

        const contextEdge = getProofContextForRun("run-edge")
        assert.ok(contextEdge.campaignsForRun.includes("campaign-match"))
        assert.equal(contextEdge.latestRunProof, null)

        mkdirSync(resolve(proofRoot, "campaign-bad-report"), { recursive: true })
        writeFileSync(resolve(proofRoot, "campaign-bad-report", "campaign.report.json"), "{", "utf8")
        writeJson(resolve(proofRoot, "campaign-bad-report", "campaign.index.json"), {
          campaignId: "campaign-bad-report",
          runIds: ["run-badctx"],
        })

        const contextBadReport = getProofContextForRun("run-badctx")
        assert.ok(contextBadReport.campaignsForRun.includes("campaign-bad-report"))
        assert.equal(contextBadReport.latestRunProof, null)

        const summaryFallbackDiff = proofCampaignSummaryDiff(
          {
            failedCheckHistogram: { alpha: 1 },
            runReports: [{}],
          },
          {
            stats: { runCount: "n/a", gatePassedCount: 2 },
            failedCheckHistogram: { beta: 3 },
            runReports: [{ runId: "", failedCheckCount: 2 }],
          }
        )
        assert.equal(summaryFallbackDiff.campaignA, null)
        assert.equal(summaryFallbackDiff.campaignB, null)
        assert.equal((summaryFallbackDiff.delta as { runCount: number }).runCount, 0)
        assert.equal(
          (summaryFallbackDiff.failedCheckDelta as Record<string, number>).alpha,
          -1
        )
        assert.equal(
          (summaryFallbackDiff.failedCheckDelta as Record<string, number>).beta,
          3
        )
        assert.equal(
          (
            summaryFallbackDiff.runChanges as Array<{
              failedCheckCount?: { delta?: number }
            }>
          )[0]?.failedCheckCount?.delta,
          2
        )

        const fallbackDiffPath = writeProofCampaignDiff({})
        assert.equal(fallbackDiffPath.endsWith("unknown-a__vs__unknown-b.json"), true)
      } finally {
        rmSync(runtimeRoot, { recursive: true, force: true })
      }
    }
  )
})
