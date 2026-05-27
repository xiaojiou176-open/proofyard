#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

fail() {
  echo "[host-safety] $1" >&2
  exit 1
}

assert_contains() {
  local file="$1"
  local needle="$2"
  grep -Fq "$needle" "$file" || fail "missing '${needle}' in ${file}"
}

assert_no_matches_outside_allowlist() {
  local pattern="$1"
  shift
  local allowlist=("$@")
  local result
  result="$(rg -n "$pattern" packages/orchestrator/src/commands README.md docs .github scripts apps -g '!node_modules' -g '!scripts/ci/host-safety-gate.sh' || true)"
  if [[ -z "$result" ]]; then
    return 0
  fi

  local line
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    local path="${line%%:*}"
    local allowed=false
    local item
    for item in "${allowlist[@]}"; do
      if [[ "$path" == "$item" ]]; then
        allowed=true
        break
      fi
    done
    if [[ "$allowed" == false ]]; then
      fail "forbidden host primitive outside allowlist: ${line}"
    fi
  done <<< "$result"
}

README_FILE="README.md"
CLI_FILE="packages/orchestrator/src/cli.ts"
DESKTOP_SMOKE_WORKFLOW=".github/workflows/desktop-smoke.yml"
WEEKLY_WORKFLOW=".github/workflows/manual.yml"
NIGHTLY_WORKFLOW=".github/workflows/nightly.yml"

assert_contains "$README_FILE" "desktop smoke / e2e / business / soak are now operator-manual lanes"
assert_contains "$README_FILE" 'UIQ_DESKTOP_AUTOMATION_MODE=operator-manual'
assert_contains "$README_FILE" 'UIQ_DESKTOP_AUTOMATION_REASON=<auditable reason>'

assert_contains "$CLI_FILE" "UIQ_DESKTOP_AUTOMATION_MODE"
assert_contains "$CLI_FILE" "UIQ_DESKTOP_AUTOMATION_REASON"
assert_contains "$CLI_FILE" "operator-manual"

assert_contains "$DESKTOP_SMOKE_WORKFLOW" "environment: owner-approved-sensitive"
assert_contains "$DESKTOP_SMOKE_WORKFLOW" "UIQ_DESKTOP_AUTOMATION_MODE: operator-manual"
assert_contains "$DESKTOP_SMOKE_WORKFLOW" "UIQ_DESKTOP_AUTOMATION_REASON:"

assert_contains "$WEEKLY_WORKFLOW" "environment: owner-approved-sensitive"
assert_contains "$WEEKLY_WORKFLOW" "UIQ_DESKTOP_AUTOMATION_MODE: operator-manual"
assert_contains "$WEEKLY_WORKFLOW" "UIQ_DESKTOP_AUTOMATION_REASON:"

assert_contains "$NIGHTLY_WORKFLOW" "environment: owner-approved-sensitive"
assert_contains "$NIGHTLY_WORKFLOW" "UIQ_DESKTOP_AUTOMATION_MODE: operator-manual"
assert_contains "$NIGHTLY_WORKFLOW" "UIQ_DESKTOP_AUTOMATION_REASON:"

assert_no_matches_outside_allowlist \
  'killall' \
  "packages/orchestrator/src/commands/desktop-lifecycle.ts" \
  "packages/orchestrator/src/commands/desktop-e2e.ts" \
  "packages/orchestrator/src/commands/desktop-soak.ts"

assert_no_matches_outside_allowlist \
  'System Events' \
  "packages/orchestrator/src/commands/desktop-business.ts" \
  "packages/orchestrator/src/commands/desktop-e2e.ts" \
  "packages/orchestrator/src/commands/desktop-utils.ts"

assert_no_matches_outside_allowlist \
  'osascript' \
  "packages/orchestrator/src/commands/desktop-lifecycle.ts" \
  "packages/orchestrator/src/commands/desktop-business.ts" \
  "packages/orchestrator/src/commands/desktop-e2e.ts" \
  "packages/orchestrator/src/commands/desktop-soak.ts" \
  "packages/orchestrator/src/commands/desktop-utils.ts" \
  "packages/orchestrator/src/commands/desktop.ts"

if rg -n 'killpg\s*\(|\b(pkill -f|kill -9 -)\b' packages/orchestrator/src scripts apps README.md docs .github -g '!node_modules' -g '!scripts/ci/host-safety-gate.sh' >/dev/null; then
  fail "found forbidden broad or forceful host-process termination primitive"
fi

echo "[host-safety] ok"
