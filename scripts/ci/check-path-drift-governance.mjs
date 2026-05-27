#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { loadGovernanceControlPlane, repoRoot } from "./lib/governance-control-plane.mjs"

const failures = []
const { repoMap } = loadGovernanceControlPlane()

const includeRoots = repoMap.semanticScan?.include ?? []
const excludeRoots = new Set(repoMap.semanticScan?.exclude ?? [])

for (const root of includeRoots) {
  const absolute = path.join(repoRoot, root)
  if (!fs.existsSync(absolute)) continue
  walk(absolute)
}

if (failures.length > 0) {
  console.error("[path-drift-governance] failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log("[path-drift-governance] ok")

function walk(absolutePath) {
  const relativePath = path.relative(repoRoot, absolutePath).replaceAll(path.sep, "/")
  if (shouldSkip(relativePath)) return
  if (
    relativePath === "configs/governance/repo-map.json" ||
    relativePath === "scripts/ci/check-path-drift-governance.mjs" ||
    relativePath === "scripts/ci/check-runtime-governance.mjs" ||
    relativePath === "scripts/ci/check-upstream-governance.mjs" ||
    relativePath === "scripts/ci/governance-score-report.mjs" ||
    relativePath === "docs/reference/generated/governance/repo-map.md"
  ) {
    return
  }
  if (
    relativePath.includes("/node_modules/") ||
    relativePath.includes("/__pycache__/") ||
    relativePath.endsWith(".pyc")
  ) {
    return
  }
  const stat = fs.statSync(absolutePath)
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(absolutePath)) {
      walk(path.join(absolutePath, entry))
    }
    return
  }

  const content = readText(absolutePath)
  if (content === null) return

  for (const token of repoMap.forbiddenRuntimeTokens ?? []) {
    if (content.includes(token)) {
      failures.push(`${relativePath}: forbidden runtime token ${token}`)
    }
  }

  for (const token of repoMap.forbiddenFloatingToolCommands ?? []) {
    if (content.includes(token)) {
      failures.push(`${relativePath}: forbidden floating tool command ${token}`)
    }
  }

  for (const alias of repoMap.legacyRootAliases ?? []) {
    const pattern = new RegExp(`(^|[\\s\`"'(=:])${escapeRegex(alias.legacy)}/`, "m")
    if (pattern.test(content)) {
      failures.push(`${relativePath}: legacy root alias ${alias.legacy}/ must be replaced with ${alias.canonical}/`)
    }
  }
}

function shouldSkip(relativePath) {
  if (!relativePath) return false
  return Array.from(excludeRoots).some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`))
}

function readText(absolutePath) {
  try {
    return fs.readFileSync(absolutePath, "utf8")
  } catch {
    return null
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
