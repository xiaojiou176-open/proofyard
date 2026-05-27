// @ts-nocheck

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import nodeTest from "node:test"
import { callToolJson, callToolText, startMcpHarnessAdvanced } from "./helpers/mcp-client.js"
import { startStubBackend } from "./helpers/stub-backend.js"

const fixtureWorkspaceRoot = resolve(import.meta.dirname, "fixtures/workspace")
const fakeUiqBin = resolve(import.meta.dirname, "fixtures/bin/fake-uiq.sh")

function createTempWorkspace(prefix: string): string {
  const source = fixtureWorkspaceRoot
  const temp = mkdtempSync(resolve(tmpdir(), `${prefix}-`))
  cpSync(source, temp, { recursive: true })
  return temp
}

function createFakePnpmBin(workspaceRoot: string): string {
  const resolvedPnpm = spawnSync("bash", ["-lc", "command -v pnpm"], {
    encoding: "utf8",
  }).stdout.trim()
  if (!resolvedPnpm) {
    throw new Error("pnpm executable not found in PATH for fake pnpm passthrough")
  }
  const binDir = resolve(workspaceRoot, ".runtime-cache/fake-bin")
  mkdirSync(binDir, { recursive: true })
  const scriptPath = resolve(binDir, "pnpm")
  writeFileSync(
    scriptPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "if [[ \"${1:-}\" == \"exec\" && \"${2:-}\" == \"tsx\" && \"${3:-}\" == \"scripts/usability/lane-d-usability.ts\" ]]; then",
      "  mkdir -p .runtime-cache/artifacts/usability",
      "  cat > .runtime-cache/artifacts/usability/lane-d-metrics.json <<'JSON'",
      "{\"summaries\":[{\"completionRate\":0.95},{\"completionRate\":0.8}]}",
      "JSON",
      "  exit 0",
      "fi",
      `exec "${resolvedPnpm}" "$@"`,
      "",
    ].join("\n"),
    "utf8"
  )
  chmodSync(scriptPath, 0o755)
  return binDir
}

nodeTest(
  "mcp success paths: catalog/selfcheck/doc/runs/overview/failures/artifact",
  { timeout: 60_000 },
  async () => {
    const backend = await startStubBackend()
    const harness = await startMcpHarnessAdvanced({
      workspaceRoot: fixtureWorkspaceRoot,
      env: {
        UIQ_MCP_API_BASE_URL: backend.baseUrl,
        UIQ_MCP_TOOL_GROUPS: "all",
      },
    })

    try {
      const listed = await harness.client.listTools()
      const names = listed.tools.map((t) => t.name)
      assert.ok(names.includes("uiq_read"))
      assert.ok(names.includes("uiq_run"))
      assert.ok(names.includes("uiq_run_and_report"))
      assert.ok(names.includes("uiq_quality_read"))
      assert.ok(names.includes("uiq_api_workflow"))
      assert.ok(names.includes("uiq_api_automation"))
      assert.ok(names.includes("uiq_proof"))
      assert.ok(names.includes("uiq_catalog"))
      assert.ok(names.includes("uiq_run_and_report"))
      assert.ok(names.includes("uiq_compare_perf"))
      assert.ok(names.includes("uiq_read"))

      const catalog = await callToolJson<{
        profiles: string[]
        targets: string[]
        commands: string[]
        backendBaseUrl: string
        tokenConfigured: boolean
      }>(harness.client, "uiq_catalog")
      assert.equal(catalog.isError, false)
      assert.ok(catalog.data.profiles.includes("pr"))
      assert.ok(catalog.data.targets.includes("web.local"))
      assert.deepEqual(catalog.data.commands, [
        "run",
        "capture",
        "explore",
        "chaos",
        "a11y",
        "perf",
        "visual",
        "e2e",
        "load",
        "security",
        "computer-use",
        "desktop-readiness",
        "desktop-e2e",
        "desktop-business",
        "desktop-soak",
        "engines:check",
        "report",
      ])
      assert.equal(catalog.data.backendBaseUrl, backend.baseUrl)

      const selfcheck = await callToolJson<{
        ok: boolean
        checks: Array<{ name: string; ok: boolean }>
      }>(harness.client, "uiq_server_selfcheck")
      assert.equal(selfcheck.isError, false)
      assert.equal(selfcheck.data.ok, true)
      assert.ok(selfcheck.data.checks.some((c) => c.name === "backend_health" && c.ok === true))

      const doc = await callToolJson<{
        ok: boolean
        source: string
        relativePath: string
        text: string
      }>(harness.client, "uiq_read", {
        source: "repo_doc",
        relativePath: "docs/hello.md",
      })
      assert.equal(doc.isError, false)
      assert.equal(doc.data.ok, true)
      assert.equal(doc.data.source, "repo_doc")
      assert.match(doc.data.text, /fixture doc/)

      const runs = await callToolJson<{ runs: string[] }>(harness.client, "uiq_list_runs", {
        limit: 10,
      })
      assert.equal(runs.isError, false)
      assert.ok(runs.data.runs.includes("run-a"))

      const overview = await callToolJson<{
        ok: boolean
        runId: string
        gateStatus: string
        failedChecks: Array<{ id: string; source: string; evidencePath: string | null }>
      }>(harness.client, "uiq_run_and_report", { mode: "overview", runId: "run-a" })
      assert.equal(overview.isError, false)
      assert.equal(overview.data.ok, true)
      assert.equal(overview.data.runId, "run-a")
      assert.equal(overview.data.gateStatus, "failed")
      assert.ok(
        overview.data.failedChecks.some(
          (c) => c.id === "a11y" && c.source === "summary" && c.evidencePath === "a11y/axe.json"
        )
      )

      const gateFailures = await callToolJson<{
        runId: string
        gateStatus: string
        failedChecks: Array<{ id: string; source: string; evidencePath: string | null }>
      }>(harness.client, "uiq_run_and_report", { mode: "failures", runId: "run-a" })
      assert.equal(gateFailures.isError, false)
      assert.equal(gateFailures.data.runId, "run-a")
      assert.equal(gateFailures.data.gateStatus, "failed")
      assert.ok(
        gateFailures.data.failedChecks.some(
          (c) => c.id === "a11y" && c.evidencePath === "a11y/axe.json"
        )
      )

      const artifact = await callToolJson<{
        ok: boolean
        source: string
        runId: string
        relativePath: string
        text: string
      }>(harness.client, "uiq_read", {
        source: "artifact",
        runId: "run-a",
        relativePath: "a11y/axe.json",
      })
      assert.equal(artifact.isError, false)
      assert.equal(artifact.data.ok, true)
      assert.equal(artifact.data.source, "artifact")
      assert.equal(artifact.data.runId, "run-a")
      assert.match(artifact.data.text, /"violations": 2/)

      const missingArtifact = await callToolText(harness.client, "uiq_read", {
        source: "artifact",
        runId: "run-a",
        relativePath: "missing/not-found.json",
      })
      assert.equal(missingArtifact.isError, true)
      assert.match(missingArtifact.text, /ENOENT|not found/i)

      const perfDelta = await callToolJson<{
        runA: string
        runB: string
        deltas: Record<string, unknown>
      }>(harness.client, "uiq_compare_perf", {
        runIdA: "run-a",
        runIdB: "run-b",
      })
      assert.equal(perfDelta.isError, false)
      assert.equal(perfDelta.data.runA, "run-a")
      assert.equal(perfDelta.data.runB, "run-b")
      assert.ok("fcp" in perfDelta.data.deltas)
      assert.ok("lcp" in perfDelta.data.deltas)
    } finally {
      await harness.close()
      await backend.close()
    }
  }
)

nodeTest(
  "mcp success paths: manifest-first checks include source and fallback evidencePath",
  { timeout: 60_000 },
  async () => {
    const workspaceRoot = createTempWorkspace("uiq-mcp-success")
    const runId = `run-manifest-only-${Date.now()}`
    const runDir = resolve(workspaceRoot, ".runtime-cache/artifacts/runs", runId)
    mkdirSync(runDir, { recursive: true })
    writeFileSync(
      resolve(runDir, "manifest.json"),
      `${JSON.stringify({ runId, gateResults: { status: "failed", checks: [{ id: "security", status: "blocked", reasonCode: "MISSING_TOKEN" }] } }, null, 2)}\n`,
      "utf8"
    )

    const backend = await startStubBackend()
    const harness = await startMcpHarnessAdvanced({
      workspaceRoot,
      env: { UIQ_MCP_API_BASE_URL: backend.baseUrl, UIQ_MCP_TOOL_GROUPS: "all" },
    })

    try {
      const overview = await callToolJson<{
        gateStatus: string
        failedChecks: Array<{ source: string; evidencePath: string | null }>
      }>(harness.client, "uiq_run_and_report", { mode: "overview", runId })
      assert.equal(overview.isError, false)
      assert.equal(overview.data.gateStatus, "failed")
      assert.equal(overview.data.failedChecks[0]?.source, "manifest")
      assert.equal(overview.data.failedChecks[0]?.evidencePath, "security/report.json")

      const gateFailures = await callToolJson<{
        failedChecks: Array<{ source: string; evidencePath: string | null }>
      }>(harness.client, "uiq_run_and_report", { mode: "failures", runId })
      assert.equal(gateFailures.isError, false)
      assert.equal(gateFailures.data.failedChecks[0]?.source, "manifest")
      assert.equal(gateFailures.data.failedChecks[0]?.evidencePath, "security/report.json")
    } finally {
      await harness.close()
      await backend.close()
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  }
)

nodeTest(
  "mcp success paths: canonical check ids fallback to evidence artifacts",
  { timeout: 60_000 },
  async () => {
    const workspaceRoot = createTempWorkspace("uiq-mcp-canonical")
    const runId = `run-canonical-${Date.now()}`
    const runDir = resolve(workspaceRoot, ".runtime-cache/artifacts/runs", runId)
    mkdirSync(resolve(runDir, "reports"), { recursive: true })
    writeFileSync(
      resolve(runDir, "manifest.json"),
      `${JSON.stringify({ runId, gateResults: { status: "failed" } }, null, 2)}\n`,
      "utf8"
    )
    writeFileSync(
      resolve(runDir, "reports/summary.json"),
      `${JSON.stringify(
        {
          status: "failed",
          checks: [
            { id: "a11y.serious_max", status: "failed", actual: 2, expected: 0 },
            { id: "perf.lcp_ms_max", status: "failed", actual: 5100, expected: 4000 },
            { id: "load.failed_requests", status: "failed", actual: 3, expected: 0 },
            { id: "load.p95_ms", status: "failed", actual: 320, expected: 250 },
            { id: "load.rps_min", status: "failed", actual: 4, expected: 10 },
            { id: "explore.under_explored", status: "blocked", actual: 1, expected: 2 },
            { id: "a11y.engine_ready", status: "blocked", actual: "builtin", expected: "axe" },
            { id: "perf.engine_ready", status: "blocked", actual: "builtin", expected: "lhci" },
            { id: "visual.baseline_ready", status: "blocked", actual: false, expected: true },
            { id: "visual.diff_pixels_max", status: "failed", actual: 128, expected: 0 },
          ],
        },
        null,
        2
      )}\n`,
      "utf8"
    )

    const backend = await startStubBackend()
    const harness = await startMcpHarnessAdvanced({
      workspaceRoot,
      env: { UIQ_MCP_API_BASE_URL: backend.baseUrl, UIQ_MCP_TOOL_GROUPS: "all" },
    })

    const expectedById = new Map<string, string>([
      ["a11y.serious_max", "a11y/axe.json"],
      ["perf.lcp_ms_max", "perf/lighthouse.json"],
      ["load.failed_requests", "metrics/load-summary.json"],
      ["load.p95_ms", "metrics/load-summary.json"],
      ["load.rps_min", "metrics/load-summary.json"],
      ["explore.under_explored", "explore/report.json"],
      ["a11y.engine_ready", "a11y/axe.json"],
      ["perf.engine_ready", "perf/lighthouse.json"],
      ["visual.baseline_ready", "visual/report.json"],
      ["visual.diff_pixels_max", "visual/report.json"],
    ])

    try {
      const overview = await callToolJson<{
        failedChecks: Array<{ id: string; evidencePath: string | null }>
      }>(harness.client, "uiq_run_and_report", { mode: "overview", runId })
      assert.equal(overview.isError, false)
      for (const check of overview.data.failedChecks) {
        assert.equal(check.evidencePath, expectedById.get(check.id) ?? null)
      }

      const gateFailures = await callToolJson<{
        failedChecks: Array<{ id: string; evidencePath: string | null }>
      }>(harness.client, "uiq_run_and_report", { mode: "failures", runId })
      assert.equal(gateFailures.isError, false)
      for (const check of gateFailures.data.failedChecks) {
        assert.equal(check.evidencePath, expectedById.get(check.id) ?? null)
      }
    } finally {
      await harness.close()
      await backend.close()
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  }
)

nodeTest(
  "mcp success paths: aggregated workflow + automation action matrix",
  { timeout: 60_000 },
  async () => {
    const backend = await startStubBackend()
    const harness = await startMcpHarnessAdvanced({
      workspaceRoot: fixtureWorkspaceRoot,
      env: {
        UIQ_MCP_API_BASE_URL: backend.baseUrl,
        UIQ_MCP_TOOL_GROUPS: "all",
      },
    })

    try {
      const workflowCalls: Array<Record<string, unknown>> = [
        { entity: "flows", action: "list", limit: 5 },
        { entity: "flows", action: "get", flowId: "flow-1" },
        { entity: "flows", action: "import_latest" },
        {
          entity: "flows",
          action: "create",
          sessionId: "session-1",
          startUrl: "https://example.com",
          sourceEventCount: 2,
          steps: [{ id: "step-1" }],
        },
        { entity: "flows", action: "update", flowId: "flow-1", startUrl: "https://next.example" },
        { entity: "templates", action: "list", limit: 5 },
        { entity: "templates", action: "get", templateId: "tpl-1" },
        { entity: "templates", action: "export", templateId: "tpl-1" },
        { entity: "templates", action: "create", flowId: "flow-1", name: "tpl-name" },
        { entity: "templates", action: "update", templateId: "tpl-1", name: "next-name" },
        { entity: "runs", action: "list", limit: 5 },
        { entity: "runs", action: "get", runId: "run-1" },
        { entity: "runs", action: "create", templateId: "tpl-1", params: { email: "u@example.com" } },
        { entity: "runs", action: "otp", runId: "run-1", otpCode: "123456" },
        { entity: "runs", action: "cancel", runId: "run-1" },
      ]
      for (const args of workflowCalls) {
        const response = await callToolJson<Record<string, unknown>>(
          harness.client,
          "uiq_api_workflow",
          args
        )
        assert.equal(typeof response.data, "object")
      }

      const automationCalls: Array<Record<string, unknown>> = [
        { action: "list_commands" },
        { action: "list_tasks", status: "running", commandId: "run-ui", limit: 5 },
        { action: "get_task", taskId: "task-1" },
        { action: "run", commandId: "run-ui", params: { foo: "bar" } },
        { action: "cancel", taskId: "task-1" },
      ]
      for (const args of automationCalls) {
        const response = await callToolJson<Record<string, unknown>>(
          harness.client,
          "uiq_api_automation",
          args
        )
        assert.equal(typeof response.data, "object")
      }

      const invalidWorkflowAction = await callToolText(harness.client, "uiq_api_workflow", {
        entity: "flows",
        action: "export",
      })
      assert.equal(invalidWorkflowAction.isError, true)
      assert.match(invalidWorkflowAction.text, /"reasonCode": "TOOL_EXECUTION_FAILED"/)
    } finally {
      await harness.close()
      await backend.close()
    }
  }
)

nodeTest(
  "mcp success paths: run tools cover profile/command/stream/full/deep-load/proof flows",
  { timeout: 60_000 },
  async () => {
    const backend = await startStubBackend()
    const harness = await startMcpHarnessAdvanced({
      workspaceRoot: fixtureWorkspaceRoot,
      env: {
        UIQ_MCP_API_BASE_URL: backend.baseUrl,
        UIQ_MCP_TOOL_GROUPS: "all",
        UIQ_MCP_FAKE_UIQ_BIN: fakeUiqBin,
      },
    })

    try {
      const runProfile = await callToolJson<Record<string, unknown>>(harness.client, "uiq_run", {
        mode: "profile",
        profile: "pr",
        target: "web.local",
      })
      assert.equal(runProfile.isError, false)
      assert.equal(runProfile.data.ok, true)

      const runCommand = await callToolJson<Record<string, unknown>>(harness.client, "uiq_run", {
        mode: "command",
        command: "capture",
      })
      assert.equal(runCommand.isError, false)
      assert.equal(runCommand.data.ok, true)

      const runMissingCommand = await callToolJson<Record<string, unknown>>(
        harness.client,
        "uiq_run",
        {
          mode: "command",
        }
      )
      assert.equal(runMissingCommand.isError, true)

      const runStream = await callToolJson<Record<string, unknown>>(
        harness.client,
        "uiq_run_and_report",
        {
          mode: "stream",
          runMode: "command",
          command: "spam-lines",
          timeoutMs: 15_000,
        }
      )
      assert.equal(runStream.isError, false)

      const runFull = await callToolJson<Record<string, unknown>>(
        harness.client,
        "uiq_run_and_report",
        {
          mode: "full",
          runMode: "profile",
          profile: "pr",
          target: "web.local",
        }
      )
      assert.equal(runFull.isError, false)
      assert.equal(runFull.data.runId, "run-a")

      const readManifest = await callToolJson<Record<string, unknown>>(
        harness.client,
        "uiq_read",
        {
          source: "manifest",
          runId: "run-a",
        }
      )
      assert.equal(readManifest.isError, false)

      const qualityKinds = ["a11y", "perf", "visual", "security"]
      for (const kind of qualityKinds) {
        const quality = await callToolJson<Record<string, unknown>>(
          harness.client,
          "uiq_quality_read",
          {
            kind,
            runId: "run-a",
          }
        )
        assert.equal(quality.isError, false)
      }

      const deepLoad = await callToolJson<Record<string, unknown>>(
        harness.client,
        "uiq_run_deep_load_localhost",
        {
          baseUrl: backend.baseUrl,
        }
      )
      assert.equal(deepLoad.isError, false)
      assert.equal(deepLoad.data.ok, true)

      const proofRun = await callToolJson<Record<string, unknown>>(harness.client, "uiq_proof", {
        action: "run",
        campaignId: "campaign-success",
        runIds: ["run-a"],
      })
      assert.equal(proofRun.isError, false)
      assert.equal(proofRun.data.campaignId, "campaign-success")

      const proofRead = await callToolJson<Record<string, unknown>>(harness.client, "uiq_proof", {
        action: "read",
        campaignId: "campaign-success",
      })
      assert.equal(proofRead.isError, false)

      const proofExport = await callToolJson<Record<string, unknown>>(
        harness.client,
        "uiq_proof",
        {
          action: "export",
          campaignId: "campaign-success",
          includeRunReports: true,
        }
      )
      assert.equal(proofExport.isError, false)
      assert.equal(typeof proofExport.data.exportPath, "string")

      const proofDiff = await callToolJson<Record<string, unknown>>(harness.client, "uiq_proof", {
        action: "diff",
        campaignIdA: "campaign-success",
        campaignIdB: "campaign-success",
      })
      assert.equal(proofDiff.isError, false)
    } finally {
      await harness.close()
      await backend.close()
    }
  }
)

nodeTest(
  "mcp success paths: deep audit localhost success covers ux audit + autofix plan",
  { timeout: 60_000 },
  async () => {
    const workspaceRoot = createTempWorkspace("uiq-mcp-deep-audit-success")
    const fakePnpmBinDir = createFakePnpmBin(workspaceRoot)
    const backend = await startStubBackend()
    const harness = await startMcpHarnessAdvanced({
      workspaceRoot,
      env: {
        UIQ_MCP_API_BASE_URL: backend.baseUrl,
        UIQ_MCP_TOOL_GROUPS: "all",
        UIQ_MCP_FAKE_UIQ_BIN: fakeUiqBin,
        PATH: `${fakePnpmBinDir}:${process.env.PATH ?? ""}`,
      },
    })

    try {
      const deepAudit = await callToolJson<Record<string, unknown>>(
        harness.client,
        "uiq_run_deep_audit_autofix_localhost",
        { autofixMode: "plan_only", baseUrl: backend.baseUrl }
      )
      assert.equal(deepAudit.isError, false)
      assert.equal(deepAudit.data.ok, true)
      assert.equal((deepAudit.data.autofix as { mode: string }).mode, "plan_only")
      assert.equal(
        ((deepAudit.data.stepResults as { uxAuditScript: { status: number } }).uxAuditScript.status ??
          -1) >= 0,
        true
      )
      assert.equal(
        typeof (deepAudit.data.runs as { initial: { runId: string } }).initial.runId,
        "string"
      )
      assert.equal(
        typeof (deepAudit.data.runs as { rerun: { runId: string } }).rerun.runId,
        "string"
      )
    } finally {
      await harness.close()
      await backend.close()
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  }
)
