#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import {
  listFilesRecursive,
  loadGovernanceControlPlane,
  repoRoot,
} from "./lib/governance-control-plane.mjs"

const failures = []
const { moduleBoundaries } = loadGovernanceControlPlane()
const rulesByRoot = new Map(moduleBoundaries.responsibilityMap.map((rule) => [rule.root, rule]))
const governedRoots = Array.from(rulesByRoot.keys())
const jsTsRoots = ["apps/web", "apps/mcp-server", "apps/automation-runner", "packages", "tests"]
const pyRoots = ["apps/api", "tests"]
const localExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".py"]

for (const root of jsTsRoots) {
  for (const file of listFilesRecursive(root, [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"])) {
    const content = fs.readFileSync(file, "utf8")
    const relativePath = path.relative(repoRoot, file).replaceAll(path.sep, "/")
    const sourceRoot = relativePath.split("/")[0]
    for (const specifier of extractJsImportSpecifiers(content)) {
      const target = resolveTarget(relativePath, specifier)
      if (!target) continue
      enforceBoundary(sourceRoot, target.root, target.importPath, relativePath)
    }
  }
}

for (const root of pyRoots) {
  for (const file of listFilesRecursive(root, [".py"])) {
    const content = fs.readFileSync(file, "utf8")
    const relativePath = path.relative(repoRoot, file).replaceAll(path.sep, "/")
    const sourceRoot = relativePath.split("/")[0]
    for (const specifier of extractPythonImportSpecifiers(content)) {
      const target = resolvePythonTarget(specifier)
      if (!target) continue
      enforceBoundary(sourceRoot, target.root, target.importPath, relativePath)
    }
  }
}

if (failures.length > 0) {
  console.error("[module-boundaries] failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(`[module-boundaries] ok (${moduleBoundaries.responsibilityMap.length} root contracts)`)

function extractJsImportSpecifiers(source) {
  const matches = new Set()
  for (const pattern of [
    /\bimport\s+[^"'`]*?\sfrom\s+["'`]([^"'`]+)["'`]/g,
    /\bimport\s+["'`]([^"'`]+)["'`]/g,
    /\bexport\s+[^"'`]*?\sfrom\s+["'`]([^"'`]+)["'`]/g,
    /\bimport\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
    /\brequire\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
  ]) {
    for (const match of source.matchAll(pattern)) {
      matches.add(match[1])
    }
  }
  return Array.from(matches)
}

function extractPythonImportSpecifiers(source) {
  const matches = new Set()
  for (const line of source.split(/\r?\n/)) {
    const fromMatch = line.match(/^\s*from\s+([a-zA-Z0-9_./]+)\s+import\s+/)
    if (fromMatch) matches.add(fromMatch[1])
    const importMatch = line.match(/^\s*import\s+([a-zA-Z0-9_.,\s]+)/)
    if (importMatch) {
      for (const item of importMatch[1].split(",")) {
        const trimmed = item.trim().split(/\s+/)[0]
        if (trimmed) matches.add(trimmed)
      }
    }
  }
  return Array.from(matches)
}

function resolveTarget(relativePath, specifier) {
  if (specifier.startsWith("@uiq/")) {
    return { root: "packages", importPath: specifier }
  }
  if (specifier.startsWith(".")) {
    const sourceDir = path.dirname(path.join(repoRoot, relativePath))
    const candidate = resolveLocalImport(sourceDir, specifier)
    if (!candidate) return null
    const repoRelative = path.relative(repoRoot, candidate).replaceAll(path.sep, "/")
    const root = deriveGovernedRoot(repoRelative)
    if (!root && !repoRelative.startsWith("contracts/") && !repoRelative.startsWith("configs/")) return null
    return { root, importPath: repoRelative }
  }
  const normalized = specifier.replaceAll("\\", "/")
  const root = deriveGovernedRoot(normalized)
  if (!root && !normalized.startsWith("contracts/") && !normalized.startsWith("configs/")) return null
  return { root, importPath: normalized }
}

function resolveLocalImport(sourceDir, specifier) {
  const direct = path.resolve(sourceDir, specifier)
  const candidates = [direct, ...localExtensions.map((ext) => `${direct}${ext}`), ...localExtensions.map((ext) => path.join(direct, `index${ext}`))]
  return candidates.find((candidate) => fs.existsSync(candidate))
}

function resolvePythonTarget(specifier) {
  const normalized = specifier.replaceAll("/", ".").replace(/^\.+/, "")
  if (!normalized) return null
  const importPath = normalized.replaceAll(".", "/")
  const root = deriveGovernedRoot(importPath)
  if (!root && !importPath.startsWith("contracts/") && !importPath.startsWith("configs/")) return null
  return { root, importPath }
}

function enforceBoundary(sourceRoot, targetRoot, importPath, relativePath) {
  const rule = rulesByRoot.get(sourceRoot)
  if (!rule) return
  if (targetRoot === sourceRoot) return
  if (targetRoot === "configs" && !moduleBoundaries.contractOnlyRoots.some((prefix) => importPath.startsWith(prefix))) {
    failures.push(`contract-only root violation in ${relativePath}: ${importPath} must stay under ${moduleBoundaries.contractOnlyRoots.join(", ")}`)
    return
  }
  if (rule.mustNotDependOn.includes(targetRoot)) {
    failures.push(`must-not-depend violation in ${relativePath}: ${sourceRoot} -> ${targetRoot} via ${importPath}`)
    return
  }
  const allowedRoots = new Set([...rule.mayDependOn, sourceRoot])
  if (!allowedRoots.has(targetRoot)) {
    failures.push(`may-depend violation in ${relativePath}: ${sourceRoot} cannot import ${targetRoot} via ${importPath}`)
  }
}

function deriveGovernedRoot(repoRelativePath) {
  const normalized = repoRelativePath.replaceAll("\\", "/")
  if (normalized.startsWith("contracts/")) return "contracts"
  if (normalized.startsWith("configs/")) return "configs"
  if (normalized.startsWith("packages/")) return "packages"
  if (normalized.startsWith("tests/")) return "tests"
  for (const root of governedRoots) {
    if (normalized === root || normalized.startsWith(`${root}/`)) return root
  }
  return null
}
