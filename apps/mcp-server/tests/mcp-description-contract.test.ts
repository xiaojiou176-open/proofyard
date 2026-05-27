// @ts-nocheck

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import nodeTest from "node:test"
import { startMcpHarnessAdvanced } from "./helpers/mcp-client.js"

const NAV_CONTRACT_TOOLS = ["uiq_read", "uiq_run", "uiq_run_and_report"] as const

const NON_EMPTY_DESCRIPTION_TOOLS = [
  "uiq_catalog",
  "uiq_quality_read",
  "uiq_api_workflow",
  "uiq_api_automation",
  "uiq_proof",
] as const

const REQUIRED_NEW_DOC_TOOLS = [
  "uiq_read",
  "uiq_run",
  "uiq_run_and_report",
  "uiq_quality_read",
  "uiq_api_workflow",
  "uiq_api_automation",
  "uiq_proof",
] as const

const NAVIGATION_FIELDS = [
  "Goal:",
  "Use When:",
  "Required Inputs:",
  "Call Order:",
  "Success Output:",
  "If Failed:",
  "Do Not:",
] as const

function resolveRepoRootFromTests(): string {
  return resolve(import.meta.dirname, "../../..")
}

nodeTest(
  "mcp core description contract: navigation fields are present",
  { timeout: 30_000 },
  async () => {
    const harness = await startMcpHarnessAdvanced({
      env: { UIQ_MCP_TOOL_GROUPS: "all" },
    })

    try {
      const listed = await harness.client.listTools()
      const byName = new Map(listed.tools.map((tool) => [tool.name, tool]))

      for (const toolName of NAV_CONTRACT_TOOLS) {
        const tool = byName.get(toolName)
        assert.ok(tool, `missing tool in listTools: ${toolName}`)
        assert.equal(typeof tool.description, "string", `description must be string: ${toolName}`)
        const description = tool.description ?? ""
        for (const field of NAVIGATION_FIELDS) {
          assert.ok(description.includes(field), `${toolName} description missing field: ${field}`)
        }
      }

      for (const toolName of NON_EMPTY_DESCRIPTION_TOOLS) {
        const tool = byName.get(toolName)
        assert.ok(tool, `missing tool in listTools: ${toolName}`)
        assert.equal(typeof tool.description, "string", `description must be string: ${toolName}`)
        assert.ok(
          (tool.description ?? "").trim().length > 0,
          `description must not be empty: ${toolName}`
        )
      }
    } finally {
      await harness.close()
    }
  }
)

nodeTest("quickstart and distribution docs stay aligned with current MCP contract", async () => {
  const repoRoot = resolveRepoRootFromTests()
  const quickstart = readFileSync(resolve(repoRoot, "docs/how-to/mcp-quickstart-1pager.md"), "utf8")
  const contract = readFileSync(
    resolve(repoRoot, "docs/reference/mcp-distribution-contract.md"),
    "utf8"
  )
  const readme = readFileSync(resolve(repoRoot, "apps/mcp-server/README.md"), "utf8")

  assert.match(readme, /docs\/reference\/mcp-distribution-contract\.md/)
  assert.match(readme, /Current \/ usable today/)
  assert.match(readme, /Publish-ready but not yet published/)

  const harness = await startMcpHarnessAdvanced({
    env: { UIQ_MCP_TOOL_GROUPS: "all" },
  })
  const registeredSet = new Set((await harness.client.listTools()).tools.map((tool) => tool.name))
  await harness.close()

  for (const toolName of REQUIRED_NEW_DOC_TOOLS) {
    assert.ok(registeredSet.has(toolName), `runtime missing required tool: ${toolName}`)
  }

  for (const text of [quickstart, contract]) {
    assert.match(text, /mcpServers/)
    assert.match(text, /stdio/i)
    assert.match(text, /UIQ_MCP_API_BASE_URL/)
    assert.match(text, /UIQ_MCP_AUTOMATION_TOKEN/)
    assert.match(text, /@webaudit\/mcp-server/)
    assert.match(text, /ghcr\.io\/xiaojiou176-open\/webaudit-mcp-server:0\.1\.1/)
    assert.match(text, /not yet published/i)
  }

  assert.match(contract, /local-with-optional-backend-token/)
})
