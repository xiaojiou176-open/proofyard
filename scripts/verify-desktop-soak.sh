#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

RUN_SUFFIX="${RUN_ID_PREFIX:-$(date +%Y%m%d%H%M%S)-$$}"
TAURI_RUN_BASE="verify-tauri-soak-${RUN_SUFFIX}"
SWIFT_RUN_BASE="verify-swift-soak-${RUN_SUFFIX}"
TAURI_RUN_ID=""
SWIFT_RUN_ID=""

ensure_unique_run_id() {
  local run_id="$1"
  local run_dir=".runtime-cache/artifacts/runs/${run_id}"
  if [ -e "$run_dir" ]; then
    echo "error: run-id already exists: ${run_id}"
    echo "please set a new RUN_ID_PREFIX and retry"
    exit 1
  fi
}

run_with_retry() {
  local profile="$1"
  local target="$2"
  local run_base="$3"
  local extra_args="${4:-}"
  local -a extra_args_array=()
  if [[ -n "$extra_args" ]]; then
    read -r -a extra_args_array <<<"$extra_args"
  fi
  local max_attempts=2

  local attempt=1
  while [ "$attempt" -le "$max_attempts" ]; do
    local run_id="${run_base}-a${attempt}"
    ensure_unique_run_id "$run_id"
    echo "[$attempt/$max_attempts] profile=${profile} target=${target} run_id=${run_id}"
    if pnpm uiq run --profile "$profile" --target "$target" --run-id "$run_id" "${extra_args_array[@]}"; then
      RUN_WITH_RETRY_LAST_RUN_ID="$run_id"
      return 0
    fi
    if [ "$attempt" -lt "$max_attempts" ]; then
      echo "retrying ${profile} after transient failure"
      sleep 2
    fi
    attempt=$((attempt + 1))
  done

  RUN_WITH_RETRY_LAST_RUN_ID="${run_base}-a${max_attempts}"
  return 1
}

echo "[1/2] tauri soak profile"
run_with_retry "tauri.soak" "tauri.macos" "$TAURI_RUN_BASE"
TAURI_RUN_ID="$RUN_WITH_RETRY_LAST_RUN_ID"

echo "[2/2] swift soak profile"
# 不要动 Quotio！swift.macos 默认 bundleId 为空，必须显式设 SWIFT_BUNDLE_ID 或传 --bundle-id
if [ -z "${SWIFT_BUNDLE_ID:-}" ]; then
  echo "Skipping swift soak: SWIFT_BUNDLE_ID is not set (target default is empty)"
  SWIFT_RUN_ID=""
else
  run_with_retry "swift.soak" "swift.macos" "$SWIFT_RUN_BASE" "--bundle-id ${SWIFT_BUNDLE_ID}"
  SWIFT_RUN_ID="$RUN_WITH_RETRY_LAST_RUN_ID"
fi

echo "DONE"
echo "tauri_manifest=.runtime-cache/artifacts/runs/${TAURI_RUN_ID}/manifest.json"
[ -n "${SWIFT_RUN_ID:-}" ] && echo "swift_manifest=.runtime-cache/artifacts/runs/${SWIFT_RUN_ID}/manifest.json"
