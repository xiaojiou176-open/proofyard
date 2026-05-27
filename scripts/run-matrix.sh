#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

RUN_ID_BASE="${RUN_ID_BASE:-${1:-matrix-$(date +%Y%m%d%H%M%S)-$$}}"
NIGHTLY_RUN_ID="${RUN_ID_BASE}-nightly"
MANUAL_RUN_ID="${RUN_ID_BASE}-manual"
DESKTOP_RUN_ID_PREFIX="${RUN_ID_BASE}-desktop"
SEEN_RUN_IDS=""

ensure_unique_run_id() {
  local run_id="$1"
  local run_dir=".runtime-cache/artifacts/runs/${run_id}"

  if printf '%s\n' "$SEEN_RUN_IDS" | grep -Fxq "$run_id"; then
    echo "error: duplicate run-id in current matrix: ${run_id}"
    exit 1
  fi
  if [ -e "$run_dir" ]; then
    echo "error: run-id already exists: ${run_id}"
    echo "please set RUN_ID_BASE to a new value and retry"
    exit 1
  fi

  SEEN_RUN_IDS="${SEEN_RUN_IDS}${run_id}"$'\n'
}

ensure_unique_run_id "$NIGHTLY_RUN_ID"
ensure_unique_run_id "$MANUAL_RUN_ID"

echo "matrix.run_id_base=${RUN_ID_BASE}"
echo "nightly.run_id=${NIGHTLY_RUN_ID}"
echo "manual.run_id=${MANUAL_RUN_ID}"
echo "desktop.run_id_prefix=${DESKTOP_RUN_ID_PREFIX}"

pids=()
names=()

(
  echo "[nightly] start"
  pnpm uiq run --profile nightly --target web.ci --run-id "$NIGHTLY_RUN_ID"
) &
pids+=("$!")
names+=("nightly")

(
  echo "[manual] start"
  pnpm uiq run --profile manual --target web.ci --run-id "$MANUAL_RUN_ID"
) &
pids+=("$!")
names+=("manual")

(
  echo "[desktop] start"
  RUN_ID_PREFIX="$DESKTOP_RUN_ID_PREFIX" ./scripts/verify-desktop-soak.sh
) &
pids+=("$!")
names+=("desktop")

failed=()
for i in "${!pids[@]}"; do
  if wait "${pids[$i]}"; then
    echo "[${names[$i]}] passed"
  else
    echo "[${names[$i]}] failed"
    failed+=("${names[$i]}")
  fi
done

if [ "${#failed[@]}" -gt 0 ]; then
  echo "matrix failed: ${failed[*]}"
  exit 1
fi

echo "matrix complete"
echo "nightly_manifest=.runtime-cache/artifacts/runs/${NIGHTLY_RUN_ID}/manifest.json"
echo "weekly_manifest=.runtime-cache/artifacts/runs/${MANUAL_RUN_ID}/manifest.json"
