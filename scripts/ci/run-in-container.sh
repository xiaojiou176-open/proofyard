#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

export PYTHONDONTWRITEBYTECODE="${PYTHONDONTWRITEBYTECODE:-1}"

readonly RUNTIME_LOCK_PATH="${UIQ_CI_RUNTIME_LOCK_PATH:-configs/ci/runtime.lock.json}"
readonly SUPPORTED_TASKS=(
  contract
  security-scan
  preflight-minimal
  lint
  backend-lint
  backend-smoke
  backend-full
  frontend-lint
  frontend-full
  core-static-gates
  coverage
  live-smoke
  gemini-web-audit
  mutation-ts
  mutation-py
  mutation-effective
  orchestrator-contract
  mcp-check
  test-truth-gate
  backend-tests
  root-web-typecheck
  root-web-unit
  root-web-ct
  root-web-e2e
  frontend-build
  frontend-ui-audit
  automation-tests
  frontend-authenticity
  frontend-nonstub
  frontend-critical
  functional-regression-matrix
  functional-regression-targeted
  pr-lint-frontend
  pr-static-gate
  pr-frontend-e2e-behavior-shard
  pr-frontend-e2e-shard
  pr-mcp-gate
  pr-run-profile
  pr-quality-gate
  nightly-frontend-e2e-shard
  nightly-backend-tests-shard
  nightly-integration-full
  nightly-core-run
  nightly-hard-gates
  manual-core-run
  release-docs-gate
  release-typecheck
  release-candidate-gate
)

TASK="contract"
GATE_NAME="unspecified"
STRICT="${UIQ_CONTAINER_GATE_STRICT:-true}"
IMAGE="${UIQ_CI_IMAGE_REF:-}"
WORKDIR="${UIQ_CONTAINER_GATE_WORKDIR:-/workspace}"
NETWORK="${UIQ_CONTAINER_GATE_NETWORK:-host}"
DRY_RUN=false
LIST_TASKS=false

usage() {
  cat <<'EOF'
Usage: bash scripts/ci/run-in-container.sh [options]

Options:
  --task <name>          Container gate task (default: contract)
  --gate <name>          Caller gate name for logs/artifacts
  --strict <true|false>  Fail when Docker runtime is unavailable (default: true)
  --image <image>        Override repo-owned CI image ref
  --workdir <path>       In-container workspace mount target
  --network <mode>       Docker network mode for non-contract tasks
  --list-tasks           Print the canonical supported task list and exit
  --dry-run              Print commands without executing
  -h, --help             Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --task)
      TASK="${2:-}"
      shift 2
      ;;
    --gate)
      GATE_NAME="${2:-}"
      shift 2
      ;;
    --strict)
      STRICT="${2:-}"
      shift 2
      ;;
    --image)
      IMAGE="${2:-}"
      shift 2
      ;;
    --workdir)
      WORKDIR="${2:-}"
      shift 2
      ;;
    --network)
      NETWORK="${2:-}"
      shift 2
      ;;
    --list-tasks)
      LIST_TASKS=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[container-gate] unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$LIST_TASKS" == "true" ]]; then
  printf '%s\n' "${SUPPORTED_TASKS[@]}"
  exit 0
fi

supports_task() {
  local wanted="$1"
  local task
  for task in "${SUPPORTED_TASKS[@]}"; do
    if [[ "$task" == "$wanted" ]]; then
      return 0
    fi
  done
  return 1
}

task_prefers_host_on_local_arm() {
  local task="$1"
  case "$task" in
    live-smoke|gemini-web-audit|mutation-ts|mutation-py|orchestrator-contract|mcp-check)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

if ! supports_task "$TASK"; then
  echo "[container-gate] unsupported task '$TASK' (supported: ${SUPPORTED_TASKS[*]})" >&2
  exit 2
fi

if [[ "$STRICT" != "true" && "$STRICT" != "false" ]]; then
  echo "[container-gate] --strict must be true or false" >&2
  exit 2
fi

run_cmd() {
  if [[ "$DRY_RUN" == "true" ]]; then
    printf '[dry-run] %q ' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

COMPOSE_ENV_CREATED=false
cleanup_compose_env_file() {
  if [[ "$COMPOSE_ENV_CREATED" == "true" ]]; then
    rm -f .env
    echo "[container-gate] cleaned generated .env"
  fi
}
trap cleanup_compose_env_file EXIT

check_contract_files() {
  bash scripts/ci/check-iac-exists.sh
  if [[ ! -f "$RUNTIME_LOCK_PATH" ]]; then
    echo "[container-gate] missing runtime lock: $RUNTIME_LOCK_PATH" >&2
    exit 1
  fi
}

check_docker_runtime() {
  if ! command -v docker >/dev/null 2>&1; then
    if [[ "$STRICT" == "true" ]]; then
      echo "[container-gate] failed: docker command not found" >&2
      exit 1
    fi
    echo "[container-gate] skipped: docker command not found (strict=false)"
    exit 0
  fi
}

docker_compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
    return 0
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
    return 0
  fi
  return 1
}

check_docker_compose() {
  if ! docker_compose_cmd >/dev/null 2>&1; then
    if [[ "$STRICT" == "true" ]]; then
      echo "[container-gate] failed: docker compose unavailable" >&2
      exit 1
    fi
    echo "[container-gate] skipped: docker compose unavailable (strict=false)"
    exit 0
  fi
}

resolve_compose_project_name() {
  local raw_name
  raw_name="$(basename "$ROOT_DIR")"

  local safe_name
  safe_name="$(printf '%s' "$raw_name" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"

  if [[ -z "$safe_name" ]]; then
    safe_name="uiq-container-gate"
  fi

  printf '%s' "$safe_name"
}

ensure_baseline_contract() {
  check_contract_files
  if [[ ! -f .env ]]; then
    if [[ -f .env.example ]]; then
      cp .env.example .env
      echo "[container-gate] generated .env from .env.example for compose contract check"
    else
      : > .env
      echo "[container-gate] generated empty .env for compose contract check"
    fi
    COMPOSE_ENV_CREATED=true
  fi
  check_docker_runtime
  check_docker_compose
  local host_arch
  host_arch="$(uname -m)"
  if [[ "$DRY_RUN" != "true" ]] && task_prefers_host_on_local_arm "$TASK" && [[ "${UIQ_HOST_ARCH:-${host_arch}}" =~ ^(aarch64|arm64)$ ]]; then
    echo "[container-gate] local arm host detected; skipping local CI image resolution because task has a host fallback path"
    return 0
  fi
  local compose_project
  local compose_cmd
  compose_project="$(resolve_compose_project_name)"
  compose_cmd="$(docker_compose_cmd)"
  if [[ "$compose_cmd" == "docker compose" ]]; then
    run_cmd docker compose -p "$compose_project" config -q
  else
    COMPOSE_PROJECT_NAME="$compose_project" run_cmd docker-compose config -q
  fi
  if [[ -z "$IMAGE" ]]; then
    local -a resolve_args=(--output ref)
    if [[ "$DRY_RUN" == "true" ]]; then
      resolve_args+=(--dry-run)
    elif [[ "$TASK" != "contract" ]]; then
      resolve_args+=(--ensure-local)
    fi
    IMAGE="$(bash scripts/ci/resolve-ci-image.sh "${resolve_args[@]}")"
  fi
  case "$IMAGE" in
    ghcr.io/*/ci:*|ghcr.io/*/ci@sha256:*) ;;
    *)
      echo "[container-gate] repo-owned ci image required, got: $IMAGE" >&2
      exit 1
      ;;
  esac
  if [[ "$TASK" != "contract" && "$DRY_RUN" != "true" ]] && ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    local prefer_local_rebuild=false
    if [[ "$TASK" == "pr-run-profile" && ( "$IMAGE" == ghcr.io/*/ci:* || "$IMAGE" == ghcr.io/*/ci@sha256:* ) ]]; then
      prefer_local_rebuild=true
    fi
    if [[ "$IMAGE" == ghcr.io/* && -n "${GITHUB_TOKEN:-}" ]]; then
      local ghcr_home ghcr_config
      ghcr_home="${ROOT_DIR}/.runtime-cache/container-home/ghcr-login"
      ghcr_config="${ghcr_home}/.docker"
      mkdir -p "$ghcr_config"
      printf '%s\n' '{"auths":{},"credsStore":"","credHelpers":{}}' > "${ghcr_config}/config.json"
      HOME="$ghcr_home" DOCKER_CONFIG="$ghcr_config" \
        run_cmd bash -lc "printf '%s' \"\$GITHUB_TOKEN\" | docker login ghcr.io -u \"\${GITHUB_ACTOR:-github-actions[bot]}\" --password-stdin"
    fi
    if [[ "$prefer_local_rebuild" == "true" ]]; then
      echo "[container-gate] pr-run-profile requires a local CI image rebuild from the current runtime lock" >&2
      local built_image_ref
      built_image_ref="$(bash scripts/ci/build-ci-image.sh | tail -n 1)"
      if [[ "$built_image_ref" != "$IMAGE" ]]; then
        echo "[container-gate] local CI image fallback resolved '$built_image_ref' while gate expected '$IMAGE'" >&2
        exit 1
      fi
    elif ! run_cmd docker pull "$IMAGE"; then
      if [[ "$IMAGE" == ghcr.io/*/ci:* || "$IMAGE" == ghcr.io/*/ci@sha256:* ]]; then
        echo "[container-gate] repo-owned CI image pull failed; rebuilding locally from runtime lock" >&2
        local built_image_ref
        built_image_ref="$(bash scripts/ci/build-ci-image.sh | tail -n 1)"
        if [[ "$built_image_ref" != "$IMAGE" ]]; then
          echo "[container-gate] local CI image fallback resolved '$built_image_ref' while gate expected '$IMAGE'" >&2
          exit 1
        fi
      else
        exit 1
      fi
    fi
  fi
}

run_task_in_container() {
  local task_cmd="$1"
  local host_uid host_gid host_arch artifact_dir container_home host_home container_uv_env bootstrap_cmd trusted_bin_dirs
  host_uid="$(id -u)"
  host_gid="$(id -g)"
  host_arch="$(uname -m)"
  artifact_dir="${ROOT_DIR}/.runtime-cache/artifacts/ci"
  container_home="${WORKDIR}/.runtime-cache/container-home"
  host_home="${ROOT_DIR}/.runtime-cache/container-home"
  container_uv_env="${container_home}/.local/share/uv/project-venv"
  trusted_bin_dirs="${UIQ_TRUSTED_BIN_DIRS:-${container_home}/.local/bin,/usr/bin,/bin,/usr/local/bin,/opt/homebrew/bin}"
  mkdir -p \
    "$artifact_dir" \
    "$host_home/.cache" \
    "$host_home/.config" \
    "$host_home/.local/bin" \
    "$host_home/.local/share" \
    "$host_home/.local/share/uv"
  if [[ "$DRY_RUN" != "true" ]]; then
    chmod u+rwx "$artifact_dir" 2>/dev/null || true
  fi
  bootstrap_cmd="$(cat <<EOF
export PATH="\$HOME/.local/bin:\$PATH"; mkdir -p "\$HOME/.local/bin" "\$HOME/.local/share/uv"; npm install --prefix "\$HOME/.local" -g pnpm@10.22.0 >/dev/null 2>&1 || { corepack enable >/dev/null 2>&1 || true; corepack prepare pnpm@10.22.0 --activate >/dev/null 2>&1 || true; cat > "\$HOME/.local/bin/pnpm" <<'EOF_PNPM'
#!/usr/bin/env bash
exec corepack pnpm "\$@"
EOF_PNPM
chmod +x "\$HOME/.local/bin/pnpm"; }; if ! command -v uv >/dev/null 2>&1; then curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1 || true; fi; mkdir -p "${WORKDIR}/.runtime-cache/artifacts/ci"
EOF
)"
  local -a env_args=(
    "-e" "HOME=${container_home}"
    "-e" "XDG_CACHE_HOME=${container_home}/.cache"
    "-e" "XDG_CONFIG_HOME=${container_home}/.config"
    "-e" "XDG_DATA_HOME=${container_home}/.local/share"
    "-e" "UV_PROJECT_ENVIRONMENT=${container_uv_env}"
    "-e" "CI=${CI:-true}"
    "-e" "UIQ_HOST_ARCH=${UIQ_HOST_ARCH:-${host_arch}}"
    "-e" "UIQ_TRUSTED_BIN_DIRS=${trusted_bin_dirs}"
  )
  local forward_vars=(
    GEMINI_API_KEY
    UIQ_BASE_URL
    UIQ_COVERAGE_GLOBAL_MIN
    UIQ_COVERAGE_CORE_MIN
    UIQ_COVERAGE_ENFORCE_GLOBAL_BRANCHES
    UIQ_COVERAGE_GLOBAL_BRANCHES_MIN
    UIQ_COVERAGE_PYTEST_N
    UIQ_GEMINI_LIVE_SMOKE_REQUIRED
    UIQ_GEMINI_LIVE_SMOKE_RETRIES
    UIQ_GEMINI_LIVE_SMOKE_TIMEOUT_MS
    UIQ_GEMINI_LIVE_BROWSER_TIMEOUT_MS
    UIQ_GEMINI_LIVE_SMOKE_ENDPOINT
    UIQ_GEMINI_LIVE_SMOKE_MODEL
    UIQ_GEMINI_LIVE_SMOKE_PROMPT
    UIQ_FRONTEND_E2E_GREP
    BACKEND_PORT
    BACKEND_BASE_URL
    AUTOMATION_API_TOKEN
    VITE_DEFAULT_AUTOMATION_TOKEN
    VITE_DEFAULT_AUTOMATION_CLIENT_ID
    UNIVERSAL_PLATFORM_DATA_DIR
    UNIVERSAL_AUTOMATION_RUNTIME_DIR
    E2E_STUB_NONSTUB_MAX_RATIO
    E2E_COUNTERFACTUAL_REQUIRED_DIRS
    E2E_COUNTERFACTUAL_REQUIRED_TAG
    E2E_COUNTERFACTUAL_MIN_FILES_PER_DIR
    UIQ_COMMITLINT_FROM
    UIQ_COMMITLINT_TO
    UIQ_SHARD_INDEX
    UIQ_SHARD_TOTAL
    GITHUB_REPOSITORY
    GH_REPO
    GH_TOKEN
    UIQ_AUTO_TICKETING
    CI
    GITHUB_ACTIONS
    UIQ_CI_IMAGE_REF
    UIQ_CI_IMAGE_DIGEST
    UIQ_K6_VERSION
    UIQ_SEMGREP_VERSION
    UIQ_MCP_STRESS_PARALLEL
    UIQ_MCP_STRESS_TIME_BUDGET_MS
    GITHUB_SHA
    GITHUB_BASE_REF
  )

  for var_name in "${forward_vars[@]}"; do
    if [[ "${!var_name+x}" == "x" ]]; then
      env_args+=("-e" "${var_name}")
    fi
  done

  local -a docker_cmd=(
    docker run --rm
    --network "$NETWORK"
    --user "${host_uid}:${host_gid}"
    -v "${ROOT_DIR}:${WORKDIR}"
    -w "$WORKDIR"
  )
  if [[ ${#env_args[@]} -gt 0 ]]; then
    docker_cmd+=("${env_args[@]}")
  fi
  docker_cmd+=(
    "$IMAGE"
    bash -lc "${bootstrap_cmd}; ${task_cmd}"
  )
  run_cmd "${docker_cmd[@]}"
}

run_script_in_container() {
  local script_body="$1"
  run_task_in_container "$script_body"
}

ensure_baseline_contract

echo "[container-gate] gate=${GATE_NAME} task=${TASK} strict=${STRICT} dry_run=${DRY_RUN} image=${IMAGE} runtime_lock=${RUNTIME_LOCK_PATH}"

case "$TASK" in
  contract)
    echo "[container-gate] passed: container baseline contract verified"
    ;;
  security-scan)
    run_task_in_container "bash scripts/security-scan.sh"
    echo "[container-gate] passed: security scan executed in container"
    ;;
  preflight-minimal)
    run_task_in_container "pnpm install --frozen-lockfile >/dev/null 2>&1 && node --import tsx --test packages/orchestrator/src/commands/run.test.ts packages/orchestrator/src/commands/run.runid.test.ts && pnpm mcp:check"
    echo "[container-gate] passed: preflight minimal executed in container"
    ;;
  lint)
    run_task_in_container "bash scripts/ci/lint-all.sh"
    echo "[container-gate] passed: lint executed in container"
    ;;
  backend-lint)
    run_task_in_container "uv sync --frozen --extra dev >/dev/null 2>&1 && RUFF_CACHE_DIR=.runtime-cache/cache/ruff uv run ruff check apps/api/app apps/api/tests"
    echo "[container-gate] passed: backend lint executed in container"
    ;;
  backend-smoke)
    run_script_in_container "$(cat <<'EOF'
uv sync --frozen --extra dev >/dev/null 2>&1
uv lock --check
mkdir -p .runtime-cache/artifacts/ci/test-output
DATABASE_URL="sqlite+pysqlite:///./.runtime-cache/artifacts/ci/test-output/backend-tests-main.sqlite3" uv run alembic -c apps/api/alembic.ini upgrade heads
RUFF_CACHE_DIR=.runtime-cache/cache/ruff uv run ruff check apps/api/app/api/health.py apps/api/tests/test_health.py
uv run pytest -n0 apps/api/tests/test_health.py --cov=apps/api/app/api/health.py --cov-report=term-missing --cov-fail-under=80
EOF
)"
    echo "[container-gate] passed: backend smoke executed in container"
    ;;
  backend-full)
    run_script_in_container "$(cat <<'EOF'
uv sync --frozen --extra dev >/dev/null 2>&1
uv lock --check
mkdir -p .runtime-cache/artifacts/ci/test-output
DATABASE_URL="sqlite+pysqlite:///./.runtime-cache/artifacts/ci/test-output/backend-tests-main.sqlite3" uv run alembic -c apps/api/alembic.ini upgrade heads
uv run pip freeze | grep -Ev '^(#|-e )|^webaudit==' > /tmp/requirements-audit.txt
uvx --from pip-audit pip-audit --strict --no-deps --disable-pip -r /tmp/requirements-audit.txt
uvx --from bandit bandit -ll -r apps/api/app
uv run python scripts/check-openapi-doc-contract.py
uv run pytest -n auto --dist=loadscope --cov-fail-under=80
EOF
)"
    echo "[container-gate] passed: backend full executed in container"
    ;;
  frontend-lint)
    run_task_in_container "pnpm install --frozen-lockfile >/dev/null 2>&1 && pnpm --dir apps/web lint"
    echo "[container-gate] passed: frontend lint executed in container"
    ;;
  frontend-full)
    run_script_in_container "$(cat <<'EOF'
pnpm install --frozen-lockfile >/dev/null 2>&1
pnpm --dir apps/web lint &
lint_pid=$!
pnpm --dir apps/web audit --audit-level=high &
audit_pid=$!
wait "$lint_pid"
wait "$audit_pid"
pnpm --dir apps/web test
pnpm --dir apps/web build
CHROME_PATH="$(pnpm exec node --input-type=module <<'NODE'
import { chromium } from "playwright"
process.stdout.write(chromium.executablePath())
NODE
)"
export CHROME_PATH
pnpm --dir apps/web audit:ui
EOF
)"
    echo "[container-gate] passed: frontend full executed in container"
    ;;
  core-static-gates)
    run_script_in_container "$(cat <<'EOF'
pnpm install --frozen-lockfile >/dev/null 2>&1
uv sync --frozen --extra dev >/dev/null 2>&1
pnpm audit:prod
pnpm audit:tooling
pnpm deps:assert:no-openai
./scripts/release/check-workflow-pnpm-version-guard.sh
pnpm env:governance:check
pnpm env:check
pnpm contracts:check-openapi-coverage
bash -n scripts/release/check-workflow-pnpm-version-guard.sh scripts/release/generate-release-notes.sh
bash -n scripts/ci/gate-openai-residue.sh
node --check scripts/ci/check-gemini-sdk-versions.mjs
node --check scripts/ci/check-threshold-doc-sync.mjs
node --check scripts/ci/uiq-flake-budget.mjs
node --check scripts/ci/uiq-failure-ticketing.mjs
node --check scripts/ci/uiq-cross-target-benchmark.mjs
node --check scripts/ci/uiq-sla-and-clusters.mjs
node --check scripts/ci/uiq-gemini-live-smoke-gate.mjs
node --check scripts/ci/verify-run-evidence.mjs
node --check scripts/perf/perf-regression-guard.mjs
node --check scripts/api/check-breaking-contract.mjs
bash scripts/ci/self-proof-suite.sh
node scripts/ci/check-gemini-sdk-versions.mjs
node scripts/api/check-breaking-contract.mjs
EOF
)"
    echo "[container-gate] passed: core static gates executed in container"
    ;;
  coverage)
    run_task_in_container "bash scripts/ci/run-unit-coverage-gate.sh"
    echo "[container-gate] passed: coverage gate executed in container"
    ;;
  live-smoke)
    if [[ "$DRY_RUN" != "true" && "${UIQ_HOST_ARCH:-${host_arch:-$(uname -m)}}" =~ ^(aarch64|arm64)$ ]]; then
      echo "[container-gate] local arm host detected; running live smoke on host to avoid amd64 browser emulation issues"
      run_cmd pnpm test:gemini:live-smoke
      echo "[container-gate] passed: live smoke executed on host"
    else
      run_task_in_container "pnpm exec playwright install --with-deps chromium >/dev/null 2>&1 && pnpm test:gemini:live-smoke"
      echo "[container-gate] passed: live smoke executed in container"
    fi
    ;;
  gemini-web-audit)
    if [[ "$DRY_RUN" != "true" && "${UIQ_HOST_ARCH:-${host_arch:-$(uname -m)}}" =~ ^(aarch64|arm64)$ ]]; then
      echo "[container-gate] local arm host detected; running gemini web audit on host to avoid amd64 browser emulation issues"
      run_cmd pnpm test:gemini:web-audit
      echo "[container-gate] passed: gemini web audit executed on host"
    else
      run_task_in_container "pnpm exec playwright install --with-deps chromium >/dev/null 2>&1 && pnpm test:gemini:web-audit"
      echo "[container-gate] passed: gemini web audit executed in container"
    fi
    ;;
  mutation-ts)
    if [[ "$DRY_RUN" != "true" && "${UIQ_HOST_ARCH:-${host_arch:-$(uname -m)}}" =~ ^(aarch64|arm64)$ ]]; then
      echo "[container-gate] local arm host detected; running ts mutation on host to avoid amd64 emulation timeout"
      run_cmd pnpm mutation:ts:strict
      echo "[container-gate] passed: ts mutation executed on host"
    else
      run_task_in_container "pnpm mutation:ts:strict"
      echo "[container-gate] passed: ts mutation executed in container"
    fi
    ;;
  mutation-py)
    if [[ "$DRY_RUN" != "true" && "${UIQ_HOST_ARCH:-${host_arch:-$(uname -m)}}" =~ ^(aarch64|arm64)$ ]]; then
      echo "[container-gate] local arm host detected; running python mutation on host to avoid amd64 emulation slowdown"
      run_cmd pnpm mutation:py:strict
      echo "[container-gate] passed: python mutation executed on host"
    else
      run_task_in_container "pnpm mutation:py:strict"
      echo "[container-gate] passed: python mutation executed in container"
    fi
    ;;
  mutation-effective)
    run_task_in_container "UIQ_MUTATION_REQUIRED_CONTEXT=true UIQ_MUTATION_PY_MAX_SURVIVED=${UIQ_MUTATION_PY_MAX_SURVIVED:-0} UIQ_MUTATION_TS_MIN_TOTAL=${UIQ_MUTATION_TS_MIN_TOTAL:-50} UIQ_MUTATION_PY_MIN_TOTAL=${UIQ_MUTATION_PY_MIN_TOTAL:-249} pnpm mutation:effective"
    echo "[container-gate] passed: mutation effective gate executed in container"
    ;;
  orchestrator-contract)
    if [[ "$DRY_RUN" != "true" && "${UIQ_HOST_ARCH:-${host_arch:-$(uname -m)}}" =~ ^(aarch64|arm64)$ ]]; then
      echo "[container-gate] local arm host detected; running orchestrator contract tests on host to avoid amd64 CI image emulation failures"
      run_cmd pnpm install --frozen-lockfile >/dev/null 2>&1
      run_cmd node --import tsx --test packages/orchestrator/src/commands/run.test.ts packages/orchestrator/src/commands/run.runid.test.ts
      echo "[container-gate] passed: orchestrator contract tests executed on host"
    else
      run_task_in_container "pnpm install --frozen-lockfile >/dev/null 2>&1 && node --import tsx --test packages/orchestrator/src/commands/run.test.ts packages/orchestrator/src/commands/run.runid.test.ts"
      echo "[container-gate] passed: orchestrator contract tests executed in container"
    fi
    ;;
  mcp-check)
    if [[ "$DRY_RUN" != "true" && "${UIQ_HOST_ARCH:-${host_arch:-$(uname -m)}}" =~ ^(aarch64|arm64)$ ]]; then
      echo "[container-gate] local arm host detected; running mcp check on host to avoid amd64 CI image emulation failures"
      run_cmd pnpm install --frozen-lockfile >/dev/null 2>&1
      run_cmd pnpm mcp:check
      echo "[container-gate] passed: mcp check executed on host"
    else
      run_task_in_container "pnpm install --frozen-lockfile >/dev/null 2>&1 && pnpm mcp:check"
      echo "[container-gate] passed: mcp check executed in container"
    fi
    ;;
  test-truth-gate)
    run_task_in_container "pnpm install --frozen-lockfile >/dev/null 2>&1 && node scripts/ci/uiq-test-truth-gate.mjs --profile preflight --strict true"
    echo "[container-gate] passed: test truth gate executed in container"
    ;;
  backend-tests)
    run_task_in_container "uv sync --frozen --extra dev >/dev/null 2>&1 && uv run pytest"
    echo "[container-gate] passed: backend tests executed in container"
    ;;
  root-web-typecheck)
    run_task_in_container "pnpm install --frozen-lockfile >/dev/null 2>&1 && pnpm exec tsc -p apps/web/tsconfig.app.json --noEmit"
    echo "[container-gate] passed: root web typecheck executed in container"
    ;;
  root-web-unit)
    run_task_in_container "pnpm install --frozen-lockfile >/dev/null 2>&1 && pnpm test:unit"
    echo "[container-gate] passed: root web unit executed in container"
    ;;
  root-web-ct)
    run_task_in_container "pnpm install --frozen-lockfile >/dev/null 2>&1 && pnpm test:ct"
    echo "[container-gate] passed: root web ct executed in container"
    ;;
  root-web-e2e)
    run_task_in_container "pnpm install --frozen-lockfile >/dev/null 2>&1 && pnpm test:e2e"
    echo "[container-gate] passed: root web e2e executed in container"
    ;;
  frontend-build)
    run_task_in_container "pnpm install --frozen-lockfile >/dev/null 2>&1 && pnpm --dir apps/web build"
    echo "[container-gate] passed: frontend build executed in container"
    ;;
  frontend-ui-audit)
    run_task_in_container "pnpm install --frozen-lockfile >/dev/null 2>&1 && pnpm --dir apps/web audit:ui"
    echo "[container-gate] passed: frontend ui audit executed in container"
    ;;
  automation-tests)
    run_task_in_container "pnpm install --frozen-lockfile >/dev/null 2>&1 && pnpm --dir apps/automation-runner test"
    echo "[container-gate] passed: automation tests executed in container"
    ;;
  frontend-authenticity)
    run_task_in_container "pnpm gate:e2e:authenticity"
    echo "[container-gate] passed: frontend authenticity executed in container"
    ;;
  frontend-nonstub)
    run_task_in_container "pnpm exec playwright install --with-deps chromium >/dev/null 2>&1 && UIQ_FRONTEND_E2E_GREP='@frontend-nonstub|@nonstub' bash scripts/run-frontend-e2e-nonstub.sh"
    echo "[container-gate] passed: frontend nonstub executed in container"
    ;;
  frontend-critical)
    run_task_in_container "pnpm exec playwright install --with-deps chromium >/dev/null 2>&1 && UIQ_FRONTEND_E2E_GREP='@frontend-critical-buttons|@frontend-first-use' pnpm test:e2e:frontend:critical"
    echo "[container-gate] passed: frontend critical executed in container"
    ;;
  functional-regression-matrix)
    run_script_in_container "$(cat <<'EOF'
pnpm install --frozen-lockfile >/dev/null 2>&1
uv sync --frozen --extra dev >/dev/null 2>&1
UIQ_TEST_MODE=serial \
UIQ_SUITE_WEB_E2E=0 \
UIQ_SUITE_FRONTEND_E2E=1 \
UIQ_SUITE_FRONTEND_UNIT=1 \
UIQ_SUITE_BACKEND=1 \
UIQ_SUITE_INTEGRATION=1 \
UIQ_INTEGRATION_PROFILE=full \
UIQ_SUITE_AUTOMATION_CHECK=1 \
UIQ_SUITE_ORCHESTRATOR_MCP=1 \
UIQ_AUTOMATION_INSTALL_DEPS=1 \
UIQ_TEST_MATRIX_RUN_TEST_TRUTH_GATE=1 \
UIQ_TEST_MATRIX_RUN_E2E_AUTHENTICITY_GATE=1 \
E2E_STUB_NONSTUB_MAX_RATIO=4 \
bash scripts/test-matrix.sh serial
EOF
)"
    echo "[container-gate] passed: functional regression matrix executed in container"
    ;;
  functional-regression-targeted)
    run_script_in_container "$(cat <<'EOF'
pnpm install --frozen-lockfile >/dev/null 2>&1
uv sync --frozen --extra dev >/dev/null 2>&1
AUTOMATION_BACKEND_PORT="$(python3 - <<'PY'
import socket
start = 17480
for port in range(start, start + 200):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if sock.connect_ex(("127.0.0.1", port)) != 0:
            print(port)
            raise SystemExit(0)
print(start)
PY
)"
export AUTOMATION_BACKEND_PORT BACKEND_PORT="$AUTOMATION_BACKEND_PORT"
pnpm test:backend:command-tower-client-defaults
pnpm test:automation:regression
pnpm test:mcp-server:regression
EOF
)"
    echo "[container-gate] passed: functional regression targeted suites executed in container"
    ;;
  pr-lint-frontend)
    run_task_in_container "pnpm install --frozen-lockfile >/dev/null 2>&1 && bash scripts/ci/lint-all.sh"
    echo "[container-gate] passed: pr frontend lint gate executed in container"
    ;;
  pr-static-gate)
    run_script_in_container "$(cat <<'EOF'
pnpm install --frozen-lockfile >/dev/null 2>&1
pnpm commitlint:ci
pnpm lockfile:sync:check
pnpm env:governance:check
bash -n scripts/release/check-workflow-pnpm-version-guard.sh scripts/release/generate-release-notes.sh
bash -n scripts/ci/gate-openai-residue.sh
bash -n scripts/run-load-k6-smoke.sh
bash -n scripts/acceptance/final-verdict-gate.sh
node --check scripts/ci/check-threshold-doc-sync.mjs
node --check scripts/ci/check-doc-links.mjs
node --check scripts/ci/uiq-test-truth-gate.mjs
node --check scripts/ci/uiq-mcp-stress-gate.mjs
node --check scripts/ci/uiq-flake-budget.mjs
node --check scripts/ci/uiq-failure-ticketing.mjs
node --check scripts/ci/uiq-ai-review.mjs
node --check scripts/ci/uiq-gemini-live-smoke-gate.mjs
node --check scripts/ci/uiq-gemini-accuracy-gate.mjs
node --check scripts/ci/uiq-gemini-concurrency-gate.mjs
node --check scripts/ci/uiq-cross-target-benchmark.mjs
node --check scripts/ci/uiq-sla-and-clusters.mjs
node --check scripts/ci/verify-run-evidence.mjs
node --check scripts/ci/check-button-inventory.mjs
node --check scripts/ci/check-button-coverage.mjs
node --check scripts/ci/check-firstparty-file-length.mjs
node --check scripts/ci/check-access-control-usage.mjs
node --check scripts/ci/check-shell-dedupe.mjs
node --check scripts/ci/check-lockfile-sync.mjs
node --check scripts/ci/check-engine-runtime.mjs
node --check scripts/perf/perf-regression-guard.mjs
node --check scripts/api/check-breaking-contract.mjs
node --test scripts/ci/uiq-strict-gates.test.mjs
bash scripts/ci/self-proof-suite.sh
pnpm test:coverage:threshold-gate
node scripts/ci/check-threshold-doc-sync.mjs
bash scripts/docs-gate.sh
node scripts/ci/check-firstparty-file-length.mjs
node scripts/ci/check-access-control-usage.mjs
node scripts/ci/check-shell-dedupe.mjs
node scripts/ci/uiq-test-truth-gate.mjs --profile pr --strict true
python3 scripts/ci/uiq-pytest-truth-gate.py --profile pr --strict true
pnpm test:packages:runtime-target-macos
node scripts/ci/check-button-coverage.mjs --mode manifest-lint
node scripts/ci/check-button-inventory.mjs
node scripts/ci/check-button-coverage.mjs
EOF
)"
    echo "[container-gate] passed: pr static gate executed in container"
    ;;
  pr-frontend-e2e-behavior-shard)
    run_script_in_container "$(cat <<'EOF'
pnpm install --frozen-lockfile >/dev/null 2>&1
uv sync --frozen --extra dev >/dev/null 2>&1
SHARD_INDEX="${UIQ_SHARD_INDEX:-1}"
SHARD_TOTAL="${UIQ_SHARD_TOTAL:-2}"
ISOLATED_SCOPE="pr-frontend-e2e-shard-${SHARD_INDEX}"
if [[ "$SHARD_INDEX" == "1" ]]; then
  pnpm gate:e2e:authenticity
  E2E_STUB_NONSTUB_MAX_RATIO="${E2E_STUB_NONSTUB_MAX_RATIO:-4}" \
  E2E_COUNTERFACTUAL_REQUIRED_DIRS="${E2E_COUNTERFACTUAL_REQUIRED_DIRS:-apps/web/tests/e2e}" \
  E2E_COUNTERFACTUAL_REQUIRED_TAG="${E2E_COUNTERFACTUAL_REQUIRED_TAG:-@counterfactual}" \
  E2E_COUNTERFACTUAL_MIN_FILES_PER_DIR="${E2E_COUNTERFACTUAL_MIN_FILES_PER_DIR:-1}" \
    bash scripts/run-frontend-e2e-nonstub.sh
  UIQ_FRONTEND_E2E_GREP='@frontend-critical-buttons|@frontend-first-use' pnpm test:e2e:frontend:critical
  E2E_COUNTERFACTUAL_GATE_STATUS=passed E2E_COUNTERFACTUAL_GATE_REASON=counterfactual.gate.passed \
    node scripts/ci/collect-counterfactual-report.mjs --out .runtime-cache/artifacts/ci
fi
DATABASE_URL="sqlite+pysqlite:///./.runtime-cache/artifacts/ci/test-output/${ISOLATED_SCOPE}.sqlite3" \
UNIVERSAL_PLATFORM_DATA_DIR="./.runtime-cache/automation/universal" \
UNIVERSAL_AUTOMATION_RUNTIME_DIR="./.runtime-cache/automation" \
bash scripts/run-frontend-e2e-nonstub.sh -- --shard="${SHARD_INDEX}/${SHARD_TOTAL}"
EOF
)"
    echo "[container-gate] passed: pr frontend e2e behavior shard executed in container"
    ;;
  pr-frontend-e2e-shard)
    run_script_in_container "$(cat <<'EOF'
pnpm install --frozen-lockfile >/dev/null 2>&1
uv sync --frozen --extra dev >/dev/null 2>&1
SHARD_INDEX="${UIQ_E2E_SHARD_INDEX:-${UIQ_SHARD_INDEX:-1}}"
SHARD_TOTAL="${UIQ_E2E_SHARD_TOTAL:-${UIQ_SHARD_TOTAL:-2}}"
ISOLATED_SCOPE="pr-frontend-e2e-shard-${SHARD_INDEX}"
if [[ "$SHARD_INDEX" == "1" ]]; then
  pnpm gate:e2e:authenticity
  E2E_STUB_NONSTUB_MAX_RATIO="${E2E_STUB_NONSTUB_MAX_RATIO:-4}" \
  E2E_COUNTERFACTUAL_REQUIRED_DIRS="${E2E_COUNTERFACTUAL_REQUIRED_DIRS:-apps/web/tests/e2e}" \
  E2E_COUNTERFACTUAL_REQUIRED_TAG="${E2E_COUNTERFACTUAL_REQUIRED_TAG:-@counterfactual}" \
  E2E_COUNTERFACTUAL_MIN_FILES_PER_DIR="${E2E_COUNTERFACTUAL_MIN_FILES_PER_DIR:-1}" \
    bash scripts/run-frontend-e2e-nonstub.sh
  UIQ_FRONTEND_E2E_GREP='@frontend-critical-buttons|@frontend-first-use' pnpm test:e2e:frontend:critical
  E2E_COUNTERFACTUAL_GATE_STATUS=passed E2E_COUNTERFACTUAL_GATE_REASON=counterfactual.gate.passed \
    node scripts/ci/collect-counterfactual-report.mjs --out .runtime-cache/artifacts/ci
fi
DATABASE_URL="sqlite+pysqlite:///./.runtime-cache/artifacts/ci/test-output/${ISOLATED_SCOPE}.sqlite3" \
UNIVERSAL_PLATFORM_DATA_DIR="./.runtime-cache/automation/universal" \
UNIVERSAL_AUTOMATION_RUNTIME_DIR="./.runtime-cache/automation" \
bash scripts/run-frontend-e2e-nonstub.sh -- --shard="${SHARD_INDEX}/${SHARD_TOTAL}"
EOF
)"
    echo "[container-gate] passed: pr frontend e2e shard alias executed in container"
    ;;
  pr-mcp-gate)
    run_script_in_container "$(cat <<'EOF'
pnpm install --frozen-lockfile >/dev/null 2>&1
PARALLEL="${UIQ_MCP_STRESS_PARALLEL:-2}"
export UIQ_MCP_STRESS_TIME_BUDGET_MS="${UIQ_MCP_STRESS_TIME_BUDGET_MS:-300000}"
node scripts/ci/uiq-mcp-stress-gate.mjs --profile pr --iterations 50 --parallel "$PARALLEL" --strict true
node --import tsx --test packages/orchestrator/src/commands/run.test.ts packages/orchestrator/src/commands/run.runid.test.ts
pnpm mcp:check
node --import tsx --test apps/mcp-server/tests/mcp-command-parity.test.ts apps/mcp-server/tests/mcp-perfect-mode.test.ts
EOF
)"
    echo "[container-gate] passed: pr mcp gate executed in container"
    ;;
  pr-run-profile)
    run_script_in_container "$(cat <<'EOF'
pnpm install --frozen-lockfile >/dev/null 2>&1
uv sync --frozen --extra dev >/dev/null 2>&1
pnpm exec playwright install --with-deps chromium >/dev/null 2>&1
pnpm uiq engines:check --profile pr
UIQ_ORCHESTRATOR_PARALLEL=1 UIQ_ORCHESTRATOR_MAX_PARALLEL_TASKS=4 pnpm uiq run --profile pr --target web.ci
node scripts/ci/verify-run-evidence.mjs --profile pr
EOF
)"
    echo "[container-gate] passed: pr run profile executed in container"
    ;;
  pr-quality-gate)
    run_script_in_container "$(cat <<'EOF'
pnpm install --frozen-lockfile >/dev/null 2>&1
uv sync --frozen --extra dev >/dev/null 2>&1
pnpm test:integration
uv run --extra dev pytest apps/api/tests/test_real_backend_http_smoke.py -q
UIQ_COVERAGE_ENFORCE_GLOBAL_BRANCHES=true bash scripts/ci/run-unit-coverage-gate.sh
pnpm mutation:ts:strict
pnpm mutation:py:strict
UIQ_MUTATION_REQUIRED_CONTEXT=true UIQ_MUTATION_PY_MAX_SURVIVED=0 UIQ_MUTATION_TS_MIN_TOTAL=50 UIQ_MUTATION_PY_MIN_TOTAL=249 pnpm mutation:effective
EOF
)"
    echo "[container-gate] passed: pr quality gate executed in container"
    ;;
  nightly-frontend-e2e-shard)
    run_script_in_container "$(cat <<'EOF'
pnpm install --frozen-lockfile >/dev/null 2>&1
SHARD_INDEX="${UIQ_SHARD_INDEX:-1}"
SHARD_TOTAL="${UIQ_SHARD_TOTAL:-3}"
pnpm test:e2e:frontend -- --shard="${SHARD_INDEX}/${SHARD_TOTAL}"
EOF
)"
    echo "[container-gate] passed: nightly frontend e2e shard executed in container"
    ;;
  nightly-backend-tests-shard)
    run_script_in_container "$(cat <<'EOF'
uv sync --frozen --extra dev >/dev/null 2>&1
uv lock --check
SHARD_INDEX="${UIQ_SHARD_INDEX:-1}"
SHARD_TOTAL="${UIQ_SHARD_TOTAL:-4}"
mkdir -p .runtime-cache/artifacts/ci/test-output
DATABASE_URL="sqlite+pysqlite:///./.runtime-cache/artifacts/ci/test-output/backend-tests-nightly-shard-${SHARD_INDEX}.sqlite3" uv run alembic -c apps/api/alembic.ini upgrade heads
mapfile -t ALL_TEST_FILES < <(find apps/api/tests -type f -name "test_*.py" | sort)
SELECTED_TEST_FILES=()
for idx in "${!ALL_TEST_FILES[@]}"; do
  shard=$(( (idx % SHARD_TOTAL) + 1 ))
  if [[ "$shard" -eq "$SHARD_INDEX" ]]; then
    SELECTED_TEST_FILES+=("${ALL_TEST_FILES[$idx]}")
  fi
done
shard_manifest=".runtime-cache/artifacts/ci/test-output/backend-tests-nightly-shard-${SHARD_INDEX}.txt"
printf '%s\n' "${SELECTED_TEST_FILES[@]}" > "$shard_manifest"
uv run pytest -o addopts= -n auto --dist=loadscope --cov=backend --cov-branch --cov-report=term-missing --cov-report=xml:.runtime-cache/artifacts/ci/test-output/backend-tests-nightly-shard-${SHARD_INDEX}-coverage.xml --cov-fail-under=0 --strict-config --strict-markers --maxfail=1 "${SELECTED_TEST_FILES[@]}"
EOF
)"
    echo "[container-gate] passed: nightly backend tests shard executed in container"
    ;;
  nightly-integration-full)
    run_task_in_container "pnpm install --frozen-lockfile >/dev/null 2>&1 && uv sync --frozen --extra dev >/dev/null 2>&1 && pnpm test:integration:full"
    echo "[container-gate] passed: nightly integration full executed in container"
    ;;
  nightly-core-run)
    run_script_in_container "$(cat <<'EOF'
pnpm install --frozen-lockfile >/dev/null 2>&1
pnpm uiq engines:check --profile nightly-core
UIQ_ORCHESTRATOR_PARALLEL=1 UIQ_ORCHESTRATOR_MAX_PARALLEL_TASKS=6 pnpm uiq run --profile nightly-core --target web.ci
node scripts/ci/verify-run-evidence.mjs --profile nightly-core
EOF
)"
    echo "[container-gate] passed: nightly core run executed in container"
    ;;
  nightly-hard-gates)
    run_script_in_container "$(cat <<'EOF'
pnpm install --frozen-lockfile >/dev/null 2>&1
PARALLEL="${UIQ_MCP_STRESS_PARALLEL:-4}"
export UIQ_MCP_STRESS_TIME_BUDGET_MS="${UIQ_MCP_STRESS_TIME_BUDGET_MS:-600000}"
node scripts/ci/uiq-mcp-stress-gate.mjs --profile nightly --iterations 100 --parallel "$PARALLEL" --strict true
node scripts/ci/check-button-inventory.mjs
node scripts/ci/uiq-flake-budget.mjs --profile nightly --strict true --dynamic-baseline false
node scripts/ci/uiq-sla-and-clusters.mjs --profile nightly
EMIT="${UIQ_AUTO_TICKETING:-false}"
node scripts/ci/uiq-failure-ticketing.mjs --runs-dir .runtime-cache/artifacts/runs --out-dir .runtime-cache/artifacts/ci --top-n 20 --sample-limit 5 --emit-gh-issues "$EMIT" --emit-pr-comment false --repo "${GITHUB_REPOSITORY:-${GH_REPO:-}}"
node scripts/ci/uiq-cross-target-benchmark.mjs --runs-dir .runtime-cache/artifacts/runs --out-dir .runtime-cache/artifacts/ci --profile nightly --lookback-days 14 --limit 120 --targets web,tauri,swift
node scripts/perf/perf-regression-guard.mjs --mode strict --window 5
node scripts/api/check-breaking-contract.mjs
EOF
)"
    echo "[container-gate] passed: nightly hard gates executed in container"
    ;;
  manual-core-run)
    run_script_in_container "$(cat <<'EOF'
pnpm install --frozen-lockfile >/dev/null 2>&1
command -v k6 >/dev/null 2>&1
command -v semgrep >/dev/null 2>&1
pnpm uiq engines:check --profile manual-core
UIQ_ENABLE_REAL_BACKEND_TESTS=true pnpm test:mcp-server:real
UIQ_ORCHESTRATOR_PARALLEL=1 UIQ_ORCHESTRATOR_MAX_PARALLEL_TASKS=6 pnpm uiq run --profile manual-core --target web.ci
node scripts/ci/verify-run-evidence.mjs --profile manual-core
EOF
)"
    echo "[container-gate] passed: manual core run executed in container"
    ;;
  release-docs-gate)
    run_task_in_container "pnpm install --frozen-lockfile >/dev/null 2>&1 && bash scripts/docs-gate.sh"
    echo "[container-gate] passed: release docs gate executed in container"
    ;;
  release-typecheck)
    run_task_in_container "pnpm install --frozen-lockfile >/dev/null 2>&1 && pnpm typecheck"
    echo "[container-gate] passed: release typecheck executed in container"
    ;;
  release-candidate-gate)
    run_script_in_container "$(cat <<'EOF'
pnpm install --frozen-lockfile >/dev/null 2>&1
uv sync --frozen --extra dev >/dev/null 2>&1
pnpm exec playwright install --with-deps chromium >/dev/null 2>&1
mkdir -p .runtime-cache/ci .runtime-cache/logs .runtime-cache/artifacts/ci/test-output
DATABASE_URL="sqlite+pysqlite:///./.runtime-cache/artifacts/ci/test-output/release-candidate-nonstub.sqlite3" uv run alembic -c apps/api/alembic.ini upgrade heads
APP_ENV="${APP_ENV:-test}" \
AUTOMATION_ALLOW_LOCAL_NO_TOKEN="true" \
AUTOMATION_REQUIRE_TOKEN="false" \
DATABASE_URL="sqlite+pysqlite:///./.runtime-cache/artifacts/ci/test-output/release-candidate-nonstub.sqlite3" \
uv run uvicorn apps.api.app.main:app --host 127.0.0.1 --port 17380 > .runtime-cache/logs/backend.release-candidate.log 2>&1 &
BACKEND_PID=$!
cleanup_release_backend() {
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
}
trap cleanup_release_backend EXIT
python3 scripts/ci/wait-http-ready.py
UIQ_E2E_ARTIFACT_POLICY=failure-only ./scripts/run-e2e.sh apps/web/tests/e2e/non-stub-core-flow.spec.ts --reporter=json > .runtime-cache/artifacts/ci/nonstub-critical-report.json
node scripts/ci/nightly-release-e2e-gate.mjs --mode=release --nonstub-report=.runtime-cache/artifacts/ci/nonstub-critical-report.json
pnpm release:gate
node scripts/ci/release-mutation-sampling.mjs --scope core --threshold 0.8
EOF
)"
    echo "[container-gate] passed: release candidate gate executed in container"
    ;;
esac
