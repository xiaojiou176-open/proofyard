#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { loadGovernanceControlPlane, repoRoot } from "./lib/governance-control-plane.mjs"

const failures = []
const { repoMap, rootAllowlist } = loadGovernanceControlPlane()

const scanRoots = ["AGENTS.md", "CLAUDE.md", "docs", "scripts", ".github", "package.json", "justfile"]

for (const root of scanRoots) {
  const abs = path.join(repoRoot, root)
  if (!fs.existsSync(abs)) continue
  walk(abs)
}

if (failures.length > 0) {
  console.error("[root-semantic-cleanliness] failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log("[root-semantic-cleanliness] ok")

function walk(absPath) {
  const relativePath = path.relative(repoRoot, absPath).replaceAll(path.sep, "/")
  if (
    !relativePath ||
    relativePath.startsWith("docs/archive/") ||
    relativePath.startsWith("docs/history/") ||
    relativePath.startsWith("docs/quality/") ||
    relativePath.includes("/node_modules/") ||
    relativePath.includes("/__pycache__/") ||
    relativePath.endsWith(".pyc") ||
    relativePath === "configs/governance/repo-map.json" ||
    relativePath === "docs/reference/generated/governance/repo-map.md" ||
    relativePath === "scripts/ci/check-root-semantic-cleanliness.mjs" ||
    relativePath === "scripts/ci/check-log-governance.mjs" ||
    relativePath === "scripts/ci/check-runtime-governance.mjs" ||
    relativePath === "scripts/ci/check-upstream-governance.mjs" ||
    relativePath === "scripts/ci/governance-score-report.mjs"
  ) {
    return
  }

  const stat = fs.statSync(absPath)
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(absPath)) {
      walk(path.join(absPath, entry))
    }
    return
  }

  let content = ""
  try {
    content = fs.readFileSync(absPath, "utf8")
  } catch {
    return
  }

  for (const alias of repoMap.legacyRootAliases ?? []) {
    const pattern = new RegExp(`(^|[\\s\`"'(=:])${escapeRegex(alias.legacy)}/`, "m")
    if (!pattern.test(content)) continue
    failures.push(`${relativePath}: forbidden root-semantic reference ${alias.legacy}/ found; use ${alias.canonical}/`)
  }

  for (const token of repoMap.forbiddenRuntimeTokens ?? []) {
    if (content.includes(token)) {
      failures.push(`${relativePath}: forbidden runtime token ${token} found in a human-facing surface`)
    }
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
