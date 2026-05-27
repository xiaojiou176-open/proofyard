#!/usr/bin/env node

import { execFileSync } from "node:child_process"

export const canonicalPublicFiles = [
  "README.md",
  "DISTRIBUTION.md",
  "INTEGRATIONS.md",
  "skills/webaudit-mcp/SKILL.md",
  "skills/webaudit-mcp/manifest.yaml",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "SUPPORT.md",
  "CODE_OF_CONDUCT.md",
  ".github/CODEOWNERS",
  ".github/pull_request_template.md",
  "docs/index.md",
  "docs/README.md",
  "docs/archive/README.md",
  "docs/assets/README.md",
  "docs/quality-gates.md",
  "docs/localized/zh-CN/README.md",
  "docs/ai/maintainer-governance-canon.md",
  "docs/reference/public-surface-policy.md",
  "docs/reference/mcp-distribution-contract.md",
  "docs/reference/public-surface-sanitization-policy.md",
  "docs/reference/dependencies-and-third-party.md",
  "docs/reference/release-supply-chain-policy.md",
  "docs/reference/run-evidence-example.md",
  "docs/release/README.md",
  "docs/showcase/minimal-success-case.md",
  "docs/cli.md",
  "docs/getting-started/human-first-10-min.md",
  "docs/how-to/mcp-quickstart-1pager.md",
  "apps/web/index.html",
  "apps/web/src/hooks/useApiClient.helpers.ts",
  "scripts/dev-menu.sh",
  "apps/api/app/services/automation_commands.py",
  "apps/mcp-server/src/tools/register-tools/descriptions.ts",
  "packages/orchestrator/src/cli.ts",
  "scripts/release/generate-supply-chain-artifacts.mjs",
]

export const trackedFixturePrefixes = [
  "apps/automation-runner/tests/fixtures/flow-spec-har/",
  "apps/automation-runner/tests/fixtures/wrappers/",
]

export function listTrackedFiles() {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" }).trim().split("\n").filter(Boolean)
}

export function collectTrackedPublicSurfaceTargets() {
  const trackedFiles = listTrackedFiles()
  const trackedSet = new Set(trackedFiles)
  const fixtureTargets = trackedFiles.filter(
    (file) =>
      trackedFixturePrefixes.some((prefix) => file.startsWith(prefix)) &&
      (file.endsWith(".har") || file.endsWith(".har.json"))
  )

  return [
    ...new Set([...canonicalPublicFiles.filter((file) => trackedSet.has(file)), ...fixtureTargets]),
  ]
}

export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
