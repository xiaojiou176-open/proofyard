#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PORT="${WEBDRIVER_PORT:-4444}"
RUNTIME_DIR=".runtime-cache/webdriver"
PID_FILE="${RUNTIME_DIR}/webdriver.pid"
META_FILE="${RUNTIME_DIR}/webdriver.meta"
LOG_FILE="${RUNTIME_DIR}/webdriver.log"
mkdir -p "$RUNTIME_DIR"

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE" || true)"
  if [[ -n "${PID}" ]] && kill -0 "$PID" >/dev/null 2>&1; then
    echo "webdriver already running pid=${PID}"
    cat "$META_FILE" 2>/dev/null || true
    exit 0
  fi
fi

if command -v tauri-driver >/dev/null 2>&1 && tauri-driver --help >/dev/null 2>&1; then
  PROVIDER="tauri-driver"
  nohup tauri-driver --port "$PORT" >"$LOG_FILE" 2>&1 &
elif command -v safaridriver >/dev/null 2>&1; then
  PROVIDER="safaridriver"
  nohup safaridriver -p "$PORT" >"$LOG_FILE" 2>&1 &
else
  echo "error: no webdriver provider found (tauri-driver/safaridriver)"
  exit 1
fi

PID="$!"
echo "$PID" >"$PID_FILE"
cat >"$META_FILE" <<EOF
provider=${PROVIDER}
port=${PORT}
pid=${PID}
EOF

for _ in {1..20}; do
  if curl -fsS "http://127.0.0.1:${PORT}/status" >/dev/null 2>&1; then
    echo "webdriver ready provider=${PROVIDER} port=${PORT} pid=${PID}"
    exit 0
  fi
  sleep 1
done

echo "webdriver failed to become ready; see ${LOG_FILE}"
exit 1
