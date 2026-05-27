#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

TARGETS=(
  ".env.example"
  "docs/reference/configuration.md"
)

mkdir -p ".runtime-cache/temp"
TMP_DIR="$(mktemp -d ".runtime-cache/temp/env-sync-check.XXXXXX")"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

for target in "${TARGETS[@]}"; do
  mkdir -p "$TMP_DIR/$(dirname "$target")"
  cp "$target" "$TMP_DIR/$target"
done

pnpm env:generate >/dev/null

changed=0
for target in "${TARGETS[@]}"; do
  if ! cmp -s "$TMP_DIR/$target" "$target"; then
    echo "[env-sync-check] generated output drift detected: $target" >&2
    changed=1
  fi
done

if [[ "$changed" -ne 0 ]]; then
  exit 1
fi

echo "[env-sync-check] ok"
