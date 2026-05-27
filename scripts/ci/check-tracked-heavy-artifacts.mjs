#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { ALLOWED_TRACKED_STOREFRONT_ARTIFACTS } from "./lib/storefront-asset-policy.mjs"

const suspiciousExtensions = [
  ".har",
  ".har.json",
  ".sqlite",
  ".db",
  ".zip",
  ".pdf",
  ".dmg",
  ".pkg",
  ".mp4",
  ".mov",
  ".trace",
  ".trace.zip",
  ".webm",
  ".png",
  ".jpg",
  ".jpeg",
  ".csv",
]

const allowedFixturePrefixes = [
  "apps/automation-runner/tests/fixtures/flow-spec-har/",
  "apps/automation-runner/tests/fixtures/wrappers/",
]

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean)

const failures = tracked.filter((file) => {
  if (!suspiciousExtensions.some((ext) => file.endsWith(ext))) {
    return false
  }

  if (
    file.endsWith(".har.json") &&
    allowedFixturePrefixes.some((prefix) => file.startsWith(prefix))
  ) {
    return false
  }

  if (ALLOWED_TRACKED_STOREFRONT_ARTIFACTS.has(file)) {
    return false
  }

  return true
})

if (failures.length > 0) {
  console.error("[tracked-heavy-artifacts] failed:")
  for (const failure of failures) console.error(`- suspicious tracked artifact: ${failure}`)
  process.exit(1)
}

console.log(`[tracked-heavy-artifacts] ok (${tracked.length} tracked file(s) scanned)`)
