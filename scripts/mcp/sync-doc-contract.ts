import { readFileSync } from "node:fs"
import { resolve } from "node:path"

type DocDrift = {
  docPath: string
  issues: string[]
}

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(".", relativePath), "utf8")
}

function extractToolNames(source: string): string[] {
  const names = new Set<string>()
  for (const match of source.matchAll(/registerTool\(\s*"([^"]+)"/g)) {
    if (match[1]?.startsWith("uiq_")) {
      names.add(match[1])
    }
  }
  for (const match of source.matchAll(/registerApiTool\(\s*mcpServer,\s*"([^"]+)"/g)) {
    if (match[1]?.startsWith("uiq_")) {
      names.add(match[1])
    }
  }
  return Array.from(names).sort()
}

function extractConstArray(source: string, constName: string): string[] {
  const escaped = constName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = source.match(
    new RegExp(`${escaped}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s+as\\s+const;?`, "m")
  )
  if (!match) {
    throw new Error(`${constName} definition not found`)
  }
  return Array.from(match[1].matchAll(/"([^"]+)"/g), (entry) => entry[1])
}

const REQUIRED_QUICKSTART_TOOLS = [
  "uiq_read",
  "uiq_run",
  "uiq_run_and_report",
  "uiq_quality_read",
  "uiq_api_workflow",
  "uiq_api_automation",
  "uiq_proof",
] as const

function extractBacktickToolNames(docText: string): Set<string> {
  return new Set(Array.from(docText.matchAll(/`(uiq_[a-z0-9_]+)`/g), (entry) => entry[1]))
}

function extractRunOverrideKeys(typesSource: string): Set<string> {
  const block = typesSource.match(/export const runOverrideSchema = \{([\s\S]*?)\} as const;?/)
  if (!block) {
    throw new Error("runOverrideSchema definition not found in core/types.ts")
  }
  return new Set(
    Array.from(block[1].matchAll(/^\s*([a-zA-Z][a-zA-Z0-9]*)\s*:/gm), (entry) => entry[1])
  )
}

function extractGeneratedRunOverrideKeys(docText: string): Set<string> {
  const lines = docText.split(/\r?\n/)
  const keys = new Set<string>()
  let inSection = false

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line === "## Run Override Fields") {
      inSection = true
      continue
    }
    if (!inSection) {
      continue
    }
    if (/^##\s+/.test(line)) {
      break
    }
    const match = line.match(/^-\s+`([a-zA-Z][a-zA-Z0-9]*)`$/)
    if (match && !match[1].startsWith("uiq_")) {
      keys.add(match[1])
    }
  }

  return keys
}

function diff(
  expected: Iterable<string>,
  actual: Iterable<string>
): { missing: string[]; extra: string[] } {
  const expectedSet = new Set(expected)
  const actualSet = new Set(actual)
  return {
    missing: Array.from(expectedSet)
      .filter((item) => !actualSet.has(item))
      .sort(),
    extra: Array.from(actualSet)
      .filter((item) => !expectedSet.has(item))
      .sort(),
  }
}

function checkReferenceLinkDoc(docPath: string, docText: string): DocDrift {
  const issues: string[] = []
  if (!docText.includes("docs/reference/generated/mcp-tool-contract.md")) {
    issues.push("must reference docs/reference/generated/mcp-tool-contract.md")
  }
  if (/##\s+Full Tool Catalog \(Current\)/.test(docText)) {
    issues.push("must not inline full tool catalog; link to generated MCP tool contract instead")
  }
  if (/##\s+Run Override Fields/.test(docText) || /Accepted run override fields:/i.test(docText)) {
    issues.push("must not inline run override fields; link to generated MCP tool contract instead")
  }

  return { docPath, issues }
}

function checkQuickstartDoc(docPath: string, docText: string): DocDrift {
  const issues: string[] = []
  if (!docText.includes("docs/reference/generated/mcp-tool-contract.md")) {
    issues.push("quickstart must link to the generated MCP tool contract")
  }
  if (!docText.includes("docs/reference/mcp-distribution-contract.md")) {
    issues.push("quickstart must link to docs/reference/mcp-distribution-contract.md")
  }
  if (/UIQ_MCP_ENABLE_ADVANCED_TOOLS\s*=\s*true/i.test(docText)) {
    issues.push("quickstart must not present deprecated advanced-tools env flags")
  }
  if (!/UIQ_MCP_TOOL_GROUPS\s*=\s*advanced,register,proof,analysis/i.test(docText)) {
    issues.push("quickstart must document optional group opt-in via UIQ_MCP_TOOL_GROUPS")
  }
  if (!docText.includes('"command": "pnpm"') || !docText.includes('"args": ["mcp:start"]')) {
    issues.push("quickstart must document the current local stdio install example")
  }
  if (!docText.includes("@webaudit/mcp-server") || !/not yet published/i.test(docText)) {
    issues.push("quickstart must describe the future package surface as not yet published")
  }
  if (
    !docText.includes("protocol = `stdio`") ||
    !docText.includes("auth = `local-with-optional-backend-token`")
  ) {
    issues.push("quickstart must state protocol/auth boundary")
  }

  return { docPath, issues }
}

function checkDistributionContractDoc(docPath: string, docText: string): DocDrift {
  const issues: string[] = []
  const requiredPhrases = [
    "@webaudit/mcp-server",
    "ghcr.io/xiaojiou176-open/webaudit-mcp-server:0.1.1",
    "protocol",
    "stdio",
    "auth boundary",
    "local-with-optional-backend-token",
    "Current / usable today",
    "Publish-ready but not yet published",
  ]

  for (const phrase of requiredPhrases) {
    if (!docText.includes(phrase)) {
      issues.push(`distribution contract missing phrase: ${phrase}`)
    }
  }

  if (!docText.includes('"command": "pnpm"') || !docText.includes('"args": ["mcp:start"]')) {
    issues.push("distribution contract must include the current local stdio config example")
  }

  if (!docText.includes('"command": "npx"') || !docText.includes('"command": "docker"')) {
    issues.push("distribution contract must include future package and docker examples")
  }

  return { docPath, issues }
}

function checkGeneratedReference(
  docPath: string,
  docText: string,
  navigationTools: string[],
  coreWorkingSet: string[],
  registeredTools: string[],
  runOverrideKeys: Set<string>
): DocDrift {
  const issues: string[] = []
  const documentedTools = extractBacktickToolNames(docText)
  const documentedRunOverrideKeys = extractGeneratedRunOverrideKeys(docText)
  const expectedTools = new Set([...navigationTools, ...coreWorkingSet, ...registeredTools])
  const toolDiff = diff(expectedTools, documentedTools)
  const runOverrideDiff = diff(runOverrideKeys, documentedRunOverrideKeys)

  if (!docText.includes("Generated from MCP runtime source and contract tests")) {
    issues.push("generated reference must declare generated-source boundary")
  }
  if (toolDiff.missing.length > 0) {
    issues.push(`generated reference missing tools: ${toolDiff.missing.join(", ")}`)
  }
  if (runOverrideDiff.missing.length > 0) {
    issues.push(
      `generated reference missing run override keys: ${runOverrideDiff.missing.join(", ")}`
    )
  }

  return { docPath, issues }
}

function main(): void {
  const helperSource = readRepoFile("apps/mcp-server/tests/helpers/mcp-client.ts")
  const typesSource = readRepoFile("apps/mcp-server/src/core/types.ts")
  const runToolsSource = readRepoFile(
    "apps/mcp-server/src/tools/register-tools/register-run-tools.ts"
  )
  const closedLoopToolsSource = readRepoFile(
    "apps/mcp-server/src/tools/register-tools/register-closed-loop-tools.ts"
  )
  const apiToolsSource = readRepoFile(
    "apps/mcp-server/src/tools/register-tools/register-api-tools.ts"
  )

  const coreWorkingSet = extractConstArray(helperSource, "CORE_TOOL_NAMES")
  const navigationTools = [...REQUIRED_QUICKSTART_TOOLS]
  const runOverrideKeys = extractRunOverrideKeys(typesSource)
  const registeredTools = Array.from(
    new Set([
      ...extractToolNames(runToolsSource),
      ...extractToolNames(closedLoopToolsSource),
      ...extractToolNames(apiToolsSource),
    ])
  ).sort()

  const docsToCheck = [
    {
      path: "docs/how-to/mcp-quickstart-1pager.md",
      check: (text: string) => {
        const quickstart = checkQuickstartDoc("docs/how-to/mcp-quickstart-1pager.md", text)
        const reference = checkReferenceLinkDoc("docs/how-to/mcp-quickstart-1pager.md", text)
        return {
          docPath: quickstart.docPath,
          issues: [...quickstart.issues, ...reference.issues],
        }
      },
    },
    {
      path: "docs/reference/generated/mcp-tool-contract.md",
      check: (text: string) =>
        checkGeneratedReference(
          "docs/reference/generated/mcp-tool-contract.md",
          text,
          navigationTools,
          coreWorkingSet,
          registeredTools,
          runOverrideKeys
        ),
    },
    {
      path: "docs/reference/mcp-distribution-contract.md",
      check: (text: string) =>
        checkDistributionContractDoc("docs/reference/mcp-distribution-contract.md", text),
    },
  ]

  const drifts: DocDrift[] = []
  for (const doc of docsToCheck) {
    const text = readRepoFile(doc.path)
    const result = doc.check(text)
    if (result.issues.length > 0) {
      drifts.push(result)
    }
  }

  if (drifts.length === 0) {
    console.log("MCP doc contract OK")
    console.log(
      `navigation tools: ${navigationTools.length}, core tools: ${coreWorkingSet.length}, registered tools: ${registeredTools.length}, run override keys: ${runOverrideKeys.size}`
    )
    return
  }

  console.error("MCP doc contract drift detected:")
  for (const drift of drifts) {
    console.error(`- ${drift.docPath}`)
    for (const issue of drift.issues) {
      console.error(`  - ${issue}`)
    }
  }
  process.exitCode = 1
}

main()
