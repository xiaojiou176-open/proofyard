#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ORIGINAL_RUNTIME_ROOT="$ROOT_DIR/.runtime-cache"
BACKUP_PARENT="$(mktemp -d "${TMPDIR:-/tmp}/uiq-cold-cache-recovery-XXXXXX")"
BACKUP_RUNTIME_ROOT="$BACKUP_PARENT/runtime-cache"
COLD_CACHE_DB_PATH="$BACKUP_PARENT/cold-cache-recovery.sqlite3"
RESTORE_NEEDED=0
REPORT_FILE_TMP="$BACKUP_PARENT/cold-cache-recovery.json"
RESULTS_FILE_TMP="$BACKUP_PARENT/cold-cache-recovery-results.jsonl"
UIQ_GOVERNANCE_RUN_ID="${UIQ_GOVERNANCE_RUN_ID:-cold-cache-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
export UIQ_GOVERNANCE_RUN_ID
ARTIFACT_DIR="$ORIGINAL_RUNTIME_ROOT/artifacts/ci/${UIQ_GOVERNANCE_RUN_ID}"

cleanup() {
  local exit_code=$?
  rm -rf "$ORIGINAL_RUNTIME_ROOT" 2>/dev/null || true
  if [[ "$RESTORE_NEEDED" -eq 1 && -d "$BACKUP_RUNTIME_ROOT" ]]; then
    if [[ -e "$ORIGINAL_RUNTIME_ROOT" ]]; then
      rm -rf "$ORIGINAL_RUNTIME_ROOT" 2>/dev/null || true
    fi
    mkdir -p "$(dirname "$ORIGINAL_RUNTIME_ROOT")"
    if ! mv "$BACKUP_RUNTIME_ROOT" "$ORIGINAL_RUNTIME_ROOT"; then
      rm -rf "$ORIGINAL_RUNTIME_ROOT" 2>/dev/null || true
      mv "$BACKUP_RUNTIME_ROOT" "$ORIGINAL_RUNTIME_ROOT"
    fi
  else
    mkdir -p "$ORIGINAL_RUNTIME_ROOT"
  fi
  if [[ -d "$ORIGINAL_RUNTIME_ROOT/runtime-cache" ]]; then
    rm -rf "$ORIGINAL_RUNTIME_ROOT/runtime-cache"
  fi
  mkdir -p "$ARTIFACT_DIR"
  if [[ -f "$REPORT_FILE_TMP" ]]; then
    cp "$REPORT_FILE_TMP" "$ARTIFACT_DIR/cold-cache-recovery.json"
  fi
  rm -f "$COLD_CACHE_DB_PATH" 2>/dev/null || true
  rm -rf "$BACKUP_PARENT"
  exit "$exit_code"
}

trap cleanup EXIT

# The repo-truth gate may already have started the local dev stack earlier in
# the run. Stop any active stack before moving the runtime root, otherwise the
# still-running backend can recreate SQLite state inside the fresh cold-cache
# root and invalidate the migration rehearsal.
bash scripts/dev-down.sh >/dev/null 2>&1 || true

if [[ -d "$ORIGINAL_RUNTIME_ROOT" ]]; then
  mkdir -p "$(dirname "$BACKUP_RUNTIME_ROOT")"
  if mv "$ORIGINAL_RUNTIME_ROOT" "$BACKUP_RUNTIME_ROOT"; then
    RESTORE_NEEDED=1
  elif [[ -d "$ORIGINAL_RUNTIME_ROOT" ]]; then
    echo "[cold-cache] failed to move runtime root into backup location" >&2
    exit 1
  else
    echo "[cold-cache] runtime root disappeared before backup, continuing with empty cold-cache state"
  fi
fi

mkdir -p "$ORIGINAL_RUNTIME_ROOT"

STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

GOVERNANCE_STATIC_RECOVERY_COMMAND="node scripts/ci/check-root-governance.mjs && node scripts/ci/check-root-semantic-cleanliness.mjs && node scripts/ci/check-source-tree-runtime-residue.mjs && node scripts/ci/check-runtime-governance.mjs && node scripts/ci/check-runtime-live-inventory.mjs && node scripts/ci/check-runtime-size-budgets.mjs && node scripts/ci/check-module-boundaries.mjs && node scripts/ci/check-public-surface-boundaries.mjs && node scripts/ci/check-dependency-governance.mjs && node scripts/ci/check-upstream-governance.mjs && node scripts/ci/check-path-drift-governance.mjs && node scripts/ci/render-docs-governance.mjs --check"

COMMANDS=(
  "$GOVERNANCE_STATIC_RECOVERY_COMMAND"
  "export PROJECT_PYTHON_ENV=.runtime-cache/toolchains/python/.venv UV_PROJECT_ENVIRONMENT=.runtime-cache/toolchains/python/.venv DATABASE_URL=sqlite+pysqlite:///${COLD_CACHE_DB_PATH} && uv sync --frozen --extra dev >/dev/null 2>&1 && CI=true pnpm install --frozen-lockfile >/dev/null 2>&1 && rm -f ${COLD_CACHE_DB_PATH} && bash scripts/dev-up.sh && bash scripts/dev-down.sh && rm -f ${COLD_CACHE_DB_PATH}"
  "pnpm env:check"
  "node --import tsx --test apps/mcp-server/tests/core.constants.test.ts"
)

: > "$RESULTS_FILE_TMP"
for cmd in "${COMMANDS[@]}"; do
  echo "[cold-cache] $cmd"
  if bash -lc "$cmd"; then
    python3 - "$RESULTS_FILE_TMP" "$cmd" "passed" <<'PY'
import json
import sys
path, command, status = sys.argv[1:]
with open(path, "a", encoding="utf-8") as fh:
    fh.write(json.dumps({"command": command, "status": status}, ensure_ascii=True) + "\n")
PY
  else
    python3 - "$RESULTS_FILE_TMP" "$cmd" "failed" <<'PY'
import json
import sys
path, command, status = sys.argv[1:]
with open(path, "a", encoding="utf-8") as fh:
    fh.write(json.dumps({"command": command, "status": status}, ensure_ascii=True) + "\n")
PY
    python3 - "$REPORT_FILE_TMP" "$STARTED_AT" "$RESULTS_FILE_TMP" <<'PY'
import json
import sys
path, started_at, results_path = sys.argv[1:]
entries = []
with open(results_path, "r", encoding="utf-8") as fh:
    for raw in fh:
        raw = raw.strip()
        if raw:
            entries.append(json.loads(raw))
payload = {
    "started_at": started_at,
    "finished_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat().replace("+00:00", "Z"),
    "status": "failed",
    "results": entries,
}
with open(path, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, ensure_ascii=True, indent=2)
    fh.write("\n")
PY
    exit 1
  fi
done

python3 - "$REPORT_FILE_TMP" "$STARTED_AT" "$RESULTS_FILE_TMP" <<'PY'
import json
import sys
path, started_at, results_path = sys.argv[1:]
entries = []
with open(results_path, "r", encoding="utf-8") as fh:
    for raw in fh:
        raw = raw.strip()
        if raw:
            entries.append(json.loads(raw))
payload = {
    "started_at": started_at,
    "finished_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat().replace("+00:00", "Z"),
    "status": "passed",
    "results": entries,
}
with open(path, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, ensure_ascii=True, indent=2)
    fh.write("\n")
PY

echo "[cold-cache] ok"
