#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
source scripts/lib/backend_lifecycle.sh
source scripts/lib/ports.sh
source scripts/lib/python-runtime.sh

ensure_project_python_env_exports

DEFAULT_BACKEND_PORT=17380
requested_backend_port="${BACKEND_PORT:-$DEFAULT_BACKEND_PORT}"
backend_port="$requested_backend_port"
spawned_backend_pid=""
effective_backend_base_url=""
effective_universal_data_dir="${UNIVERSAL_PLATFORM_DATA_DIR:-./.runtime-cache/automation/universal}"
effective_universal_runtime_dir="${UNIVERSAL_AUTOMATION_RUNTIME_DIR:-./.runtime-cache/automation}"
ci_test_output_root=".runtime-cache/artifacts/ci/test-output"
automation_api_token="${AUTOMATION_API_TOKEN:-uiq-frontend-nonstub-token-12345}"
automation_client_id="${VITE_DEFAULT_AUTOMATION_CLIENT_ID:-client-frontend-e2e}"
default_frontend_e2e_grep="${UIQ_FRONTEND_E2E_GREP:-@frontend-nonstub-main|@frontend-nonstub|@nonstub}"
backend_log_path=".runtime-cache/logs/backend.frontend-nonstub.log"
health_retries="${UIQ_FRONTEND_NONSTUB_BACKEND_HEALTH_RETRIES:-120}"
health_interval_seconds="${UIQ_FRONTEND_NONSTUB_BACKEND_HEALTH_INTERVAL_SECONDS:-0.5}"

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
    if grep -Eqi "Cannot find module @rollup/rollup-|installed esbuild for another platform|needs the @esbuild/" "$run_log"; then
      echo "[frontend-nonstub] frontend platform deps mismatched, reinstalling workspace deps..."
      rm -rf apps/web/node_modules
      CI=true pnpm install --frozen-lockfile || CI=true pnpm install --no-frozen-lockfile
    else
      rm -f "$run_log"
      return "$status"
    fi
  fi
  rm -f "$run_log"
}

cleanup() {
  stop_pid_if_running "$spawned_backend_pid"
}
trap cleanup EXIT

if curl -fsS "http://127.0.0.1:${backend_port}/health/" >/dev/null 2>&1; then
  commands_status="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${backend_port}/api/automation/commands" || true)"
  if [[ "$commands_status" != "200" ]]; then
    backend_port="$(find_available_port "$DEFAULT_BACKEND_PORT")"
  fi
fi

if ! curl -fsS "http://127.0.0.1:${backend_port}/health/" >/dev/null 2>&1; then
  mkdir -p .runtime-cache/logs "$ci_test_output_root"
  isolated_scope="frontend-nonstub-${backend_port}-$$"
  isolated_sqlite="${ci_test_output_root}/${isolated_scope}.sqlite3"
  isolated_universal_data_dir="${ci_test_output_root}/${isolated_scope}-universal-data"
  isolated_universal_runtime_dir="${ci_test_output_root}/${isolated_scope}-universal-runtime"
  effective_universal_data_dir="./${isolated_universal_data_dir}"
  effective_universal_runtime_dir="./${isolated_universal_runtime_dir}"
  mkdir -p "$isolated_universal_data_dir" "$isolated_universal_runtime_dir"
  launcher=()
  if [[ -x "$(project_uvicorn_bin)" ]] && "$(project_uvicorn_bin)" --version >/dev/null 2>&1; then
    launcher=("$(project_uvicorn_bin)")
  elif command -v uv >/dev/null 2>&1; then
    launcher=("uv" "run" "--extra" "dev" "uvicorn")
  elif command -v uvicorn >/dev/null 2>&1; then
    launcher=("$(command -v uvicorn)")
  else
    echo "[frontend-nonstub-backend] uvicorn launcher unavailable: expected managed python env uvicorn, uvicorn, or uv" >&2
    exit 1
  fi
  echo "[frontend-nonstub-backend] backend not running, starting temporary backend on http://127.0.0.1:${backend_port}"
  echo "[frontend-nonstub-backend] backend launcher: ${launcher[*]}"
  APP_ENV=test \
  AUTOMATION_API_TOKEN="$automation_api_token" \
  AUTOMATION_ALLOW_LOCAL_NO_TOKEN=true \
  AUTOMATION_REQUIRE_TOKEN=true \
  DATABASE_URL="sqlite+pysqlite:///./${isolated_sqlite}" \
  UNIVERSAL_PLATFORM_DATA_DIR="$effective_universal_data_dir" \
  UNIVERSAL_AUTOMATION_RUNTIME_DIR="$effective_universal_runtime_dir" \
    "${launcher[@]}" apps.api.app.main:app --host 127.0.0.1 --port "$backend_port" \
    > "$backend_log_path" 2>&1 &
  spawned_backend_pid="$!"
  echo "[frontend-nonstub-backend] spawned backend pid=${spawned_backend_pid} log=${backend_log_path}"
  if ! wait_for_backend_health \
    "http://127.0.0.1:${backend_port}" \
    "$health_retries" \
    "$health_interval_seconds" \
    "$spawned_backend_pid" \
    "frontend-nonstub-backend" \
    "$backend_log_path"; then
    echo "[frontend-nonstub-backend] backend failed to start after $((health_retries / 2))s, see ${backend_log_path}" >&2
    print_backend_log_tail "$backend_log_path" 120
    exit 1
  fi
  echo "[frontend-nonstub-backend] temporary backend ready (pid=${spawned_backend_pid})"
fi

effective_backend_base_url="http://127.0.0.1:${backend_port}"

heal_frontend_platform_deps_if_needed

BACKEND_PORT="$backend_port" \
BACKEND_BASE_URL="$effective_backend_base_url" \
AUTOMATION_API_TOKEN="$automation_api_token" \
VITE_DEFAULT_AUTOMATION_TOKEN="$automation_api_token" \
VITE_DEFAULT_AUTOMATION_CLIENT_ID="$automation_client_id" \
UNIVERSAL_PLATFORM_DATA_DIR="$effective_universal_data_dir" \
UNIVERSAL_AUTOMATION_RUNTIME_DIR="$effective_universal_runtime_dir" \
UIQ_FRONTEND_E2E_GREP="$default_frontend_e2e_grep" \
  pnpm exec playwright test -c tests/frontend-e2e/playwright.config.ts "$@"
