#!/usr/bin/env node

import fs from "node:fs"

const surfaces = [
  {
    id: "showcase",
    target: "docs/showcase/minimal-success-case.md",
    requiredSources: ["README.md", "docs/index.md"],
  },
  {
    id: "run-evidence",
    target: "docs/reference/run-evidence-example.md",
    requiredSources: ["README.md", "docs/index.md"],
  },
  {
    id: "release",
    target: "docs/release/README.md",
    requiredSources: ["README.md", "docs/index.md"],
  },
  {
    id: "archive-boundary",
    target: "docs/archive/README.md",
    requiredSources: ["docs/index.md", "docs/README.md"],
  },
  {
    id: "public-surface-policy",
    target: "docs/reference/public-surface-policy.md",
    requiredSources: ["docs/index.md"],
  },
  {
    id: "release-supply-chain-policy",
    target: "docs/reference/release-supply-chain-policy.md",
    requiredSources: ["README.md", "docs/index.md"],
  },
  {
    id: "distribution-status",
    target: "DISTRIBUTION.md",
    requiredSources: ["README.md", "docs/index.md"],
  },
  {
    id: "integration-boundaries",
    target: "INTEGRATIONS.md",
    requiredSources: ["README.md", "docs/index.md"],
  },
  {
    id: "mcp-distribution-contract",
    target: "docs/reference/mcp-distribution-contract.md",
    requiredSources: ["README.md", "docs/index.md", "apps/mcp-server/README.md"],
  },
]

const failures = []

for (const surface of surfaces) {
  if (!fs.existsSync(surface.target)) {
    failures.push(`missing contract target: ${surface.target}`)
    continue
  }
  for (const source of surface.requiredSources) {
    if (!fs.existsSync(source)) {
      failures.push(`missing docs contract source: ${source}`)
      continue
    }
    const content = fs.readFileSync(source, "utf8")
    if (!content.includes(surface.target)) {
      failures.push(`surface route drift: ${source} -> ${surface.target}`)
    }
  }
}

if (failures.length > 0) {
  console.error("[doc-surface-contract] failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(`[doc-surface-contract] ok (${surfaces.length} surface contract(s))`)
