#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
export PYTHONDONTWRITEBYTECODE="${PYTHONDONTWRITEBYTECODE:-1}"

PROFILE="baseline"
if [[ "${1:-}" == "--profile" ]]; then
  PROFILE="${2:-baseline}"
fi
if [[ "$PROFILE" != "baseline" && "$PROFILE" != "full" ]]; then
  echo "usage: bash scripts/ci/governance-required-flows.sh [--profile baseline|full]" >&2
  exit 2
fi

ARTIFACT_DIR=".runtime-cache/artifacts/ci"
UIQ_GOVERNANCE_RUN_ID="${UIQ_GOVERNANCE_RUN_ID:-governance-proof-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
export UIQ_GOVERNANCE_RUN_ID
ARTIFACT_DIR="$ARTIFACT_DIR/$UIQ_GOVERNANCE_RUN_ID"
JSON_OUT="$ARTIFACT_DIR/governance-required-flows.json"
MD_OUT="$ARTIFACT_DIR/governance-required-flows.md"
PROFILE_JSON_OUT="$ARTIFACT_DIR/governance-required-flows-${PROFILE}.json"
PROFILE_MD_OUT="$ARTIFACT_DIR/governance-required-flows-${PROFILE}.md"
STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
FINAL_STATUS="passed"
DEV_STACK_STARTED=0
ROOT_CLEANLINESS_COMMAND="node scripts/ci/check-root-governance.mjs"
PROFILE_KIND="internal-control-plane"
RESULTS_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/governance-required-flows.XXXXXX")"

if [[ "$PROFILE" == "full" ]]; then
  PROFILE_KIND="repo-truth"
fi

mkdir -p "$ARTIFACT_DIR"
RESULTS_FILE="$RESULTS_TMP_DIR/governance-required-flows.results.jsonl"
: > "$RESULTS_FILE"

cleanup() {
  if [[ "$DEV_STACK_STARTED" -eq 1 ]]; then
    bash scripts/dev-down.sh >/dev/null 2>&1 || true
  fi
  rm -rf "$RESULTS_TMP_DIR"
  :
}
trap cleanup EXIT

record_step() {
  local step_id="$1"
  local command="$2"
  local status="$3"
  local duration_ms="$4"
  local detail="$5"
  python3 - "$RESULTS_FILE" "$step_id" "$command" "$status" "$duration_ms" "$detail" <<'PY'
import json
import sys
path, step_id, command, status, duration_ms, detail = sys.argv[1:]
with open(path, "a", encoding="utf-8") as fh:
    fh.write(json.dumps({
        "step_id": step_id,
        "command": command,
        "status": status,
        "duration_ms": int(duration_ms),
        "detail": detail,
    }, ensure_ascii=True) + "\n")
PY
}

run_step() {
  local step_id="$1"
  local command="$2"
  echo "[governance-required-flows] $step_id :: $command"
  local started_ms ended_ms duration_ms
  started_ms="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"
  if bash -lc "$command"; then
    if ! bash -lc "$ROOT_CLEANLINESS_COMMAND" >/dev/null; then
      ended_ms="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"
      duration_ms="$((ended_ms - started_ms))"
      record_step "$step_id" "$command" "failed" "$duration_ms" "root_cleanliness_failed"
      FINAL_STATUS="failed"
      return 1
    fi
    ended_ms="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"
    duration_ms="$((ended_ms - started_ms))"
    record_step "$step_id" "$command" "passed" "$duration_ms" ""
    return 0
  fi
  ended_ms="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"
  duration_ms="$((ended_ms - started_ms))"
  record_step "$step_id" "$command" "failed" "$duration_ms" "command_failed"
  FINAL_STATUS="failed"
  return 1
}

skip_step() {
  local step_id="$1"
  local command="$2"
  local detail="$3"
  echo "[governance-required-flows] skip $step_id :: $detail"
  record_step "$step_id" "$command" "skipped" 0 "$detail"
}

run_step "setup" "just setup"
run_step "contracts_generate" "pnpm contracts:generate"
run_step "lint" "pnpm lint"
run_step "docs_governance_render" "node scripts/ci/render-docs-governance.mjs"
run_step "docs_gate" "bash scripts/docs-gate.sh"
run_step "governance_contract" "find apps -type d -name '__pycache__' -prune -exec rm -rf {} + >/dev/null 2>&1 && pnpm governance:check"
run_step "cold_cache_recovery" "bash scripts/ci/check-cold-cache-recovery.sh"

if [[ "$PROFILE" == "full" ]]; then
  skip_step "dev_up" "TM_FRONTEND_PORT=43173 just dev-up" "canonical pr run autostarts target"
  run_step "uiq_run_pr_web" "bash scripts/dev-down.sh >/dev/null 2>&1 || true && pnpm uiq run --profile pr --target web.ci --run-id governance-proof-pr-web"
  skip_step "dev_down" "just dev-down" "canonical pr run tears down its own autostarted target"
  run_step "mainline_alignment" "pnpm mainline:alignment:check"
  run_step "test_matrix" "pnpm test:matrix"
else
  skip_step "dev_up" "just dev-up" "profile=baseline"
  skip_step "test_matrix" "pnpm test:matrix" "profile=baseline"
  skip_step "uiq_run_pr_web" "pnpm uiq run --profile pr --target web.ci --run-id governance-proof-pr-web" "profile=baseline"
  skip_step "dev_down" "just dev-down" "profile=baseline"
  skip_step "mainline_alignment" "pnpm mainline:alignment:check" "profile=baseline"
fi

python3 - "$RESULTS_FILE" "$JSON_OUT" "$MD_OUT" "$PROFILE_JSON_OUT" "$PROFILE_MD_OUT" "$PROFILE" "$PROFILE_KIND" "$STARTED_AT" "$FINAL_STATUS" <<'PY'
import json
import sys
from datetime import datetime, timezone

results_path, json_out, md_out, profile_json_out, profile_md_out, profile, profile_kind, started_at, final_status = sys.argv[1:]
steps = []
with open(results_path, "r", encoding="utf-8") as fh:
    for raw in fh:
        raw = raw.strip()
        if raw:
            steps.append(json.loads(raw))

finished_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
import os
for path in (json_out, md_out, profile_json_out, profile_md_out):
    os.makedirs(os.path.dirname(path), exist_ok=True)
payload = {
    "profile": profile,
    "profile_kind": profile_kind,
    "overall_truth_claimable": profile_kind == "repo-truth",
    "started_at": started_at,
    "finished_at": finished_at,
    "status": final_status,
    "steps": steps,
}
with open(json_out, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, ensure_ascii=True, indent=2)
    fh.write("\n")
with open(profile_json_out, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, ensure_ascii=True, indent=2)
    fh.write("\n")

lines = [
    "# Governance Required Flows",
    "",
    f"- Profile: `{profile}`",
    f"- Profile Kind: `{profile_kind}`",
    f"- Overall Truth Claimable: `{'true' if profile_kind == 'repo-truth' else 'false'}`",
    f"- Status: `{final_status}`",
    f"- Started: `{started_at}`",
    f"- Finished: `{finished_at}`",
    "",
    "| Step | Status | Duration (ms) | Command | Detail |",
    "| --- | --- | ---: | --- | --- |",
]
for step in steps:
    lines.append(
        f"| `{step['step_id']}` | `{step['status']}` | {step['duration_ms']} | `{step['command']}` | `{step['detail']}` |"
    )
with open(md_out, "w", encoding="utf-8") as fh:
    fh.write("\n".join(lines).rstrip() + "\n")
with open(profile_md_out, "w", encoding="utf-8") as fh:
    fh.write("\n".join(lines).rstrip() + "\n")
PY

if [[ "$FINAL_STATUS" != "passed" ]]; then
  exit 1
fi

echo "[governance-required-flows] ok ($PROFILE)"
