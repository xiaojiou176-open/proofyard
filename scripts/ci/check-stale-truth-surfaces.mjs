#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"

const DOCS_ROOT = "docs"
const ignoredPrefixes = [
  "docs/adr/",
  "docs/archive/",
  "docs/history/",
  "docs/plans/",
  "docs/quality/",
  "docs/reference/generated/",
]

const historicalPathPattern = /(acceptance|scorecard|snapshot|assessment|20\d{2}-\d{2}-\d{2})/i
const requiredBannerPattern = /Historical review artifact only\./
const requiredNonCanonicalPattern =
  /not a canonical current-state contract source|not a canonical contract source|Do not treat .* current canonical repo truth/i
const failures = []
const candidates = []

for (const filePath of walkMarkdownFiles(DOCS_ROOT)) {
  if (ignoredPrefixes.some((prefix) => filePath.startsWith(prefix))) {
    continue
  }

  const basename = path.basename(filePath)
  const content = fs.readFileSync(filePath, "utf8")
  const header = content.split("\n").slice(0, 14).join("\n")

  const isHistoricalCandidate =
    requiredBannerPattern.test(header) ||
    (filePath.startsWith("docs/reference/") && historicalPathPattern.test(basename))

  if (!isHistoricalCandidate) {
    continue
  }

  candidates.push(filePath)

  if (!requiredBannerPattern.test(header)) {
    failures.push(`${filePath}: missing historical banner near top of file`)
  }

  if (!requiredNonCanonicalPattern.test(header)) {
    failures.push(`${filePath}: missing explicit non-canonical/current-truth disclaimer`)
  }

  const hasIndexRedirect = content.includes("docs/index.md")
  const hasCanonicalTruthRedirect =
    content.includes("docs/architecture.md") || content.includes("docs/reference/generated/")
  if (!hasIndexRedirect || !hasCanonicalTruthRedirect) {
    failures.push(
      `${filePath}: missing current-truth redirect(s): docs/index.md plus docs/architecture.md or docs/reference/generated/`
    )
  }
}

if (failures.length > 0) {
  console.error("[stale-truth-surfaces] failed:")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`[stale-truth-surfaces] ok (${candidates.length} candidate(s))`)

function walkMarkdownFiles(rootDir) {
  const files = []
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkMarkdownFiles(fullPath))
      continue
    }
    if (entry.isFile() && fullPath.endsWith(".md")) {
      files.push(fullPath)
    }
  }
  return files.sort()
}
