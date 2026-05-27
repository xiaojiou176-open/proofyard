#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
source "$ROOT_DIR/scripts/lib/python-runtime.sh"
ensure_project_python_env_exports
PROJECT_PYTEST_BIN="$(project_python_bin) -m pytest"
PROJECT_MANAGED_PYTEST_CMD="PROJECT_PYTHON_ENV=\"$PROJECT_PYTHON_ENV\" UV_PROJECT_ENVIRONMENT=\"$UV_PROJECT_ENVIRONMENT\" uv run --frozen --extra dev pytest"

read_bool() {
  local raw="${1:-}"
  local fallback="${2:-1}"
  case "$raw" in
    1|true|TRUE|yes|YES|on|ON) echo "1" ;;
    0|false|FALSE|no|NO|off|OFF) echo "0" ;;
    "") echo "$fallback" ;;
    *) echo "$fallback" ;;
  esac
}

read_positive_int() {
  local raw="${1:-}"
  local fallback="${2:-1}"
  if [[ "$raw" =~ ^[0-9]+$ ]] && [[ "$raw" -gt 0 ]]; then
    echo "$raw"
    return
  fi
  echo "$fallback"
}

read_positive_number() {
  local raw="${1:-}"
  local fallback="${2:-1}"
  if awk -v v="$raw" 'BEGIN { exit !(v ~ /^([0-9]+([.][0-9]+)?|[.][0-9]+)$/ && (v + 0) > 0) }'; then
    echo "$raw"
    return
  fi
  echo "$fallback"
}

min_int() {
  local a="$1"
  local b="$2"
  if [[ "$a" -le "$b" ]]; then
    echo "$a"
  else
    echo "$b"
  fi
}

detect_cpu_count() {
  local n
  n="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"
  if ! [[ "$n" =~ ^[0-9]+$ ]] || [[ "$n" -lt 1 ]]; then
    n=4
  fi
  echo "$n"
}

MODE="${1:-${UIQ_TEST_MODE:-parallel}}"
if [[ "$MODE" != "parallel" && "$MODE" != "serial" ]]; then
  echo "usage: ./scripts/test-matrix.sh [parallel|serial]"
  echo "or set UIQ_TEST_MODE=parallel|serial"
  exit 1
fi

RUN_WEB_E2E="$(read_bool "${UIQ_SUITE_WEB_E2E:-}" 1)"
RUN_FRONTEND_E2E="$(read_bool "${UIQ_SUITE_FRONTEND_E2E:-}" 1)"
RUN_FRONTEND_UNIT="$(read_bool "${UIQ_SUITE_FRONTEND_UNIT:-}" 1)"
RUN_BACKEND="$(read_bool "${UIQ_SUITE_BACKEND:-}" 1)"
RUN_INTEGRATION="$(read_bool "${UIQ_SUITE_INTEGRATION:-}" 1)"
INTEGRATION_PROFILE_RAW="${UIQ_INTEGRATION_PROFILE:-full}"
INTEGRATION_PROFILE="$(echo "$INTEGRATION_PROFILE_RAW" | tr '[:upper:]' '[:lower:]')"
if [[ "$INTEGRATION_PROFILE" != "smoke" && "$INTEGRATION_PROFILE" != "full" ]]; then
  echo "error: UIQ_INTEGRATION_PROFILE must be smoke or full (received: $INTEGRATION_PROFILE_RAW)"
  exit 1
fi
RUN_AUTOMATION_CHECK="$(read_bool "${UIQ_SUITE_AUTOMATION_CHECK:-}" 1)"
RUN_ORCHESTRATOR_MCP="$(read_bool "${UIQ_SUITE_ORCHESTRATOR_MCP:-}" 1)"
RUN_TEST_TRUTH_GATE="$(read_bool "${UIQ_TEST_MATRIX_RUN_TEST_TRUTH_GATE:-}" 1)"
RUN_E2E_AUTHENTICITY_GATE="$(read_bool "${UIQ_TEST_MATRIX_RUN_E2E_AUTHENTICITY_GATE:-}" 1)"
EXPECT_FULL_CONTRACT="$(read_bool "${UIQ_TEST_MATRIX_EXPECT_FULL_CONTRACT:-}" 1)"
AUTOMATION_INSTALL_DEPS="$(read_bool "${UIQ_AUTOMATION_INSTALL_DEPS:-}" 0)"
ALLOW_CMD_OVERRIDE="$(read_bool "${UIQ_TEST_MATRIX_ALLOW_CMD_OVERRIDE:-}" 0)"
ALLOW_UNSAFE_OVERRIDE="$(read_bool "${UIQ_TEST_MATRIX_ALLOW_UNSAFE_OVERRIDE:-}" 0)"

if [[ "$RUN_WEB_E2E" != "1" && "$RUN_FRONTEND_E2E" != "1" && "$RUN_FRONTEND_UNIT" != "1" && "$RUN_BACKEND" != "1" && "$RUN_INTEGRATION" != "1" && "$RUN_AUTOMATION_CHECK" != "1" && "$RUN_ORCHESTRATOR_MCP" != "1" ]]; then
  echo "error: no suite selected"
  echo "set one of UIQ_SUITE_WEB_E2E/UIQ_SUITE_FRONTEND_E2E/UIQ_SUITE_FRONTEND_UNIT/UIQ_SUITE_BACKEND/UIQ_SUITE_INTEGRATION/UIQ_SUITE_AUTOMATION_CHECK/UIQ_SUITE_ORCHESTRATOR_MCP=1"
  exit 1
fi

if [[ "$EXPECT_FULL_CONTRACT" == "1" ]]; then
  if [[ "$RUN_WEB_E2E" != "1" || "$RUN_FRONTEND_E2E" != "1" || "$RUN_FRONTEND_UNIT" != "1" || "$RUN_BACKEND" != "1" || "$RUN_INTEGRATION" != "1" || "$RUN_AUTOMATION_CHECK" != "1" || "$RUN_ORCHESTRATOR_MCP" != "1" || "$RUN_TEST_TRUTH_GATE" != "1" || "$RUN_E2E_AUTHENTICITY_GATE" != "1" || "$INTEGRATION_PROFILE" != "full" ]]; then
    echo "error: full contract mode requires all suites + integration(full) + truth gate + authenticity gate"
    exit 1
  fi
fi

UIQ_WEB_PORT="${UIQ_WEB_PORT:-${UIQ_E2E_PORT:-4173}}"
UIQ_FRONTEND_E2E_PORT="${UIQ_FRONTEND_E2E_PORT:-43173}"
if ! [[ "$UIQ_WEB_PORT" =~ ^[0-9]+$ && "$UIQ_FRONTEND_E2E_PORT" =~ ^[0-9]+$ ]]; then
  echo "error: UIQ_WEB_PORT and UIQ_FRONTEND_E2E_PORT must be integers"
  exit 1
fi
if [[ "$RUN_WEB_E2E" == "1" && "$RUN_FRONTEND_E2E" == "1" && "$UIQ_WEB_PORT" == "$UIQ_FRONTEND_E2E_PORT" ]]; then
  echo "error: UIQ_WEB_PORT and UIQ_FRONTEND_E2E_PORT must be different for concurrent e2e"
  exit 1
fi

LOG_BASE="${UIQ_TEST_LOG_DIR:-.runtime-cache/artifacts/ci/test-matrix}"
RUN_ID="${UIQ_TEST_RUN_ID:-$(date +%Y%m%d-%H%M%S)-$$}"
LOG_DIR="$LOG_BASE/$RUN_ID"
mkdir -p "$LOG_DIR"
mkdir -p .runtime-cache/cache/coverage .runtime-cache/cache/hypothesis .runtime-cache/cache/pytest .runtime-cache/temp/pytest
export COVERAGE_FILE="${COVERAGE_FILE:-.runtime-cache/cache/coverage/.coverage.test-matrix}"
export HYPOTHESIS_STORAGE_DIRECTORY="${HYPOTHESIS_STORAGE_DIRECTORY:-.runtime-cache/cache/hypothesis}"
export PYTEST_ADDOPTS="${PYTEST_ADDOPTS:-} -o cache_dir=.runtime-cache/cache/pytest --basetemp=.runtime-cache/temp/pytest"
TRUTH_GATE_LOG="$LOG_DIR/test-truth-gate.log"
E2E_AUTH_GATE_LOG="$LOG_DIR/e2e-authenticity-gate.log"
FAILFAST_TERM_GRACE_SEC="${UIQ_FAILFAST_TERM_GRACE_SEC:-3}"
if ! [[ "$FAILFAST_TERM_GRACE_SEC" =~ ^[0-9]+$ ]]; then
  echo "error: UIQ_FAILFAST_TERM_GRACE_SEC must be an integer"
  exit 1
fi
HEARTBEAT_INTERVAL_SEC="${UIQ_TEST_HEARTBEAT_INTERVAL_SEC:-30}"
if ! [[ "$HEARTBEAT_INTERVAL_SEC" =~ ^[0-9]+$ ]] || [[ "$HEARTBEAT_INTERVAL_SEC" -lt 1 ]]; then
  echo "error: UIQ_TEST_HEARTBEAT_INTERVAL_SEC must be a positive integer"
  exit 1
fi

if [[ "$RUN_TEST_TRUTH_GATE" == "1" ]]; then
  echo "[gate] test-truth-gate (strict)"
  if node scripts/ci/uiq-test-truth-gate.mjs --profile matrix --strict true >"$TRUTH_GATE_LOG" 2>&1; then
    echo "[pass] test-truth-gate (log: $TRUTH_GATE_LOG)"
  else
    echo "[fail] test-truth-gate (log: $TRUTH_GATE_LOG)"
    echo "test-matrix failed; see logs in $LOG_DIR"
    exit 1
  fi
else
  echo "[skip] test-truth-gate (UIQ_TEST_MATRIX_RUN_TEST_TRUTH_GATE=0)"
fi

if [[ "$RUN_E2E_AUTHENTICITY_GATE" == "1" ]]; then
  echo "[gate] e2e-authenticity-gate"
  if node scripts/ci/e2e-authenticity-gate.mjs >"$E2E_AUTH_GATE_LOG" 2>&1; then
    echo "[pass] e2e-authenticity-gate (log: $E2E_AUTH_GATE_LOG)"
  else
    echo "[fail] e2e-authenticity-gate (log: $E2E_AUTH_GATE_LOG)"
    echo "test-matrix failed; see logs in $LOG_DIR"
    exit 1
  fi
else
  echo "[skip] e2e-authenticity-gate (UIQ_TEST_MATRIX_RUN_E2E_AUTHENTICITY_GATE=0)"
fi

PARALLEL_BUDGET_MODE="${UIQ_PARALLEL_BUDGET_MODE:-auto}"
CPU_COUNT="$(detect_cpu_count)"
DEFAULT_GLOBAL_BUDGET="$(( CPU_COUNT > 2 ? CPU_COUNT - 1 : 2 ))"
GLOBAL_BUDGET="$(read_positive_int "${UIQ_GLOBAL_WORKER_BUDGET:-}" "$DEFAULT_GLOBAL_BUDGET")"
SELECTED_SUITE_COUNT=$(( RUN_WEB_E2E + RUN_FRONTEND_E2E + RUN_FRONTEND_UNIT + RUN_BACKEND + RUN_INTEGRATION + RUN_AUTOMATION_CHECK + RUN_ORCHESTRATOR_MCP ))

SUITE_DURATION_FILE="$LOG_DIR/suite-durations.tsv"
echo -e "suite\tduration_sec\tstatus" > "$SUITE_DURATION_FILE"
BUDGET_LOG="$LOG_DIR/parallel-budget.log"
: > "$BUDGET_LOG"

suite_weight_env_name() {
  case "$1" in
    apps-web-e2e) echo "UIQ_SUITE_WEIGHT_APPS_WEB_E2E" ;;
    frontend-e2e) echo "UIQ_SUITE_WEIGHT_FRONTEND_E2E" ;;
    frontend-unit) echo "UIQ_SUITE_WEIGHT_FRONTEND_UNIT" ;;
    backend-pytest) echo "UIQ_SUITE_WEIGHT_BACKEND_PYTEST" ;;
    integration-tests) echo "UIQ_SUITE_WEIGHT_INTEGRATION_TESTS" ;;
    automation-check) echo "UIQ_SUITE_WEIGHT_AUTOMATION_CHECK" ;;
    orchestrator-mcp-gate) echo "UIQ_SUITE_WEIGHT_ORCHESTRATOR_MCP_GATE" ;;
    *) echo "" ;;
  esac
}

suite_default_weight() {
  case "$1" in
    apps-web-e2e|frontend-e2e|backend-pytest) echo "1.5" ;;
    frontend-unit|integration-tests) echo "1.0" ;;
    automation-check|orchestrator-mcp-gate) echo "0.8" ;;
    *) echo "1.0" ;;
  esac
}

suite_worker_cap() {
  case "$1" in
    apps-web-e2e) echo "4" ;;
    frontend-e2e) echo "3" ;;
    frontend-unit) echo "4" ;;
    backend-pytest|integration-tests) echo "4" ;;
    automation-check|orchestrator-mcp-gate) echo "2" ;;
    *) echo "1" ;;
  esac
}

suite_uses_worker_budget() {
  case "$1" in
    apps-web-e2e|frontend-e2e|frontend-unit|backend-pytest|integration-tests) return 0 ;;
    *) return 1 ;;
  esac
}

suite_enabled() {
  case "$1" in
    apps-web-e2e) [[ "$RUN_WEB_E2E" == "1" ]] ;;
    frontend-e2e) [[ "$RUN_FRONTEND_E2E" == "1" ]] ;;
    frontend-unit) [[ "$RUN_FRONTEND_UNIT" == "1" ]] ;;
    backend-pytest) [[ "$RUN_BACKEND" == "1" ]] ;;
    integration-tests) [[ "$RUN_INTEGRATION" == "1" ]] ;;
    automation-check) [[ "$RUN_AUTOMATION_CHECK" == "1" ]] ;;
    orchestrator-mcp-gate) [[ "$RUN_ORCHESTRATOR_MCP" == "1" ]] ;;
    *) return 1 ;;
  esac
}

append_suite_duration() {
  local suite_name="$1"
  local started_epoch="$2"
  local status="$3"
  local ended_epoch duration
  mkdir -p "$(dirname "$SUITE_DURATION_FILE")"
  ended_epoch="$(date +%s)"
  duration=$(( ended_epoch - started_epoch ))
  if [[ "$duration" -lt 0 ]]; then
    duration=0
  fi
  echo -e "${suite_name}\t${duration}\t${status}" >> "$SUITE_DURATION_FILE"
}

collect_history_duration_files() {
  local history_base="$1"
  local lookback="$2"
  local current_file="$3"
  local -a files=()
  local -a sorted=()
  local f
  if [[ ! -d "$history_base" ]]; then
    return 0
  fi
  while IFS= read -r -d '' f; do
    files+=("$f")
  done < <(find "$history_base" -mindepth 2 -maxdepth 2 -type f -name "suite-durations.tsv" -print0 2>/dev/null)
  if [[ "${#files[@]}" -eq 0 ]]; then
    return 0
  fi
  while IFS= read -r f; do
    sorted+=("$f")
  done < <(printf '%s\n' "${files[@]}" | sort -r)
  local emitted=0
  for f in "${sorted[@]}"; do
    if [[ "$f" == "$current_file" ]]; then
      continue
    fi
    echo "$f"
    emitted=$((emitted + 1))
    if [[ "$emitted" -ge "$lookback" ]]; then
      break
    fi
  done
}

suite_history_avg_duration() {
  local suite_name="$1"
  shift || true
  if [[ "$#" -eq 0 ]]; then
    echo ""
    return
  fi
  awk -F '\t' -v target="$suite_name" '
    NR > 1 && $1 == target && $2 ~ /^[0-9]+$/ {
      sum += $2
      count += 1
    }
    END {
      if (count > 0) {
        printf "%.6f", sum / count
      }
    }
  ' "$@"
}

budget_line() {
  local line="$1"
  echo "$line"
  echo "$line" >> "$BUDGET_LOG"
}

suite_budget_names=()
suite_budget_values=()
set_suite_budget() {
  local suite_name="$1"
  local value="$2"
  local i
  for i in "${!suite_budget_names[@]}"; do
    if [[ "${suite_budget_names[$i]}" == "$suite_name" ]]; then
      suite_budget_values[i]="$value"
      return
    fi
  done
  suite_budget_names+=("$suite_name")
  suite_budget_values+=("$value")
}

get_suite_budget() {
  local suite_name="$1"
  local i
  for i in "${!suite_budget_names[@]}"; do
    if [[ "${suite_budget_names[$i]}" == "$suite_name" ]]; then
      echo "${suite_budget_values[$i]}"
      return
    fi
  done
  echo ""
}

build_suite_budget_prefix() {
  local suite_name="$1"
  local budget_value
  budget_value="$(get_suite_budget "$suite_name")"
  if [[ ! "$budget_value" =~ ^[0-9]+$ ]] || [[ "$budget_value" -lt 1 ]]; then
    echo ""
    return
  fi
  case "$suite_name" in
    backend-pytest|integration-tests) echo "UIQ_PYTEST_WORKERS=$budget_value PYTEST_XDIST_AUTO_NUM_WORKERS=$budget_value " ;;
    apps-web-e2e) echo "UIQ_PLAYWRIGHT_E2E_WORKERS=$budget_value " ;;
    frontend-e2e) echo "UIQ_FRONTEND_E2E_WORKERS=$budget_value " ;;
    frontend-unit) echo "UIQ_VITEST_MAX_WORKERS=$budget_value " ;;
    *) echo "" ;;
  esac
}

apply_suite_budget_prefix() {
  local suite_name="$1"
  local suite_cmd="$2"
  local prefix
  prefix="$(build_suite_budget_prefix "$suite_name")"
  if [[ -n "$prefix" ]]; then
    echo "${prefix}${suite_cmd}"
    return
  fi
  echo "$suite_cmd"
}

DYNAMIC_BUDGET_ENABLED=0
if [[ "$MODE" == "parallel" && "$PARALLEL_BUDGET_MODE" == "auto" && "$SELECTED_SUITE_COUNT" -gt 1 ]]; then
  DYNAMIC_BUDGET_ENABLED=1
fi

if [[ "$DYNAMIC_BUDGET_ENABLED" == "1" ]]; then
  HISTORY_ENABLED="$(read_bool "${UIQ_PARALLEL_HISTORY_ENABLED:-}" 1)"
  HISTORY_LOOKBACK="$(read_positive_int "${UIQ_PARALLEL_HISTORY_LOOKBACK:-}" 5)"
  HISTORY_BASE="${UIQ_PARALLEL_HISTORY_DIR:-$LOG_BASE}"
  history_files=()
  if [[ "$HISTORY_ENABLED" == "1" ]]; then
    while IFS= read -r file; do
      history_files+=("$file")
    done < <(collect_history_duration_files "$HISTORY_BASE" "$HISTORY_LOOKBACK" "$SUITE_DURATION_FILE")
  fi

  all_suites=("apps-web-e2e" "frontend-e2e" "frontend-unit" "backend-pytest" "integration-tests" "automation-check" "orchestrator-mcp-gate")
  worker_suites=()
  static_weights=()
  history_avgs=()
  effective_weights=()
  caps=()
  source_labels=()
  total_effective="0"
  history_mean_sum="0"
  history_mean_count=0

  for suite_name in "${all_suites[@]}"; do
    if ! suite_enabled "$suite_name"; then
      continue
    fi
    if ! suite_uses_worker_budget "$suite_name"; then
      continue
    fi
    weight_env_name="$(suite_weight_env_name "$suite_name")"
    default_weight="$(suite_default_weight "$suite_name")"
    raw_weight="${!weight_env_name:-}"
    static_weight="$(read_positive_number "$raw_weight" "$default_weight")"
    suite_history_avg=""
    if [[ "${#history_files[@]}" -gt 0 ]]; then
      suite_history_avg="$(suite_history_avg_duration "$suite_name" "${history_files[@]}")"
    fi
    if awk -v v="$suite_history_avg" 'BEGIN { exit !(v ~ /^([0-9]+([.][0-9]+)?|[.][0-9]+)$/ && (v + 0) > 0) }'; then
      history_mean_sum="$(awk -v a="$history_mean_sum" -v b="$suite_history_avg" 'BEGIN { printf "%.6f", a + b }')"
      history_mean_count=$((history_mean_count + 1))
    else
      suite_history_avg=""
    fi
    worker_suites+=("$suite_name")
    static_weights+=("$static_weight")
    history_avgs+=("$suite_history_avg")
    caps+=("$(suite_worker_cap "$suite_name")")
  done

  history_reference=""
  if [[ "$history_mean_count" -gt 0 ]]; then
    history_reference="$(awk -v sum="$history_mean_sum" -v c="$history_mean_count" 'BEGIN { printf "%.6f", sum / c }')"
  fi

  for i in "${!worker_suites[@]}"; do
    static_weight="${static_weights[$i]}"
    hist_avg="${history_avgs[$i]}"
    if [[ -n "$history_reference" ]] && [[ -n "$hist_avg" ]]; then
      effective="$(awk -v sw="$static_weight" -v hs="$hist_avg" -v ref="$history_reference" 'BEGIN { printf "%.6f", sw * (hs / ref) }')"
      source_labels+=("static+history")
    else
      effective="$static_weight"
      source_labels+=("static")
    fi
    effective_weights+=("$effective")
    total_effective="$(awk -v a="$total_effective" -v b="$effective" 'BEGIN { printf "%.6f", a + b }')"
  done

  worker_suite_count="${#worker_suites[@]}"
  if [[ "$worker_suite_count" -gt 0 ]]; then
    base_sum="$worker_suite_count"
    remaining_budget=0
    if [[ "$GLOBAL_BUDGET" -gt "$base_sum" ]]; then
      remaining_budget=$((GLOBAL_BUDGET - base_sum))
    fi
    extra_budgets=()
    remainders=()
    allocated_extra_sum=0
    for i in "${!worker_suites[@]}"; do
      cap="${caps[$i]}"
      headroom=$((cap - 1))
      extra=0
      remainder="0"
      if [[ "$remaining_budget" -gt 0 && "$headroom" -gt 0 ]]; then
        share="$(awk -v rem="$remaining_budget" -v w="${effective_weights[$i]}" -v tw="$total_effective" 'BEGIN { if (tw > 0) printf "%.6f", rem * (w / tw); else printf "0" }')"
        share_floor="$(awk -v s="$share" 'BEGIN { printf "%d", int(s) }')"
        if [[ "$share_floor" -gt "$headroom" ]]; then
          share_floor="$headroom"
          remainder="0"
        else
          remainder="$(awk -v s="$share" -v f="$share_floor" 'BEGIN { printf "%.6f", s - f }')"
        fi
        extra="$share_floor"
      fi
      extra_budgets+=("$extra")
      remainders+=("$remainder")
      allocated_extra_sum=$((allocated_extra_sum + extra))
    done

    remaining_after_floor=$((remaining_budget - allocated_extra_sum))
    while [[ "$remaining_after_floor" -gt 0 ]]; do
      best_idx=-1
      best_rem="-1"
      for i in "${!worker_suites[@]}"; do
        current=$((1 + extra_budgets[i]))
        cap="${caps[$i]}"
        if [[ "$current" -ge "$cap" ]]; then
          continue
        fi
        candidate="${remainders[$i]}"
        if awk -v c="$candidate" -v b="$best_rem" 'BEGIN { exit !(c > b) }'; then
          best_idx="$i"
          best_rem="$candidate"
        fi
      done
      if [[ "$best_idx" -lt 0 ]]; then
        break
      fi
      extra_budgets[best_idx]=$((extra_budgets[best_idx] + 1))
      remainders[best_idx]="0"
      remaining_after_floor=$((remaining_after_floor - 1))
    done

    for i in "${!worker_suites[@]}"; do
      total_suite_budget=$((1 + extra_budgets[i]))
      cap="${caps[$i]}"
      if [[ "$total_suite_budget" -gt "$cap" ]]; then
        total_suite_budget="$cap"
      fi
      set_suite_budget "${worker_suites[$i]}" "$total_suite_budget"
    done
  fi

  UIQ_PYTEST_WORKERS_EFFECTIVE="${UIQ_PYTEST_WORKERS:-auto}"
  UIQ_PLAYWRIGHT_E2E_WORKERS_EFFECTIVE="${UIQ_PLAYWRIGHT_E2E_WORKERS:-50%}"
  UIQ_FRONTEND_E2E_WORKERS_EFFECTIVE="${UIQ_FRONTEND_E2E_WORKERS:-50%}"
  UIQ_VITEST_MAX_WORKERS_EFFECTIVE="${UIQ_VITEST_MAX_WORKERS:-4}"
  backend_budget="$(get_suite_budget "backend-pytest")"
  integration_budget="$(get_suite_budget "integration-tests")"
  apps_web_budget="$(get_suite_budget "apps-web-e2e")"
  frontend_e2e_budget="$(get_suite_budget "frontend-e2e")"
  frontend_unit_budget="$(get_suite_budget "frontend-unit")"
  if [[ "$backend_budget" =~ ^[0-9]+$ ]]; then
    UIQ_PYTEST_WORKERS_EFFECTIVE="$backend_budget"
  elif [[ "$integration_budget" =~ ^[0-9]+$ ]]; then
    UIQ_PYTEST_WORKERS_EFFECTIVE="$integration_budget"
  fi
  if [[ "$apps_web_budget" =~ ^[0-9]+$ ]]; then
    UIQ_PLAYWRIGHT_E2E_WORKERS_EFFECTIVE="$apps_web_budget"
  fi
  if [[ "$frontend_e2e_budget" =~ ^[0-9]+$ ]]; then
    UIQ_FRONTEND_E2E_WORKERS_EFFECTIVE="$frontend_e2e_budget"
  fi
  if [[ "$frontend_unit_budget" =~ ^[0-9]+$ ]]; then
    UIQ_VITEST_MAX_WORKERS_EFFECTIVE="$frontend_unit_budget"
  fi

  budget_line "[budget] mode=load-aware global_budget=$GLOBAL_BUDGET selected_suites=$SELECTED_SUITE_COUNT worker_suites=${#worker_suites[@]}"
  budget_line "[budget] history_enabled=$HISTORY_ENABLED lookback=$HISTORY_LOOKBACK history_files=${#history_files[@]} history_base=$HISTORY_BASE"
  if [[ -n "$history_reference" ]]; then
    budget_line "[budget] history_reference_duration_sec=$history_reference"
  else
    budget_line "[budget] history_reference_duration_sec=none (fallback to static weights)"
  fi
  for i in "${!worker_suites[@]}"; do
    suite_name="${worker_suites[$i]}"
    budget_value="$(get_suite_budget "$suite_name")"
    budget_line "[budget] suite=$suite_name static_weight=${static_weights[$i]} history_avg_sec=${history_avgs[$i]:-n/a} effective_weight=${effective_weights[$i]} source=${source_labels[$i]} cap=${caps[$i]} allocated_workers=${budget_value:-n/a}"
  done
else
  UIQ_PYTEST_WORKERS_EFFECTIVE="${UIQ_PYTEST_WORKERS:-auto}"
  UIQ_PLAYWRIGHT_E2E_WORKERS_EFFECTIVE="${UIQ_PLAYWRIGHT_E2E_WORKERS:-50%}"
  UIQ_FRONTEND_E2E_WORKERS_EFFECTIVE="${UIQ_FRONTEND_E2E_WORKERS:-50%}"
  UIQ_VITEST_MAX_WORKERS_EFFECTIVE="${UIQ_VITEST_MAX_WORKERS:-4}"
  budget_line "[budget] mode=fallback-static reason=parallel_auto_not_enabled_or_single_suite"
fi

: "${UIQ_PYTEST_WORKERS_EFFECTIVE}" "${UIQ_PLAYWRIGHT_E2E_WORKERS_EFFECTIVE}" "${UIQ_FRONTEND_E2E_WORKERS_EFFECTIVE}" "${UIQ_VITEST_MAX_WORKERS_EFFECTIVE}"
export UIQ_PYTEST_WORKERS="$UIQ_PYTEST_WORKERS_EFFECTIVE"
export UIQ_PLAYWRIGHT_E2E_WORKERS="$UIQ_PLAYWRIGHT_E2E_WORKERS_EFFECTIVE"
export UIQ_FRONTEND_E2E_WORKERS="$UIQ_FRONTEND_E2E_WORKERS_EFFECTIVE"
export UIQ_VITEST_MAX_WORKERS="$UIQ_VITEST_MAX_WORKERS_EFFECTIVE"
if [[ "$UIQ_PYTEST_WORKERS_EFFECTIVE" =~ ^[0-9]+$ ]]; then
  export PYTEST_XDIST_AUTO_NUM_WORKERS="$UIQ_PYTEST_WORKERS_EFFECTIVE"
fi

source "${ROOT_DIR}/scripts/test-matrix-runner.sh"

suite_names=()
suite_cmds=()
suite_logs=()
phase_short_indices=()
phase_long_indices=()

resolve_integration_cmd() {
  local integration_dir="apps/api/tests"
  local marker_expr=""
  if [[ ! -d "$integration_dir" ]]; then
    echo "echo \"[fail] integration suite enabled but $integration_dir is missing\"; exit 1"
    return
  fi
  case "$INTEGRATION_PROFILE" in
    smoke) marker_expr="integration and integration_smoke" ;;
    full) marker_expr="integration and integration_full" ;;
    *)
      echo "echo \"[fail] invalid integration profile: $INTEGRATION_PROFILE\""
      return
      ;;
  esac
  echo "$PROJECT_MANAGED_PYTEST_CMD $integration_dir -m \"$marker_expr\" -q"
}

resolve_suite_cmd() {
  local suite_name="$1"
  local default_cmd="$2"
  local override_cmd="${3:-}"
  if [[ -n "$override_cmd" ]]; then
    if [[ "$ALLOW_CMD_OVERRIDE" != "1" ]]; then
      echo "error: command override for $suite_name is disabled by default; set UIQ_TEST_MATRIX_ALLOW_CMD_OVERRIDE=1 to enable explicitly" >&2
      exit 1
    fi
    if [[ "$ALLOW_UNSAFE_OVERRIDE" == "1" ]]; then
      echo "$override_cmd"
      return
    fi
    if [[ "$override_cmd" == *$'\n'* || "$override_cmd" == *$'\r'* ]]; then
      echo "error: unsafe override for $suite_name: multiline commands are not allowed" >&2
      exit 1
    fi
    if [[ "$override_cmd" =~ [\;\|\<\>\`\$\(\)\&] ]]; then
      echo "error: unsafe override for $suite_name: shell metacharacters are not allowed" >&2
      exit 1
    fi
    case "$suite_name" in
      apps-web-e2e)
        [[ "$override_cmd" =~ ^UIQ_WEB_PORT=[0-9]+[[:space:]]+pnpm[[:space:]]+test:e2e([[:space:]][[:alnum:]_./:=,@%+-]+)*$ ]] || {
          echo "error: override for $suite_name must start with 'UIQ_WEB_PORT=<int> pnpm test:e2e'" >&2
          exit 1
        }
        ;;
      frontend-e2e)
        [[ "$override_cmd" =~ ^UIQ_FRONTEND_E2E_PORT=[0-9]+[[:space:]]+pnpm[[:space:]]+test:e2e:frontend([[:space:]][[:alnum:]_./:=,@%+-]+)*$ ]] || {
          echo "error: override for $suite_name must start with 'UIQ_FRONTEND_E2E_PORT=<int> pnpm test:e2e:frontend'" >&2
          exit 1
        }
        ;;
      frontend-unit)
        [[ "$override_cmd" =~ ^pnpm[[:space:]]+--dir[[:space:]]+frontend[[:space:]]+test([[:space:]][[:alnum:]_./:=,@%+-]+)*$ ]] || {
          echo "error: override for $suite_name must start with 'pnpm --dir apps/web test'" >&2
          exit 1
        }
        ;;
      backend-pytest)
        [[ "$override_cmd" =~ ^((uv[[:space:]]+run[[:space:]]+--extra[[:space:]]+dev[[:space:]]+pytest|\.runtime-cache/toolchains/python/\.venv/bin/python[[:space:]]+-m[[:space:]]+pytest))([[:space:]][[:alnum:]_./:=,@%+-]+)*$ ]] || {
          echo "error: override for $suite_name must start with '.runtime-cache/toolchains/python/.venv/bin/python -m pytest' or 'uv run --extra dev pytest'" >&2
          exit 1
        }
        ;;
      integration-tests)
        [[ "$override_cmd" =~ ^((uv[[:space:]]+run[[:space:]]+--extra[[:space:]]+dev[[:space:]]+pytest|\.runtime-cache/toolchains/python/\.venv/bin/python[[:space:]]+-m[[:space:]]+pytest))([[:space:]][[:alnum:]_./:=,@%+-]+)*$ ]] || {
          echo "error: override for $suite_name must start with '.runtime-cache/toolchains/python/.venv/bin/python -m pytest' or 'uv run --extra dev pytest'" >&2
          exit 1
        }
        ;;
      automation-check)
        [[ "$override_cmd" =~ ^pnpm[[:space:]]+--dir[[:space:]]+automation[[:space:]]+--ignore-workspace[[:space:]]+(check|install)([[:space:]][[:alnum:]_./:=,@%+-]+)*$ ]] || {
          echo "error: override for $suite_name must start with 'pnpm --dir apps/automation-runner --ignore-workspace check|install'" >&2
          exit 1
        }
        ;;
      orchestrator-mcp-gate)
        [[ "$override_cmd" =~ ^(node[[:space:]]+--import[[:space:]]+tsx[[:space:]]+--test|pnpm[[:space:]]+mcp:check)([[:space:]][[:alnum:]_./:=,@%+-]+)*$ ]] || {
          echo "error: override for $suite_name must start with 'node --import tsx --test' or 'pnpm mcp:check'" >&2
          exit 1
        }
        ;;
      *)
        echo "error: unknown suite for override validation: $suite_name" >&2
        exit 1
        ;;
    esac
    echo "$override_cmd"
    return
  fi
  echo "$default_cmd"
}

if [[ "$RUN_WEB_E2E" == "1" ]]; then
  suite_names+=("apps-web-e2e")
  suite_cmds+=("$(maybe_wrap_long_suite_cmd "apps-web-e2e" "$(apply_suite_budget_prefix "apps-web-e2e" "$(resolve_suite_cmd "apps-web-e2e" "UIQ_WEB_PORT=$UIQ_WEB_PORT pnpm test:e2e" "${UIQ_TEST_MATRIX_CMD_APPS_WEB_E2E:-}")")")")
  suite_logs+=("$LOG_DIR/apps-web-e2e.log")
  register_suite_phase "apps-web-e2e" "$(( ${#suite_names[@]} - 1 ))"
fi

if [[ "$RUN_FRONTEND_E2E" == "1" ]]; then
  suite_names+=("frontend-e2e")
  suite_cmds+=("$(maybe_wrap_long_suite_cmd "frontend-e2e" "$(apply_suite_budget_prefix "frontend-e2e" "$(resolve_suite_cmd "frontend-e2e" "UIQ_FRONTEND_E2E_PORT=$UIQ_FRONTEND_E2E_PORT UIQ_FRONTEND_E2E_GREP_INVERT='@frontend-nonstub|@nonstub|@frontend-smoke-live|@frontend-smoke-canary' pnpm test:e2e:frontend" "${UIQ_TEST_MATRIX_CMD_FRONTEND_E2E:-}")")")")
  suite_logs+=("$LOG_DIR/frontend-e2e.log")
  register_suite_phase "frontend-e2e" "$(( ${#suite_names[@]} - 1 ))"
fi

if [[ "$RUN_FRONTEND_UNIT" == "1" ]]; then
  suite_names+=("frontend-unit")
  suite_cmds+=("$(apply_suite_budget_prefix "frontend-unit" "$(resolve_suite_cmd "frontend-unit" "pnpm --dir apps/web test" "${UIQ_TEST_MATRIX_CMD_FRONTEND_UNIT:-}")")")
  suite_logs+=("$LOG_DIR/frontend-unit.log")
  register_suite_phase "frontend-unit" "$(( ${#suite_names[@]} - 1 ))"
fi

if [[ "$RUN_BACKEND" == "1" ]]; then
  suite_names+=("backend-pytest")
  suite_cmds+=("$(maybe_wrap_long_suite_cmd "backend-pytest" "$(apply_suite_budget_prefix "backend-pytest" "$(resolve_suite_cmd "backend-pytest" "UIQ_BACKEND_TEST_SCOPE=backend $PROJECT_MANAGED_PYTEST_CMD" "${UIQ_TEST_MATRIX_CMD_BACKEND_PYTEST:-}")")")")
  suite_logs+=("$LOG_DIR/backend-pytest.log")
  register_suite_phase "backend-pytest" "$(( ${#suite_names[@]} - 1 ))"
fi

if [[ "$RUN_INTEGRATION" == "1" ]]; then
  suite_names+=("integration-tests")
  suite_cmds+=("$(maybe_wrap_long_suite_cmd "integration-tests" "$(apply_suite_budget_prefix "integration-tests" "$(resolve_suite_cmd "integration-tests" "UIQ_BACKEND_TEST_SCOPE=integration $(resolve_integration_cmd)" "${UIQ_TEST_MATRIX_CMD_INTEGRATION:-}")")")")
  suite_logs+=("$LOG_DIR/integration-tests.log")
  register_suite_phase "integration-tests" "$(( ${#suite_names[@]} - 1 ))"
fi

if [[ "$RUN_AUTOMATION_CHECK" == "1" ]]; then
  suite_names+=("automation-check")
  if [[ "$AUTOMATION_INSTALL_DEPS" == "1" ]]; then
    suite_cmds+=("$(maybe_wrap_long_suite_cmd "automation-check" "$(resolve_suite_cmd "automation-check" "pnpm --dir apps/automation-runner --ignore-workspace install --frozen-lockfile && pnpm --dir apps/automation-runner --ignore-workspace check" "${UIQ_TEST_MATRIX_CMD_AUTOMATION_CHECK:-}")")")
  else
    suite_cmds+=("$(maybe_wrap_long_suite_cmd "automation-check" "$(resolve_suite_cmd "automation-check" "pnpm --dir apps/automation-runner --ignore-workspace check" "${UIQ_TEST_MATRIX_CMD_AUTOMATION_CHECK:-}")")")
  fi
  suite_logs+=("$LOG_DIR/automation-check.log")
  register_suite_phase "automation-check" "$(( ${#suite_names[@]} - 1 ))"
fi

if [[ "$RUN_ORCHESTRATOR_MCP" == "1" ]]; then
  suite_names+=("orchestrator-mcp-gate")
  suite_cmds+=("$(resolve_suite_cmd "orchestrator-mcp-gate" "node --import tsx --test packages/orchestrator/src/commands/run.test.ts packages/orchestrator/src/commands/run.runid.test.ts && pnpm mcp:check" "${UIQ_TEST_MATRIX_CMD_ORCHESTRATOR_MCP_GATE:-}")")
  suite_logs+=("$LOG_DIR/orchestrator-mcp-gate.log")
  register_suite_phase "orchestrator-mcp-gate" "$(( ${#suite_names[@]} - 1 ))"
fi

echo "mode=$MODE run_id=$RUN_ID log_dir=$LOG_DIR"
echo "budget_log=$BUDGET_LOG duration_log=$SUITE_DURATION_FILE"
echo "ports: web_e2e=$UIQ_WEB_PORT frontend_e2e=$UIQ_FRONTEND_E2E_PORT"
echo "phase order: short(${#phase_short_indices[@]}) -> long(${#phase_long_indices[@]})"
if [[ "$RUN_AUTOMATION_CHECK" == "1" ]]; then
  echo "automation-check: install_deps=$AUTOMATION_INSTALL_DEPS (set UIQ_AUTOMATION_INSTALL_DEPS=1 to reinstall)"
fi
if [[ "$ALLOW_CMD_OVERRIDE" == "1" ]]; then
  echo "command override: enabled (UIQ_TEST_MATRIX_ALLOW_CMD_OVERRIDE=1)"
fi

failed=0
failed_name=""

if [[ "$MODE" == "serial" ]]; then
  echo "[phase] short-tests"
  run_serial_phase "${phase_short_indices[@]}" || true
  if [[ "$failed" -eq 0 ]]; then
    echo "[phase] long-tests"
    run_serial_phase "${phase_long_indices[@]}" || true
  fi
else
  echo "[phase] short-tests"
  if [[ "${#phase_short_indices[@]}" -gt 0 ]]; then
    run_parallel_phase "${phase_short_indices[@]}" || true
  fi
  if [[ "$failed" -eq 0 && "${#phase_long_indices[@]}" -gt 0 ]]; then
    echo "[phase] long-tests"
    run_parallel_phase "${phase_long_indices[@]}" || true
  fi
fi

if [[ "$failed" -ne 0 ]]; then
  echo "test-matrix failed; see logs in $LOG_DIR"
  exit 1
fi

echo "test-matrix passed; logs in $LOG_DIR"
