#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

RUN_SUFFIX="$(date +%s)"
WEB_RUN_ID="verify-web-${RUN_SUFFIX}"
TAURI_RUN_ID="verify-tauri-${RUN_SUFFIX}"
SWIFT_RUN_ID="verify-swift-${RUN_SUFFIX}"

echo "[1/5] contracts:generate"
pnpm contracts:generate

echo "[2/5] lint/typecheck"
pnpm lint

echo "[3/5] web pr profile"
pnpm uiq run --profile pr --target web.ci --run-id "$WEB_RUN_ID"

echo "[4/5] tauri smoke profile"
pnpm uiq run --profile tauri.smoke --target tauri.macos --run-id "$TAURI_RUN_ID"

echo "[5/5] swift smoke profile"
# Do not touch Quotio here. swift.macos defaults to an empty bundleId, so SWIFT_BUNDLE_ID or --bundle-id must be provided explicitly.
if [ -z "${SWIFT_BUNDLE_ID:-}" ]; then
  echo "Skipping swift smoke: SWIFT_BUNDLE_ID is not set (target default is empty)"
  SWIFT_RUN_ID=""
else
  pnpm uiq run --profile swift.smoke --target swift.macos --run-id "$SWIFT_RUN_ID" --bundle-id "${SWIFT_BUNDLE_ID}"
fi

echo "DONE"
echo "web_manifest=.runtime-cache/artifacts/runs/${WEB_RUN_ID}/manifest.json"
echo "tauri_manifest=.runtime-cache/artifacts/runs/${TAURI_RUN_ID}/manifest.json"
[ -n "${SWIFT_RUN_ID:-}" ] && echo "swift_manifest=.runtime-cache/artifacts/runs/${SWIFT_RUN_ID}/manifest.json"
