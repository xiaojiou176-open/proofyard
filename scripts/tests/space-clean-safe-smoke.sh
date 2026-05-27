#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/proofyard-space-clean-safe-XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

repo_root="$tmp_dir/repo"
runtime_root="$repo_root/.runtime-cache"
mkdir -p "$repo_root/configs/governance"
cp configs/governance/runtime-live-policy.json "$repo_root/configs/governance/runtime-live-policy.json"
cp configs/governance/runtime-output-registry.json "$repo_root/configs/governance/runtime-output-registry.json"

mkdir -p \
  "$runtime_root/temp/session-a" \
  "$runtime_root/logs/preflight/20260325-1" \
  "$runtime_root/cache/pytest" \
  "$runtime_root/cache/ruff" \
  "$runtime_root/test-drivers" \
  "$runtime_root/automation/secure-defaults-stale" \
  "$runtime_root/automation/provider-domain-gate-stale" \
  "$runtime_root/automation/secret-missing-stale" \
  "$runtime_root/automation/hardening-stale" \
  "$runtime_root/artifacts/runs/empty-run" \
  "$runtime_root/artifacts/runs/full-run" \
  "$runtime_root/backups" \
  "$runtime_root/toolchains/python/.venv/bin" \
  "$repo_root/.venv/bin" \
  "$repo_root/apps/demo/__pycache__" \
  "$repo_root/apps/demo/.runtime-cache"

printf 'tmp\n' > "$runtime_root/temp/session-a/file.txt"
printf 'preflight\n' > "$runtime_root/logs/preflight/20260325-1/run.log"
printf 'old-cache\n' > "$runtime_root/cache/pytest/old.cache"
printf 'fresh-cache\n' > "$runtime_root/cache/ruff/fresh.cache"
printf 'driver\n' > "$runtime_root/test-drivers/driver.ts"
printf 'meta\n' > "$runtime_root/automation/secure-defaults-stale/session-meta.json"
printf 'meta\n' > "$runtime_root/automation/provider-domain-gate-stale/session-meta.json"
printf 'result\n' > "$runtime_root/automation/secret-missing-stale/replay-flow-result.json"
printf 'trace\n' > "$runtime_root/automation/hardening-stale/session-meta.json"
printf 'result\n' > "$runtime_root/artifacts/runs/full-run/result.txt"
printf 'backup\n' > "$runtime_root/backups/keep.tgz"
printf 'python\n' > "$runtime_root/toolchains/python/.venv/bin/python"
printf 'legacy\n' > "$repo_root/.venv/bin/python"
printf 'pyc\n' > "$repo_root/apps/demo/__pycache__/demo.cpython-311.pyc"
printf 'pyc\n' > "$repo_root/apps/demo/module.pyc"
printf 'nested\n' > "$repo_root/apps/demo/.runtime-cache/stale.txt"

python3 - <<'PY' "$runtime_root/cache/pytest/old.cache" "$runtime_root/cache/pytest" "$runtime_root/cache/ruff/fresh.cache" "$runtime_root/cache/ruff"
import os
import sys
import time
from pathlib import Path

old_file = Path(sys.argv[1])
old_dir = Path(sys.argv[2])
fresh_file = Path(sys.argv[3])
fresh_dir = Path(sys.argv[4])
now = time.time()
old_ts = now - (10 * 24 * 3600)
fresh_ts = now - (1 * 24 * 3600)
for target in (old_file, old_dir):
    os.utime(target, (old_ts, old_ts))
for target in (fresh_file, fresh_dir):
    os.utime(target, (fresh_ts, fresh_ts))
PY

dry_output="$(python3 scripts/space-clean-safe.py --repo-root "$repo_root" --runtime-root "$runtime_root")"
python3 - <<'PY' "$dry_output" "$repo_root" "$runtime_root"
import json
import sys
from pathlib import Path

payload = json.loads(sys.argv[1])
repo_root = Path(sys.argv[2])
runtime_root = Path(sys.argv[3])

assert payload["dry_run"] is True
assert payload["deleted_count"] == 0
candidate_paths = {item["relative_path"] for item in payload["safe_clean_candidates"]}
assert ".runtime-cache/artifacts/runs" not in set(payload["protected_paths"])
assert any(rule["relative_path"] == ".runtime-cache/artifacts/runs" and "empty-run-stub" in rule["allow_safe_clean_kinds"] for rule in payload["protected_path_rules"])
assert ".runtime-cache/temp/session-a" in candidate_paths
assert ".runtime-cache/logs/preflight/20260325-1" in candidate_paths
assert ".runtime-cache/cache/pytest" in candidate_paths
assert ".runtime-cache/test-drivers" in candidate_paths
assert ".runtime-cache/automation/hardening-stale" in candidate_paths
assert ".runtime-cache/automation/provider-domain-gate-stale" in candidate_paths
assert ".runtime-cache/automation/secret-missing-stale" in candidate_paths
assert ".runtime-cache/automation/secure-defaults-stale" in candidate_paths
assert ".runtime-cache/artifacts/runs/empty-run" in candidate_paths
assert "apps/demo/__pycache__" in candidate_paths
assert "apps/demo/module.pyc" in candidate_paths
assert "apps/demo/.runtime-cache" in candidate_paths

checks = [
    runtime_root / "temp" / "session-a",
    runtime_root / "logs" / "preflight" / "20260325-1",
    runtime_root / "cache" / "pytest",
    runtime_root / "test-drivers",
    runtime_root / "automation" / "hardening-stale",
    runtime_root / "automation" / "provider-domain-gate-stale",
    runtime_root / "automation" / "secret-missing-stale",
    runtime_root / "automation" / "secure-defaults-stale",
    runtime_root / "artifacts" / "runs" / "empty-run",
    repo_root / "apps" / "demo" / "__pycache__",
    repo_root / "apps" / "demo" / ".runtime-cache",
    repo_root / ".venv",
]
for target in checks:
    assert target.exists(), f"dry-run removed {target}"
PY

apply_output="$(python3 scripts/space-clean-safe.py --repo-root "$repo_root" --runtime-root "$runtime_root" --apply)"
python3 - <<'PY' "$apply_output" "$repo_root" "$runtime_root"
import json
import sys
from pathlib import Path

payload = json.loads(sys.argv[1])
repo_root = Path(sys.argv[2])
runtime_root = Path(sys.argv[3])

assert payload["dry_run"] is False
assert payload["deleted_count"] >= 6

removed = [
    runtime_root / "temp" / "session-a",
    runtime_root / "logs" / "preflight" / "20260325-1",
    runtime_root / "cache" / "pytest",
    runtime_root / "test-drivers",
    runtime_root / "automation" / "hardening-stale",
    runtime_root / "automation" / "provider-domain-gate-stale",
    runtime_root / "automation" / "secret-missing-stale",
    runtime_root / "automation" / "secure-defaults-stale",
    runtime_root / "artifacts" / "runs" / "empty-run",
    repo_root / "apps" / "demo" / "__pycache__",
    repo_root / "apps" / "demo" / "module.pyc",
    repo_root / "apps" / "demo" / ".runtime-cache",
]
for target in removed:
    assert not target.exists(), f"expected removed: {target}"

kept = [
    runtime_root / "cache" / "ruff",
    runtime_root / "artifacts" / "runs" / "full-run",
    runtime_root / "backups" / "keep.tgz",
    runtime_root / "toolchains" / "python" / ".venv",
    repo_root / ".venv",
]
for target in kept:
    assert target.exists(), f"expected kept: {target}"
PY

echo "space-clean-safe smoke passed"
