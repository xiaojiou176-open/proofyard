#!/usr/bin/env node

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const outputDir = process.argv[2] || ".runtime-cache/artifacts/release/supply-chain"
fs.mkdirSync(outputDir, { recursive: true })

const generatedAt = new Date().toISOString()
const runId = process.env.GITHUB_RUN_ID || "local"
const attempt = process.env.GITHUB_RUN_ATTEMPT || "0"
const sha = process.env.GITHUB_SHA || "workspace"
const ref = process.env.GITHUB_REF || "local-ref"

const sbom = {
  kind: "sbom",
  format: "placeholder-json",
  verificationStatus: "non-verifiable-placeholder",
  generatedAt,
  repo: "webaudit",
  sha,
  ref,
  warning:
    "This artifact is a placeholder repository-side summary. It is not a signed SBOM and must not be treated as release-grade supply-chain proof.",
  packages: [
    { ecosystem: "python", manifest: "pyproject.toml" },
    { ecosystem: "node", manifest: "package.json" },
  ],
}

const provenance = {
  kind: "provenance",
  generatedAt,
  builder: "github-actions",
  runId,
  attempt,
  sha,
  ref,
  workflow: "release-candidate",
  verificationStatus: "non-verifiable-placeholder",
  warning:
    "This provenance document is a placeholder summary emitted by the repository. It is not a cryptographically verifiable provenance attestation.",
}

const attestation = {
  kind: "attestation",
  generatedAt,
  subject: {
    repo: "webaudit",
    sha,
    ref,
  },
  predicates: ["sbom", "provenance", "subject-manifest", "release-gate"],
  verificationStatus: "non-verifiable-placeholder",
  warning:
    "This attestation document is a placeholder summary. It is not a signed attestation and must not be marketed as a strong supply-chain proof artifact.",
}

const attestedFiles = ["sbom.json", "provenance.json", "attestation.json"]
fs.writeFileSync(path.join(outputDir, "sbom.json"), `${JSON.stringify(sbom, null, 2)}\n`, "utf8")
fs.writeFileSync(
  path.join(outputDir, "provenance.json"),
  `${JSON.stringify(provenance, null, 2)}\n`,
  "utf8"
)
fs.writeFileSync(
  path.join(outputDir, "attestation.json"),
  `${JSON.stringify(attestation, null, 2)}\n`,
  "utf8"
)

const subjectManifest = {
  kind: "subject-manifest",
  generatedAt,
  verificationStatus: "non-verifiable-placeholder",
  warning:
    "This subject manifest is a repository-generated digest summary for consumer inspection. It is not itself a signed attestation.",
  digestAlgorithm: "sha256",
  source: {
    repo: "webaudit",
    sha,
    ref,
    workflow: "release-candidate",
    runId,
    attempt,
  },
  subjects: attestedFiles.map((fileName) => ({
    name: fileName,
    sha256: sha256File(fileName),
    bytes: fs.statSync(path.join(outputDir, fileName)).size,
  })),
}

fs.writeFileSync(
  path.join(outputDir, "subject-manifest.json"),
  `${JSON.stringify(subjectManifest, null, 2)}\n`,
  "utf8"
)

const checksumFiles = [...attestedFiles, "subject-manifest.json"]
const checksums = checksumFiles.map((fileName) => `${sha256File(fileName)}  ${fileName}`)
fs.writeFileSync(path.join(outputDir, "checksums.txt"), `${checksums.join("\n")}\n`, "utf8")

console.log(JSON.stringify({ outputDir, files: [...checksumFiles, "checksums.txt"] }))

function sha256File(fileName) {
  const content = fs.readFileSync(path.join(outputDir, fileName))
  return crypto.createHash("sha256").update(content).digest("hex")
}
