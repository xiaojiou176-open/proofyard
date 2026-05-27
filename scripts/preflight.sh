#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export PYTHONDONTWRITEBYTECODE="${PYTHONDONTWRITEBYTECODE:-1}"

MODE="${1:-${UIQ_PREFLIGHT_MODE:-full}}"
if [[ "$MODE" != "full" && "$MODE" != "minimal" ]]; then
  echo "usage: ./scripts/preflight.sh [full|minimal]"
  exit 1
fi

if [[ "$MODE" == "minimal" ]]; then
  TOTAL_STEPS=2
else
  TOTAL_STEPS=13
fi

HEARTBEAT_INTERVAL_SEC="${UIQ_PREFLIGHT_HEARTBEAT_INTERVAL_SEC:-30}"
if ! [[ "$HEARTBEAT_INTERVAL_SEC" =~ ^[0-9]+$ ]] || [[ "$HEARTBEAT_INTERVAL_SEC" -lt 1 ]]; then
  echo "error: UIQ_PREFLIGHT_HEARTBEAT_INTERVAL_SEC must be a positive integer" >&2
  exit 2
fi

RUN_ID="${UIQ_PREFLIGHT_RUN_ID:-$(date +%Y%m%d-%H%M%S)-$$}"
LOG_DIR="${UIQ_PREFLIGHT_LOG_DIR:-.runtime-cache/logs/preflight}/${RUN_ID}"
mkdir -p "$LOG_DIR"

declare -a PIDS=()
declare -a LABELS=()
declare -a LOG_FILES=()
declare -a FAILURES=()
first_rc=0
failed=0

sanitize_name() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-'
}

classify_failure_log() {
  local log_file="$1"
  if [[ ! -f "$log_file" ]]; then
    echo "unknown (missing-log)"
    return
  fi
  if grep -Eqi 'timed? out|timeout|ETIMEDOUT|ERR_TEST_TIMEOUT|TimeoutError|exceeded timeout|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network error|socket hang up|TLS|fetch failed|connection reset' "$log_file"; then
    echo "network-or-timeout"
    return
  fi
  echo "logic-or-assertion"
}

launch_task() {
  local step="$1"
  local label="$2"
  shift 2
  local prefix="[${step}/${TOTAL_STEPS}][${label}]"
  local log_file
  log_file="$LOG_DIR/$(sanitize_name "${step}-${label}").log"

  (
    echo "${prefix} START"
    "$@" \
      > >(tee -a "$log_file" | awk -v p="$prefix" '{ print p " " $0; fflush(); }') \
      2> >(tee -a "$log_file" | awk -v p="$prefix" '{ print p " " $0; fflush(); }' >&2)
    local rc=$?
    if (( rc == 0 )); then
      echo "${prefix} PASS"
    else
      echo "${prefix} FAIL (exit ${rc})" >&2
    fi
    exit "$rc"
  ) &

  PIDS+=("$!")
  LABELS+=("${step}/${TOTAL_STEPS} ${label}")
  LOG_FILES+=("$log_file")
}

launch_long_task() {
  local step="$1"
  local label="$2"
  local cmd="$3"
  launch_task "$step" "$label" bash scripts/ci/with-heartbeat.sh "$HEARTBEAT_INTERVAL_SEC" "$label" "$cmd"
}

wait_tasks() {
  for i in "${!PIDS[@]}"; do
    set +e
    wait "${PIDS[$i]}"
    rc=$?
    set -e

    if (( rc == 0 )); then
      continue
    fi
    ((failed += 1))
    FAILURES+=("${LABELS[$i]} (exit ${rc})")
    category="$(classify_failure_log "${LOG_FILES[$i]}")"
    echo "[hint] ${LABELS[$i]} failure category: ${category} (log: ${LOG_FILES[$i]})" >&2
    if (( first_rc == 0 )); then
      first_rc="$rc"
    fi
  done
  PIDS=()
  LABELS=()
  LOG_FILES=()
}

if [[ "$MODE" == "minimal" ]]; then
  echo "[phase] short-checks"
  launch_task "1" "orchestrator run contract tests" \
    bash scripts/ci/run-in-container.sh --task orchestrator-contract --gate preflight-minimal
  launch_task "2" "mcp server typecheck" \
    bash scripts/ci/run-in-container.sh --task mcp-check --gate preflight-minimal
  wait_tasks
else
  echo "[phase] short-checks"
  launch_task "1" "security scan" bash scripts/ci/run-in-container.sh --task security-scan --gate preflight
  launch_task "2" "backend lint" bash scripts/ci/run-in-container.sh --task backend-lint --gate preflight
  launch_task "4" "frontend lint" bash scripts/ci/run-in-container.sh --task frontend-lint --gate preflight
  launch_task "8" "orchestrator run contract tests" \
    bash scripts/ci/run-in-container.sh --task orchestrator-contract --gate preflight
  launch_task "9" "mcp server typecheck" bash scripts/ci/run-in-container.sh --task mcp-check --gate preflight
  launch_task "10" "test truth gate" bash scripts/ci/run-in-container.sh --task test-truth-gate --gate preflight
  launch_task "11" "docs gate" bash scripts/docs-gate.sh
  wait_tasks

  if (( failed == 0 )); then
    echo "[phase] long-checks"
    launch_long_task "3" "backend tests" "bash scripts/ci/run-in-container.sh --task backend-tests --gate preflight"
    launch_long_task "5" "frontend build" "bash scripts/ci/run-in-container.sh --task frontend-build --gate preflight"
    launch_long_task "6" "frontend ui audit" "bash scripts/ci/run-in-container.sh --task frontend-ui-audit --gate preflight"
    launch_long_task "7" "automation tests" "bash scripts/ci/run-in-container.sh --task automation-tests --gate preflight"
    launch_long_task "12" "unit coverage gate" "bash scripts/ci/run-in-container.sh --task coverage --gate preflight"
    launch_long_task "13" "e2e authenticity gate" "bash scripts/ci/run-in-container.sh --task frontend-authenticity --gate preflight"
    wait_tasks
  fi
fi

if (( failed > 0 )); then
  echo "preflight failed (${failed} task(s)):" >&2
  for item in "${FAILURES[@]}"; do
    echo " - ${item}" >&2
  done
  echo "preflight logs: ${LOG_DIR}" >&2
  exit "$first_rc"
fi

echo "preflight passed"
