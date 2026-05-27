#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

USE_EXTERNAL_WEBDRIVER="${USE_EXTERNAL_WEBDRIVER:-false}"
META_FILE=".runtime-cache/webdriver/webdriver.meta"
PROVIDER=""
PORT=""

if [[ "${USE_EXTERNAL_WEBDRIVER}" == "true" ]]; then
  PROVIDER="${WEBDRIVER_PROVIDER:-external}"
else
  ./scripts/start-webdriver.sh
  PROVIDER="$(grep '^provider=' "$META_FILE" | head -n 1 | cut -d'=' -f2 || true)"
  PORT="$(grep '^port=' "$META_FILE" | head -n 1 | cut -d'=' -f2 || true)"
fi

cleanup() {
  if [[ "${USE_EXTERNAL_WEBDRIVER}" != "true" ]]; then
    ./scripts/stop-webdriver.sh >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ "${USE_EXTERNAL_WEBDRIVER}" == "true" ]]; then
  export WEBDRIVER_URL="${WEBDRIVER_URL:-http://127.0.0.1:4444}"
else
  export WEBDRIVER_URL="http://127.0.0.1:${PORT:-4444}"
fi
export WEBDRIVER_PROVIDER="${PROVIDER:-unknown}"

if ! curl -fsS "${WEBDRIVER_URL}/status" >/dev/null 2>&1; then
  echo "tauri smoke blocked: webdriver endpoint not reachable at ${WEBDRIVER_URL}"
  if [[ "${USE_EXTERNAL_WEBDRIVER}" == "true" ]]; then
    echo "Please start your external webdriver before running smoke."
  fi
  exit 3
fi

if [[ "${WEBDRIVER_PROVIDER}" == "safaridriver" ]]; then
  export WEBDRIVER_CAPABILITIES_JSON='{"alwaysMatch":{"browserName":"safari"}}'
  PRECHECK_JSON="$(curl -sS -X POST "${WEBDRIVER_URL}/session" -H 'content-type: application/json' -d "{\"capabilities\":${WEBDRIVER_CAPABILITIES_JSON}}" || true)"
  if echo "${PRECHECK_JSON}" | rg -q "Allow remote automation"; then
    echo "tauri smoke blocked: Safari remote automation is disabled."
    echo "Enable it with one of:"
    echo "  1) Safari -> Settings -> Advanced -> Show features for web developers"
    echo "  2) Safari menu -> Develop -> Allow Remote Automation"
    echo "  3) (admin) run: safaridriver --enable"
    exit 2
  fi
  SESSION_ID="$(echo "${PRECHECK_JSON}" | sed -n 's/.*"sessionId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
  if [[ -n "${SESSION_ID}" ]]; then
    curl -sS -X DELETE "${WEBDRIVER_URL}/session/${SESSION_ID}" >/dev/null || true
  fi
fi

cd apps/automation-runner
pnpm smoke:tauri
