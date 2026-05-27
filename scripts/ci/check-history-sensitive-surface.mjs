#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { canonicalPublicFiles } from "./lib/public-surface-targets.mjs"

const probes = [
  "AKIA[0-9A-Z]{16}",
  "ghp_[A-Za-z0-9]{20,}",
  "(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}",
  ["BEGIN", "PRIVATE", "KEY"].join(" "),
  "Bearer[[:space:]][A-Za-z0-9._-]+",
  "Set-Cookie",
  "X-CSRF-Token",
  "session_id=",
  "csrf_cookie=",
  "\"password\"[[:space:]]*:",
  "\"otp\"[[:space:]]*:",
]

const includedPaths = canonicalPublicFiles

const excludedPaths = [
  "scripts/ci/check-history-sensitive-surface.mjs",
  "scripts/ci/check-public-redaction.mjs",
  "scripts/ci/check-public-collaboration-english.mjs",
  "scripts/ci/check-tracked-heavy-artifacts.mjs",
  "docs/reference/public-surface-policy.md",
  "docs/reference/public-surface-sanitization-policy.md",
]

const failures = []

for (const probe of probes) {
  try {
    const args = [
      "log",
      "--all",
      "--format=%h %s",
      "-G",
      probe,
      "--",
      ...includedPaths,
      ...excludedPaths.map((target) => `:(exclude)${target}`),
    ]
    const output = execFileSync(
      "git",
      args,
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim()
    if (output) {
      failures.push(`history-sensitive pattern matched: ${probe}`)
    }
  } catch (error) {
    if (error?.status === 0 || error?.status === 1) {
      continue
    }
    throw error
  }
}

if (failures.length > 0) {
  console.error("[history-sensitive-surface] failed:")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log("[history-sensitive-surface] ok")
