#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
source "$ROOT_DIR/scripts/lib/python-runtime.sh"
ensure_project_python_env_exports

: "${UIQ_COVERAGE_GLOBAL_MIN:=85}"
: "${UIQ_COVERAGE_CORE_MIN:=95}"
: "${UIQ_COVERAGE_ENFORCE_GLOBAL_BRANCHES:=true}"
: "${UIQ_COVERAGE_GLOBAL_BRANCHES_MIN:=80}"
: "${UIQ_COVERAGE_PYTEST_N:=0}"
: "${UIQ_COVERAGE_INCLUDE_APPS_WEB:=true}"

COV_ROOT="${UIQ_COVERAGE_OUTPUT_DIR:-.runtime-cache/coverage}"
BACKEND_COV_DIR="$COV_ROOT/backend"
FRONTEND_COV_DIR="$COV_ROOT/frontend"
APPS_WEB_COV_DIR="$COV_ROOT/apps-web"
MCP_SERVER_COV_DIR="$COV_ROOT/mcp-server"
PACKAGES_COV_DIR="$COV_ROOT/packages"
AUTOMATION_COV_DIR="$COV_ROOT/automation"
TMP_ROOT="${UIQ_COVERAGE_TMPDIR:-/tmp/uiq-coverage-gate}"
FRONTEND_VITEST_REPORT_DIR="$FRONTEND_COV_DIR/vitest"
APPS_WEB_VITEST_REPORT_DIR="$APPS_WEB_COV_DIR/vitest"
MCP_SERVER_V8_REPORT_DIR="$MCP_SERVER_COV_DIR/v8"
PACKAGES_V8_REPORT_DIR="$PACKAGES_COV_DIR/v8"
AUTOMATION_V8_REPORT_DIR="$AUTOMATION_COV_DIR/v8"
FRONTEND_VITEST_TMP_REPORT_DIR="$TMP_ROOT/frontend-vitest-report"
APPS_WEB_VITEST_TMP_REPORT_DIR="$TMP_ROOT/apps-web-vitest-report"
mkdir -p \
  "$BACKEND_COV_DIR" \
  "$FRONTEND_COV_DIR" \
  "$APPS_WEB_COV_DIR" \
  "$MCP_SERVER_COV_DIR" \
  "$PACKAGES_COV_DIR" \
  "$AUTOMATION_COV_DIR" \
  "$TMP_ROOT"
export TMPDIR="$(cd "$TMP_ROOT" && pwd)"

echo "[coverage-gate preflight] false-green anti-pattern scan"
FALSE_GREEN_SCAN_PATHS=(apps/api/tests apps/web/src apps)
FALSE_GREEN_GLOBS=(
  --glob "**/*.test.ts"
  --glob "**/*.test.tsx"
  --glob "**/*.test.js"
  --glob "**/*.test.jsx"
  --glob "**/*.test.py"
  --glob "!**/node_modules/**"
  --glob "!**/.pnpm/**"
  --glob "!**/dist/**"
  --glob "!**/build/**"
  --glob "!**/.runtime-cache/**"
)
FALSE_GREEN_PATTERNS=(
  "expect\\(true\\)\\.toBe\\(true\\)"
  "expect\\(false\\)\\.toBe\\(false\\)"
)

scan_false_green_pattern() {
  local pattern="$1"
  shift
  if command -v rg >/dev/null 2>&1; then
    rg -n "$pattern" "$@" "${FALSE_GREEN_GLOBS[@]}"
    return $?
  fi

  local paths=("$@")
  grep -RInE \
    --include='*.test.ts' \
    --include='*.test.tsx' \
    --include='*.test.js' \
    --include='*.test.jsx' \
    --include='*.test.py' \
    --exclude-dir='node_modules' \
    --exclude-dir='.pnpm' \
    --exclude-dir='dist' \
    --exclude-dir='build' \
    --exclude-dir='.runtime-cache' \
    "$pattern" \
    "${paths[@]}"
}

false_green_found=0
for pattern in "${FALSE_GREEN_PATTERNS[@]}"; do
  if scan_false_green_pattern "$pattern" "${FALSE_GREEN_SCAN_PATHS[@]}"; then
    false_green_found=1
  fi
done

if [[ "$false_green_found" -ne 0 ]]; then
  echo "[coverage-gate] false-green anti-patterns detected; fix assertions before coverage gate"
  exit 1
fi

if [[ -n "${UV_PROJECT_ENVIRONMENT:-}" ]]; then
  uv sync --frozen --extra dev >/dev/null 2>&1
  PYTEST_CMD=(uv run --frozen --extra dev pytest)
elif [[ -x "$(resolve_project_python_env)/bin/pytest" ]] && "$(resolve_project_python_env)/bin/pytest" --version >/dev/null 2>&1; then
  PYTEST_CMD=("$(resolve_project_python_env)/bin/pytest")
else
  PYTEST_CMD=(uv run --extra dev pytest)
fi

run_with_retry_on_missing_rollup() {
  local label="$1"
  shift
  local run_log
  run_log="$(mktemp)"
  set +e
  "$@" >"$run_log" 2>&1
  local status=$?
  set -e
  cat "$run_log"
  if [[ "$status" -ne 0 ]]; then
    if grep -Eqi "Cannot find module @rollup/rollup-|MODULE_NOT_FOUND|installed esbuild for another platform|needs the @esbuild/" "$run_log"; then
      echo "[coverage-gate] $label prerequisites missing, installing workspace deps..."
      rm -rf apps/web/node_modules
      CI=true pnpm install --frozen-lockfile || CI=true pnpm install --no-frozen-lockfile
      "$@"
    elif grep -Eqi "ENOENT: no such file or directory, open .*coverage-[0-9]+\.json" "$run_log"; then
      local attempt
      for attempt in 1 2 3; do
        echo "[coverage-gate] $label coverage temp artifact race detected (retry ${attempt}/3), resetting coverage dirs..."
        rm -rf \
          apps/web/coverage \
          "$FRONTEND_COV_DIR" \
          apps/web/tests/unit/coverage \
          "$APPS_WEB_COV_DIR"
        mkdir -p \
          apps/web/coverage/.tmp \
          "$FRONTEND_VITEST_REPORT_DIR/.tmp" \
          apps/web/tests/unit/coverage/.tmp \
          "$APPS_WEB_VITEST_REPORT_DIR/.tmp"
        if "$@"; then
          rm -f "$run_log"
          return 0
        fi
      done
      echo "[coverage-gate] $label coverage temp artifact race persisted after 3 retries"
      rm -f "$run_log"
      return "$status"
    else
      echo "[coverage-gate] $label failed with non-retryable error; refusing implicit retry"
      rm -f "$run_log"
      return "$status"
    fi
  fi
  rm -f "$run_log"
}

summarize_lcov() {
  local lcov_path="$1"
  local summary_path="$2"
  local path_prefix="$3"
  local label="$4"
  if [[ ! -f "$lcov_path" ]]; then
    echo "[coverage-gate] missing $label lcov output: $lcov_path"
    exit 2
  fi

  node - "$lcov_path" "$summary_path" "$path_prefix" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const lcovPath = process.argv[2];
const summaryPath = process.argv[3];
const pathPrefix = process.argv[4];
const raw = fs.readFileSync(lcovPath, "utf8");

const files = {};
let current = null;
let lineFound = 0;
let lineHit = 0;
let branchFound = 0;
let branchHit = 0;

function flushCurrent() {
  if (!current) return;
  const rawPath = current.replaceAll("\\", "/");
  const repoRelative = path.isAbsolute(rawPath)
    ? path.relative(process.cwd(), rawPath).replaceAll("\\", "/")
    : rawPath.replace(/^\.\//, "");
  const normalized = pathPrefix
    ? path.posix.join(pathPrefix, repoRelative)
    : repoRelative;
  const linePct = lineFound > 0 ? (lineHit / lineFound) * 100 : 100;
  const branchPct = branchFound > 0 ? (branchHit / branchFound) * 100 : 100;
  files[normalized] = {
    lines: { total: lineFound, covered: lineHit, pct: linePct },
    branches: { total: branchFound, covered: branchHit, pct: branchPct },
  };
}

for (const line of raw.split(/\r?\n/)) {
  if (line.startsWith("SF:")) {
    flushCurrent();
    current = line.slice(3).trim();
    lineFound = 0;
    lineHit = 0;
    branchFound = 0;
    branchHit = 0;
    continue;
  }
  if (!current) continue;
  if (line.startsWith("DA:")) {
    const payload = line.slice(3).split(",");
    if (payload.length >= 2) {
      lineFound += 1;
      if (Number(payload[1]) > 0) lineHit += 1;
    }
    continue;
  }
  if (line.startsWith("BRDA:")) {
    const payload = line.slice(5).split(",");
    if (payload.length >= 4) {
      branchFound += 1;
      if (payload[3] !== "-" && Number(payload[3]) > 0) branchHit += 1;
    }
    continue;
  }
  if (line === "end_of_record") {
    flushCurrent();
    current = null;
  }
}
flushCurrent();

let totalLines = 0;
let coveredLines = 0;
let totalBranches = 0;
let coveredBranches = 0;

for (const metrics of Object.values(files)) {
  totalLines += metrics.lines.total;
  coveredLines += metrics.lines.covered;
  totalBranches += metrics.branches.total;
  coveredBranches += metrics.branches.covered;
}

const summary = {
  total: {
    lines: {
      total: totalLines,
      covered: coveredLines,
      pct: totalLines > 0 ? (coveredLines / totalLines) * 100 : 100,
    },
    branches: {
      total: totalBranches,
      covered: coveredBranches,
      pct: totalBranches > 0 ? (coveredBranches / totalBranches) * 100 : 100,
    },
  },
  ...files,
};

fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");
NODE
}

run_c8_coverage() {
  local label="$1"
  local report_dir="$2"
  shift 2
  rm -rf "$report_dir"
  mkdir -p "$report_dir"
  pnpm exec c8 \
    --all \
    --exclude-after-remap \
    --reporter=lcov \
    --reports-dir "$report_dir" \
    "$@"
}

echo "[coverage-gate 1/4] backend unit coverage (product code: apps/api/app)"
# Remove stale/corrupted coverage DB shards from previous interrupted runs.
rm -f .coverage .coverage.*
PYTEST_ARGS=(apps/api/tests)
if [[ "$UIQ_COVERAGE_PYTEST_N" != "0" ]]; then
  PYTEST_ARGS+=(-n "$UIQ_COVERAGE_PYTEST_N" --dist=loadscope)
fi
PYTEST_ARGS+=(
  --cov=apps/api/app
  --cov-branch
  --cov-report=term-missing
  --cov-report="json:$BACKEND_COV_DIR/coverage.json"
  # Final pass/fail is enforced by scripts/ci/check-coverage-thresholds.mjs
  # after filtering to product-code scopes.
  --cov-fail-under=0
)

"${PYTEST_CMD[@]}" "${PYTEST_ARGS[@]}"

echo "[coverage-gate 2/4] frontend unit coverage (product code: apps/web/src)"
rm -rf "$FRONTEND_COV_DIR"
rm -rf "$FRONTEND_VITEST_TMP_REPORT_DIR"
mkdir -p "$FRONTEND_COV_DIR" "$FRONTEND_VITEST_REPORT_DIR" "$FRONTEND_VITEST_TMP_REPORT_DIR"
run_frontend_coverage() {
  rm -rf "$FRONTEND_VITEST_TMP_REPORT_DIR"
  mkdir -p "$FRONTEND_VITEST_TMP_REPORT_DIR"
  pnpm --dir apps/web exec vitest run \
    --config vitest.config.ts \
    --maxWorkers=1 \
    --coverage.enabled \
    --coverage.clean=true \
    --coverage.reporter=text \
    --coverage.reporter=lcov \
    --coverage.reportsDirectory="$FRONTEND_VITEST_TMP_REPORT_DIR"
}

run_with_retry_on_missing_rollup "frontend coverage" run_frontend_coverage
if [[ ! -f "$FRONTEND_VITEST_TMP_REPORT_DIR/lcov.info" ]]; then
  for attempt in 1 2 3; do
    echo "[coverage-gate] frontend lcov missing after successful run (retry ${attempt}/3), rerunning frontend coverage..."
    rm -rf apps/web/coverage "$FRONTEND_COV_DIR" "$FRONTEND_VITEST_TMP_REPORT_DIR"
    mkdir -p "$FRONTEND_VITEST_REPORT_DIR" "$FRONTEND_VITEST_TMP_REPORT_DIR"
    run_frontend_coverage
    if [[ -f "$FRONTEND_VITEST_TMP_REPORT_DIR/lcov.info" ]]; then
      break
    fi
  done
fi
if [[ ! -f "$FRONTEND_VITEST_TMP_REPORT_DIR/lcov.info" ]]; then
  echo "[coverage-gate] frontend lcov still missing after retries: $FRONTEND_VITEST_TMP_REPORT_DIR/lcov.info"
  exit 1
fi
cp "$FRONTEND_VITEST_TMP_REPORT_DIR/lcov.info" "$FRONTEND_VITEST_REPORT_DIR/lcov.info"

summarize_lcov \
  "$FRONTEND_VITEST_REPORT_DIR/lcov.info" \
  "$FRONTEND_COV_DIR/coverage-summary.json" \
  "frontend" \
  "frontend"

if [[ "$UIQ_COVERAGE_INCLUDE_APPS_WEB" == "true" ]]; then
  echo "[coverage-gate 3/6] apps/web unit coverage (optional product module: apps/web/src)"
  rm -rf "$APPS_WEB_COV_DIR"
  rm -rf "$APPS_WEB_VITEST_TMP_REPORT_DIR"
  mkdir -p "$APPS_WEB_COV_DIR" "$APPS_WEB_VITEST_REPORT_DIR" "$APPS_WEB_VITEST_TMP_REPORT_DIR"
  run_apps_web_coverage() {
    rm -rf "$APPS_WEB_VITEST_TMP_REPORT_DIR"
    mkdir -p "$APPS_WEB_VITEST_TMP_REPORT_DIR"
    pnpm exec vitest run \
      --config apps/web/tests/unit/vitest.config.ts \
      --maxWorkers=1 \
      --coverage.enabled \
      --coverage.clean=true \
      --coverage.reporter=text \
      --coverage.reporter=lcov \
      --coverage.reportsDirectory="$APPS_WEB_VITEST_TMP_REPORT_DIR"
  }
  run_with_retry_on_missing_rollup "apps/web coverage" run_apps_web_coverage
  if [[ ! -f "$APPS_WEB_VITEST_TMP_REPORT_DIR/lcov.info" ]]; then
    for attempt in 1 2 3; do
      echo "[coverage-gate] apps/web lcov missing after successful run (retry ${attempt}/3), rerunning apps/web coverage..."
      rm -rf apps/web/tests/unit/coverage "$APPS_WEB_COV_DIR" "$APPS_WEB_VITEST_TMP_REPORT_DIR"
      mkdir -p "$APPS_WEB_VITEST_REPORT_DIR" "$APPS_WEB_VITEST_TMP_REPORT_DIR"
      run_apps_web_coverage
      if [[ -f "$APPS_WEB_VITEST_TMP_REPORT_DIR/lcov.info" ]]; then
        break
      fi
    done
  fi
  if [[ ! -f "$APPS_WEB_VITEST_TMP_REPORT_DIR/lcov.info" ]]; then
    echo "[coverage-gate] apps/web lcov still missing after retries: $APPS_WEB_VITEST_TMP_REPORT_DIR/lcov.info"
    exit 1
  fi
  cp "$APPS_WEB_VITEST_TMP_REPORT_DIR/lcov.info" "$APPS_WEB_VITEST_REPORT_DIR/lcov.info"
  summarize_lcov \
    "$APPS_WEB_VITEST_REPORT_DIR/lcov.info" \
    "$APPS_WEB_COV_DIR/coverage-summary.json" \
    "apps/web" \
    "apps/web"
else
  echo "[coverage-gate 3/6] apps/web coverage skipped (UIQ_COVERAGE_INCLUDE_APPS_WEB=false)"
fi

echo "[coverage-gate 4/6] apps/mcp-server source coverage"
rm -rf "$MCP_SERVER_V8_REPORT_DIR"
mkdir -p "$MCP_SERVER_V8_REPORT_DIR"
MCP_SERVER_V8_TEMP_DIR="$MCP_SERVER_V8_REPORT_DIR/.tmp-v8"
MCP_SERVER_C8_CLEAN=true
run_mcp_server_coverage_file() {
  local test_file="$1"
  local -a c8_args=(
    --all
    --exclude-after-remap
    --reporter=none
    --reports-dir "$MCP_SERVER_V8_REPORT_DIR"
    --temp-directory "$MCP_SERVER_V8_TEMP_DIR"
  )
  if [[ "$MCP_SERVER_C8_CLEAN" == "true" ]]; then
    c8_args+=(--clean)
    MCP_SERVER_C8_CLEAN=false
  else
    c8_args+=(--clean=false)
  fi
  pnpm exec c8 \
    "${c8_args[@]}" \
    --src apps/mcp-server/src \
    node --import tsx --test-concurrency=1 --test "$test_file"
}

for mcp_server_test in \
  apps/mcp-server/tests/mcp-success.test.ts \
  apps/mcp-server/tests/mcp-failure.test.ts \
  apps/mcp-server/tests/mcp-auth.test.ts \
  apps/mcp-server/tests/mcp-advanced-visibility.test.ts \
  apps/mcp-server/tests/mcp-timeout-semantic.test.ts \
  apps/mcp-server/tests/mcp-smoke.test.ts \
  apps/mcp-server/tests/core.constants.test.ts \
  apps/mcp-server/tests/core.registry.test.ts \
  apps/mcp-server/tests/core.types.test.ts \
  apps/mcp-server/tests/mcp-artifacts-proof.test.ts \
  apps/mcp-server/tests/mcp-api-tools-core.test.ts \
  apps/mcp-server/tests/mcp-perfect-mode.test.ts \
  apps/mcp-server/tests/mcp-core-fixes.test.ts
do
  run_mcp_server_coverage_file "$mcp_server_test"
done

NODE_V8_COVERAGE="$MCP_SERVER_V8_TEMP_DIR" \
  node --import tsx --test apps/mcp-server/tests/mcp-runtime-manager.test.ts

pnpm exec c8 report \
  --exclude-after-remap \
  --reporter=lcov \
  --reports-dir "$MCP_SERVER_V8_REPORT_DIR" \
  --temp-directory "$MCP_SERVER_V8_TEMP_DIR"
summarize_lcov \
  "$MCP_SERVER_V8_REPORT_DIR/lcov.info" \
  "$MCP_SERVER_COV_DIR/coverage-summary.json" \
  "" \
  "apps/mcp-server"

echo "[coverage-gate 5/6] packages source coverage"
run_c8_coverage \
  "packages coverage" \
  "$PACKAGES_V8_REPORT_DIR" \
  --src packages/core/src \
  --src packages/orchestrator/src \
  --src packages/ai-prompts/src \
  --src packages/ai-review/src \
  --src packages/ui/src \
  --src packages/drivers \
  node --import tsx --test-concurrency=1 --test \
  packages/orchestrator/src/commands/run.base-url.test.ts \
  packages/orchestrator/src/commands/run.proof.test.ts \
  packages/orchestrator/src/commands/report.contract.test.ts \
  packages/orchestrator/src/commands/perf.gate.test.ts \
  packages/orchestrator/src/commands/explore.url-normalize.test.ts \
  packages/orchestrator/src/commands/desktop-e2e.test.ts \
  packages/orchestrator/src/commands/desktop-soak.test.ts \
  packages/orchestrator/src/commands/desktop-business.test.ts \
  packages/orchestrator/src/commands/visual.gate.test.ts \
  packages/orchestrator/src/commands/safety-denylist.test.ts \
  packages/orchestrator/src/commands/security.test.ts \
  packages/orchestrator/src/commands/target-runtime.test.ts \
  packages/orchestrator/src/commands/run.runid.test.ts \
  packages/orchestrator/src/commands/run.test.ts \
  packages/orchestrator/src/commands/run/profile-runner.test.ts \
  packages/orchestrator/src/commands/run/run-validate.extra.test.ts \
  packages/orchestrator/src/commands/engine-adapters.test.ts \
  packages/orchestrator/src/commands/load.test.ts \
  packages/orchestrator/src/commands/computer-use.test.ts \
  packages/orchestrator/src/commands/capture.mock.test.ts \
  packages/orchestrator/src/commands/computer-use.cli.test.ts \
  packages/orchestrator/src/commands/run/run-pipeline.test.ts \
  packages/orchestrator/src/commands/run/pipeline/fix-executor.test.ts \
  packages/orchestrator/src/commands/run/pipeline/stage-execution.test.ts \
  packages/orchestrator/src/commands/run/pipeline/reporting.test.ts \
  packages/orchestrator/src/commands/run/profile-finalize.test.ts \
  packages/orchestrator/src/commands/run/reporting.test.ts \
  packages/orchestrator/src/commands/run/run-pipeline.helpers.test.ts \
  packages/orchestrator/src/commands/run/run-resolve.test.ts \
  packages/orchestrator/src/commands/run/run-resolve.extra.test.ts \
  packages/ai-prompts/src/prompt-chain.test.ts \
  packages/ai-prompts/src/render.test.ts \
  packages/ai-review/src/build-input.test.ts \
  packages/ai-review/src/generate-findings.test.ts \
  packages/ui/src/button.test.tsx \
  packages/ui/src/primitives.test.tsx \
  packages/core/src/config/loadYaml.test.ts \
  packages/core/src/manifest/io.test.ts \
  packages/core/src/artifacts/runtimePaths.test.ts \
  packages/drivers/macos-xcuitest/src/index.test.ts
summarize_lcov \
  "$PACKAGES_V8_REPORT_DIR/lcov.info" \
  "$PACKAGES_COV_DIR/coverage-summary.json" \
  "" \
  "packages"

echo "[coverage-gate 6/6] automation source coverage"
run_c8_coverage \
  "automation coverage" \
  "$AUTOMATION_V8_REPORT_DIR" \
  --src apps/automation-runner/scripts \
  --src apps/automation-runner/scripts/lib \
  env UIQ_HOST_ARCH="${UIQ_HOST_ARCH:-$(uname -m)}" pnpm --dir apps/automation-runner exec tsx --test \
  scripts/generate-ui-ux-gemini-report.runtime-failure.test.ts \
  scripts/lib/prompts/index.test.ts \
  scripts/lib/extract-video-flow.ai-routing.test.ts \
  scripts/extract-video-flow.logic.test.ts \
  scripts/midscene-driver.test.ts \
  scripts/extract-flow-spec.runtime-output.test.ts \
  scripts/extract-register-spec.runtime-bridge.test.ts \
  scripts/build-manifest.runtime.test.ts \
  scripts/generate-from-reconstruction.runtime.test.ts \
  scripts/wrapper-cli.runtime.test.ts \
  scripts/record-session.logic.test.ts \
  scripts/replay-flow-script.logic.test.ts \
  scripts/replay-flow-draft-helpers.logic.test.ts \
  scripts/replay-register.logic.test.ts \
  scripts/replay-register.runtime.test.ts \
  scripts/extract-video-flow.action-schema.test.ts \
  scripts/extract-video-flow.runtime-fallback-output.test.ts \
  scripts/detect-driver-targets.runtime.test.ts \
  scripts/generate-playwright-case.runtime.test.ts \
  scripts/reconstruct-and-replay.runtime.test.ts \
  scripts/run-target-smoke.runtime.test.ts \
  scripts/lib/replay-flow-lib.logic.test.ts \
  scripts/generate-ui-ux-gemini-report.model-env.test.ts \
  scripts/replay-flow-runtime-failure.test.ts
summarize_lcov \
  "$AUTOMATION_V8_REPORT_DIR/lcov.info" \
  "$AUTOMATION_COV_DIR/coverage-summary.json" \
  "" \
  "automation"

echo "[coverage-gate threshold] threshold check"
export UIQ_BACKEND_COVERAGE_JSON="$BACKEND_COV_DIR/coverage.json"
export UIQ_FRONTEND_COVERAGE_JSON="$FRONTEND_COV_DIR/coverage-summary.json"
export UIQ_MCP_SERVER_COVERAGE_JSON="$MCP_SERVER_COV_DIR/coverage-summary.json"
export UIQ_PACKAGES_COVERAGE_JSON="$PACKAGES_COV_DIR/coverage-summary.json"
export UIQ_AUTOMATION_COVERAGE_JSON="$AUTOMATION_COV_DIR/coverage-summary.json"
export UIQ_COVERAGE_GLOBAL_MIN
export UIQ_COVERAGE_CORE_MIN
export UIQ_COVERAGE_ENFORCE_GLOBAL_BRANCHES
export UIQ_COVERAGE_GLOBAL_BRANCHES_MIN
export UIQ_COVERAGE_INCLUDE_APPS_WEB
if [[ "$UIQ_COVERAGE_INCLUDE_APPS_WEB" == "true" ]]; then
  export UIQ_APPS_WEB_COVERAGE_JSON="$APPS_WEB_COV_DIR/coverage-summary.json"
else
  unset UIQ_APPS_WEB_COVERAGE_JSON
fi
node scripts/ci/check-coverage-thresholds.mjs
