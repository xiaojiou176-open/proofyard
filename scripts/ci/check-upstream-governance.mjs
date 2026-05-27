#!/usr/bin/env node

import { loadGovernanceControlPlane, readRepoText } from "./lib/governance-control-plane.mjs"

const failures = []
const { upstreamRegistry, upstreamCompatMatrix, upstreamCustomizations } = loadGovernanceControlPlane()
const upstreamSource = readRepoText("configs/upstream/source.yaml")
const repoUpstreamDisabled = /^\s*mode:\s*none\s*$/m.test(upstreamSource)

const requiredEntryIds = [
  "ci-node-base-image",
  "ci-python-base-image",
  "uv-binary",
  "actionlint-binary",
  "gitleaks-binary",
  "k6-binary",
  "semgrep-cli",
  "curlconverter-cli",
  "har-to-k6-cli",
  "playwright-cli",
  "mcp-sdk",
  "gemini-sdk",
]

if (!repoUpstreamDisabled) {
  requiredEntryIds.push("upstream-repo-binding")
}

const byId = new Map()
for (const entry of upstreamRegistry.entries) {
  if (byId.has(entry.id)) {
    failures.push(`duplicate upstream registry id: ${entry.id}`)
  }
  byId.set(entry.id, entry)
  for (const field of [
    "id",
    "kind",
    "role",
    "source",
    "pin",
    "integrates_via",
    "owner",
    "verify_command",
    "rollback_path",
    "license",
    "security_posture",
    "compat_group",
    "contract_kind",
    "cadence",
    "required_proof",
    "status",
  ]) {
    if (!(field in entry) || String(entry[field]).trim() === "") {
      failures.push(`upstream registry entry ${entry.id} missing field: ${field}`)
    }
  }
}

for (const id of requiredEntryIds) {
  if (!byId.has(id)) {
    failures.push(`upstream registry missing active surface: ${id}`)
  }
}

for (const group of upstreamCompatMatrix.groups) {
  if (!group.requiredProofArtifact) {
    failures.push(`compat matrix group missing requiredProofArtifact: ${group.id}`)
  }
  for (const supported of group.supported) {
    if (!byId.has(supported)) {
      failures.push(`compat matrix references unknown upstream id: ${supported}`)
    }
  }
}

if (!Array.isArray(upstreamCustomizations.requiredFields) || upstreamCustomizations.requiredFields.length === 0) {
  failures.push("upstream customizations registry missing requiredFields")
}
if (!Array.isArray(upstreamCustomizations.customizations)) {
  failures.push("upstream customizations registry must expose an array")
} else {
  for (const entry of upstreamCustomizations.customizations) {
    for (const field of upstreamCustomizations.requiredFields ?? []) {
      const value = entry[field]
      const isEmptyArray = Array.isArray(value) && value.length === 0
      if (value === undefined || value === null || value === "" || isEmptyArray) {
        failures.push(`upstream customization ${entry.id ?? "(unknown)"} missing field: ${field}`)
      }
    }
    if (entry.upstream_id && !byId.has(entry.upstream_id)) {
      failures.push(`upstream customization references unknown upstream id: ${entry.upstream_id}`)
    }
  }
}

const dockerSource = readRepoText("docker/ci/Dockerfile")
for (const token of [
  "ARG NODE_IMAGE=docker.io/library/node:20-bookworm-slim@sha256:",
  "ARG PYTHON_IMAGE=docker.io/library/python:3.11-slim-bookworm@sha256:",
  "UV_VERSION=0.8.15",
  "ACTIONLINT_VERSION=1.7.11",
  "GITLEAKS_VERSION=8.24.2",
]) {
  if (!dockerSource.includes(token)) {
    failures.push(`docker/ci/Dockerfile missing expected upstream token: ${token}`)
  }
}
if (dockerSource.includes(":latest")) {
  failures.push("docker/ci/Dockerfile contains a forbidden floating latest tag")
}

const thirdpartyReferenceDoc = readRepoText("docs/reference/thirdparty-registry.md")
if (!thirdpartyReferenceDoc.includes("configs/governance/upstream-registry.json")) {
  failures.push("thirdparty registry doc must point to configs/governance/upstream-registry.json")
}
const customizationsReferenceDoc = readRepoText("docs/reference/upstream-customizations.md")
if (!customizationsReferenceDoc.includes("configs/governance/upstream-customizations.json")) {
  failures.push("upstream customizations doc must point to configs/governance/upstream-customizations.json")
}

for (const [relativePath, forbiddenToken] of [
  ["apps/automation-runner/scripts/run-curlconverter-safe.sh", "pnpm dlx curlconverter"],
  ["apps/automation-runner/scripts/run-har-to-k6-safe.sh", "pnpm dlx har-to-k6"],
  ["docs/reference/dependencies-and-third-party.md", "pnpm dlx"],
]) {
  const content = readRepoText(relativePath)
  if (content.includes(forbiddenToken)) {
    failures.push(`${relativePath} contains forbidden floating wrapper fallback: ${forbiddenToken}`)
  }
}

if (failures.length > 0) {
  console.error("[upstream-governance] failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(`[upstream-governance] ok (${upstreamRegistry.entries.length} entries)`)
