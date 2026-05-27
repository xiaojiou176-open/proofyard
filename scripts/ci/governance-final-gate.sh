#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
export PYTHONDONTWRITEBYTECODE="${PYTHONDONTWRITEBYTECODE:-1}"

export PYTHONDONTWRITEBYTECODE="${PYTHONDONTWRITEBYTECODE:-1}"

MODE="${UIQ_GOVERNANCE_GATE_MODE:-control-plane}"
REQUIRED_FLOWS_PROFILE="${UIQ_GOVERNANCE_REQUIRED_FLOWS_PROFILE:-}"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/ci/governance-final-gate.sh [--mode control-plane|repo-truth] [--required-flows-profile baseline|full] [--print-config]

Modes:
  control-plane  Internal governance control-plane gate.
  repo-truth     Authoritative scoped repo-truth gate. Requires internal governance, public/open-source readiness, release truth, mainline alignment, and full required-flows proof.
EOF
}

PRINT_CONFIG=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --required-flows-profile)
      REQUIRED_FLOWS_PROFILE="${2:-}"
      shift 2
      ;;
    --print-config)
      PRINT_CONFIG=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown option '$1'" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$MODE" != "control-plane" && "$MODE" != "repo-truth" ]]; then
  echo "error: --mode must be control-plane or repo-truth" >&2
  exit 2
fi

if [[ -z "$REQUIRED_FLOWS_PROFILE" ]]; then
  if [[ "$MODE" == "repo-truth" ]]; then
    REQUIRED_FLOWS_PROFILE="full"
  else
    REQUIRED_FLOWS_PROFILE="baseline"
  fi
fi

if [[ "$REQUIRED_FLOWS_PROFILE" != "baseline" && "$REQUIRED_FLOWS_PROFILE" != "full" ]]; then
  echo "error: --required-flows-profile must be baseline or full" >&2
  exit 2
fi

if [[ "$PRINT_CONFIG" -eq 1 ]]; then
  printf '{"mode":"%s","required_flows_profile":"%s"}\n' "$MODE" "$REQUIRED_FLOWS_PROFILE"
  exit 0
fi

UIQ_GOVERNANCE_RUN_ID="${UIQ_GOVERNANCE_RUN_ID:-governance-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
export UIQ_GOVERNANCE_RUN_ID
ARTIFACT_DIR=".runtime-cache/artifacts/ci/${UIQ_GOVERNANCE_RUN_ID}"
STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
mkdir -p "$ARTIFACT_DIR"
RESULTS_FILE="$ARTIFACT_DIR/governance-final-gate.results.jsonl"
RESULTS_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/uiq-governance-final-XXXXXX")"
RESULTS_FILE_TMP="$RESULTS_TMP_DIR/governance-final-gate.results.jsonl"
: > "$RESULTS_FILE_TMP"

cleanup() {
  mkdir -p "$ARTIFACT_DIR" 2>/dev/null || true
  if [[ -f "$RESULTS_FILE_TMP" ]]; then
    cp "$RESULTS_FILE_TMP" "$RESULTS_FILE" 2>/dev/null || true
  fi
  rm -rf "$RESULTS_TMP_DIR" 2>/dev/null || true
}
trap cleanup EXIT

record_step() {
  local step_id="$1"
  local status="$2"
  python3 - <<'PY' "$RESULTS_FILE_TMP" "$step_id" "$status"
import json
import sys

path, step_id, status = sys.argv[1:]
with open(path, "a", encoding="utf-8") as fh:
    fh.write(json.dumps({"step_id": step_id, "status": status}, ensure_ascii=True) + "\n")
PY
}

run_step() {
  local step_id="$1"
  shift
  "$@"
  record_step "$step_id" "passed"
}

echo "[governance-final] docs render + references"
if [[ "$MODE" == "control-plane" ]]; then
  echo "[governance-final] notice: control-plane mode validates internal governance only"
  echo "[governance-final] notice: this mode is not sufficient for overall repo readiness claims"
  echo "[governance-final] notice: for authoritative overall truth use 'pnpm repo:truth:check'"
else
  echo "[governance-final] notice: repo-truth mode is the authoritative scoped repo-truth gate"
  echo "[governance-final] notice: repo-truth requires control-plane, public readiness, release truth, canonical mainline, and full required flows"
fi
run_step "docs_render_check" node scripts/ci/render-docs-governance.mjs --check
run_step "docs_gate" bash scripts/docs-gate.sh
run_step "repo_truth_semantics" node scripts/ci/check-repo-truth-semantics.mjs

echo "[governance-final] root hallway"
run_step "root_governance" node scripts/ci/check-root-governance.mjs
run_step "root_semantic_cleanliness" node scripts/ci/check-root-semantic-cleanliness.mjs
run_step "source_tree_runtime_residue" node scripts/ci/check-source-tree-runtime-residue.mjs
run_step "worktree_hygiene" bash scripts/check-worktree-hygiene.sh

echo "[governance-final] runtime + logging"
run_step "runtime_governance" node scripts/ci/check-runtime-governance.mjs
run_step "runtime_live_inventory" node scripts/ci/check-runtime-live-inventory.mjs
run_step "runtime_size_budgets" node scripts/ci/check-runtime-size-budgets.mjs
run_step "path_drift_governance" node scripts/ci/check-path-drift-governance.mjs
run_step "log_governance" node scripts/ci/check-log-governance.mjs
run_step "runtime_reachability" bash scripts/ci/check-runtime-reachability.sh

echo "[governance-final] architecture + upstream"
run_step "module_boundaries" node scripts/ci/check-module-boundaries.mjs
run_step "public_surface_boundaries" node scripts/ci/check-public-surface-boundaries.mjs
run_step "dependency_governance" node scripts/ci/check-dependency-governance.mjs
run_step "upstream_governance" node scripts/ci/check-upstream-governance.mjs
run_step "upstream_binding_local" bash scripts/ci/check-upstream-binding-local.sh
run_step "cold_cache_recovery" bash scripts/ci/check-cold-cache-recovery.sh
if [[ "$MODE" == "repo-truth" ]]; then
  echo "[governance-final] public/open-source truth"
  run_step "public_collaboration_english" pnpm public:collaboration:check
  run_step "public_redaction" pnpm public:redaction:check
  run_step "public_history_sensitive_surface" pnpm public:history:check
  run_step "public_artifacts" pnpm public:artifacts:check
  run_step "contribution_rights" pnpm contribution:rights:check
  run_step "release_supply_chain" pnpm release:proof:verify
  run_step "public_readiness" pnpm public:readiness:check
  run_step "public_readiness_deep" pnpm public:readiness:deep-check
  run_step "mainline_alignment" pnpm mainline:alignment:check
fi
run_step "governance_required_flows" bash scripts/ci/governance-required-flows.sh --profile "$REQUIRED_FLOWS_PROFILE"

mkdir -p "$ARTIFACT_DIR"
python3 - <<'PY' "$RESULTS_FILE_TMP" "$ARTIFACT_DIR/governance-final-gate.json" "$UIQ_GOVERNANCE_RUN_ID" "$STARTED_AT" "$MODE" "$REQUIRED_FLOWS_PROFILE"
import json
import sys
from datetime import datetime, timezone

results_path, output_path, run_id, started_at, mode, required_flows_profile = sys.argv[1:]
steps = []
with open(results_path, "r", encoding="utf-8") as fh:
    for raw in fh:
        raw = raw.strip()
        if raw:
            steps.append(json.loads(raw))

step_status = {step["step_id"]: step["status"] for step in steps}

def layer_status(step_ids, enabled=True):
    if not enabled:
        return "not_in_scope"
    return "passed" if all(step_status.get(step_id) == "passed" for step_id in step_ids) else "failed"

internal_control_plane_steps = [
    "docs_render_check",
    "docs_gate",
    "repo_truth_semantics",
    "root_governance",
    "root_semantic_cleanliness",
    "source_tree_runtime_residue",
    "worktree_hygiene",
    "runtime_governance",
    "runtime_live_inventory",
    "runtime_size_budgets",
    "path_drift_governance",
    "log_governance",
    "runtime_reachability",
    "module_boundaries",
    "public_surface_boundaries",
    "dependency_governance",
    "upstream_governance",
    "upstream_binding_local",
    "cold_cache_recovery",
]
public_readiness_steps = [
    "public_collaboration_english",
    "public_redaction",
    "public_history_sensitive_surface",
    "public_artifacts",
    "contribution_rights",
    "public_readiness",
    "public_readiness_deep",
]
release_truth_steps = ["release_supply_chain"]
mainline_alignment_steps = ["mainline_alignment"]
required_flows_steps = ["governance_required_flows"]

repo_truth_enabled = mode == "repo-truth"

payload = {
    "run_id": run_id,
    "started_at": started_at,
    "finished_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "status": "passed",
    "mode": mode,
    "truth_scope": "overall-repo-truth" if repo_truth_enabled else "internal-control-plane",
    "overall_truth_claimable": repo_truth_enabled,
    "required_flows_profile": required_flows_profile,
    "layers": {
        "internal_control_plane": {
            "status": layer_status(internal_control_plane_steps, enabled=True),
            "step_ids": internal_control_plane_steps,
        },
        "public_readiness": {
            "status": layer_status(public_readiness_steps, enabled=repo_truth_enabled),
            "step_ids": public_readiness_steps,
        },
        "release_truth": {
            "status": layer_status(release_truth_steps, enabled=repo_truth_enabled),
            "step_ids": release_truth_steps,
        },
        "mainline_alignment": {
            "status": layer_status(mainline_alignment_steps, enabled=repo_truth_enabled),
            "step_ids": mainline_alignment_steps,
        },
        "required_flows": {
            "status": layer_status(required_flows_steps, enabled=True),
            "profile": required_flows_profile,
            "profile_kind": "repo-truth" if required_flows_profile == "full" else "internal-control-plane",
            "step_ids": required_flows_steps,
        },
    },
    "steps": steps,
}
with open(output_path, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, ensure_ascii=True, indent=2)
    fh.write("\n")
PY

echo "[governance-final] score report"
run_step "governance_score_report" node scripts/ci/governance-score-report.mjs

echo "[governance-final] ok"
