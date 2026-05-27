#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const repoRoot = process.cwd()
const args = new Set(process.argv.slice(2))
const failures = []

const requiredFiles = [
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "docs/README.md",
  "docs/index.md",
  "docs/architecture.md",
  "docs/reference/dependencies-and-third-party.md",
  "docs/reference/public-surface-sanitization-policy.md",
]

for (const relativePath of requiredFiles) {
  const fullPath = path.join(repoRoot, relativePath)
  if (!fs.existsSync(fullPath)) {
    failures.push(`missing required file: ${relativePath}`)
  }
}

assertIncludes("README.md", "docs/README.md", "README must route readers to docs/README.md")
assertIncludes("README.md", "docs/architecture.md", "README must route readers to docs/architecture.md")
assertIncludes("README.md", "docs/index.md", "README must route readers to docs/index.md")
assertIncludes("AGENTS.md", "docs/README.md", "AGENTS.md must route agents to docs/README.md")
assertIncludes("CLAUDE.md", "docs/README.md", "CLAUDE.md must route agents to docs/README.md")
assertIncludes(
  "docs/README.md",
  "one public doc surface",
  "docs/README.md must describe the single live public doc surface"
)
assertIncludes(
  "docs/README.md",
  "supports the README storefront",
  "docs/README.md must state that docs support the README storefront"
)
assertIncludes(
  "docs/architecture.md",
  "## Runtime Boundaries",
  "docs/architecture.md must describe runtime boundaries"
)

runNodeCheck("scripts/ci/check-doc-truth-surfaces.mjs")

if (args.has("--check-staged-docs-link") || args.has("--check-ci-docs-link")) {
  runNodeCheck("scripts/ci/check-doc-links.mjs")
}

if (failures.length > 0) {
  console.error("[docs-ssot] failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log("[docs-ssot] ok (compat wrapper -> live docs truth surface)")

function assertIncludes(relativePath, token, message) {
  const fullPath = path.join(repoRoot, relativePath)
  if (!fs.existsSync(fullPath)) {
    failures.push(`missing required file: ${relativePath}`)
    return
  }
  const content = fs.readFileSync(fullPath, "utf8")
  if (!content.includes(token)) {
    failures.push(`${message} (${relativePath} missing ${JSON.stringify(token)})`)
  }
}

function runNodeCheck(relativeScriptPath) {
  try {
    execFileSync("node", [relativeScriptPath], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (error) {
    const stdout =
      error && typeof error === "object" && "stdout" in error ? String(error.stdout || "") : ""
    const stderr =
      error && typeof error === "object" && "stderr" in error ? String(error.stderr || "") : ""
    const combined = [stdout, stderr].filter(Boolean).join("\n").trim()
    failures.push(
      `${relativeScriptPath} failed${combined.length > 0 ? `: ${combined}` : ""}`
    )
  }
}
