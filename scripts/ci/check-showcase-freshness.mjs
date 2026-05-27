#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const requiredFiles = [
  "docs/showcase/minimal-success-case.md",
  "docs/reference/run-evidence-example.md",
  "docs/release/README.md",
]

const routingChecks = [
  { source: "README.md", token: "docs/showcase/minimal-success-case.md" },
  { source: "README.md", token: "docs/reference/run-evidence-example.md" },
  { source: "README.md", token: "docs/release/README.md" },
  { source: "docs/index.md", token: "docs/showcase/minimal-success-case.md" },
  { source: "docs/index.md", token: "docs/reference/run-evidence-example.md" },
  { source: "docs/index.md", token: "docs/release/README.md" },
]

const failures = []
const tempRoot = ".runtime-cache/artifacts/ci/showcase-proof-check"

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) {
    failures.push(`missing showcase surface file: ${file}`)
    continue
  }
  const text = fs.readFileSync(file, "utf8")
  if (text.trim().length < 80) {
    failures.push(`showcase surface too thin: ${file}`)
  }
}

const releaseReadme = fs.readFileSync("docs/release/README.md", "utf8")
if (!releaseReadme.includes("./scripts/release/generate-release-notes.sh")) {
  failures.push("release surface missing release-notes generation entrypoint")
}

const showcaseDoc = fs.readFileSync("docs/showcase/minimal-success-case.md", "utf8")
for (const token of [
  "just run",
  "pnpm uiq run --profile pr --target web.local",
  ".runtime-cache/artifacts/runs/<runId>/manifest.json",
  ".runtime-cache/artifacts/runs/<runId>/reports/summary.json",
  ".runtime-cache/artifacts/runs/<runId>/reports/diagnostics.index.json",
  ".runtime-cache/artifacts/runs/<runId>/reports/log-index.json",
  "just run-legacy",
  ".runtime-cache/automation/",
]) {
  if (!showcaseDoc.includes(token)) {
    failures.push(`minimal success case missing evidence token: ${token}`)
  }
}

for (const check of routingChecks) {
  if (!fs.existsSync(check.source)) {
    failures.push(`missing routing source: ${check.source}`)
    continue
  }
  const content = fs.readFileSync(check.source, "utf8")
  if (!content.includes(check.token)) {
    failures.push(`missing showcase route: ${check.source} -> ${check.token}`)
  }
}

const releaseNotesPath = path.join(tempRoot, "release-notes-vnext.md")
const supplyChainRoot = path.join(tempRoot, "supply-chain")

fs.rmSync(tempRoot, { recursive: true, force: true })
fs.mkdirSync(tempRoot, { recursive: true })

try {
  execFileSync("bash", ["scripts/release/generate-release-notes.sh"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      RELEASE_NOTES_OUTPUT: releaseNotesPath,
    },
    encoding: "utf8",
    stdio: "pipe",
  })
} catch (error) {
  failures.push(`release notes generator failed: ${formatError(error)}`)
}

if (!fs.existsSync(releaseNotesPath)) {
  failures.push(`release notes generator did not create expected file: ${releaseNotesPath}`)
}

try {
  execFileSync("node", ["scripts/release/generate-supply-chain-artifacts.mjs", supplyChainRoot], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    stdio: "pipe",
  })
} catch (error) {
  failures.push(`supply-chain generator failed: ${formatError(error)}`)
}

for (const file of [
  "sbom.json",
  "provenance.json",
  "attestation.json",
  "subject-manifest.json",
  "checksums.txt",
]) {
  const fullPath = path.join(supplyChainRoot, file)
  if (!fs.existsSync(fullPath)) {
    failures.push(`supply-chain generator missing expected artifact: ${fullPath}`)
  }
}

if (failures.length > 0) {
  console.error("[showcase-freshness] failed:")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log("[showcase-freshness] ok")

function formatError(error) {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}
