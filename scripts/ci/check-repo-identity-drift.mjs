#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"

const repoRoot = process.cwd()
const failures = []

const currentSurfaces = [
  "README.md",
  "package.json",
  "pyproject.toml",
  ".npmrc",
  "CITATION.cff",
  "docs/localized/zh-CN/README.md",
  "docs/quality-gates.md",
  "docs/ai/agent-guide.md",
  "docs/ai/maintainer-governance-canon.md",
  "apps/web/package.json",
  "apps/automation-runner/package.json",
  "apps/api/app/services/automation_commands.py",
  "apps/api/config/default.json",
  "apps/api/config/development.json",
  "apps/api/config/staging.json",
  "apps/api/config/production.json",
  "apps/api/config/test.json",
  "configs/tooling/Makefile",
  "scripts/ci/run-jscpd-gate.sh",
  "scripts/ci/check-no-direct-env-access.sh",
  "scripts/security-scan.sh",
  "scripts/ci/build-ci-image.sh",
  "scripts/ci/resolve-ci-image.sh",
  "scripts/ci/run-in-container.sh",
  "scripts/release/generate-supply-chain-artifacts.mjs",
]

const forbiddenTokens = [
  { token: "browser-automation-playground", reason: "legacy repo/product name must not remain in current surfaces" },
  { token: "uiq-platform-repo", reason: "legacy repo/package/cache namespace must not remain in current surfaces" },
  { token: "browser-automation-recorder", reason: "previous repo/package/runtime identity must not remain in current surfaces" },
  { token: "browser-automation-frontend", reason: "legacy web package identity must not remain in current surfaces" },
  { token: "browser-automation-pipeline", reason: "legacy automation package identity must not remain in current surfaces" },
  { token: "🤖自动化浏览器操作", reason: "legacy repo root label must not remain in current execution surfaces" },
]

const legacyRootAliases = [
  { legacy: "backend", canonical: "apps/api" },
  { legacy: "frontend", canonical: "apps/web" },
  { legacy: "automation", canonical: "apps/automation-runner" },
]

for (const relativePath of currentSurfaces) {
  const absolutePath = path.join(repoRoot, relativePath)
  if (!fs.existsSync(absolutePath)) {
    failures.push(`missing current-surface file: ${relativePath}`)
    continue
  }
  const content = fs.readFileSync(absolutePath, "utf8")

  for (const { token, reason } of forbiddenTokens) {
    if (content.includes(token)) {
      failures.push(`${relativePath}: ${reason} (${JSON.stringify(token)})`)
    }
  }

  for (const alias of legacyRootAliases) {
    const pattern = new RegExp(`(^|[\\s\`"'(=:])${escapeRegex(alias.legacy)}/`, "m")
    if (pattern.test(content)) {
      failures.push(
        `${relativePath}: legacy root alias ${alias.legacy}/ must be replaced with ${alias.canonical}/ in current surfaces`
      )
    }
  }
}

if (failures.length > 0) {
  console.error("[repo-identity-drift] failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(`[repo-identity-drift] ok (${currentSurfaces.length} surface(s))`)

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
