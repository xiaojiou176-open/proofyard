#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

CONFIG_FILE="${UIQ_UPSTREAM_SOURCE_CONFIG:-configs/upstream/source.yaml}"
UPSTREAM_MODE="$(awk -F':' '$1 ~ /^[[:space:]]*mode[[:space:]]*$/ {gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); print $2; exit}' "$CONFIG_FILE")"
UPSTREAM_BRANCH="${UIQ_UPSTREAM_BRANCH:-$(awk -F':' '$1 ~ /^[[:space:]]*branch[[:space:]]*$/ {gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); print $2; exit}' "$CONFIG_FILE")}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"

if [[ "${UPSTREAM_MODE:-explicit}" == "none" ]]; then
  echo "[upstream-binding-local] skipped (mode=none)"
  exit 0
fi

bash scripts/upstream/bootstrap.sh --strict --config "$CONFIG_FILE" >/dev/null

audit_json="$(bash scripts/git-sync-audit.sh --fetch --json --upstream-branch "$UPSTREAM_BRANCH")"

python3 - <<'PY' "$audit_json"
import json
import sys

payload = json.loads(sys.argv[1])
upstream = payload.get("upstream", {})
configured = upstream.get("configured")
ref_present = upstream.get("ref_present")
branch = upstream.get("branch")

if not configured:
    raise SystemExit("upstream binding failed: remote not configured")
if not ref_present:
    raise SystemExit(f"upstream binding failed: ref missing for {branch}")

print(f"[upstream-binding-local] ok ({branch})")
PY
