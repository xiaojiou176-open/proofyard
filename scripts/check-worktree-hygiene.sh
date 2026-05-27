#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

failures=0

fail() {
  echo "[hygiene] FAIL: $1" >&2
  failures=$((failures + 1))
}

pass() {
  echo "[hygiene] PASS: $1"
}

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[hygiene] Not a git repository: $ROOT_DIR" >&2
  exit 2
fi

if ! node scripts/ci/check-root-governance.mjs >/tmp/uiq-root-governance.out 2>/tmp/uiq-root-governance.err; then
  fail "root governance contract failed"
  cat /tmp/uiq-root-governance.out /tmp/uiq-root-governance.err >&2 || true
fi

if ! node scripts/ci/check-root-semantic-cleanliness.mjs >/tmp/uiq-root-semantic.out 2>/tmp/uiq-root-semantic.err; then
  fail "root semantic cleanliness contract failed"
  cat /tmp/uiq-root-semantic.out /tmp/uiq-root-semantic.err >&2 || true
fi

if ! node scripts/ci/check-source-tree-runtime-residue.mjs >/tmp/uiq-source-tree-residue.out 2>/tmp/uiq-source-tree-residue.err; then
  fail "source tree runtime residue contract failed"
  cat /tmp/uiq-source-tree-residue.out /tmp/uiq-source-tree-residue.err >&2 || true
fi

if ! node scripts/ci/check-runtime-governance.mjs >/tmp/uiq-runtime-governance.out 2>/tmp/uiq-runtime-governance.err; then
  fail "runtime governance contract failed"
  cat /tmp/uiq-runtime-governance.out /tmp/uiq-runtime-governance.err >&2 || true
fi

root_noise_paths=(
  ".coverage"
  ".coverage.*"
  ".hypothesis"
  ".pnpm-store"
  ".pytest_cache"
  ".ruff_cache"
  "coverage"
  "mutants"
  "test-results"
  "playwright-report"
  "tmp"
  "artifacts"
)

for noise in "${root_noise_paths[@]}"; do
  if [[ "$noise" == *"*"* ]]; then
    matches=()
    while IFS= read -r match; do
      matches+=("$match")
    done < <(compgen -G "$noise" || true)
    if (( ${#matches[@]} > 0 )); then
      for match in "${matches[@]}"; do
        fail "root noise detected: $match"
      done
    fi
  elif [[ -e "$noise" ]]; then
    fail "root noise detected: $noise"
  fi
done

if git diff --name-only --diff-filter=U | grep -q '.'; then
  fail "unmerged conflict entries exist"
fi

conflict_markers="$(git grep -nE '^(<<<<<<< |>>>>>>> )' -- . || true)"
if [[ -n "$conflict_markers" ]]; then
  fail "conflict markers found in tracked files"
  echo "$conflict_markers" >&2
fi

if (( failures > 0 )); then
  echo "[hygiene] FAILED with ${failures} issue(s)." >&2
  exit 1
fi

pass "no root noise, ignore policy is complete, and no conflict residue found"
