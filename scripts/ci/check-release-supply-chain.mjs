#!/usr/bin/env node

import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"

const workflowPath = ".github/workflows/release-candidate.yml"
const failures = []

if (!fs.existsSync(workflowPath)) {
  failures.push(`missing workflow: ${workflowPath}`)
} else {
  const content = fs.readFileSync(workflowPath, "utf8")
  for (const requiredSnippet of [
    "node scripts/release/generate-supply-chain-artifacts.mjs",
    "node scripts/ci/check-release-supply-chain.mjs",
    ".runtime-cache/artifacts/release/supply-chain/",
    "subject-path: .runtime-cache/artifacts/release/supply-chain/*",
    "attestations: write",
    "id-token: write",
  ]) {
    if (!content.includes(requiredSnippet)) {
      failures.push(`release workflow missing required supply-chain step/snippet: ${requiredSnippet}`)
    }
  }
  if (!/uses:\s+actions\/attest@(?:v4|[0-9a-f]{40})/.test(content)) {
    failures.push("release workflow missing required supply-chain step/snippet: uses: actions/attest@<pinned>")
  }
  for (const forbidden of [
    "test -f .runtime-cache/artifacts/release/supply-chain/provenance.json",
    "test -f .runtime-cache/artifacts/release/supply-chain/attestation.json",
  ]) {
    if (content.includes(forbidden)) {
      failures.push(`release workflow still uses file-exists placeholder check: ${forbidden}`)
    }
  }
  if (!content.includes("node scripts/ci/check-release-supply-chain.mjs")) {
    failures.push("release workflow does not invoke release supply-chain verifier")
  }
}

const sampleDir = fs.mkdtempSync(path.join(os.tmpdir(), "uiq-release-supply-chain-"))
try {
  execFileSync(
    "node",
    ["scripts/release/generate-supply-chain-artifacts.mjs", sampleDir],
    { encoding: "utf8", stdio: "pipe" }
  )

  const expectations = [
    ["sbom.json", "sbom", "This artifact is a placeholder repository-side summary."],
    [
      "provenance.json",
      "provenance",
      "This provenance document is a placeholder summary emitted by the repository.",
    ],
    [
      "attestation.json",
      "attestation",
      "This attestation document is a placeholder summary.",
    ],
  ]

  for (const [fileName, expectedKind, warningPrefix] of expectations) {
    const absPath = path.join(sampleDir, fileName)
    if (!fs.existsSync(absPath)) {
      failures.push(`generator missing expected artifact: ${fileName}`)
      continue
    }
    const payload = JSON.parse(fs.readFileSync(absPath, "utf8"))
    if (payload.kind !== expectedKind) {
      failures.push(`${fileName} has unexpected kind: ${payload.kind}`)
    }
    if (payload.verificationStatus !== "non-verifiable-placeholder") {
      failures.push(`${fileName} missing placeholder verification status`)
    }
    if (typeof payload.warning !== "string" || !payload.warning.startsWith(warningPrefix)) {
      failures.push(`${fileName} missing expected warning text`)
    }
  }

  const subjectManifestPath = path.join(sampleDir, "subject-manifest.json")
  if (!fs.existsSync(subjectManifestPath)) {
    failures.push("generator missing expected artifact: subject-manifest.json")
  } else {
    const payload = JSON.parse(fs.readFileSync(subjectManifestPath, "utf8"))
    if (payload.kind !== "subject-manifest") {
      failures.push(`subject-manifest.json has unexpected kind: ${payload.kind}`)
    }
    if (payload.verificationStatus !== "non-verifiable-placeholder") {
      failures.push("subject-manifest.json missing placeholder verification status")
    }
    if (
      typeof payload.warning !== "string" ||
      !payload.warning.startsWith(
        "This subject manifest is a repository-generated digest summary for consumer inspection."
      )
    ) {
      failures.push("subject-manifest.json missing expected warning text")
    }
    if (payload.digestAlgorithm !== "sha256") {
      failures.push(`subject-manifest.json has unexpected digest algorithm: ${payload.digestAlgorithm}`)
    }
    if (!Array.isArray(payload.subjects) || payload.subjects.length !== expectations.length) {
      failures.push(
        `subject-manifest.json has unexpected subject count: ${Array.isArray(payload.subjects) ? payload.subjects.length : "invalid"}`
      )
    } else {
      for (const [fileName] of expectations) {
        const subject = payload.subjects.find((item) => item?.name === fileName)
        if (!subject) {
          failures.push(`subject-manifest.json missing subject entry for ${fileName}`)
          continue
        }
        const absPath = path.join(sampleDir, fileName)
        if (subject.sha256 !== sha256File(absPath)) {
          failures.push(`subject-manifest.json has unexpected digest for ${fileName}`)
        }
        if (subject.bytes !== fs.statSync(absPath).size) {
          failures.push(`subject-manifest.json has unexpected byte size for ${fileName}`)
        }
      }
    }
  }

  const checksumsPath = path.join(sampleDir, "checksums.txt")
  if (!fs.existsSync(checksumsPath)) {
    failures.push("generator missing expected artifact: checksums.txt")
  } else {
    const lines = fs
      .readFileSync(checksumsPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
    const checksumFiles = [...expectations.map(([fileName]) => fileName), "subject-manifest.json"]
    if (lines.length !== checksumFiles.length) {
      failures.push(`checksums.txt has unexpected line count: ${lines.length}`)
    }
    for (const fileName of checksumFiles) {
      const expectedLine = `${sha256File(path.join(sampleDir, fileName))}  ${fileName}`
      if (!lines.includes(expectedLine)) {
        failures.push(`checksums.txt missing exact digest line for ${fileName}`)
      }
    }
  }
} finally {
  fs.rmSync(sampleDir, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error("[release-supply-chain] failed:")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log("[release-supply-chain] ok (placeholder-aware contract)")

function sha256File(filePath) {
  const content = fs.readFileSync(filePath)
  return crypto.createHash("sha256").update(content).digest("hex")
}
