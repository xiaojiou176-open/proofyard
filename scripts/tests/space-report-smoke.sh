#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/webaudit-space-report-XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

repo_root="$tmp_dir/repo"
runtime_root="$repo_root/.runtime-cache"
home_root="$tmp_dir/home"
mkdir -p \
  "$repo_root/configs/governance" \
  "$repo_root/.venv/bin" \
  "$repo_root/apps/automation-runner/node_modules" \
  "$repo_root/apps/mcp-server/node_modules" \
  "$runtime_root/temp/session-a" \
  "$runtime_root/logs/preflight/run-1" \
  "$runtime_root/artifacts/runs/sample-run" \
  "$runtime_root/container-home/cache" \
  "$runtime_root/toolchains/python/.venv/bin" \
  "$home_root/.cache/pnpm/webaudit/store"
cp configs/governance/runtime-live-policy.json "$repo_root/configs/governance/runtime-live-policy.json"
cp configs/governance/runtime-output-registry.json "$repo_root/configs/governance/runtime-output-registry.json"

printf 'temp\n' > "$runtime_root/temp/session-a/file.txt"
printf 'log\n' > "$runtime_root/logs/preflight/run-1/preflight.log"
printf 'manifest\n' > "$runtime_root/artifacts/runs/sample-run/manifest.json"
printf 'container\n' > "$runtime_root/container-home/cache/index.txt"
printf 'store\n' > "$home_root/.cache/pnpm/webaudit/store/index.json"
printf 'legacy\n' > "$repo_root/.venv/bin/python"
printf 'runner\n' > "$repo_root/apps/automation-runner/node_modules/index.js"
printf 'mcp\n' > "$repo_root/apps/mcp-server/node_modules/index.js"
printf 'managed\n' > "$runtime_root/toolchains/python/.venv/bin/python"

report_output="$(HOME="$home_root" python3 scripts/space-report.py --repo-root "$repo_root" --runtime-root "$runtime_root")"
python3 - <<'PY' "$report_output" "$home_root"
import json
import sys
from pathlib import Path

payload = json.loads(sys.argv[1])
home_root = Path(sys.argv[2]).resolve()

assert payload["repo_internal_total_bytes"] > 0
assert payload["repo_exclusive_external_total_bytes"] > 0
assert payload["safe_clean_total_bytes"] > 0
assert payload["reclaim_total_bytes"] > 0
assert payload["protected_total_bytes"] > 0
assert any(bucket["id"] == "artifacts" and bucket["cleanup_class"] == "preserve" for bucket in payload["managed_buckets"])
assert any(bucket["id"] == "temp" and bucket["cleanup_class"] == "safe-clean" for bucket in payload["managed_buckets"])
assert any(layer["id"] == "pnpm-webaudit-store" for layer in payload["repo_exclusive_external_layers"])
assert any(item["relative_path"] == ".runtime-cache/temp/session-a" for item in payload["safe_clean_candidates"])
assert any(item["id"] == "root-venv" and item["apply_allowed"] is True for item in payload["reclaim_candidates"])
assert any(item["id"] == "repo-pnpm-store" for item in payload["reclaim_candidates"])
assert any(item["id"] == "automation-runner-node-modules" for item in payload["reclaim_candidates"])
assert any(item["id"] == "mcp-server-node-modules" for item in payload["reclaim_candidates"])
assert any(rule["relative_path"] == ".runtime-cache/artifacts/runs" and "empty-run-stub" in rule["allow_safe_clean_kinds"] for rule in payload["protected_path_rules"])
external_paths = {Path(layer["path"]).resolve() for layer in payload["repo_exclusive_external_layers"]}
assert home_root.joinpath(".cache/pnpm/webaudit").resolve() in external_paths
PY

echo "space-report smoke passed"
