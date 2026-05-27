#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { loadGovernanceControlPlane, repoRoot } from "./lib/governance-control-plane.mjs"

const failures = []
const { runtimeRegistry, runtimeLivePolicy } = loadGovernanceControlPlane()
const runtimeRoot = path.join(repoRoot, runtimeRegistry.runtimeRoot)

function sizeBytes(absPath) {
  if (!fs.existsSync(absPath)) return 0
  const stat = fs.lstatSync(absPath)
  if (stat.isSymbolicLink() || stat.isFile()) return stat.size
  let total = 0
  for (const entry of fs.readdirSync(absPath, { withFileTypes: true })) {
    total += sizeBytes(path.join(absPath, entry.name))
  }
  return total
}

const budgets = runtimeLivePolicy.sizeBudgetsMb ?? {}
const checks = [
  { id: "temp", absPath: path.join(runtimeRoot, "temp") },
  { id: "coverage", absPath: path.join(runtimeRoot, "coverage") },
  { id: "container-home", absPath: path.join(runtimeRoot, "container-home") },
  { id: "artifacts_ci", absPath: path.join(runtimeRoot, "artifacts", "ci") },
]

for (const check of checks) {
  const budgetMb = Number(budgets[check.id] ?? 0)
  if (!Number.isFinite(budgetMb) || budgetMb <= 0) {
    failures.push(`missing positive runtime size budget for ${check.id}`)
    continue
  }
  const actualMb = sizeBytes(check.absPath) / (1024 * 1024)
  if (actualMb > budgetMb) {
    failures.push(`${check.id} exceeds budget: ${actualMb.toFixed(1)}MB > ${budgetMb}MB`)
  }
}

if (failures.length > 0) {
  console.error("[runtime-size-budgets] failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log("[runtime-size-budgets] ok")
