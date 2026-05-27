#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"

export const repoRoot = process.cwd()
const DEFAULT_GOVERNANCE_RUN_ID = `governance-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`
export const governanceRunId = (process.env.UIQ_GOVERNANCE_RUN_ID || DEFAULT_GOVERNANCE_RUN_ID).trim()

export const GOVERNANCE_PATHS = {
  repoMap: "configs/governance/repo-map.json",
  rootAllowlist: "configs/governance/root-allowlist.json",
  runtimeRegistry: "configs/governance/runtime-output-registry.json",
  runtimeLivePolicy: "configs/governance/runtime-live-policy.json",
  logSchema: "configs/governance/log-event.schema.json",
  moduleBoundaries: "configs/governance/module-boundaries.json",
  dependencyBaselines: "configs/governance/dependency-baselines.json",
  upstreamRegistry: "configs/governance/upstream-registry.json",
  upstreamCompatMatrix: "configs/governance/upstream-compat-matrix.json",
  upstreamCustomizations: "configs/governance/upstream-customizations.json",
}

export function readRepoText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8")
}

export function readRepoJson(relativePath) {
  return JSON.parse(readRepoText(relativePath))
}

export function currentGovernanceArtifactRoot() {
  return `.runtime-cache/artifacts/ci/${governanceRunId}`
}

export function currentGovernanceArtifactPath(...segments) {
  return path.posix.join(currentGovernanceArtifactRoot(), ...segments)
}

export function ensureParentDir(relativePath) {
  fs.mkdirSync(path.dirname(path.join(repoRoot, relativePath)), { recursive: true })
}

export function writeRepoText(relativePath, content) {
  ensureParentDir(relativePath)
  fs.writeFileSync(path.join(repoRoot, relativePath), content, "utf8")
}

export function loadGovernanceControlPlane() {
  return {
    repoMap: readRepoJson(GOVERNANCE_PATHS.repoMap),
    rootAllowlist: readRepoJson(GOVERNANCE_PATHS.rootAllowlist),
    runtimeRegistry: readRepoJson(GOVERNANCE_PATHS.runtimeRegistry),
    runtimeLivePolicy: readRepoJson(GOVERNANCE_PATHS.runtimeLivePolicy),
    logSchema: readRepoJson(GOVERNANCE_PATHS.logSchema),
    moduleBoundaries: readRepoJson(GOVERNANCE_PATHS.moduleBoundaries),
    dependencyBaselines: readRepoJson(GOVERNANCE_PATHS.dependencyBaselines),
    upstreamRegistry: readRepoJson(GOVERNANCE_PATHS.upstreamRegistry),
    upstreamCompatMatrix: readRepoJson(GOVERNANCE_PATHS.upstreamCompatMatrix),
    upstreamCustomizations: readRepoJson(GOVERNANCE_PATHS.upstreamCustomizations),
  }
}

export function listRootEntries() {
  return fs.readdirSync(repoRoot).sort()
}

export function listImmediateDirectoryEntries(relativeDir) {
  const absRoot = path.join(repoRoot, relativeDir)
  if (!fs.existsSync(absRoot) || !fs.statSync(absRoot).isDirectory()) return []
  return fs
    .readdirSync(absRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

export function fileExists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath))
}

export function listFilesRecursive(relativeDir, extensions = []) {
  const absRoot = path.join(repoRoot, relativeDir)
  if (!fs.existsSync(absRoot)) return []
  const queue = [absRoot]
  const files = []
  while (queue.length > 0) {
    const current = queue.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (["node_modules", ".git", ".runtime-cache", "dist", "build", "coverage"].includes(entry.name)) continue
        queue.push(full)
        continue
      }
      if (extensions.length === 0 || extensions.some((ext) => entry.name.endsWith(ext))) {
        files.push(full)
      }
    }
  }
  return files
}

export function renderTable(headers, rows) {
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
  ]
  for (const row of rows) {
    lines.push(`| ${row.join(" | ")} |`)
  }
  return lines.join("\n")
}

export function renderList(items) {
  return items.map((item) => `- \`${item}\``).join("\n")
}

export function matchesSimpleGlob(value, pattern) {
  if (!pattern.includes("*")) return value === pattern
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
  return new RegExp(`^${escaped}$`).test(value)
}
