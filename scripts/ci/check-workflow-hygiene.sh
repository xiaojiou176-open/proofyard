#!/usr/bin/env bash
set -euo pipefail

readonly workflow_files=(
  ".github/workflows/ci.yml"
  ".github/workflows/pre-commit.yml"
)

readonly helper_workflow_files=(
  ".github/workflows/nightly.yml"
  ".github/workflows/manual.yml"
  ".github/workflows/release-candidate.yml"
  ".github/workflows/upstream-drift-audit.yml"
  ".github/workflows/runtime-gc.yml"
  ".github/workflows/desktop-smoke.yml"
)

readonly action_files=(
  ".github/actions/setup-python-uv/action.yml"
  ".github/actions/setup-playwright/action.yml"
  ".github/actions/workspace-sanitize/action.yml"
)

search_fixed_string() {
  local pattern="$1"
  shift
  if command -v rg >/dev/null 2>&1; then
    rg -n --fixed-strings "$pattern" "$@"
    return $?
  fi
  grep -RInF -- "$pattern" "$@"
}

check_absent() {
  local pattern="$1"
  shift
  if search_fixed_string "$pattern" "$@" >/dev/null; then
    echo "::error::forbidden workflow hygiene pattern found: $pattern"
    search_fixed_string "$pattern" "$@" || true
    exit 1
  fi
}

check_present() {
  local pattern="$1"
  shift
  if ! search_fixed_string "$pattern" "$@" >/dev/null; then
    echo "::error::required workflow hygiene pattern missing: $pattern"
    exit 1
  fi
}

check_absent "clean: false" "${workflow_files[@]}"
check_absent "\${{ github.workspace }}/.runtime-cache/toolcache" "${workflow_files[@]}"
check_absent "\${GITHUB_WORKSPACE}/.runtime-cache/uv" "${action_files[@]}"
check_absent "uses: actions/upload-artifact@v4" "${helper_workflow_files[@]}" ".github/workflows/pre-commit.yml" ".github/workflows/release-candidate.yml" ".github/workflows/upstream-drift-audit.yml"
check_absent "uses: ./.github/actions/self-hosted-checkout" "${helper_workflow_files[@]}" ".github/workflows/pre-commit.yml" ".github/workflows/release-candidate.yml"
check_absent '["self-hosted","shared-pool"]' ".github/workflows/pr.yml" ".github/workflows/ci.yml" ".github/workflows/manual.yml"
check_absent "  schedule:" ".github/workflows/nightly.yml" ".github/workflows/manual.yml" ".github/workflows/upstream-drift-audit.yml" ".github/workflows/desktop-smoke.yml"

check_present "uses: ./.github/actions/workspace-sanitize" "${workflow_files[@]}"
check_present "uses: ./.github/actions/repo-checkout" "${helper_workflow_files[@]}" ".github/workflows/pre-commit.yml" ".github/workflows/release-candidate.yml"
check_present "environment: owner-approved-sensitive" ".github/workflows/upstream-drift-audit.yml" ".github/workflows/desktop-smoke.yml" ".github/workflows/nightly.yml" ".github/workflows/manual.yml" ".github/workflows/pr.yml" ".github/workflows/ci.yml"
check_present "\${{ runner.temp }}/ms-playwright" ".github/actions/setup-playwright/action.yml"
check_present "runner_temp=\"\${RUNNER_TEMP:?RUNNER_TEMP is required}\"" ".github/actions/workspace-sanitize/action.yml"

echo "workflow hygiene checks passed"
