// @ts-nocheck

import assert from "node:assert/strict"
import nodeTest from "node:test"
import { startMcpHarnessAdvanced, startMcpHarnessDefault } from "./helpers/mcp-client.js"

nodeTest("new aggregated toolset is visible in default mode", { timeout: 30_000 }, async () => {
  const harness = await startMcpHarnessDefault()

  try {
    const listed = await harness.client.listTools()
    const names = listed.tools.map((tool) => tool.name)

    assert.ok(
      names.includes("uiq_read"),
      "aggregated tool should be visible in default mode: uiq_read"
    )
    assert.ok(
      names.includes("uiq_run"),
      "aggregated tool should be visible in default mode: uiq_run"
    )
    assert.ok(
      names.includes("uiq_run_and_report"),
      "aggregated tool should be visible in default mode: uiq_run_and_report"
    )
    assert.ok(
      names.includes("uiq_quality_read"),
      "aggregated tool should be visible in default mode: uiq_quality_read"
    )
    assert.ok(
      names.includes("uiq_api_workflow"),
      "aggregated tool should be visible in default mode: uiq_api_workflow"
    )
    assert.ok(
      names.includes("uiq_api_automation"),
      "aggregated tool should be visible in default mode: uiq_api_automation"
    )
    assert.ok(
      names.includes("uiq_proof"),
      "aggregated tool should be visible in default mode: uiq_proof"
    )
    assert.ok(
      names.includes("uiq_model_target_capabilities"),
      "new capability tool should be visible: uiq_model_target_capabilities"
    )
    assert.ok(
      names.includes("uiq_run_deep_load_localhost"),
      "new deep-load tool should be visible: uiq_run_deep_load_localhost"
    )
    assert.ok(
      !names.includes("uiq_api_runs"),
      "legacy api tool should not be exposed: uiq_api_runs"
    )
  } finally {
    await harness.close()
  }
})

nodeTest(
  "advanced tools are exposed when UIQ_MCP_TOOL_GROUPS=all",
  { timeout: 30_000 },
  async () => {
    const harness = await startMcpHarnessAdvanced({
      env: {
        UIQ_MCP_TOOL_GROUPS: "all",
        UIQ_MCP_TOOL_GROUPS: "all",
        UIQ_MCP_PERFECT_MODE: "false",
      },
    })

    try {
      const listed = await harness.client.listTools()
      const names = listed.tools.map((tool) => tool.name)

      assert.ok(names.includes("uiq_catalog"), "catalog tool should be exposed: uiq_catalog")
      assert.ok(names.includes("uiq_read"), "aggregated tool should be exposed: uiq_read")
      assert.ok(names.includes("uiq_run"), "aggregated tool should be exposed: uiq_run")
      assert.ok(
        names.includes("uiq_run_and_report"),
        "aggregated tool should be exposed: uiq_run_and_report"
      )
      assert.ok(
        names.includes("uiq_quality_read"),
        "aggregated tool should be exposed: uiq_quality_read"
      )
      assert.ok(
        names.includes("uiq_api_workflow"),
        "aggregated tool should be exposed: uiq_api_workflow"
      )
      assert.ok(
        names.includes("uiq_api_automation"),
        "aggregated tool should be exposed: uiq_api_automation"
      )
      assert.ok(names.includes("uiq_proof"), "aggregated tool should be exposed: uiq_proof")
      assert.ok(
        names.includes("uiq_run_deep_audit_autofix_localhost"),
        "new deep-audit tool should be exposed"
      )
      assert.ok(
        !names.includes("uiq_api_sessions"),
        "legacy api tool should not be exposed: uiq_api_sessions"
      )
    } finally {
      await harness.close()
    }
  }
)
