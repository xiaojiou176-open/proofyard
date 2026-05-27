#!/usr/bin/env node

import { execFileSync } from "node:child_process"

const failures = []

const forbiddenHits = safeRg(["-n", "packages/orchestrator/src/", "apps/mcp-server/src"])

for (const hit of forbiddenHits) {
  failures.push(`run-tool boundary drift: forbidden deep orchestrator import in ${hit}`)
}

const allowedBarrelHits = safeRg([
  "-n",
  "packages/orchestrator/index\\.js",
  "apps/mcp-server/src/tools/register-tools",
])

if (allowedBarrelHits.length === 0) {
  failures.push("run-tool boundary drift: no package-level orchestrator barrel import found in register-tools")
}

if (failures.length > 0) {
  console.error("[run-tool-boundary] failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(`[run-tool-boundary] ok (${allowedBarrelHits.length} barrel import hit(s))`)

function safeRg(args) {
  try {
    return execFileSync("rg", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .trim()
      .split("\n")
      .filter(Boolean)
  } catch (error) {
    if (error?.status === 1) {
      return []
    }
    throw error
  }
}
