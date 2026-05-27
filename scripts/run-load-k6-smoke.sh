#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/ports.sh"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/backend_lifecycle.sh"

BACKEND_PID=""
LOG_PATH=".runtime-cache/logs/k6-smoke-backend.log"
BACKEND_PORT="${TM_BACKEND_PORT:-17380}"
TARGET_URL=""
HEALTH_RETRIES="${K6_SMOKE_BACKEND_HEALTH_RETRIES:-}"
HEALTH_INTERVAL="${K6_SMOKE_BACKEND_HEALTH_INTERVAL:-1}"

cleanup() {
  stop_pid_if_running "$BACKEND_PID"
}
trap cleanup EXIT

if ! validate_port_number "$BACKEND_PORT" "TM_BACKEND_PORT"; then
  exit 1
fi
if ! BACKEND_PORT="$(find_available_port "$BACKEND_PORT" 50)"; then
  echo "error: no available backend port from ${TM_BACKEND_PORT:-17380} to $(( ${TM_BACKEND_PORT:-17380} + 49 ))"
  exit 1
fi
TARGET_URL="http://127.0.0.1:$BACKEND_PORT"

if [[ -z "$HEALTH_RETRIES" ]]; then
  if [[ "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ]]; then
    HEALTH_RETRIES=120
  else
    HEALTH_RETRIES=60
  fi
fi

if ! command -v k6 >/dev/null 2>&1; then
  echo "[k6-smoke] k6 binary is required for smoke gate but was not found"
  echo "[k6-smoke] install k6 before invoking this gate"
  exit 1
fi

echo "[k6-smoke] validating HAR->k6 parse path"
HAR_FILE="apps/automation-runner/tests/fixtures/wrappers/local-health.har.json"
pnpm --dir apps/automation-runner run automation:har:k6 -- --input "$HAR_FILE" >/dev/null
echo "[k6-smoke] backend health wait budget: retries=${HEALTH_RETRIES}, interval=${HEALTH_INTERVAL}s"
ensure_backend_running "$TARGET_URL" "$BACKEND_PORT" "$LOG_PATH" "k6-smoke" "$HEALTH_RETRIES" "$HEALTH_INTERVAL"

run_k6_smoke_once() {
  echo "[k6-smoke] running smoke script"
  TARGET_URL="$TARGET_URL" k6 run --address 127.0.0.1:0 apps/automation-runner/load/reconstruction-smoke.js
}

if ! run_k6_smoke_once; then
  echo "[k6-smoke] first run failed, re-checking backend health and retrying once"
  stop_pid_if_running "$BACKEND_PID"
  BACKEND_PID=""
  if ! BACKEND_PORT="$(find_available_port "$BACKEND_PORT" 50)"; then
    echo "error: no available backend port for k6 retry from ${TM_BACKEND_PORT:-17380} to $(( ${TM_BACKEND_PORT:-17380} + 49 ))"
    exit 1
  fi
  TARGET_URL="http://127.0.0.1:$BACKEND_PORT"
  ensure_backend_running "$TARGET_URL" "$BACKEND_PORT" "$LOG_PATH" "k6-smoke-retry" "$HEALTH_RETRIES" "$HEALTH_INTERVAL"
  run_k6_smoke_once
fi
