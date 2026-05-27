#!/usr/bin/env node

import fs from "node:fs"

const requiredEntrypoints = [
  { path: "docs/localized/zh-CN/README.md", sources: ["README.md", "docs/index.md"] },
  { path: "docs/showcase/minimal-success-case.md", sources: ["README.md", "docs/index.md"] },
  { path: "docs/reference/run-evidence-example.md", sources: ["README.md", "docs/index.md"] },
  { path: "docs/reference/mcp-distribution-contract.md", sources: ["README.md", "docs/index.md"] },
  { path: "docs/archive/README.md", sources: ["docs/index.md", "docs/README.md"] },
  { path: "DISTRIBUTION.md", sources: ["README.md", "docs/index.md"] },
  { path: "INTEGRATIONS.md", sources: ["README.md", "docs/index.md"] },
]

const failures = []

for (const entry of requiredEntrypoints) {
  if (!fs.existsSync(entry.path)) {
    failures.push(`missing required entrypoint target: ${entry.path}`)
    continue
  }
  for (const source of entry.sources) {
    if (!fs.existsSync(source)) {
      failures.push(`missing required source surface: ${source}`)
      continue
    }
    const content = fs.readFileSync(source, "utf8")
    if (!content.includes(entry.path)) {
      failures.push(`entrypoint missing route: ${source} -> ${entry.path}`)
    }
  }
}

if (failures.length > 0) {
  console.error("[doc-entrypoints] failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(`[doc-entrypoints] ok (${requiredEntrypoints.length} routed target(s))`)
