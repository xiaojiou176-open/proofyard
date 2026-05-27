#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export PYTHONDONTWRITEBYTECODE="${PYTHONDONTWRITEBYTECODE:-1}"
# shellcheck source=scripts/lib/python-runtime.sh
source "$ROOT_DIR/scripts/lib/python-runtime.sh"
ensure_project_python_env_exports

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 not found"
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "error: pnpm not found"
  echo "install: npm install -g pnpm"
  exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "error: uv not found"
  echo "install: https://docs.astral.sh/uv/getting-started/installation/"
  exit 1
fi

uv sync --frozen --extra dev

if [[ -d browser_automation_playground.egg-info ]]; then
  mkdir -p .runtime-cache/temp/setup-artifacts
  rm -rf .runtime-cache/temp/setup-artifacts/browser_automation_playground.egg-info 2>/dev/null || true
  mv browser_automation_playground.egg-info .runtime-cache/temp/setup-artifacts/browser_automation_playground.egg-info
fi

# Web now depends on workspace packages, so setup must
# install through the workspace root instead of pretending apps/web is isolated.
CI="${CI:-true}" pnpm install --frozen-lockfile || CI="${CI:-true}" pnpm install --no-frozen-lockfile

CI="${CI:-true}" pnpm --filter @webaudit/automation-runner exec playwright install chromium

if command -v pre-commit >/dev/null 2>&1; then
  bash scripts/install-hooks.sh
else
  echo "warning: pre-commit not found in PATH; git hooks not installed. Install it first (e.g. uv tool install pre-commit) and rerun 'pnpm hooks:install'." >&2
fi

echo "setup complete"
