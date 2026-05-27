#!/usr/bin/env bash
set -euo pipefail

echo "[deps-guard] verifying root install path excludes openai/anthropic"

scan_cmd=(grep -nE '\b(openai|@anthropic-ai/sdk|anthropic)@')
if command -v rg >/dev/null 2>&1; then
  scan_cmd=(rg -n '\b(openai|@anthropic-ai/sdk|anthropic)@')
fi

tmp_lock_scan="$(mktemp "${TMPDIR:-/tmp}/uiq-llm-vendor-lock-scan.XXXXXX")"
tmp_tree_output="$(mktemp)"
trap 'rm -f "$tmp_lock_scan" "$tmp_tree_output"' EXIT

if "${scan_cmd[@]}" pnpm-lock.yaml >"$tmp_lock_scan"; then
  echo "[deps-guard] root pnpm-lock.yaml unexpectedly references openai/anthropic:"
  cat "$tmp_lock_scan"
  exit 1
fi

pnpm ls openai --depth 99 >"$tmp_tree_output" 2>&1 || true
if grep -q 'openai@' "$tmp_tree_output"; then
  echo "[deps-guard] root dependency tree unexpectedly contains openai:"
  cat "$tmp_tree_output"
  exit 1
fi

pnpm ls @anthropic-ai/sdk --depth 99 >"$tmp_tree_output" 2>&1 || true
if grep -q '@anthropic-ai/sdk@' "$tmp_tree_output"; then
  echo "[deps-guard] root dependency tree unexpectedly contains @anthropic-ai/sdk:"
  cat "$tmp_tree_output"
  exit 1
fi

pnpm ls anthropic --depth 99 >"$tmp_tree_output" 2>&1 || true
if grep -q 'anthropic@' "$tmp_tree_output"; then
  echo "[deps-guard] root dependency tree unexpectedly contains anthropic:"
  cat "$tmp_tree_output"
  exit 1
fi

echo "[deps-guard] PASS: root install path has zero openai/anthropic"
