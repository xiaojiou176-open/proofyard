#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/ports.sh"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/backend_lifecycle.sh"

if [[ "${1:-}" == "--" ]]; then
  shift
fi

node "$ROOT_DIR/scripts/check-e2e-contract.mjs"

RUNTIME_CACHE_DIR=".runtime-cache/cache"
RUNTIME_LOG_DIR=".runtime-cache/logs"
RUNTIME_E2E_CONFIG="$RUNTIME_CACHE_DIR/playwright.e2e.frontend.config.mjs"
mkdir -p "$RUNTIME_CACHE_DIR" "$RUNTIME_LOG_DIR"

heal_frontend_platform_deps_if_needed() {
  local run_log
  run_log="$(mktemp)"
  set +e
  (
    cd apps/web &&
      pnpm exec node -e "require('esbuild').buildSync({ stdin: { contents: 'console.log(1)', sourcefile: 'probe.js', resolveDir: process.cwd() }, write: false })"
  ) >"$run_log" 2>&1
  local status=$?
  set -e
  if [[ "$status" -ne 0 ]]; then
    cat "$run_log"
    if grep -Eqi "Cannot find module @rollup/rollup-|installed esbuild for another platform|needs the @esbuild/|Host version \".*\" does not match binary version" "$run_log"; then
      echo "warn: frontend platform deps mismatched, reinstalling workspace deps"
      rm -rf apps/web/node_modules
      CI=true pnpm install --frozen-lockfile || CI=true pnpm install --no-frozen-lockfile
    else
      rm -f "$run_log"
      return "$status"
    fi
  fi
  rm -f "$run_log"
}

ARTIFACT_POLICY="${UIQ_E2E_ARTIFACT_POLICY:-critical}"
case "$ARTIFACT_POLICY" in
  critical)
    PLAYWRIGHT_SCREENSHOT_POLICY="on"
    PLAYWRIGHT_TRACE_POLICY="retain-on-failure"
    PLAYWRIGHT_VIDEO_POLICY="retain-on-failure"
    ;;
  full)
    PLAYWRIGHT_SCREENSHOT_POLICY="on"
    PLAYWRIGHT_TRACE_POLICY="on"
    PLAYWRIGHT_VIDEO_POLICY="on"
    ;;
  failure-only)
    PLAYWRIGHT_SCREENSHOT_POLICY="only-on-failure"
    PLAYWRIGHT_TRACE_POLICY="retain-on-failure"
    PLAYWRIGHT_VIDEO_POLICY="retain-on-failure"
    ;;
  *)
    echo "error: UIQ_E2E_ARTIFACT_POLICY must be one of critical|full|failure-only (got: $ARTIFACT_POLICY)"
    exit 1
    ;;
esac

cat > "$RUNTIME_E2E_CONFIG" <<'EOF'
import { defineConfig } from "@playwright/test";
import path from "node:path";

const webPort = Number(process.env.UIQ_WEB_PORT ?? 4173);
const webBaseUrl = process.env.UIQ_BASE_URL ?? `http://127.0.0.1:${webPort}`;
const repoRoot = process.cwd();
const defaultWorkers = process.env.CI ? "4" : "50%";

function resolveWorkers() {
  const raw =
    process.env.UIQ_FRONTEND_E2E_WORKERS ??
    process.env.UIQ_PLAYWRIGHT_WORKERS ??
    defaultWorkers;
  if (/^\d+%$/.test(raw)) return raw;
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  throw new Error(
    `Invalid Playwright workers value '${raw}'. Use positive integer or percentage like '50%'.`
  );
}

function resolveRetries() {
  const raw = process.env.UIQ_FRONTEND_E2E_RETRIES ?? process.env.UIQ_PLAYWRIGHT_RETRIES ?? "1";
  const parsed = Number.parseInt(raw, 10);
  if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  throw new Error(`Invalid Playwright retries value '${raw}'. Use a non-negative integer.`);
}

export default defineConfig({
  testDir: path.join(repoRoot, "apps/web/tests/e2e"),
  timeout: 45_000,
  retries: resolveRetries(),
  workers: resolveWorkers(),
  outputDir: path.join(repoRoot, ".runtime-cache/artifacts/test-results/frontend-generic-e2e"),
  reporter: [["list"]],
  use: {
    baseURL: webBaseUrl,
    headless: true,
    screenshot: process.env.PLAYWRIGHT_SCREENSHOT_POLICY ?? "on",
    trace: process.env.PLAYWRIGHT_TRACE_POLICY ?? "retain-on-failure",
    video: process.env.PLAYWRIGHT_VIDEO_POLICY ?? "retain-on-failure"
  }
});
EOF

EXTERNAL_BASE_URL="${UIQ_BASE_URL:-}"
if [[ -n "$EXTERNAL_BASE_URL" ]]; then
  if [[ ! "$EXTERNAL_BASE_URL" =~ ^https?:// ]]; then
    echo "error: UIQ_BASE_URL must start with http:// or https:// (got: $EXTERNAL_BASE_URL)"
    exit 1
  fi
  echo "info: reuse provided runtime at $EXTERNAL_BASE_URL"
  UIQ_BASE_URL="$EXTERNAL_BASE_URL" \
  PLAYWRIGHT_SCREENSHOT_POLICY="$PLAYWRIGHT_SCREENSHOT_POLICY" \
  PLAYWRIGHT_TRACE_POLICY="$PLAYWRIGHT_TRACE_POLICY" \
  PLAYWRIGHT_VIDEO_POLICY="$PLAYWRIGHT_VIDEO_POLICY" \
  pnpm exec playwright test -c "$RUNTIME_E2E_CONFIG" "$@"
  exit 0
fi

PREFERRED_PORT="${UIQ_WEB_PORT:-4173}"
if ! validate_port_number "$PREFERRED_PORT" "UIQ_WEB_PORT"; then
  exit 1
fi

if ! WEB_PORT="$(find_available_port "$PREFERRED_PORT" 50)"; then
  echo "error: no available web port found from $PREFERRED_PORT to $((PREFERRED_PORT + 49))"
  exit 1
fi

if [[ "$WEB_PORT" != "$PREFERRED_PORT" ]]; then
  echo "warn: port $PREFERRED_PORT is in use, e2e fallback to $WEB_PORT"
fi

BACKEND_ORIGIN="${VITE_DEFAULT_BASE_URL:-}"
if [[ -n "$BACKEND_ORIGIN" ]]; then
  if [[ ! "$BACKEND_ORIGIN" =~ ^https?:// ]]; then
    echo "error: VITE_DEFAULT_BASE_URL must start with http:// or https:// (got: $BACKEND_ORIGIN)"
    exit 1
  fi
else
  PREFERRED_BACKEND_PORT="${BACKEND_PORT:-17380}"
  if ! [[ "$PREFERRED_BACKEND_PORT" =~ ^[0-9]+$ ]]; then
    echo "error: BACKEND_PORT must be an integer (got: $PREFERRED_BACKEND_PORT)"
    exit 1
  fi

  if ! BACKEND_PORT_SELECTED="$(find_available_port "$PREFERRED_BACKEND_PORT" 50)"; then
    echo "error: no available backend port found from $PREFERRED_BACKEND_PORT to $((PREFERRED_BACKEND_PORT + 49))"
    exit 1
  fi
  if [[ "$BACKEND_PORT_SELECTED" != "$PREFERRED_BACKEND_PORT" ]]; then
    echo "warn: backend port $PREFERRED_BACKEND_PORT is in use, non-stub e2e fallback to $BACKEND_PORT_SELECTED"
  fi
  BACKEND_ORIGIN="http://127.0.0.1:${BACKEND_PORT_SELECTED}"
fi

if ! extract_url_port "$BACKEND_ORIGIN" >/dev/null; then
  echo "error: unable to derive backend port from VITE_DEFAULT_BASE_URL=$BACKEND_ORIGIN"
  exit 1
fi

WEB_BASE_URL="http://127.0.0.1:${WEB_PORT}"
SERVER_PID=""
SERVER_PGID=""
BACKEND_PID=""
CLEANUP_DONE=0
FRONTEND_LOG_FILE="$RUNTIME_LOG_DIR/frontend.e2e.dev.log"

has_pid() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

get_pgid() {
  local pid="$1"
  ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' '
}

wait_for_exit() {
  local pid="$1"
  local timeout_secs="$2"
  local deadline=$((SECONDS + timeout_secs))
  while has_pid "$pid"; do
    if ((SECONDS >= deadline)); then
      return 1
    fi
    sleep 0.2
  done
  return 0
}

signal_server_group_or_pid() {
  local signal="$1"

  if [[ -n "$SERVER_PGID" && "$SERVER_PGID" =~ ^[0-9]+$ && "$SERVER_PGID" != "$(get_pgid "$$")" ]]; then
    kill "-$signal" -- "-$SERVER_PGID" >/dev/null 2>&1 || true
    return
  fi

  if has_pid "$SERVER_PID"; then
    kill "-$signal" "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}

cleanup() {
  if ((CLEANUP_DONE == 1)); then
    return
  fi
  CLEANUP_DONE=1

  if ! has_pid "$SERVER_PID"; then
    stop_pid_if_running "$BACKEND_PID"
    return
  fi

  signal_server_group_or_pid TERM
  if ! wait_for_exit "$SERVER_PID" 5; then
    signal_server_group_or_pid KILL
    wait_for_exit "$SERVER_PID" 2 || true
  fi

  wait "$SERVER_PID" 2>/dev/null || true
  stop_pid_if_running "$BACKEND_PID"
}
on_interrupt() {
  cleanup
  exit 130
}

on_terminate() {
  cleanup
  exit 143
}

trap cleanup EXIT
trap on_interrupt INT
trap on_terminate TERM

BACKEND_PORT_SELECTED="$(extract_url_port "$BACKEND_ORIGIN")"

if curl -fsS "${BACKEND_ORIGIN}/health/" >/dev/null 2>&1; then
  commands_status="$(curl -s -o /dev/null -w '%{http_code}' "${BACKEND_ORIGIN}/api/automation/commands" || true)"
  if [[ "$commands_status" != "200" ]]; then
    if ! BACKEND_PORT_SELECTED="$(find_available_port "$((BACKEND_PORT_SELECTED + 1))" 50)"; then
      echo "error: backend at ${BACKEND_ORIGIN} requires token and fallback port allocation failed"
      exit 1
    fi
    BACKEND_ORIGIN="http://127.0.0.1:${BACKEND_PORT_SELECTED}"
  fi
fi

ensure_backend_running "$BACKEND_ORIGIN" "$BACKEND_PORT_SELECTED" "$RUNTIME_LOG_DIR/backend.e2e.dev.log" "e2e-backend"
heal_frontend_platform_deps_if_needed

start_frontend_server() {
  : > "$FRONTEND_LOG_FILE"
  if command -v setsid >/dev/null 2>&1; then
    setsid env VITE_DEFAULT_BASE_URL="$BACKEND_ORIGIN" pnpm --dir apps/web dev --host 127.0.0.1 --port "$WEB_PORT" --strictPort > "$FRONTEND_LOG_FILE" 2>&1 &
  else
    env VITE_DEFAULT_BASE_URL="$BACKEND_ORIGIN" pnpm --dir apps/web dev --host 127.0.0.1 --port "$WEB_PORT" --strictPort > "$FRONTEND_LOG_FILE" 2>&1 &
  fi
  SERVER_PID=$!
  SERVER_PGID="$(get_pgid "$SERVER_PID")"
}

start_frontend_server

wait_for_url() {
  local url="$1"
  local timeout_sec="${UIQ_READY_TIMEOUT_SEC:-20}"
  local initial_delay_sec="${UIQ_READY_INITIAL_DELAY_SEC:-0.25}"
  local max_delay_sec="${UIQ_READY_MAX_DELAY_SEC:-2}"
  local jitter_ratio="${UIQ_READY_JITTER_RATIO:-0.2}"
  local total_wait_sec="0"
  local attempt=0
  local delay_sec
  local jittered_sec
  local remaining_sec
  local sleep_sec

  while true; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi

    remaining_sec="$(awk -v timeout="$timeout_sec" -v waited="$total_wait_sec" 'BEGIN { r = timeout - waited; if (r < 0) r = 0; printf "%.6f", r }')"
    if awk -v remaining="$remaining_sec" 'BEGIN { exit !(remaining <= 0) }'; then
      return 1
    fi

    attempt=$((attempt + 1))
    delay_sec="$(awk -v base="$initial_delay_sec" -v cap="$max_delay_sec" -v n="$attempt" 'BEGIN { d = base * (2 ^ (n - 1)); if (d > cap) d = cap; printf "%.6f", d }')"
    rand_unit="$(awk -v r="$RANDOM" 'BEGIN { printf "%.6f", r / 32767 }')"
    jittered_sec="$(awk -v d="$delay_sec" -v ratio="$jitter_ratio" -v unit="$rand_unit" 'BEGIN { lo = d * (1 - ratio); hi = d * (1 + ratio); if (lo < 0) lo = 0; printf "%.6f", lo + unit * (hi - lo) }')"
    sleep_sec="$(awk -v a="$jittered_sec" -v b="$remaining_sec" 'BEGIN { if (a < b) printf "%.6f", a; else printf "%.6f", b }')"
    sleep "$sleep_sec"
    total_wait_sec="$(awk -v waited="$total_wait_sec" -v slept="$sleep_sec" 'BEGIN { printf "%.6f", waited + slept }')"
  done
}

if ! wait_for_url "$WEB_BASE_URL/"; then
  if grep -Eqi "Cannot find module @rollup/rollup-|installed esbuild for another platform|needs the @esbuild/|Host version \".*\" does not match binary version" "$FRONTEND_LOG_FILE"; then
    echo "warn: frontend dev server failed due to platform/version drift, reinstalling workspace deps and retrying once"
    signal_server_group_or_pid TERM
    wait_for_exit "$SERVER_PID" 5 || true
    rm -rf apps/web/node_modules
    CI=true pnpm install --frozen-lockfile || CI=true pnpm install --no-frozen-lockfile
    start_frontend_server
    if ! wait_for_url "$WEB_BASE_URL/"; then
      echo "error: frontend dev server not ready at $WEB_BASE_URL/ after dependency heal retry"
      exit 1
    fi
  else
    echo "error: frontend dev server not ready at $WEB_BASE_URL/"
    exit 1
  fi
fi

UIQ_WEB_PORT="$WEB_PORT" UIQ_BASE_URL="$WEB_BASE_URL" BACKEND_PORT="$BACKEND_PORT_SELECTED" BACKEND_BASE_URL="$BACKEND_ORIGIN" pnpm exec playwright test -c "$RUNTIME_E2E_CONFIG" "$@"
