#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

export PYTHONDONTWRITEBYTECODE="${PYTHONDONTWRITEBYTECODE:-1}"

METRICS_DIR=".runtime-cache/artifacts/ci"
METRICS_FILE="${METRICS_DIR}/precommit-required-gates-metrics.json"
METRICS_HISTORY_FILE="${METRICS_DIR}/precommit-required-gates-metrics-history.jsonl"
PRECOMMIT_MODE="unknown"
CURRENT_STEP="bootstrap"
RUN_START_MS=""

now_ms() {
  python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
}

emit_metrics_on_exit() {
  local exit_code="$1"
  local run_end_ms duration_ms status failed_step timestamp
  run_end_ms="$(now_ms)"
  if [[ -z "${RUN_START_MS}" ]]; then
    RUN_START_MS="$run_end_ms"
  fi
  duration_ms="$((run_end_ms - RUN_START_MS))"
  status="passed"
  failed_step=""
  run_mode="apply"
  if [[ "$DRY_RUN" == "true" ]]; then
    status="simulated"
    run_mode="dry-run"
  fi
  if [[ "$exit_code" -ne 0 ]]; then
    status="failed"
    failed_step="$CURRENT_STEP"
  fi
  timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  mkdir -p "$METRICS_DIR"
python3 - "$METRICS_FILE" "$METRICS_HISTORY_FILE" "$PRECOMMIT_MODE" "$status" "$failed_step" "$duration_ms" "$timestamp" "$exit_code" "$run_mode" <<'PY'
import json
import os
import sys

metrics_file, history_file, mode, status, failed_step, duration_ms, timestamp, exit_code, run_mode = sys.argv[1:]
record = {
    "mode": mode,
    "run_mode": run_mode,
    "status": status,
    "failed_step": failed_step or None,
    "duration_ms": int(duration_ms),
    "timestamp": timestamp,
    "exit_code": int(exit_code),
}
with open(metrics_file, "w", encoding="utf-8") as f:
    json.dump(record, f, ensure_ascii=True, indent=2)
    f.write("\n")
with open(history_file, "a", encoding="utf-8") as f:
    f.write(json.dumps(record, ensure_ascii=True) + "\n")
PY
}

RUN_START_MS="$(now_ms)"
trap 'exit_code=$?; emit_metrics_on_exit "$exit_code"; exit "$exit_code"' EXIT

DRY_RUN=false
CONTAINER_TASKS="${UIQ_CONTAINER_GATE_ENFORCED_TASKS:-contract,lint,coverage,mutation-ts,mutation-py,frontend-authenticity,frontend-nonstub,frontend-critical}"
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi
HOOK_FILES=()
if (($# > 0)); then
  HOOK_FILES=("$@")
fi

is_all_files_audit_context() {
  if ((${#HOOK_FILES[@]} == 0)); then
    return 1
  fi
  local staged_text
  staged_text="$(git diff --cached --name-only --diff-filter=ACDMRTUXB)"
  local -a staged_files=()
  if [[ -n "$staged_text" ]]; then
    mapfile -t staged_files <<< "$staged_text"
  fi
  if ((${#staged_files[@]} == 0)); then
    return 0
  fi
  declare -A staged_map=()
  local staged
  for staged in "${staged_files[@]}"; do
    [[ -n "$staged" ]] && staged_map["$staged"]=1
  done
  local file
  for file in "${HOOK_FILES[@]}"; do
    [[ -z "$file" ]] && continue
    if [[ -z "${staged_map["$file"]+x}" ]]; then
      return 0
    fi
  done
  if ((${#HOOK_FILES[@]} != ${#staged_files[@]})); then
    return 0
  fi
  return 1
}

run_step() {
  local label="$1"
  shift
  CURRENT_STEP="$label"
  echo "[pre-commit-required] ${label}"
  if [[ "$DRY_RUN" == "true" ]]; then
    printf '[dry-run] %q ' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

has_container_task() {
  local wanted="$1"
  local padded=",${CONTAINER_TASKS// /},"
  [[ "$padded" == *",$wanted,"* ]]
}

resolve_bool_flag() {
  local name="$1"
  local default_value="$2"
  local raw_value="${!name-}"
  if [[ -z "$raw_value" ]]; then
    echo "$default_value"
    return
  fi
  if [[ "$raw_value" != "true" && "$raw_value" != "false" ]]; then
    echo "[pre-commit-required] invalid ${name}=${raw_value}; expected true|false" >&2
    exit 2
  fi
  echo "$raw_value"
}

run_gate_with_container_toggle() {
  local task="$1"
  local label="$2"
  shift 2
  if has_container_task "$task"; then
    run_step "${label}-container" bash scripts/ci/run-in-container.sh --task "$task" --gate pre-commit-required
    return
  fi
  run_step "${label}-host" "$@"
}

run_lint_gate_with_container_fallback() {
  local log_file
  log_file="$(mktemp "${TMPDIR:-/tmp}/proofyard-precommit-lint.XXXXXX")"
  trap 'rm -f "$log_file"' RETURN

  echo "[pre-commit-required] lint-all-container"
  if [[ "$DRY_RUN" == "true" ]]; then
    printf '[dry-run] %q ' bash scripts/ci/run-in-container.sh --task lint --gate pre-commit-required
    printf '\n'
    return 0
  fi

  set +e
  bash scripts/ci/run-in-container.sh --task lint --gate pre-commit-required >"$log_file" 2>&1
  local rc=$?
  set -e
  cat "$log_file"
  if [[ $rc -eq 0 ]]; then
    return 0
  fi

  echo "[pre-commit-required] lint-all-container failed; falling back to host lint-all.sh for local pre-commit parity"
  run_step "lint-all-host-fallback" bash scripts/ci/lint-all.sh
  return 0
}

PRECOMMIT_MODE="${UIQ_PRECOMMIT_REQUIRED_MODE-}"
if [[ -z "$PRECOMMIT_MODE" ]]; then
  PRECOMMIT_MODE="strict"
fi
if [[ "$PRECOMMIT_MODE" != "strict" ]]; then
  echo "[pre-commit-required] invalid UIQ_PRECOMMIT_REQUIRED_MODE=${PRECOMMIT_MODE}; expected strict" >&2
  exit 2
fi

DEFAULT_REPO_WIDE_FLAG="false"
DEFAULT_ENV_DOCS_FLAG="false"
DEFAULT_HEAVY_FLAG="false"

RUN_REPO_WIDE_GATES="$(resolve_bool_flag UIQ_PRECOMMIT_REQUIRED_REPO_WIDE_GATES "$DEFAULT_REPO_WIDE_FLAG")"
RUN_ENV_DOCS_GATES="$(resolve_bool_flag UIQ_PRECOMMIT_REQUIRED_ENV_DOCS_GATES "$DEFAULT_ENV_DOCS_FLAG")"
RUN_HEAVY_GATES="$(resolve_bool_flag UIQ_PRECOMMIT_REQUIRED_HEAVY_GATES "$DEFAULT_HEAVY_FLAG")"
COVERAGE_BRANCH_ENFORCE="$(resolve_bool_flag UIQ_PRECOMMIT_REQUIRED_ENFORCE_GLOBAL_BRANCHES "true")"

echo "[pre-commit-required] mode=${PRECOMMIT_MODE} repo_wide=${RUN_REPO_WIDE_GATES} env_docs=${RUN_ENV_DOCS_GATES} heavy=${RUN_HEAVY_GATES} coverage_branches=${COVERAGE_BRANCH_ENFORCE}"

# Stabilize branch coverage signal across local environments (avoid xdist variability).
export UIQ_COVERAGE_PYTEST_N="${UIQ_COVERAGE_PYTEST_N:-1}"

run_step "env:generate" pnpm env:generate
run_step "env:check" pnpm env:check
run_step "env:alias:check" pnpm env:alias:check
run_step "repo-sensitive-surface" pnpm repo:sensitive:check
run_step "source-tree-runtime-residue" node scripts/ci/check-source-tree-runtime-residue.mjs
run_step "repo-high-signal-pii" pnpm repo:pii:check
run_step "tracked-heavy-artifacts" pnpm public:artifacts:check
ATOMIC_DRY_RUN="${UIQ_PRECOMMIT_REQUIRED_ATOMIC_DRY_RUN:-false}"
if [[ "$ATOMIC_DRY_RUN" != "true" && "$ATOMIC_DRY_RUN" != "false" ]]; then
  echo "[pre-commit-required] invalid UIQ_PRECOMMIT_REQUIRED_ATOMIC_DRY_RUN=${ATOMIC_DRY_RUN}; expected true|false" >&2
  exit 2
fi
if [[ "$ATOMIC_DRY_RUN" == "true" ]]; then
  echo "[pre-commit-required] atomic gate override: dry-run (UIQ_PRECOMMIT_REQUIRED_ATOMIC_DRY_RUN=true)"
  run_step "atomic-commit-gate(staged,dry-run)" bash scripts/ci/atomic-commit-gate.sh --dry-run
elif is_all_files_audit_context; then
  echo "[pre-commit-required] context=all-files-audit (staged-only atomic gate runs in dry-run mode)"
  run_step "atomic-commit-gate(staged,dry-run)" bash scripts/ci/atomic-commit-gate.sh --dry-run
else
  run_step "atomic-commit-gate(staged)" bash scripts/ci/atomic-commit-gate.sh
fi
if [[ "$RUN_REPO_WIDE_GATES" == "true" || "$RUN_HEAVY_GATES" == "true" ]]; then
  run_step "container-contract-gate" bash scripts/ci/run-in-container.sh --task contract --gate pre-commit-required
  run_lint_gate_with_container_fallback
else
  echo "[pre-commit-required] repo-wide lint/container delegated to pre-push/CI (set UIQ_PRECOMMIT_REQUIRED_REPO_WIDE_GATES=true to enable)"
fi
run_step "test-truth-gate(js-ts)" node scripts/ci/uiq-test-truth-gate.mjs --profile pre-commit-required --scope staged --strict true --write-artifacts false
run_step "test-truth-gate(python)" python3 scripts/ci/uiq-pytest-truth-gate.py --profile pre-commit-required --strict true
PREV_COVERAGE_ENFORCE="${UIQ_COVERAGE_ENFORCE_GLOBAL_BRANCHES-}"
HAD_PREV_COVERAGE_ENFORCE="${UIQ_COVERAGE_ENFORCE_GLOBAL_BRANCHES+x}"
if [[ "$RUN_HEAVY_GATES" == "true" ]]; then
  run_step "e2e-authenticity-gate" node scripts/ci/e2e-authenticity-gate.mjs
  run_step "observability-contract" bash scripts/ci/check-observability-contract.sh
  run_step "coverage-threshold-gate-regression" pnpm test:coverage:threshold-gate
  echo "[pre-commit-required] coverage global-branches enforcement=${COVERAGE_BRANCH_ENFORCE} (strict default=true; set UIQ_PRECOMMIT_REQUIRED_ENFORCE_GLOBAL_BRANCHES=false to downgrade)"
  export UIQ_COVERAGE_ENFORCE_GLOBAL_BRANCHES="${COVERAGE_BRANCH_ENFORCE}"
  run_gate_with_container_toggle "coverage" "coverage-gate" bash scripts/ci/run-unit-coverage-gate.sh
  run_step "mutation-ts-strict" bash scripts/ci/run-in-container.sh --task mutation-ts --gate pre-commit-required
  run_step "mutation-py-strict" bash scripts/ci/run-in-container.sh --task mutation-py --gate pre-commit-required
  run_step "mutation-effective" env \
    UIQ_MUTATION_REQUIRED_CONTEXT=true \
    UIQ_MUTATION_PY_MAX_SURVIVED="${UIQ_MUTATION_PY_MAX_SURVIVED:-0}" \
    UIQ_MUTATION_TS_MIN_TOTAL="${UIQ_MUTATION_TS_MIN_TOTAL:-50}" \
    UIQ_MUTATION_PY_MIN_TOTAL="${UIQ_MUTATION_PY_MIN_TOTAL:-249}" \
    pnpm mutation:effective
  run_step "docs-gate" bash scripts/docs-gate.sh
  run_step "governance-control-plane-check" pnpm governance:control-plane:check
  run_step "security-scan" bash scripts/security-scan.sh
  run_step "preflight(minimal)" bash scripts/preflight.sh minimal
  echo "[pre-commit-required] Gemini live smoke is maintainer-only and intentionally excluded from deterministic pre-commit gates"
else
  if [[ "$RUN_ENV_DOCS_GATES" == "true" ]]; then
    run_step "docs-gate" bash scripts/docs-gate.sh
    run_step "governance-control-plane-check" pnpm governance:control-plane:check
  else
    echo "[pre-commit-required] docs/governance gates delegated to pre-push/CI (set UIQ_PRECOMMIT_REQUIRED_ENV_DOCS_GATES=true to enable)"
  fi
  echo "[pre-commit-required] heavy gates delegated to pre-push/CI (set UIQ_PRECOMMIT_REQUIRED_HEAVY_GATES=true to enable)"
fi
if [[ "${HAD_PREV_COVERAGE_ENFORCE}" == "x" ]]; then
  export UIQ_COVERAGE_ENFORCE_GLOBAL_BRANCHES="${PREV_COVERAGE_ENFORCE}"
else
  unset UIQ_COVERAGE_ENFORCE_GLOBAL_BRANCHES
fi

echo "pre-commit required gates passed"
