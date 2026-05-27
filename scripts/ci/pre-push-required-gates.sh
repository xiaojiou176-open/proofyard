#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

export PYTHONDONTWRITEBYTECODE="${PYTHONDONTWRITEBYTECODE:-1}"

METRICS_DIR=".runtime-cache/artifacts/ci"
METRICS_FILE="${METRICS_DIR}/prepush-required-gates-metrics.json"
METRICS_HISTORY_FILE="${METRICS_DIR}/prepush-required-gates-metrics-history.jsonl"
CURRENT_STEP="bootstrap"
RUN_START_MS=""

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

MODE="${UIQ_PREPUSH_REQUIRED_MODE:-strict}"
if [[ "$MODE" != "strict" && "$MODE" != "balanced" ]]; then
  echo "[pre-push-required] invalid UIQ_PREPUSH_REQUIRED_MODE=${MODE}; expected strict|balanced" >&2
  exit 2
fi

if [[ "${CI:-}" == "true" && "$MODE" == "balanced" && "${UIQ_PREPUSH_ALLOW_BALANCED_IN_CI:-false}" != "true" ]]; then
  echo "[pre-push-required] CI requires strict mode; refusing balanced mode (set UIQ_PREPUSH_ALLOW_BALANCED_IN_CI=true only for dry-run policy audit)" >&2
  exit 2
fi

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
python3 - "$METRICS_FILE" "$METRICS_HISTORY_FILE" "$MODE" "$status" "$failed_step" "$duration_ms" "$timestamp" "$exit_code" "$run_mode" <<'PY'
import json
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

run_step() {
  local label="$1"
  shift
  CURRENT_STEP="$label"
  echo "[pre-push-required] ${label}"
  if [[ "$DRY_RUN" == "true" ]]; then
    if [[ $# -gt 0 ]] && declare -F -- "$1" >/dev/null 2>&1; then
      "$@"
      return 0
    fi
    printf '[dry-run] %q ' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

should_run_nonstub_e2e="${UIQ_PREPUSH_RUN_LOCAL_NONSTUB_E2E:-true}"
if [[ "$should_run_nonstub_e2e" != "true" && "$should_run_nonstub_e2e" != "false" ]]; then
  echo "[pre-push-required] invalid UIQ_PREPUSH_RUN_LOCAL_NONSTUB_E2E=${should_run_nonstub_e2e}; expected true|false" >&2
  exit 2
fi

run_heavy_gates="${UIQ_PREPUSH_RUN_HEAVY_GATES:-true}"
if [[ "$run_heavy_gates" != "true" && "$run_heavy_gates" != "false" ]]; then
  echo "[pre-push-required] invalid UIQ_PREPUSH_RUN_HEAVY_GATES=${run_heavy_gates}; expected true|false" >&2
  exit 2
fi

test_truth_scope="${UIQ_PREPUSH_TEST_TRUTH_SCOPE:-staged}"
if [[ "$test_truth_scope" != "staged" && "$test_truth_scope" != "all" && "$test_truth_scope" != "staged-or-changed" ]]; then
  echo "[pre-push-required] invalid UIQ_PREPUSH_TEST_TRUTH_SCOPE=${test_truth_scope}; expected staged|all|staged-or-changed" >&2
  exit 2
fi

run_local_nonstub_e2e() {
  local e2e_stub_nonstub_max_ratio="${UIQ_PREPUSH_E2E_STUB_NONSTUB_MAX_RATIO:-4}"
  local e2e_counterfactual_required_dirs="${UIQ_PREPUSH_E2E_COUNTERFACTUAL_REQUIRED_DIRS:-apps/web/tests/e2e}"
  local e2e_counterfactual_required_tag="${UIQ_PREPUSH_E2E_COUNTERFACTUAL_REQUIRED_TAG:-@counterfactual}"
  local e2e_counterfactual_min_files="${UIQ_PREPUSH_E2E_COUNTERFACTUAL_MIN_FILES_PER_DIR:-1}"

  if [[ "$DRY_RUN" == "true" ]]; then
    printf '[dry-run] CI=true bash scripts/ci/run-in-container.sh --task frontend-authenticity --gate %q\n' 'nonstub-e2e(local-backend,strict)'
    printf '[dry-run] CI=true E2E_STUB_NONSTUB_MAX_RATIO=%q E2E_COUNTERFACTUAL_REQUIRED_DIRS=%q E2E_COUNTERFACTUAL_REQUIRED_TAG=%q E2E_COUNTERFACTUAL_MIN_FILES_PER_DIR=%q bash scripts/ci/run-in-container.sh --task frontend-nonstub --gate %q\n' \
      "$e2e_stub_nonstub_max_ratio" "$e2e_counterfactual_required_dirs" "$e2e_counterfactual_required_tag" "$e2e_counterfactual_min_files" 'nonstub-e2e(local-backend,strict)'
    printf '[dry-run] CI=true bash scripts/ci/run-in-container.sh --task frontend-critical --gate %q\n' 'nonstub-e2e(local-backend,strict)'
    return 0
  fi

  set +e
  CI=true \
    bash scripts/ci/run-in-container.sh --task frontend-authenticity --gate 'nonstub-e2e(local-backend,strict)'
  local frontend_authenticity_status=$?
  CI=true \
  E2E_STUB_NONSTUB_MAX_RATIO="$e2e_stub_nonstub_max_ratio" \
  E2E_COUNTERFACTUAL_REQUIRED_DIRS="$e2e_counterfactual_required_dirs" \
  E2E_COUNTERFACTUAL_REQUIRED_TAG="$e2e_counterfactual_required_tag" \
  E2E_COUNTERFACTUAL_MIN_FILES_PER_DIR="$e2e_counterfactual_min_files" \
    bash scripts/ci/run-in-container.sh --task frontend-nonstub --gate 'nonstub-e2e(local-backend,strict)'
  local frontend_status=$?
  CI=true \
    bash scripts/ci/run-in-container.sh --task frontend-critical --gate 'nonstub-e2e(local-backend,strict)'
  local frontend_critical_status=$?
  set -e

  if [[ $frontend_authenticity_status -ne 0 || $frontend_status -ne 0 || $frontend_critical_status -ne 0 ]]; then
    return 1
  fi
}

echo "[pre-push-required] mode=${MODE} heavy_gates=${run_heavy_gates} nonstub_e2e=${should_run_nonstub_e2e} test_truth_scope=${test_truth_scope}"
if [[ "$MODE" == "balanced" ]]; then
  echo "[pre-push-required] delegation_summary=ci_required(functional_regression_gate,strict_invariants_gate,security)"
fi

run_step "repo-sensitive-surface" pnpm repo:sensitive:check
run_step "repo-sensitive-history" pnpm repo:sensitive:history:check
run_step "source-tree-runtime-residue" node scripts/ci/check-source-tree-runtime-residue.mjs
run_step "repo-high-signal-pii" pnpm repo:pii:check
run_step "tracked-heavy-artifacts" pnpm public:artifacts:check

# Tier 1:
# - strict mode keeps high local assurance;
# - balanced mode is intentionally lightweight (delegate most gates to CI).
if [[ "$MODE" == "strict" ]]; then
  run_step "env:generate" pnpm env:generate
  run_step "env:check" pnpm env:check
  run_step "env:alias:check" pnpm env:alias:check
  run_step "openai-residue-gate" bash scripts/ci/gate-openai-residue.sh
  run_step "hooks-equivalence-gate" bash scripts/ci/hooks-equivalence-gate.sh
  run_step "docs-gate" bash scripts/docs-gate.sh
  run_step "governance-control-plane-check" pnpm governance:control-plane:check
else
  run_step "openai-residue-gate" bash scripts/ci/gate-openai-residue.sh
  echo "[pre-push-required] balanced mode: env/docs/hooks-equivalence delegated to CI"
fi

run_step "test-truth-gate(js-ts)" node scripts/ci/uiq-test-truth-gate.mjs \
  --profile pre-push-required \
  --scope "$test_truth_scope" \
  --strict true \
  --write-artifacts false
run_step "test-truth-gate(python)" python3 scripts/ci/uiq-pytest-truth-gate.py \
  --profile pre-push-required \
  --strict true

# Tier 2 (optional heavy): delegated to CI by default for faster local push loop.
if [[ "$run_heavy_gates" == "true" ]]; then
  run_step "security-scan" bash scripts/security-scan.sh
  run_step "preflight(minimal)" bash scripts/preflight.sh minimal
  run_step "mutation-ts-strict" bash scripts/ci/run-in-container.sh --task mutation-ts --gate mutation-ts-strict
  run_step "mutation-py-strict" bash scripts/ci/run-in-container.sh --task mutation-py --gate mutation-py-strict
  run_step "mutation-effective" env \
    UIQ_MUTATION_REQUIRED_CONTEXT=true \
    UIQ_MUTATION_PY_MAX_SURVIVED="${UIQ_MUTATION_PY_MAX_SURVIVED:-0}" \
    UIQ_MUTATION_TS_MIN_TOTAL="${UIQ_MUTATION_TS_MIN_TOTAL:-50}" \
    UIQ_MUTATION_PY_MIN_TOTAL="${UIQ_MUTATION_PY_MIN_TOTAL:-249}" \
    pnpm mutation:effective
else
  echo "[pre-push-required] heavy gates disabled explicitly (set UIQ_PREPUSH_RUN_HEAVY_GATES=true to restore CI parity)"
fi

# Tier 3 (strict-only local nonstub replay): optional local parity with CI-required E2E.
if [[ "$MODE" == "strict" && "$should_run_nonstub_e2e" == "true" && "$run_heavy_gates" == "true" ]]; then
  run_step "nonstub-e2e(local-backend,strict)" run_local_nonstub_e2e
else
  echo "[pre-push-required] skip local nonstub e2e (mode=${MODE}, heavy=${run_heavy_gates}, flag=${should_run_nonstub_e2e})"
fi

echo "[pre-push-required] passed"
