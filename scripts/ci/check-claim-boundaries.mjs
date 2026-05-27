#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"

const repoRoot = process.cwd()
const failures = []

assertIncludes("README.md", "auditable browser automation platform", "README must keep the public identity")
assertIncludes("CONTRIBUTING.md", "Do not commit `.env` files", "CONTRIBUTING must keep the secret-handling rule")
assertIncludes("SECURITY.md", "Do not disclose security issues", "SECURITY must keep the private-reporting rule")
assertIncludes(
  "docs/reference/public-surface-sanitization-policy.md",
  "non-public surface",
  "public surface policy must document non-public surfaces"
)

if (failures.length > 0) {
  console.error("[claim-boundaries] failed:")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log("[claim-boundaries] ok")

function assertIncludes(relativePath, needle, failure) {
  const absolutePath = path.join(repoRoot, relativePath)
  if (!fs.existsSync(absolutePath)) {
    failures.push(`${failure} (${relativePath} missing)`)
    return
  }
  const content = fs.readFileSync(absolutePath, "utf8")
  if (!content.includes(needle)) {
    failures.push(`${failure} (${relativePath} missing ${JSON.stringify(needle)})`)
  }
}
