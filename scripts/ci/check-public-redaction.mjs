#!/usr/bin/env node

import fs from "node:fs"
import { collectTrackedPublicSurfaceTargets } from "./lib/public-surface-targets.mjs"

const secretPatterns = [
  /AKIA[0-9A-Z]{16}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /sk-[A-Za-z0-9_-]{20,}/,
  new RegExp("BEGIN " + "PRIVATE KEY"),
  /\bBearer\s+(?!SCRUBBED_|PLACEHOLDER_|TEST_|EXAMPLE_)[A-Za-z0-9.-]{12,}/,
  /\bsession_id=(?!SCRUBBED_|PLACEHOLDER_|TEST_|EXAMPLE_)[A-Za-z0-9.-]{8,}/i,
  /\bcsrf_cookie=(?!SCRUBBED_|PLACEHOLDER_|TEST_|EXAMPLE_)[A-Za-z0-9.-]{8,}/i,
  /"password"\s*:\s*"(?!\*\*\*REDACTED\*\*\*|SCRUBBED_|PLACEHOLDER_|TEST_)[^"]+"/i,
  /"otp"\s*:\s*"(?!\*\*\*REDACTED\*\*\*|000000|SCRUBBED_|PLACEHOLDER_|TEST_)[^"]+"/i,
]

const failures = []
const targets = collectTrackedPublicSurfaceTargets()

for (const target of targets) {
  if (!fs.existsSync(target)) {
    continue
  }
  const content = fs.readFileSync(target, "utf8")
  for (const pattern of secretPatterns) {
    if (pattern.test(content)) {
      failures.push(`possible sensitive content in public surface: ${target}`)
      break
    }
  }
}

if (failures.length > 0) {
  console.error("[public-redaction] failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(`[public-redaction] ok (${targets.length} surface(s))`)
