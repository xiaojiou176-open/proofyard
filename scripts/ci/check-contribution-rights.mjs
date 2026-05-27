#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"

const repoRoot = process.cwd()
const failures = []

const contributing = readRepoText("CONTRIBUTING.md")
requireIncludes(
  "CONTRIBUTING.md",
  contributing,
  "DCO-style `Signed-off-by:`",
  "CONTRIBUTING.md must require DCO-style sign-off for reviewable contributions"
)
requireIncludes(
  "CONTRIBUTING.md",
  contributing,
  "public-preview boundary",
  "CONTRIBUTING.md must describe the current public-preview contribution boundary"
)
requireIncludes(
  "CONTRIBUTING.md",
  contributing,
  "pnpm repo:truth:check",
  "CONTRIBUTING.md must point contributors to scoped repo-truth validation"
)

const prTemplate = readRepoText(".github/pull_request_template.md")
requireIncludes(
  ".github/pull_request_template.md",
  prTemplate,
  "I have the right to submit this contribution under the repository license.",
  "PR template must require explicit contribution rights attestation"
)
requireIncludes(
  ".github/pull_request_template.md",
  prTemplate,
  "Every commit in this PR includes a DCO-style `Signed-off-by:` line.",
  "PR template must require DCO-style sign-off confirmation"
)

if (failures.length > 0) {
  console.error("[contribution-rights] failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log("[contribution-rights] ok (policy surface)")

function readRepoText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8")
}

function requireIncludes(relativePath, content, needle, failure) {
  if (!content.includes(needle)) {
    failures.push(`${failure} (${relativePath} missing ${JSON.stringify(needle)})`)
  }
}
