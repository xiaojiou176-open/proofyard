#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"

const repoRoot = process.cwd()
const failures = []

const allowedDocs = new Set([
  "docs/README.md",
  "docs/index.md",
  "docs/architecture.md",
  "docs/cli.md",
  "docs/getting-started/human-first-10-min.md",
  "docs/showcase/minimal-success-case.md",
  "docs/compare/webaudit-vs-generic-browser-agents.md",
  "docs/how-to/api-builder-quickstart.md",
  "docs/how-to/ai-reconstruction-side-road.md",
  "docs/how-to/webaudit-for-coding-agents.md",
  "docs/how-to/evidence-recovery-review-workspace.md",
  "docs/how-to/mcp-quickstart-1pager.md",
  "docs/how-to/webaudit-for-ai-agents.md",
  "docs/how-to/template-exchange-mvp.md",
  "docs/release/README.md",
  "docs/release/publication-receipt-bundle.md",
  "docs/assets/README.md",
  "docs/archive/README.md",
  "docs/quality-gates.md",
  "docs/ai/agent-guide.md",
  "docs/ai/maintainer-governance-canon.md",
  "docs/localized/zh-CN/README.md",
  "docs/reference/configuration.md",
  "docs/reference/dependencies-and-third-party.md",
  "docs/reference/public-surface-policy.md",
  "docs/reference/mcp-distribution-contract.md",
  "docs/reference/universal-api.md",
  "docs/reference/release-supply-chain-policy.md",
  "docs/reference/run-evidence-example.md",
  "docs/reference/recovery-safety-policy.md",
  "docs/reference/hosted-review-workspace-mvp.md",
  "docs/reference/final-closeout-wave5.md",
  "docs/reference/public-surface-sanitization-policy.md",
  "docs/reference/thirdparty-registry.md",
  "docs/reference/upstream-customizations.md",
  "docs/reference/generated/ci-governance-topology.md",
  "docs/reference/generated/mcp-tool-contract.md",
  "docs/reference/generated/profile-thresholds.md",
  "docs/reference/generated/governance/dependency-baselines.md",
  "docs/reference/generated/governance/log-event-schema.md",
  "docs/reference/generated/governance/module-boundaries.md",
  "docs/reference/generated/governance/repo-map.md",
  "docs/reference/generated/governance/root-allowlist.md",
  "docs/reference/generated/governance/runtime-live-policy.md",
  "docs/reference/generated/governance/runtime-output-registry.md",
  "docs/reference/generated/governance/upstream-compat-matrix.md",
  "docs/reference/generated/governance/upstream-customizations.md",
  "docs/reference/generated/governance/upstream-registry.md",
])

const bannedTokens = ["docs/plans/", "docs/history/", "docs/audits/", "docs/closure/"]

const englishRequiredMarkdown = [
  "README.md",
  "DISTRIBUTION.md",
  "INTEGRATIONS.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "SUPPORT.md",
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
  ...Array.from(allowedDocs).filter((file) => file !== "docs/localized/zh-CN/README.md"),
]

const actualDocs = walkFiles(path.join(repoRoot, "docs")).map((p) =>
  path.relative(repoRoot, p).replaceAll("\\", "/")
)
for (const file of actualDocs) {
  if (!allowedDocs.has(file)) {
    failures.push(`unexpected docs file tracked in storefront public surface: ${file}`)
  }
}

for (const file of englishRequiredMarkdown) {
  const fullPath = path.join(repoRoot, file)
  if (!fs.existsSync(fullPath)) {
    continue
  }
  const content = fs.readFileSync(fullPath, "utf8")
  if (/[\p{Script=Han}]/u.test(content)) {
    failures.push(`${file} contains non-English Han characters`)
  }
  for (const token of bannedTokens) {
    if (content.includes(token)) {
      failures.push(`${file} references banned or deleted surface: ${token}`)
    }
  }
}

if (failures.length > 0) {
  console.error("[doc-truth-surfaces] failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log("[doc-truth-surfaces] ok")

function walkFiles(dir) {
  if (!fs.existsSync(dir)) {
    return []
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath))
    } else {
      files.push(fullPath)
    }
  }
  return files
}
