#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import {
  trackedSensitiveExcludedPaths,
  trackedSensitiveHistoryProbes,
} from "./lib/tracked-sensitive-rules.mjs"

const failures = []

for (const { id, probe } of trackedSensitiveHistoryProbes) {
  try {
    const args = [
      "log",
      "--all",
      "--format=%h %s",
      "-G",
      probe,
      "--",
      ".",
      ...Array.from(trackedSensitiveExcludedPaths).map((target) => `:(exclude)${target}`),
    ]
    const output = execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()

    if (!output) {
      continue
    }

    const firstHit = output.split("\n", 1)[0]
    failures.push(`${id} matched in history (${firstHit})`)
  } catch (error) {
    if (error?.status === 0 || error?.status === 1) {
      continue
    }
    throw error
  }
}

if (failures.length > 0) {
  console.error("[repo-sensitive-history] failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log("[repo-sensitive-history] ok")
