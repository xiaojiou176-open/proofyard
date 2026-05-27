#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PID_FILE=".runtime-cache/webdriver/webdriver.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "webdriver not running (no pid file)"
  exit 0
fi

PID="$(cat "$PID_FILE" || true)"
if [[ -n "${PID}" ]] && kill -0 "$PID" >/dev/null 2>&1; then
  kill "$PID" >/dev/null 2>&1 || true
  sleep 1
  if kill -0 "$PID" >/dev/null 2>&1; then
    echo "webdriver pid=$PID did not exit after SIGTERM; manual cleanup required"
    exit 1
  fi
fi

rm -f ".runtime-cache/webdriver/webdriver.pid"
echo "webdriver stopped"
