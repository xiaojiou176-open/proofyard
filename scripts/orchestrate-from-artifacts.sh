#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
source "$ROOT_DIR/scripts/lib/python-runtime.sh"
ensure_project_python_env_exports

PYTHON_BIN="$(project_python_bin)"
PYTHON_UVICORN_BIN="$(project_uvicorn_bin)"

TEMPLATE_NAME="auto-template"
HIGH_PROTECTION="true"
AUTO_CREATE_RUN="false"
SESSION_ID=""
HAR_PATH=""
HTML_PATH=""
VIDEO_PATH=""
FLOW_DRAFT_PATH=""
OTP_CODE=""
AUTOMATION_TOKEN=""
START_BACKEND="true"
RUN_PARAMS=()

usage() {
  cat <<'EOF'
usage: ./scripts/orchestrate-from-artifacts.sh [options]

options:
  --session-id <id>          Use an existing automation session id
  --template-name <name>     Template name (default: auto-template)
  --high-protection <bool>   true/false (default: true)
  --auto-create-run <bool>   true/false (default: false)
  --run-param k=v            Repeatable run param key/value
  --otp-code <code>          Optional OTP code when creating run
  --har-path <path>          Optional HAR file path (uploaded as base64)
  --html-path <path>         Optional HTML file path
  --video-path <path>        Optional video file path (uploaded as base64)
  --flow-draft-path <path>   Optional flow-draft json path
  --automation-token <token> Optional automation token for backend API
  --start-backend <bool>     Auto start local backend if not running (default: true)
  -h, --help                 Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --session-id)
      SESSION_ID="${2:-}"
      shift 2
      ;;
    --template-name)
      TEMPLATE_NAME="${2:-}"
      shift 2
      ;;
    --high-protection)
      HIGH_PROTECTION="${2:-}"
      shift 2
      ;;
    --auto-create-run)
      AUTO_CREATE_RUN="${2:-}"
      shift 2
      ;;
    --run-param)
      RUN_PARAMS+=("${2:-}")
      shift 2
      ;;
    --otp-code)
      OTP_CODE="${2:-}"
      shift 2
      ;;
    --har-path)
      HAR_PATH="${2:-}"
      shift 2
      ;;
    --html-path)
      HTML_PATH="${2:-}"
      shift 2
      ;;
    --video-path)
      VIDEO_PATH="${2:-}"
      shift 2
      ;;
    --flow-draft-path)
      FLOW_DRAFT_PATH="${2:-}"
      shift 2
      ;;
    --automation-token)
      AUTOMATION_TOKEN="${2:-}"
      shift 2
      ;;
    --start-backend)
      START_BACKEND="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$SESSION_ID" && -z "$HAR_PATH" && -z "$HTML_PATH" && -z "$VIDEO_PATH" && -z "$FLOW_DRAFT_PATH" ]]; then
  LATEST_POINTER=".runtime-cache/automation/latest-session.json"
  if [[ ! -f "$LATEST_POINTER" ]]; then
    echo "error: no session-id provided and no latest session found at $LATEST_POINTER"
    exit 1
  fi
  SESSION_ID="$("$PYTHON_BIN" - <<'PY'
import json
from pathlib import Path
p = Path(".runtime-cache/automation/latest-session.json")
data = json.loads(p.read_text(encoding="utf-8"))
print(data.get("sessionId", ""))
PY
)"
fi

if [[ -z "$FLOW_DRAFT_PATH" ]]; then
  RESOLVED_SESSION_AND_FLOW="$(SESSION_ID="$SESSION_ID" "$PYTHON_BIN" - <<'PY'
import os
from pathlib import Path

runtime_root = Path(".runtime-cache/automation")
session_id = os.environ.get("SESSION_ID", "").strip()

def find_latest_with_flow() -> str:
    candidates: list[tuple[float, str]] = []
    if not runtime_root.exists():
        return ""
    for child in runtime_root.iterdir():
        if not child.is_dir():
            continue
        if (child / "flow-draft.json").is_file():
            candidates.append((child.stat().st_mtime, child.name))
    if not candidates:
        return ""
    candidates.sort(reverse=True)
    return candidates[0][1]

if session_id:
    flow_path = runtime_root / session_id / "flow-draft.json"
    if flow_path.is_file():
        print(f"{session_id}|{flow_path}")
    else:
        fallback = find_latest_with_flow()
        if fallback:
            fallback_path = runtime_root / fallback / "flow-draft.json"
            print(f"{fallback}|{fallback_path}")
        else:
            print("||")
else:
    fallback = find_latest_with_flow()
    if fallback:
        fallback_path = runtime_root / fallback / "flow-draft.json"
        print(f"{fallback}|{fallback_path}")
    else:
        print("||")
PY
)"
  RESOLVED_SESSION="${RESOLVED_SESSION_AND_FLOW%%|*}"
  RESOLVED_FLOW_PATH="${RESOLVED_SESSION_AND_FLOW#*|}"
  if [[ -z "$RESOLVED_SESSION" || -z "$RESOLVED_FLOW_PATH" ]]; then
    echo "error: no usable session found (missing flow-draft.json). run './scripts/run-pipeline.sh manual ui-only' first or pass --flow-draft-path."
    exit 1
  fi
  if [[ -n "$SESSION_ID" && "$RESOLVED_SESSION" != "$SESSION_ID" ]]; then
    echo "warn: session '$SESSION_ID' has no flow-draft.json, fallback to latest usable session '$RESOLVED_SESSION'."
  fi
  SESSION_ID="$RESOLVED_SESSION"
  FLOW_DRAFT_PATH="$RESOLVED_FLOW_PATH"
fi

if [[ "$START_BACKEND" == "true" ]] && ! curl -fsS "http://127.0.0.1:8000/health/" >/dev/null 2>&1; then
  mkdir -p ".runtime-cache/logs"
  BACKEND_LOG=".runtime-cache/logs/backend.orchestrate.log"
  AUTOMATION_ALLOW_LOCAL_NO_TOKEN=true "$PYTHON_UVICORN_BIN" apps.api.app.main:app --host 127.0.0.1 --port 8000 >"$BACKEND_LOG" 2>&1 &
  BACKEND_PID=$!
  cleanup_backend() {
    if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
      kill "$BACKEND_PID" >/dev/null 2>&1 || true
      wait "$BACKEND_PID" 2>/dev/null || true
    fi
  }
  trap cleanup_backend EXIT
  for _ in {1..30}; do
    if curl -fsS "http://127.0.0.1:8000/health/" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  if ! curl -fsS "http://127.0.0.1:8000/health/" >/dev/null 2>&1; then
    echo "error: backend not ready, log=$BACKEND_LOG"
    exit 1
  fi
fi

RUN_PARAMS_SERIALIZED=""
if [[ "${#RUN_PARAMS[@]}" -gt 0 ]]; then
  RUN_PARAMS_SERIALIZED="$(printf "%s\n" "${RUN_PARAMS[@]}")"
fi

AUTOMATION_TOKEN_RESOLVED="$AUTOMATION_TOKEN"
if [[ -z "$AUTOMATION_TOKEN_RESOLVED" ]]; then
  AUTOMATION_TOKEN_RESOLVED="${AUTOMATION_API_TOKEN:-}"
fi
if [[ -z "$AUTOMATION_TOKEN_RESOLVED" && -f ".env" ]]; then
  AUTOMATION_TOKEN_RESOLVED="$("$PYTHON_BIN" - <<'PY'
from dotenv import dotenv_values
values = dotenv_values(".env")
print((values.get("AUTOMATION_API_TOKEN") or "").strip())
PY
)"
fi
if [[ "$AUTOMATION_TOKEN_RESOLVED" == "replace-with-strong-token" ]]; then
  AUTOMATION_TOKEN_RESOLVED=""
fi

export SESSION_ID TEMPLATE_NAME HIGH_PROTECTION AUTO_CREATE_RUN HAR_PATH HTML_PATH VIDEO_PATH FLOW_DRAFT_PATH OTP_CODE RUN_PARAMS_SERIALIZED AUTOMATION_TOKEN_RESOLVED

"$PYTHON_BIN" - <<'PY'
import base64
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

def parse_bool(value: str) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}

session_id = os.environ.get("SESSION_ID", "").strip()
template_name = os.environ.get("TEMPLATE_NAME", "auto-template").strip() or "auto-template"
high_protection = parse_bool(os.environ.get("HIGH_PROTECTION", "true"))
auto_create_run = parse_bool(os.environ.get("AUTO_CREATE_RUN", "false"))
otp_code = os.environ.get("OTP_CODE", "").strip()

payload: dict[str, object] = {
    "template_name": template_name,
    "high_protection": high_protection,
    "auto_create_run": auto_create_run,
    "run_params": {},
}

if session_id:
    payload["session_id"] = session_id

run_params_raw = os.environ.get("RUN_PARAMS_SERIALIZED", "")
run_params: dict[str, str] = {}
for line in run_params_raw.splitlines():
    line = line.strip()
    if not line:
        continue
    if "=" not in line:
        raise SystemExit(f"invalid --run-param '{line}', expected key=value")
    key, value = line.split("=", 1)
    key = key.strip()
    if not key:
        raise SystemExit(f"invalid --run-param '{line}', empty key")
    run_params[key] = value
payload["run_params"] = run_params

if otp_code:
    payload["otp_code"] = otp_code

har_path = os.environ.get("HAR_PATH", "").strip()
if har_path:
    har_data = Path(har_path).read_bytes()
    payload["har_base64"] = base64.b64encode(har_data).decode("utf-8")

html_path = os.environ.get("HTML_PATH", "").strip()
if html_path:
    payload["html"] = Path(html_path).read_text(encoding="utf-8")

video_path = os.environ.get("VIDEO_PATH", "").strip()
if video_path:
    video_data = Path(video_path).read_bytes()
    payload["video_base64"] = base64.b64encode(video_data).decode("utf-8")

flow_draft_path = os.environ.get("FLOW_DRAFT_PATH", "").strip()
if flow_draft_path:
    payload["flow_draft"] = json.loads(Path(flow_draft_path).read_text(encoding="utf-8"))

request = urllib.request.Request(
    "http://127.0.0.1:8000/api/command-tower/orchestrate-from-artifacts",
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST",
)
token = os.environ.get("AUTOMATION_TOKEN_RESOLVED", "").strip()
if token:
    request.add_header("x-automation-token", token)

try:
    with urllib.request.urlopen(request, timeout=90) as response:
        body = response.read().decode("utf-8")
except urllib.error.HTTPError as exc:
    detail = exc.read().decode("utf-8", errors="replace")
    extra = ""
    if exc.code == 404:
        try:
            with urllib.request.urlopen("http://127.0.0.1:8000/openapi.json", timeout=10) as openapi_resp:
                openapi = json.loads(openapi_resp.read().decode("utf-8"))
            paths = openapi.get("paths", {})
            extra = f" | route_registered={('/api/command-tower/orchestrate-from-artifacts' in paths)}"
        except Exception as openapi_exc:
            extra = f" | route_probe_failed={openapi_exc}"
    raise SystemExit(
        f"orchestrate-from-artifacts request failed: HTTP {exc.code}: {detail}{extra}"
    )
except Exception as exc:
    raise SystemExit(f"orchestrate-from-artifacts request failed: {exc}")

result = json.loads(body)
session = str(result.get("session_id", session_id)).strip()
if not session:
    raise SystemExit("orchestrate response missing session_id")

session_dir = Path(".runtime-cache/automation") / session
session_dir.mkdir(parents=True, exist_ok=True)
result_path = session_dir / "orchestrate-result.json"
result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

checks = result.get("run_readiness_report", {}).get("checks", {})
clusters = result.get("failure_clusters", [])
summary_lines = [
    f"session_id: {result.get('session_id', 'n/a')}",
    f"flow_id: {result.get('flow_id', 'n/a')}",
    f"template_id: {result.get('template_id', 'n/a')}",
    f"run_id: {result.get('run_id', 'n/a')}",
    f"run_status: {result.get('run_status', 'n/a')}",
    f"ready: {result.get('run_readiness_report', {}).get('ready', False)}",
    "",
    "readiness_checks:",
]
for key, ok in checks.items():
    summary_lines.append(f"- {key}: {'ok' if ok else 'failed'}")
summary_lines.append("")
summary_lines.append("failure_clusters:")
if clusters:
    for cluster in clusters:
        summary_lines.append(
            f"- {cluster.get('cluster_key', 'n/a')} | count={cluster.get('count', 0)} | sample={cluster.get('sample_detail', 'n/a')}"
        )
else:
    summary_lines.append("- none")

summary_path = session_dir / "orchestrate-summary.txt"
summary_path.write_text("\n".join(summary_lines) + "\n", encoding="utf-8")

print(json.dumps({
    "result_path": str(result_path),
    "summary_path": str(summary_path),
    "result": result,
}, ensure_ascii=False, indent=2))
PY
