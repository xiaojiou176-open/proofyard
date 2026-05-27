#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
source "$ROOT_DIR/scripts/lib/python-runtime.sh"
ensure_project_python_env_exports
export RUFF_CACHE_DIR="${ROOT_DIR}/.runtime-cache/cache/ruff"
mkdir -p "$RUFF_CACHE_DIR"

TOTAL_STEPS=5
HEARTBEAT_INTERVAL_SEC="${UIQ_LINT_HEARTBEAT_INTERVAL_SEC:-30}"
if ! [[ "$HEARTBEAT_INTERVAL_SEC" =~ ^[0-9]+$ ]] || [[ "$HEARTBEAT_INTERVAL_SEC" -lt 1 ]]; then
  echo "error: UIQ_LINT_HEARTBEAT_INTERVAL_SEC must be a positive integer" >&2
  exit 2
fi

declare -a PIDS=()
declare -a LABELS=()
declare -a FAILURES=()
failed=0
first_rc=0

launch_task() {
  local step="$1"
  local label="$2"
  shift 2
  local prefix="[lint-all ${step}/${TOTAL_STEPS}][${label}]"

  (
    echo "${prefix} START"
    "$@" \
      > >(awk -v p="$prefix" '{ print p " " $0; fflush(); }') \
      2> >(awk -v p="$prefix" '{ print p " " $0; fflush(); }' >&2)
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
}

run_long_with_heartbeat() {
  local label="$1"
  local command="$2"
  bash scripts/ci/with-heartbeat.sh "$HEARTBEAT_INTERVAL_SEC" "$label" "$command"
}

run_backend_lint() {
  local fallback_venv=".runtime-cache/ci-python-venv"

  if command -v uv >/dev/null 2>&1; then
    uv run --extra dev ruff check apps/api/app apps/api/tests
    return
  fi
  if python3 -m ruff --version >/dev/null 2>&1; then
    python3 -m ruff check apps/api/app apps/api/tests
    return
  fi
  if [[ -x "$(project_ruff_bin)" ]] && "$(project_ruff_bin)" --version >/dev/null 2>&1; then
    "$(project_ruff_bin)" check apps/api/app apps/api/tests
    return
  fi
  if [[ ! -x "${fallback_venv}/bin/python3" ]]; then
    if ! python3 -m venv "${fallback_venv}" >/dev/null 2>&1; then
      if command -v apt-get >/dev/null 2>&1; then
        apt-get update >/dev/null
        DEBIAN_FRONTEND=noninteractive apt-get install -y python3-venv >/dev/null
      fi
      python3 -m venv "${fallback_venv}"
    fi
  fi
  "${fallback_venv}/bin/pip" install --quiet ruff
  "${fallback_venv}/bin/ruff" check apps/api/app apps/api/tests
}

install_workspace_deps_serialized() {
  local lock_root=".runtime-cache/locks"
  local lock_dir="${lock_root}/lint-all-workspace-install.lock.d"
  local lock_pid_file="${lock_dir}/pid"
  mkdir -p "$lock_root"

  while ! mkdir "$lock_dir" 2>/dev/null; do
    if [[ -f "$lock_pid_file" ]]; then
      local holder_pid=""
      holder_pid="$(cat "$lock_pid_file" 2>/dev/null || true)"
      if [[ -n "$holder_pid" ]] && ! kill -0 "$holder_pid" >/dev/null 2>&1; then
        rm -f "$lock_pid_file" 2>/dev/null || true
        rmdir "$lock_dir" 2>/dev/null || true
        continue
      fi
    elif [[ -d "$lock_dir" ]]; then
      rmdir "$lock_dir" 2>/dev/null || true
      if [[ ! -d "$lock_dir" ]]; then
        continue
      fi
    fi
    sleep 1
  done
  printf '%s\n' "$$" >"$lock_pid_file"

  echo "[lint-all] installing workspace deps under lock..."
  CI=true pnpm install --frozen-lockfile || CI=true pnpm install --no-frozen-lockfile
  rm -f "$lock_pid_file" 2>/dev/null || true
  rmdir "$lock_dir" 2>/dev/null || true
}

if [[ "${1:-}" == "--workspace-install-only" ]]; then
  install_workspace_deps_serialized
  exit 0
fi

run_root_typecheck() {
  pnpm typecheck || {
    echo "[lint-all] root typecheck prerequisites missing, installing workspace deps..."
    install_workspace_deps_serialized
    pnpm typecheck
  }
}

run_mcp_server_typecheck() {
  pnpm mcp:check || {
    echo "[lint-all] mcp typecheck prerequisites missing, installing workspace deps..."
    install_workspace_deps_serialized
    pnpm mcp:check
  }
}

launch_task "1" "root typecheck" run_root_typecheck
launch_task "2" "backend lint (ruff)" run_backend_lint
launch_task "5" "mcp server typecheck" run_mcp_server_typecheck
echo "[phase] short-lint"

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
    if (( first_rc == 0 )); then
      first_rc="$rc"
    fi
  done
  PIDS=()
  LABELS=()
}

wait_tasks

if (( failed == 0 )); then
  echo "[phase] long-lint"
  launch_task "3" "frontend eslint" run_long_with_heartbeat "frontend-eslint" \
    "pnpm --dir apps/web lint || { \
      echo '[lint-all] frontend lint prerequisites missing, installing frontend deps...'; \
      bash scripts/ci/lint-all.sh --workspace-install-only; \
      pnpm --dir apps/web lint; \
    }"
  launch_task "4" "automation eslint" run_long_with_heartbeat "automation-eslint" \
    "pnpm --dir apps/automation-runner lint || { \
      echo '[lint-all] automation lint prerequisites missing, installing automation deps...'; \
      bash scripts/ci/lint-all.sh --workspace-install-only; \
      pnpm --dir apps/automation-runner lint; \
    }"
  wait_tasks
fi

if (( failed > 0 )); then
  echo "lint-all failed (${failed} task(s)):" >&2
  for item in "${FAILURES[@]}"; do
    echo " - ${item}" >&2
  done
  exit "$first_rc"
fi

echo "lint-all passed"
