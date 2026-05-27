#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/ports.sh"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/backend_lifecycle.sh"

if ! command -v k6 >/dev/null 2>&1; then
  echo "[k6] k6 binary is required for full load run"
  exit 1
fi

BACKEND_PID=""
LOG_PATH=".runtime-cache/logs/k6-full-backend.log"
BACKEND_PORT="${TM_BACKEND_PORT:-17380}"
TARGET_URL=""

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

ensure_backend_running "$TARGET_URL" "$BACKEND_PORT" "$LOG_PATH" "k6"
TARGET_URL="$TARGET_URL" k6 run --address 127.0.0.1:0 apps/automation-runner/load/reconstruction-smoke.js
