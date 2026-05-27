#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import {
  fileExists,
  listFilesRecursive,
  loadGovernanceControlPlane,
  readRepoText,
  repoRoot,
} from "./lib/governance-control-plane.mjs"

const failures = []
const { runtimeRegistry, runtimeLivePolicy } = loadGovernanceControlPlane()
const gitignore = readRepoText(".gitignore")
const runtimeGc = fileExists("scripts/runtime-gc.sh") ? readRepoText("scripts/runtime-gc.sh") : ""

const bucketIds = new Set()
const bucketPaths = new Set()
const managedTopLevelTokens = new Set()

for (const bucket of runtimeRegistry.managedBuckets) {
  if (bucketIds.has(bucket.id)) failures.push(`duplicate runtime bucket id: ${bucket.id}`)
  if (bucketPaths.has(bucket.path)) failures.push(`duplicate runtime bucket path: ${bucket.path}`)
  if (!bucket.path.startsWith(`${runtimeRegistry.runtimeRoot}/`)) {
    failures.push(`runtime bucket must stay under ${runtimeRegistry.runtimeRoot}: ${bucket.path}`)
  }
  bucketIds.add(bucket.id)
  bucketPaths.add(bucket.path)
  managedTopLevelTokens.add(bucket.path.replace(`${runtimeRegistry.runtimeRoot}/`, "").split("/")[0])
}

for (const line of runtimeRegistry.requiredGitignoreLines) {
  if (!gitignore.includes(line)) failures.push(`.gitignore missing governance-required line: ${line}`)
}

for (const bucket of runtimeLivePolicy.allowedBuckets ?? []) {
  if (!managedTopLevelTokens.has(bucket)) {
    failures.push(`runtime output registry missing runtime-live-policy bucket: ${bucket}`)
  }
}

for (const topLevel of managedTopLevelTokens) {
  if (!runtimeGc.includes(`/${topLevel}`) && !runtimeGc.includes(`${topLevel}_dir`) && !runtimeGc.includes(`"${topLevel}"`)) {
    failures.push(`runtime cleanup lifecycle missing managed bucket token: ${topLevel}`)
  }
}

for (const noisePath of runtimeRegistry.rootNoisePaths) {
  if (!noisePath.includes("*") && !gitignore.includes(noisePath)) {
    failures.push(`.gitignore missing explicit root-noise token: ${noisePath}`)
  }
}

const ownersToCheck = runtimeRegistry.toolOutputs.filter(
  (item) => !item.owner.includes("*") && !item.owner.includes(" + ")
)
for (const item of ownersToCheck) {
  if (!fileExists(item.owner)) {
    failures.push(`runtime registry owner missing: ${item.owner}`)
  }
}

const legacySurfacePatterns = [
  { label: "artifacts/acceptance", pattern: /(^|[^./-])artifacts\/acceptance\b/gm },
  { label: "artifacts/release", pattern: /(^|[^./-])artifacts\/release\b/gm },
  { label: ".runtime-cache/logs/backend.dev.log", pattern: /\.runtime-cache\/logs\/backend\.dev\.log\b/gm },
  { label: ".runtime-cache/logs/frontend.dev.log", pattern: /\.runtime-cache\/logs\/frontend\.dev\.log\b/gm },
  { label: ".runtime-cache/logs/test-matrix/", pattern: /\.runtime-cache\/logs\/test-matrix\//gm },
  { label: ".runtime-cache/artifacts/ci/governance-score-report.json", pattern: /\.runtime-cache\/artifacts\/ci\/governance-score-report\.json\b/gm },
  { label: ".runtime-cache/artifacts/ci/cold-cache-recovery.json", pattern: /\.runtime-cache\/artifacts\/ci\/cold-cache-recovery\.json\b/gm },
  { label: ".runtime-cache/artifacts/ci/governance-required-flows.json", pattern: /\.runtime-cache\/artifacts\/ci\/governance-required-flows\.json\b/gm },
  { label: ".runtime-cache/test_output", pattern: /\.runtime-cache\/test_output\b/gm },
  { label: ".runtime-cache/driver-smoke", pattern: /\.runtime-cache\/driver-smoke\b/gm },
  { label: ".runtime-cache/tmp", pattern: /\.runtime-cache\/tmp\b/gm },
]

const scanTargets = [
  "scripts",
  "docs",
  ".github",
  "apps",
  "configs",
  "packages",
  "tests",
  "package.json",
  "justfile",
]

for (const target of scanTargets) {
  const absTarget = path.join(repoRoot, target)
  if (!fs.existsSync(absTarget)) continue
  if (fs.statSync(absTarget).isDirectory()) {
    for (const file of listFilesRecursive(target)) {
      const relative = path.relative(repoRoot, file).replaceAll(path.sep, "/")
      if (relative.startsWith("docs/archive/")) continue
      if (
        relative.includes("/node_modules/") ||
        relative.includes("/__pycache__/") ||
        relative.endsWith(".pyc") ||
        relative === "configs/governance/repo-map.json" ||
        relative === "docs/reference/generated/governance/repo-map.md" ||
        relative === "scripts/ci/check-runtime-governance.mjs" ||
        relative === "scripts/ci/governance-score-report.mjs"
      ) {
        continue
      }
      const content = fs.readFileSync(file, "utf8")
      for (const entry of legacySurfacePatterns) {
        entry.pattern.lastIndex = 0
        if (entry.pattern.test(content)) failures.push(`legacy runtime surface in ${relative}: ${entry.label}`)
      }
    }
    continue
  }
  if (
    target === "scripts/ci/check-runtime-governance.mjs" ||
    target === "scripts/ci/governance-score-report.mjs" ||
    target === "configs/governance/repo-map.json" ||
    target === "docs/reference/generated/governance/repo-map.md"
  ) {
    continue
  }
  const content = fs.readFileSync(absTarget, "utf8")
  for (const entry of legacySurfacePatterns) {
    entry.pattern.lastIndex = 0
    if (entry.pattern.test(content)) failures.push(`legacy runtime surface in ${target}: ${entry.label}`)
  }
}

if (failures.length > 0) {
  console.error("[runtime-governance] failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(`[runtime-governance] ok (${runtimeRegistry.managedBuckets.length} managed buckets)`)
