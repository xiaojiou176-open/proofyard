#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/proofyard-space-clean-reclaim-XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

repo_root="$tmp_dir/repo"
runtime_root="$repo_root/.runtime-cache"
home_root="$tmp_dir/home"

mkdir -p \
  "$repo_root/configs/governance" \
  "$repo_root/.venv/bin" \
  "$repo_root/apps/automation-runner/node_modules" \
  "$repo_root/apps/mcp-server/node_modules" \
  "$runtime_root/backups" \
  "$runtime_root/toolchains/python/.venv/bin" \
  "$home_root/.cache/pnpm/proofyard/store"

cp configs/governance/runtime-live-policy.json "$repo_root/configs/governance/runtime-live-policy.json"
cp configs/governance/runtime-output-registry.json "$repo_root/configs/governance/runtime-output-registry.json"

printf 'legacy\n' > "$repo_root/.venv/bin/python"
printf 'runner\n' > "$repo_root/apps/automation-runner/node_modules/index.js"
printf 'mcp\n' > "$repo_root/apps/mcp-server/node_modules/index.js"
printf 'backup\n' > "$runtime_root/backups/keep.tgz"
printf 'managed\n' > "$runtime_root/toolchains/python/.venv/bin/python"
printf 'store\n' > "$home_root/.cache/pnpm/proofyard/store/index.json"

dry_output="$(HOME="$home_root" python3 scripts/space-clean-reclaim.py --repo-root "$repo_root" --pretty)"
python3 - <<'PY' "$dry_output" "$repo_root" "$home_root"
import json
import sys
from pathlib import Path

payload = json.loads(sys.argv[1])
repo_root = Path(sys.argv[2])
home_root = Path(sys.argv[3]).resolve()

assert payload["dry_run"] is True
assert payload["status"] == "ok"
assert payload["deleted_count"] == 0
candidates = {item["id"]: item for item in payload["reclaim_candidates"]}
assert set(candidates) == {
    "root-venv",
    "repo-pnpm-store",
    "automation-runner-node-modules",
    "mcp-server-node-modules",
}
assert candidates["root-venv"]["apply_allowed"] is True
assert candidates["repo-pnpm-store"]["path"] == str(home_root / ".cache/pnpm/proofyard/store")
assert (repo_root / ".venv").exists()
assert (repo_root / "apps/automation-runner/node_modules").exists()
assert (repo_root / "apps/mcp-server/node_modules").exists()
PY

apply_output="$(HOME="$home_root" python3 scripts/space-clean-reclaim.py --repo-root "$repo_root" --scope root-venv --scope repo-pnpm-store --scope automation-runner-node-modules --scope mcp-server-node-modules --apply)"
python3 - <<'PY' "$apply_output" "$repo_root" "$runtime_root" "$home_root"
import json
import sys
from pathlib import Path

payload = json.loads(sys.argv[1])
repo_root = Path(sys.argv[2])
runtime_root = Path(sys.argv[3])
home_root = Path(sys.argv[4])

assert payload["dry_run"] is False
assert payload["status"] == "ok"
assert payload["deleted_count"] == 4
assert not (repo_root / ".venv").exists()
assert not (repo_root / "apps/automation-runner/node_modules").exists()
assert not (repo_root / "apps/mcp-server/node_modules").exists()
assert not (home_root / ".cache/pnpm/proofyard").exists()
assert (runtime_root / "backups" / "keep.tgz").exists()
assert (runtime_root / "toolchains" / "python" / ".venv" / "bin" / "python").exists()
PY

echo "space-clean-reclaim smoke passed"
