// @ts-nocheck

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import nodeTest from "node:test"
import yaml from "yaml"
import { startMcpHarnessDefault } from "./helpers/mcp-client.js"

function extractRunOverrideKeys(coreSource: string): string[] {
  const block = coreSource.match(/export const runOverrideSchema = \{([\s\S]*?)\} as const;?/)
  assert.ok(block, "runOverrideSchema definition must exist")
  return Array.from(
    block[1].matchAll(/^\s*([a-zA-Z][a-zA-Z0-9]*)\s*:/gm),
    (match) => match[1]
  ).sort()
}

nodeTest(
  "uiq_run and uiq_run_and_report inputSchema stays aligned with runOverrideSchema keys",
  { timeout: 30_000 },
  async () => {
    const typesSource = readFileSync(resolve(".", "apps/mcp-server/src/core/types.ts"), "utf8")
    const schemaKeys = extractRunOverrideKeys(typesSource)
    const harness = await startMcpHarnessDefault()

    try {
      const listed = await harness.client.listTools()
      const byName = new Map(listed.tools.map((tool) => [tool.name, tool]))
      const toolNames = ["uiq_run", "uiq_run_and_report"] as const
      const forbiddenLegacyFields = ["browser", "platform", "device", "headless", "timeout", "env"]

      for (const toolName of toolNames) {
        const tool = byName.get(toolName)
        assert.ok(tool, `missing tool in listTools: ${toolName}`)
        const properties = Object.keys(tool.inputSchema?.properties ?? {}).sort()
        const listedKeys = schemaKeys.filter((key) => properties.includes(key)).sort()
        assert.deepEqual(
          listedKeys,
          schemaKeys,
          `${toolName} inputSchema runOverrideSchema keys drift`
        )

        for (const legacyField of forbiddenLegacyFields) {
          assert.ok(
            !properties.includes(legacyField),
            `${toolName} inputSchema contains unsupported legacy field: ${legacyField}`
          )
        }
      }
    } finally {
      await harness.close()
    }
  }
)

nodeTest("package metadata, runtime identity, and skill manifest stay aligned", () => {
  const repoRoot = resolve(import.meta.dirname, "../../..")
  const packageJson = JSON.parse(
    readFileSync(resolve(repoRoot, "apps/mcp-server/package.json"), "utf8")
  )
  const coreSource = readFileSync(resolve(repoRoot, "apps/mcp-server/src/core.ts"), "utf8")
  const skillManifest = yaml.parse(
    readFileSync(resolve(repoRoot, "skills/webaudit-mcp/manifest.yaml"), "utf8")
  )

  assert.equal(packageJson.name, "@webaudit/mcp-server")
  assert.equal(packageJson.version, "0.1.1")
  assert.equal(packageJson.license, "MIT")
  assert.equal(packageJson.publishConfig?.access, "public")
  assert.equal(packageJson.bin?.["webaudit-mcp"], "./dist/server.cjs")
  assert.ok(Array.isArray(packageJson.files) && packageJson.files.includes("dist"))
  assert.match(coreSource, /name:\s*"@webaudit\/mcp-server"/)
  assert.match(coreSource, /version:\s*"0\.1\.1"/)
  assert.equal(skillManifest.name, "webaudit-mcp")
  assert.equal(skillManifest.version, packageJson.version)
  assert.equal(skillManifest.protocol, "stdio")
  assert.equal(skillManifest.transport, "stdio")
  assert.equal(skillManifest.auth, "local-with-optional-backend-token")
})
