import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

test("MCP README links the publish-facing distribution contract", () => {
  const repoRoot = resolve(import.meta.dirname, "../../..")
  const readme = readFileSync(resolve(repoRoot, "apps/mcp-server/README.md"), "utf8")

  assert.match(
    readme,
    /\[docs\/reference\/mcp-distribution-contract\.md\]\(\.\.\/\.\.\/docs\/reference\/mcp-distribution-contract\.md\)/,
    "apps/mcp-server/README.md must link the MCP distribution contract"
  )
  assert.match(readme, /Current \/ usable today/)
  assert.match(readme, /Publish-ready but not yet published/)
  assert.match(readme, /@proofyard\/mcp-server/)
  assert.match(readme, /ghcr\.io\/xiaojiou176-open\/proofyard-mcp-server:0\.1\.1/)
})

test("quickstart and distribution contract stay aligned on protocol, auth, and install examples", () => {
  const repoRoot = resolve(import.meta.dirname, "../../..")
  const quickstart = readFileSync(resolve(repoRoot, "docs/how-to/mcp-quickstart-1pager.md"), "utf8")
  const contract = readFileSync(
    resolve(repoRoot, "docs/reference/mcp-distribution-contract.md"),
    "utf8"
  )

  for (const text of [quickstart, contract]) {
    assert.match(text, /mcpServers/)
    assert.match(text, /stdio/i)
    assert.match(text, /UIQ_MCP_API_BASE_URL/)
    assert.match(text, /UIQ_MCP_AUTOMATION_TOKEN/)
    assert.match(text, /@proofyard\/mcp-server/)
    assert.match(text, /ghcr\.io\/xiaojiou176-open\/proofyard-mcp-server:0\.1\.1/)
    assert.match(text, /not yet published/i)
  }

  assert.match(contract, /local-with-optional-backend-token/)
})
