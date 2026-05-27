#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

HEARTBEAT_INTERVAL_SEC="${UIQ_TEST_ALL_HEARTBEAT_INTERVAL_SEC:-30}"
if ! [[ "$HEARTBEAT_INTERVAL_SEC" =~ ^[0-9]+$ ]] || [[ "$HEARTBEAT_INTERVAL_SEC" -lt 1 ]]; then
  echo "error: UIQ_TEST_ALL_HEARTBEAT_INTERVAL_SEC must be a positive integer" >&2
  exit 2
fi

MUTATION_MODE="${UIQ_MUTATION_GATE_MODE:-strict}"
if [[ "$MUTATION_MODE" != "off" && "$MUTATION_MODE" != "summary" && "$MUTATION_MODE" != "strict" ]]; then
  echo "error: UIQ_MUTATION_GATE_MODE must be one of: off|summary|strict" >&2
  exit 2
fi
MUTATION_REQUIRED_CONTEXT="${UIQ_MUTATION_REQUIRED_CONTEXT:-false}"
if [[ "$MUTATION_REQUIRED_CONTEXT" == "true" && "$MUTATION_MODE" != "strict" ]]; then
  echo "error: strict mutation is required in required-gate context (set UIQ_MUTATION_GATE_MODE=strict)." >&2
  exit 2
fi

echo "[test-all 1/3][short] docs gate"
bash scripts/docs-gate.sh

echo "[test-all 2/3][long] full test matrix + hooks-equivalence gate (parallel)"
bash scripts/ci/with-heartbeat.sh "$HEARTBEAT_INTERVAL_SEC" "test-matrix-full" "UIQ_TEST_MATRIX_RUN_TEST_TRUTH_GATE=0 pnpm test:matrix:full" &
MATRIX_PID="$!"
bash scripts/ci/with-heartbeat.sh "$HEARTBEAT_INTERVAL_SEC" "hooks-equivalence-gate" "bash scripts/ci/hooks-equivalence-gate.sh" &
EQUIV_PID="$!"

set +e
wait "$MATRIX_PID"
matrix_rc=$?
wait "$EQUIV_PID"
equiv_rc=$?
set -e

if (( matrix_rc != 0 || equiv_rc != 0 )); then
  echo "test-all failed (matrix=${matrix_rc}, hooks_equivalence=${equiv_rc})" >&2
  exit 1
fi

if [[ "$MUTATION_MODE" == "off" ]]; then
  echo "[test-all 3/3][optional] mutation gate skipped (UIQ_MUTATION_GATE_MODE=off, non-required context only)"
else
  if [[ "$MUTATION_MODE" == "summary" ]]; then
    echo "[test-all 3/3][optional] mutation summary gate"
    bash scripts/ci/with-heartbeat.sh "$HEARTBEAT_INTERVAL_SEC" "mutation-summary" "pnpm mutation:summary"
  else
    echo "[test-all 3/3][optional] mutation strict gate"
    if [[ "$MUTATION_REQUIRED_CONTEXT" == "true" ]]; then
      bash scripts/ci/with-heartbeat.sh "$HEARTBEAT_INTERVAL_SEC" "mutation-ts-strict" "pnpm mutation:ts:strict"
      bash scripts/ci/with-heartbeat.sh "$HEARTBEAT_INTERVAL_SEC" "mutation-py-strict" "pnpm mutation:py:strict"
    fi
    bash scripts/ci/with-heartbeat.sh "$HEARTBEAT_INTERVAL_SEC" "mutation-effective" "pnpm mutation:effective"
  fi

  node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const summaryPath = path.resolve(".runtime-cache/reports/mutation/latest-summary.json");
if (!fs.existsSync(summaryPath)) {
  console.error(`[test-all] mutation summary missing: ${summaryPath}`);
  process.exit(1);
}
const raw = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
for (const key of ["ts", "py"]) {
  if (!raw[key] || typeof raw[key].effective !== "boolean") {
    console.error(`[test-all] mutation summary invalid at key=${key}`);
    process.exit(1);
  }
}
console.log(`[test-all] mutation summary verified: ${summaryPath}`);
NODE
fi

echo "test-all passed"
