import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { SUPPORTED_COMMANDS } from "../../../packages/orchestrator/index.js"

function extractQuotedItems(section: string): string[] {
  return Array.from(section.matchAll(/"([^"]+)"/g), (match) => match[1])
}

function extractCatalogCommands(fileText: string): string[] {
  const match = fileText.match(/const commands = \[([\s\S]*?)\]\s*$/m)
  if (!match) throw new Error("commands array not found in MCP catalog source")
  return extractQuotedItems(match[1])
}

function extractRegisteredToolNames(fileText: string): string[] {
  return Array.from(fileText.matchAll(/registerTool\(\s*"([^"]+)"/g), (match) => match[1])
}

test("uiq_catalog command list stays in sync with orchestrator CLI", () => {
  const repoRoot = resolve(import.meta.dirname, "../../../")
  const catalogSource = readFileSync(
    resolve(repoRoot, "apps/mcp-server/src/tools/register-tools/register-run-tools.ts"),
    "utf8"
  )

  const cliCommands = [...SUPPORTED_COMMANDS]
  const catalogCommands = extractCatalogCommands(catalogSource)
  const registeredTools = extractRegisteredToolNames(catalogSource)

  assert.deepEqual(catalogCommands, cliCommands)
  assert.ok(catalogCommands.includes("computer-use"))
  assert.ok(registeredTools.includes("uiq_run"))
  assert.ok(registeredTools.includes("uiq_run_and_report"))
})
