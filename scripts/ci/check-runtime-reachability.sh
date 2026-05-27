#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

UIQ_GOVERNANCE_RUN_ID="${UIQ_GOVERNANCE_RUN_ID:-governance-runtime-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
export UIQ_GOVERNANCE_RUN_ID
ARTIFACT_DIR=".runtime-cache/artifacts/ci/${UIQ_GOVERNANCE_RUN_ID}"
REPORT_FILE="${ARTIFACT_DIR}/runtime-reachability.json"
mkdir -p "$ARTIFACT_DIR"

BACKEND_LOG=".runtime-cache/logs/runtime/backend.dev.log"
FRONTEND_LOG=".runtime-cache/logs/runtime/frontend.dev.log"
DEV_UP_RAN=0

cleanup() {
  if [[ "$DEV_UP_RAN" -eq 1 ]]; then
    bash scripts/dev-down.sh >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

record_report() {
  local status="$1"
  mkdir -p "$(dirname "$REPORT_FILE")"
  python3 - <<'PY' "$REPORT_FILE" "$status" "$BACKEND_LOG" "$FRONTEND_LOG"
import json
import os
import sys
from datetime import datetime, timezone

report_path, status, backend_log, frontend_log = sys.argv[1:]
payload = {
    "status": status,
    "finished_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "checks": {
        "backend_dev_log_exists": os.path.exists(backend_log),
        "frontend_dev_log_exists": os.path.exists(frontend_log),
        "backend_dev_log_nonempty": os.path.exists(backend_log) and os.path.getsize(backend_log) > 0,
        "frontend_dev_log_nonempty": os.path.exists(frontend_log) and os.path.getsize(frontend_log) > 0,
    },
}
with open(report_path, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, ensure_ascii=True, indent=2)
    fh.write("\n")
PY
}

echo "[runtime-reachability] starting dev stack"
bash scripts/dev-up.sh
DEV_UP_RAN=1

[[ -s "$BACKEND_LOG" ]] || { record_report failed; echo "[runtime-reachability] missing backend dev log"; exit 1; }
[[ -s "$FRONTEND_LOG" ]] || { record_report failed; echo "[runtime-reachability] missing frontend dev log"; exit 1; }

echo "[runtime-reachability] wrapper help smokes"
bash apps/automation-runner/scripts/run-curlconverter-safe.sh --help >/dev/null
bash apps/automation-runner/scripts/run-har-to-k6-safe.sh --help >/dev/null

record_report passed
echo "[runtime-reachability] ok"
