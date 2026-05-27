#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

const repoRoot = process.cwd()
const failures = []

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
  })
  if (result.status !== 0) {
    failures.push(
      [
        `${command} ${args.join(" ")}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n")
    )
  }
}

function assertDocReferences(relativePath, requiredTokens) {
  const content = readFileSync(path.join(repoRoot, relativePath), "utf8")
  for (const token of requiredTokens) {
    if (!content.includes(token)) {
      failures.push(`${relativePath} missing required docs-governance token: ${token}`)
    }
  }
}

run("node", ["scripts/ci/render-docs-governance.mjs", "--check"])
run("pnpm", ["env:sync:check"])
run("pnpm", ["mcp:doc:contract"])

assertDocReferences("docs/quality-gates.md", [
  "docs/reference/generated/profile-thresholds.md",
  "docs/reference/generated/ci-governance-topology.md",
])
assertDocReferences("docs/README.md", [
  "docs/reference/generated/ci-governance-topology.md",
])
assertDocReferences("docs/how-to/mcp-quickstart-1pager.md", [
  "docs/reference/generated/mcp-tool-contract.md",
])
assertDocReferences("docs/index.md", [
  "docs/reference/generated/governance/dependency-baselines.md",
  "docs/reference/generated/governance/repo-map.md",
  "docs/reference/generated/governance/root-allowlist.md",
  "docs/reference/generated/governance/runtime-live-policy.md",
  "docs/reference/generated/governance/upstream-registry.md",
  "docs/reference/generated/governance/upstream-customizations.md",
])
assertDocReferences("docs/reference/public-surface-sanitization-policy.md", [
  "docs/reference/generated/governance/log-event-schema.md",
  "docs/reference/generated/governance/runtime-output-registry.md",
])
assertDocReferences("docs/reference/dependencies-and-third-party.md", [
  "docs/reference/generated/governance/dependency-baselines.md",
])
assertDocReferences("docs/reference/upstream-customizations.md", [
  "configs/governance/upstream-customizations.json",
])
assertDocReferences("docs/reference/dependencies-and-third-party.md", [
  "configs/governance/upstream-registry.json",
  "docs/reference/generated/governance/upstream-compat-matrix.md",
])

if (failures.length > 0) {
  console.error("docs render state checks failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log("[docs-render-state] ok")
