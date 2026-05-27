#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import {
  findTrackedSensitiveContentMatch,
  isTrackedSensitiveExcludedPath,
  listTrackedFiles,
} from "./lib/tracked-sensitive-rules.mjs"

const repoRoot = process.cwd()
const failures = []
let checkedFiles = 0

for (const relativePath of listTrackedFiles()) {
  if (isTrackedSensitiveExcludedPath(relativePath)) {
    continue
  }

  const absolutePath = path.join(repoRoot, relativePath)
  if (!fs.existsSync(absolutePath)) {
    continue
  }

  const buffer = fs.readFileSync(absolutePath)
  if (buffer.includes(0)) {
    continue
  }

  const content = buffer.toString("utf8")
  const match = findTrackedSensitiveContentMatch(content)
  if (!match) {
    checkedFiles += 1
    continue
  }

  failures.push(`${relativePath}:${match.line} matched ${match.ruleId}`)
}

if (failures.length > 0) {
  console.error("[repo-sensitive-surface] failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(`[repo-sensitive-surface] ok (${checkedFiles} tracked text file(s))`)
