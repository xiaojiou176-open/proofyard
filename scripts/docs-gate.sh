#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REQUIRED_FILES=(
  "AGENTS.md"
  "CLAUDE.md"
  "README.md"
  "DISTRIBUTION.md"
  "INTEGRATIONS.md"
  "CONTRIBUTING.md"
  "SECURITY.md"
  "SUPPORT.md"
  "CHANGELOG.md"
  "CODE_OF_CONDUCT.md"
  "LICENSE"
  ".github/CODEOWNERS"
  ".github/pull_request_template.md"
  "docs/README.md"
  "docs/architecture.md"
  "docs/reference/dependencies-and-third-party.md"
  "docs/reference/public-surface-sanitization-policy.md"
  "apps/AGENTS.md"
  "apps/CLAUDE.md"
  "apps/api/AGENTS.md"
  "apps/api/CLAUDE.md"
  "apps/web/AGENTS.md"
  "apps/web/CLAUDE.md"
  "apps/automation-runner/AGENTS.md"
  "apps/automation-runner/CLAUDE.md"
  "packages/AGENTS.md"
  "packages/CLAUDE.md"
  "scripts/ci/check-doc-truth-surfaces.mjs"
  "scripts/ci/check-storefront-assets.mjs"
)

for file in "${REQUIRED_FILES[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "docs gate failed: missing required file $file"
    exit 1
  fi
done

node scripts/ci/check-doc-truth-surfaces.mjs
node scripts/ci/check-doc-entrypoints.mjs
node scripts/ci/check-doc-surface-contract.mjs
node scripts/ci/check-ai-discovery-surfaces.mjs
node scripts/ci/check-storefront-seo.mjs
node scripts/ci/check-value-narrative.mjs
node scripts/ci/check-mainline-alignment.mjs
node scripts/ci/check-storefront-assets.mjs
echo "docs gate passed"
