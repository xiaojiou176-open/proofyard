import assert from "node:assert/strict"
import { resolve } from "node:path"
import nodeTest from "node:test"
import { startMcpHarnessAdvanced, startMcpHarnessDefault } from "./helpers/mcp-client.js"

const workspaceRoot = resolve(import.meta.dirname, "fixtures/workspace")

const NEW_TOOL_NAMES = [
  "uiq_api_automation",
  "uiq_api_workflow",
  "uiq_catalog",
  "uiq_compare_perf",
  "uiq_evidence_runs",
  "uiq_list_runs",
  "uiq_model_target_capabilities",
  "uiq_proof",
  "uiq_quality_read",
  "uiq_read",
  "uiq_run",
  "uiq_run_and_report",
  "uiq_run_deep_audit_autofix_localhost",
  "uiq_run_deep_load_localhost",
  "uiq_server_selfcheck",
] as const

nodeTest("mcp default mode listTools: exact new tool catalog", { timeout: 30_000 }, async () => {
  const harness = await startMcpHarnessDefault({
    workspaceRoot,
    env: { UIQ_MCP_TOOL_GROUPS: "" },
  })
  try {
    const listed = await harness.client.listTools()
    const names = listed.tools.map((t) => t.name).sort()
    const expected = [...NEW_TOOL_NAMES].sort()
    assert.equal(names.length, expected.length)
    assert.deepEqual(names, expected)
  } finally {
    await harness.close()
  }
})

nodeTest("mcp advanced mode listTools: exact new tool catalog", { timeout: 30_000 }, async () => {
  const harness = await startMcpHarnessAdvanced({
    workspaceRoot,
    env: { UIQ_MCP_TOOL_GROUPS: "all" },
  })
  try {
    const listed = await harness.client.listTools()
    const names = listed.tools.map((t) => t.name).sort()
    const expected = [...NEW_TOOL_NAMES].sort()
    assert.equal(names.length, expected.length)
    assert.deepEqual(names, expected)
  } finally {
    await harness.close()
  }
})

nodeTest(
  "mcp default and advanced modes expose the same new toolset",
  { timeout: 90_000 },
  async () => {
    const defaultHarness = await startMcpHarnessDefault({
      workspaceRoot,
      env: { UIQ_MCP_TOOL_GROUPS: "" },
    })
    let defaultNames: string[] = []
    try {
      defaultNames = (await defaultHarness.client.listTools()).tools.map((tool) => tool.name).sort()
    } finally {
      await defaultHarness.close()
    }

    const advancedHarness = await startMcpHarnessAdvanced({
      workspaceRoot,
      env: { UIQ_MCP_TOOL_GROUPS: "all" },
    })
    try {
      const advancedNames = (await advancedHarness.client.listTools()).tools
        .map((tool) => tool.name)
        .sort()
      assert.deepEqual(defaultNames, advancedNames)
    } finally {
      await advancedHarness.close()
    }
  }
)

nodeTest("mcp resources expose both latest manifest and summary", { timeout: 30_000 }, async () => {
  const harness = await startMcpHarnessDefault({
    workspaceRoot,
    env: { UIQ_MCP_TOOL_GROUPS: "" },
  })
  try {
    const listed = await harness.client.listResources()
    const uris = listed.resources.map((r) => r.uri).sort()
    assert.deepEqual(uris, ["uiq://runs/latest/manifest", "uiq://runs/latest/summary"])

    const manifest = await harness.client.readResource({
      uri: "uiq://runs/latest/manifest",
    })
    const summary = await harness.client.readResource({
      uri: "uiq://runs/latest/summary",
    })

    const manifestText =
      manifest.contents.find((c): c is { uri: string; text: string } => "text" in c)?.text ?? ""
    const summaryText =
      summary.contents.find((c): c is { uri: string; text: string } => "text" in c)?.text ?? ""
    assert.match(manifestText, /"runId": "run-b"/)
    assert.match(summaryText, /"status": "success"/)
  } finally {
    await harness.close()
  }
})
