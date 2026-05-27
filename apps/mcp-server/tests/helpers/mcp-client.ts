// @ts-nocheck

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

export type McpHarness = {
  client: Client
  close: () => Promise<void>
}

export const CORE_TOOL_NAMES = [
  "uiq_catalog",
  "uiq_server_selfcheck",
  "uiq_run_profile",
  "uiq_run_stream",
  "uiq_run_overview",
  "uiq_read_artifact",
  "uiq_gate_failures",
  "uiq_backend_runtime",
  "uiq_api_sessions",
  "uiq_api_flows",
  "uiq_api_templates",
  "uiq_api_runs",
] as const

export const ADVANCED_TOOL_NAMES = [
  "uiq_register_orchestrate",
  "uiq_register_state",
  "uiq_api_automation_commands",
  "uiq_api_automation_tasks",
  "uiq_api_automation_task",
  "uiq_api_automation_run",
  "uiq_api_automation_cancel",
  "uiq_run_command",
  "uiq_computer_use_run",
  "uiq_list_runs",
  "uiq_read_manifest",
  "uiq_read_repo_doc",
  "uiq_summarize_failures",
  "uiq_a11y_top",
  "uiq_perf_metrics",
  "uiq_visual_status",
  "uiq_security_summary",
  "uiq_compare_perf",
  "uiq_model_target_capabilities",
  "uiq_run_proof_campaign",
  "uiq_read_proof_report",
  "uiq_export_proof_bundle",
  "uiq_diff_proof_campaign",
] as const

const RUNTIME_ROOT_PREFIX = "uiq-mcp-dev-harness-"
const RUNTIME_CLEANUP_RETRY_DELAYS_MS = [40, 80, 160]

function writeJsonFile(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

async function cleanupRuntimeRoot(runtimeRoot: string): Promise<void> {
  const retryBudget = RUNTIME_CLEANUP_RETRY_DELAYS_MS.length + 1
  for (let attempt = 0; attempt < retryBudget; attempt += 1) {
    if (!existsSync(runtimeRoot)) return
    try {
      rmSync(runtimeRoot, { recursive: true, force: true, maxRetries: 2, retryDelay: 25 })
      if (!existsSync(runtimeRoot)) return
    } catch {
      // swallow and retry; fixture cleanup must not fail the test suite
    }
    if (attempt < RUNTIME_CLEANUP_RETRY_DELAYS_MS.length) {
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, RUNTIME_CLEANUP_RETRY_DELAYS_MS[attempt])
      )
    }
  }
}

function seedRuntimeFixtures(workspaceRoot: string): void {
  const runsRoot = resolve(workspaceRoot, ".runtime-cache/artifacts/runs")
  const runARoot = resolve(runsRoot, "run-a")
  const runBRoot = resolve(runsRoot, "run-b")
  const logsRoot = resolve(workspaceRoot, ".runtime-cache/logs")
  mkdirSync(resolve(runARoot, "reports"), { recursive: true })
  mkdirSync(resolve(runARoot, "a11y"), { recursive: true })
  mkdirSync(resolve(runARoot, "perf"), { recursive: true })
  mkdirSync(resolve(runARoot, "visual"), { recursive: true })
  mkdirSync(resolve(runARoot, "security"), { recursive: true })
  mkdirSync(resolve(runARoot, "metrics"), { recursive: true })
  mkdirSync(resolve(runBRoot, "perf"), { recursive: true })
  mkdirSync(resolve(runBRoot, "reports"), { recursive: true })
  mkdirSync(logsRoot, { recursive: true })

  writeJsonFile(resolve(runARoot, "manifest.json"), {
    runId: "run-a",
    gateResults: { status: "failed" },
  })
  writeJsonFile(resolve(runARoot, "reports/summary.json"), {
    status: "failed",
    checks: [
      { id: "a11y", status: "failed", actual: 2, expected: 0, reasonCode: "VIOLATIONS_FOUND" },
      {
        id: "performance",
        status: "blocked",
        actual: 1.2,
        expected: 1.0,
        reasonCode: "BUDGET_EXCEEDED",
      },
    ],
  })
  writeJsonFile(resolve(runARoot, "a11y/axe.json"), {
    counts: { violations: 2 },
    issues: [
      {
        id: "a11y-color-contrast",
        severity: "serious",
        message: "contrast ratio too low",
        selector: "#hero-title",
      },
      {
        id: "a11y-label",
        severity: "moderate",
        message: "form control missing label",
        selector: "#email",
      },
    ],
    scannedAt: "2026-02-19T00:00:00.000Z",
  })
  writeJsonFile(resolve(runARoot, "perf/lighthouse.json"), {
    engine: "lhci",
    preset: "desktop",
    metrics: { fcp: 1.2, lcp: 1.8 },
    measuredAt: "2026-02-19T00:00:00.000Z",
    fallbackUsed: false,
    deterministic: { seed: 1 },
  })
  writeJsonFile(resolve(runARoot, "visual/report.json"), {
    mode: "diff",
    diffPixels: 124,
    totalPixels: 100000,
    diffRatio: 0.00124,
    baselineCreated: false,
    baselinePath: "baseline.png",
    currentPath: "current.png",
    diffPath: "diff.png",
  })
  writeJsonFile(resolve(runARoot, "security/report.json"), {
    status: "warn",
    findings: [{ id: "sec-1" }],
  })
  writeJsonFile(resolve(runARoot, "metrics/security-tickets.json"), [
    { ticketId: "SEC-101" },
    { ticketId: "SEC-102" },
  ])
  writeJsonFile(resolve(runBRoot, "perf/lighthouse.json"), {
    engine: "lhci",
    preset: "desktop",
    metrics: { fcp: 1.0, lcp: 1.6 },
    measuredAt: "2026-02-19T00:00:00.000Z",
    fallbackUsed: false,
    deterministic: { seed: 1 },
  })
  writeJsonFile(resolve(runBRoot, "manifest.json"), {
    runId: "run-b",
    gateResults: { status: "success" },
  })
  writeJsonFile(resolve(runBRoot, "reports/summary.json"), {
    status: "success",
    checks: [],
  })
}

export async function startMcpHarness(options?: {
  workspaceRoot?: string
  env?: Record<string, string | undefined>
}): Promise<McpHarness> {
  const repoRoot = resolve(import.meta.dirname, "../../../../")
  const workspaceRoot =
    options?.workspaceRoot ?? resolve(repoRoot, "apps/mcp-server/tests/fixtures/workspace")
  seedRuntimeFixtures(workspaceRoot)
  const runtimeRootOverride = options?.env?.UIQ_MCP_DEV_RUNTIME_ROOT
  const runtimeRoot = runtimeRootOverride ?? mkdtempSync(resolve(tmpdir(), RUNTIME_ROOT_PREFIX))
  const transport = new StdioClientTransport({
    command: "pnpm",
    args: ["exec", "tsx", "apps/mcp-server/src/server.ts"],
    cwd: repoRoot,
    stderr: "pipe",
    env: {
      ...process.env,
      UIQ_MCP_WORKSPACE_ROOT: workspaceRoot,
      UIQ_MCP_DEV_RUNTIME_ROOT: runtimeRoot,
      ...(options?.env ?? {}),
    },
  })

  const client = new Client({ name: "uiq-mcp-test", version: "0.1.0" }, { capabilities: {} })
  try {
    await client.connect(transport)
  } catch (error) {
    await client.close().catch(() => undefined)
    await transport.close().catch(() => undefined)
    throw error
  }

  return {
    client,
    close: async () => {
      await client.close().catch(() => undefined)
      await transport.close().catch(() => undefined)
      if (!runtimeRootOverride) {
        await cleanupRuntimeRoot(runtimeRoot)
      }
    },
  }
}

export async function startMcpHarnessDefault(options?: {
  workspaceRoot?: string
  env?: Record<string, string | undefined>
}): Promise<McpHarness> {
  return startMcpHarness({
    ...options,
    env: {
      ...(options?.env ?? {}),
      UIQ_MCP_PERFECT_MODE: "false",
      UIQ_MCP_TOOL_GROUPS: "",
    },
  })
}

export async function startMcpHarnessAdvanced(options?: {
  workspaceRoot?: string
  env?: Record<string, string | undefined>
}): Promise<McpHarness> {
  return startMcpHarness({
    ...options,
    env: {
      ...(options?.env ?? {}),
      UIQ_MCP_PERFECT_MODE: "false",
      UIQ_MCP_TOOL_GROUPS: "all",
    },
  })
}

export async function callToolText(
  client: Client,
  name: string,
  args: Record<string, unknown> = {}
): Promise<{ text: string; isError: boolean }> {
  const res = await client.callTool({ name, arguments: args })
  const textPart = res.content.find((c): c is { type: "text"; text: string } => c.type === "text")
  return {
    text: textPart?.text ?? "",
    isError: Boolean(res.isError),
  }
}

export async function callToolJson<T = unknown>(
  client: Client,
  name: string,
  args: Record<string, unknown> = {}
): Promise<{ data: T; isError: boolean }> {
  const { text, isError } = await callToolText(client, name, args)
  const trimmed = text.trim()
  try {
    const parsed = JSON.parse(trimmed) as T
    return {
      data: parsed,
      isError,
    }
  } catch (error) {
    const hint = trimmed.length === 0 ? "<empty response>" : trimmed.slice(0, 1200)
    throw new Error(
      `callToolJson(${name}) expected JSON but received non-JSON text (isError=${isError}): ${hint}`,
      { cause: error }
    )
  }
}
