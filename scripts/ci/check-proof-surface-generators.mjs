#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const tmpRoot = ".runtime-cache/artifacts/ci/proof-surface-check"
fs.rmSync(tmpRoot, { recursive: true, force: true })
fs.mkdirSync(tmpRoot, { recursive: true })

const releaseNotesPath = path.join(tmpRoot, "release-notes-vnext.md")
const supplyChainDir = path.join(tmpRoot, "release-supply-chain")

execFileSync("bash", ["scripts/release/generate-release-notes.sh"], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: { ...process.env, RELEASE_NOTES_OUTPUT: releaseNotesPath },
  stdio: "pipe",
})

execFileSync("node", ["scripts/release/generate-supply-chain-artifacts.mjs", supplyChainDir], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: process.env,
  stdio: "pipe",
})

const failures = []

if (!fs.existsSync(releaseNotesPath)) {
  failures.push(`missing generated release notes: ${releaseNotesPath}`)
} else {
  const content = fs.readFileSync(releaseNotesPath, "utf8")
  for (const token of ["# Release Notes (vNext)", "## Highlights", "## Commits"]) {
    if (!content.includes(token)) failures.push(`release notes missing token: ${token}`)
  }
}

for (const file of [
  "sbom.json",
  "provenance.json",
  "attestation.json",
  "subject-manifest.json",
  "checksums.txt",
]) {
  if (!fs.existsSync(path.join(supplyChainDir, file))) {
    failures.push(`missing generated proof artifact: ${file}`)
  }
}

if (failures.length > 0) {
  console.error("[proof-surface-generators] failed:")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log("[proof-surface-generators] ok")
