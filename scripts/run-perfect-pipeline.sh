#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
source "$ROOT_DIR/scripts/lib/python-runtime.sh"
ensure_project_python_env_exports

MODE="${1:-manual}"
if [[ "$MODE" != "manual" && "$MODE" != "midscene" ]]; then
  echo "usage: ./scripts/run-perfect-pipeline.sh [manual|midscene] [--skip-record] [--session-id <id>] [orchestrate-options...]"
  exit 1
fi
shift || true

SKIP_RECORD="false"
SESSION_ID=""
ORCHESTRATE_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-record)
      SKIP_RECORD="true"
      shift
      ;;
    --session-id)
      SESSION_ID="${2:-}"
      shift 2
      ;;
    *)
      ORCHESTRATE_ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ "$SKIP_RECORD" == "true" ]]; then
  echo "[1/3] skip record, reuse existing artifacts"
else
  echo "[1/3] record session (${MODE})"
  ./scripts/run-pipeline.sh "$MODE" ui-only
fi

RESOLVED_SESSION_AND_NOTE="$(SESSION_ID="$SESSION_ID" "$(project_python_bin)" - <<'PY'
import json
import os
from pathlib import Path

runtime_root = Path(".runtime-cache/automation")
session_id = os.environ.get("SESSION_ID", "").strip()
latest_pointer = runtime_root / "latest-session.json"

def has_flow(session: str) -> bool:
    return bool(session) and (runtime_root / session / "flow-draft.json").is_file()

def has_full_artifacts(session: str) -> bool:
    if not session:
        return False
    session_dir = runtime_root / session
    return (
        (session_dir / "flow-draft.json").is_file()
        and (session_dir / "register.har").is_file()
        and (session_dir / "source.html").is_file()
        and (session_dir / "video").is_dir()
    )

def latest_with(predicate) -> str:
    if not runtime_root.exists():
        return ""
    candidates: list[tuple[float, str]] = []
    for child in runtime_root.iterdir():
        if not child.is_dir():
            continue
        if predicate(child.name):
            candidates.append((child.stat().st_mtime, child.name))
    if not candidates:
        return ""
    candidates.sort(reverse=True)
    return candidates[0][1]

if session_id:
    if has_flow(session_id):
        print(f"{session_id}|")
    else:
        print("||error: session-id has no flow-draft.json")
    raise SystemExit(0)

if latest_pointer.exists():
    try:
        latest = json.loads(latest_pointer.read_text(encoding="utf-8"))
        pointer_session = str(latest.get("sessionId") or "")
    except Exception:
        pointer_session = ""
    if has_full_artifacts(pointer_session):
        print(f"{pointer_session}|")
        raise SystemExit(0)
    full_fallback = latest_with(has_full_artifacts)
    if full_fallback:
        print(f"{full_fallback}|warn: latest pointer session '{pointer_session}' not full-artifacts, fallback to '{full_fallback}'")
        raise SystemExit(0)
    flow_fallback = latest_with(has_flow)
    if flow_fallback:
        print(f"{flow_fallback}|warn: no full-artifacts session found, fallback to flow-only '{flow_fallback}'")
        raise SystemExit(0)

fallback = latest_with(has_full_artifacts)
if fallback:
    print(f"{fallback}|")
else:
    fallback_flow = latest_with(has_flow)
    if fallback_flow:
        print(f"{fallback_flow}|warn: no full-artifacts session found, fallback to flow-only '{fallback_flow}'")
    else:
        print("||error: no usable session with flow-draft.json found")
PY
)"
EFFECTIVE_SESSION_ID="${RESOLVED_SESSION_AND_NOTE%%|*}"
RESOLVE_NOTE="${RESOLVED_SESSION_AND_NOTE#*|}"
if [[ -n "$RESOLVE_NOTE" ]]; then
  if [[ "$RESOLVE_NOTE" == error:* ]]; then
    echo "$RESOLVE_NOTE"
    exit 1
  fi
  echo "$RESOLVE_NOTE"
fi

echo "[2/3] build manifest from session: ${EFFECTIVE_SESSION_ID}"
(cd apps/automation-runner && pnpm manifest -- --session-id="$EFFECTIVE_SESSION_ID")

echo "[3/3] orchestrate from latest artifacts"
if [[ "${#ORCHESTRATE_ARGS[@]}" -gt 0 ]]; then
  ./scripts/orchestrate-from-artifacts.sh --session-id "$EFFECTIVE_SESSION_ID" --auto-create-run false --high-protection true "${ORCHESTRATE_ARGS[@]}"
else
  ./scripts/orchestrate-from-artifacts.sh --session-id "$EFFECTIVE_SESSION_ID" --auto-create-run false --high-protection true
fi

echo "perfect pipeline complete"
