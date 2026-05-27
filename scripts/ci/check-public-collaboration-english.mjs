#!/usr/bin/env node

import fs from "node:fs"

const canonicalPublicFiles = [
  "LICENSE",
  "README.md",
  "DISTRIBUTION.md",
  "INTEGRATIONS.md",
  "skills/proofyard-mcp/SKILL.md",
  "skills/proofyard-mcp/manifest.yaml",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "SUPPORT.md",
  "CODE_OF_CONDUCT.md",
  ".github/CODEOWNERS",
  ".github/pull_request_template.md",
  "AGENTS.md",
  "CLAUDE.md",
  "apps/AGENTS.md",
  "apps/CLAUDE.md",
  "apps/api/AGENTS.md",
  "apps/api/CLAUDE.md",
  "apps/web/AGENTS.md",
  "apps/web/CLAUDE.md",
  "apps/automation-runner/AGENTS.md",
  "apps/automation-runner/CLAUDE.md",
  "packages/AGENTS.md",
  "packages/CLAUDE.md",
  "docs/README.md",
  "docs/architecture.md",
  "docs/reference/mcp-distribution-contract.md",
  "docs/reference/dependencies-and-third-party.md",
  "docs/reference/public-surface-sanitization-policy.md",
]

const engineeringFacingEnglishFiles = [
  "scripts/ci/check-gemini-sdk-versions.mjs",
  "scripts/ci/governance-exceptions.mjs",
  "scripts/computer-use/README.md",
  "scripts/computer-use/gemini-computer-use.py",
  "scripts/train-and-auto-replay.sh",
  "scripts/usability/lane-d-usability.ts",
  "apps/web/scripts/mock-backend.mjs",
  "packages/orchestrator/src/commands/capture.ts",
  "packages/orchestrator/src/commands/visual.ts",
  "apps/web/src/testing/button-manifest.ts",
  "tests/frontend-e2e/support/button-behavior-harness.ts",
]

const failures = []
const hanPattern = /\p{Script=Han}/u

for (const target of [...canonicalPublicFiles, ...engineeringFacingEnglishFiles]) {
  if (!fs.existsSync(target)) {
    failures.push(`missing required public collaboration surface: ${target}`)
    continue
  }
  const content = fs.readFileSync(target, "utf8")
  if (hanPattern.test(content)) {
    failures.push(`non-English canonical collaboration surface detected: ${target}`)
  }
}

if (failures.length > 0) {
  console.error("[public-collaboration-english] failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(
  `[public-collaboration-english] ok (${canonicalPublicFiles.length + engineeringFacingEnglishFiles.length} surface(s))`
)
