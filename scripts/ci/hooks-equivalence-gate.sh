#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="hooks-equivalence-gate"
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
CONTAINER_TASKS="${UIQ_CONTAINER_GATE_ENFORCED_TASKS:-contract,lint,backend-lint,frontend-lint,coverage,live-smoke,mutation-ts,mutation-py,orchestrator-contract,mcp-check,backend-tests,frontend-build,frontend-ui-audit,automation-tests,frontend-authenticity,frontend-nonstub,frontend-critical}"

ARTIFACT_DIR=".runtime-cache/artifacts/ci"
REPORT_JSON="${ARTIFACT_DIR}/hooks-equivalence-gate.json"
REPORT_MD="${ARTIFACT_DIR}/hooks-equivalence-gate.md"
mkdir -p "$ARTIFACT_DIR"
PREPUSH_BALANCED_DRYRUN_LOG="${ARTIFACT_DIR}/pre-push-required-balanced.dryrun.log"
PREPUSH_STRICT_DRYRUN_LOG="${ARTIFACT_DIR}/pre-push-required-strict.dryrun.log"
PRECOMMIT_CANONICAL_DRYRUN_LOG="${ARTIFACT_DIR}/pre-commit-required-canonical.dryrun.log"
PRECOMMIT_STRICT_DRYRUN_LOG="${ARTIFACT_DIR}/pre-commit-required-strict.dryrun.log"

if [[ -n "${SKIP:-}" ]]; then
  echo "[$SCRIPT_NAME] ignore SKIP env during CI equivalence gate: ${SKIP}" >&2
  unset SKIP
fi

run_gitleaks_precommit() {
  local config_path="configs/tooling/pre-commit-config.yaml"
  if command -v pre-commit >/dev/null 2>&1; then
    pre-commit run --config "$config_path" gitleaks --all-files
    return $?
  fi

  if command -v pnpm >/dev/null 2>&1 && pnpm exec pre-commit --version >/dev/null 2>&1; then
    pnpm exec pre-commit run --config "$config_path" gitleaks --all-files
    return $?
  fi

  echo "[$SCRIPT_NAME] pre-commit not found in PATH; fallback to uvx runner" >&2
  uvx pre-commit run --config "$config_path" gitleaks --all-files
}

run_actionlint_precommit() {
  local config_path="configs/tooling/pre-commit-config.yaml"
  if command -v pre-commit >/dev/null 2>&1; then
    pre-commit run --config "$config_path" actionlint --all-files --verbose
    return $?
  fi

  if command -v pnpm >/dev/null 2>&1 && pnpm exec pre-commit --version >/dev/null 2>&1; then
    pnpm exec pre-commit run --config "$config_path" actionlint --all-files --verbose
    return $?
  fi

  echo "[$SCRIPT_NAME] pre-commit not found in PATH; fallback to uvx runner" >&2
  uvx pre-commit run --config "$config_path" actionlint --all-files --verbose
}

run_commitlint_range() {
  local from_ref="$1"
  local to_ref="$2"
  local -a commits=()
  mapfile -t commits < <(git rev-list --no-merges --reverse "${from_ref}..${to_ref}")

  if [[ "${#commits[@]}" -eq 0 ]]; then
    echo "[$SCRIPT_NAME] commitlint_range: no non-merge commits in ${from_ref}..${to_ref}"
    return 0
  fi

  local sha=""
  local subject=""
  for sha in "${commits[@]}"; do
    subject="$(git log -1 --format=%s "$sha")"
    if [[ "$subject" =~ ^\[codex\]\ .+\ \(\#[0-9]+\)$ ]]; then
      echo "[$SCRIPT_NAME] commitlint_range: skip codex automation landing $sha $subject"
      continue
    fi
    git log -1 --format=%B "$sha" | pnpm exec commitlint --verbose
  done
}

declare -a STEP_NAMES=()
declare -a STEP_COMMANDS=()
declare -a STEP_DURATIONS=()
declare -a STEP_STATUSES=()
declare -a STEP_EXIT_CODES=()

resolve_docs_link_base_ref() {
  if [[ -n "${UIQ_DOCS_LINK_BASE_REF:-}" ]]; then
    printf '%s' "$UIQ_DOCS_LINK_BASE_REF"
    return 0
  fi
  if [[ "${GITHUB_EVENT_NAME:-}" == "pull_request" && -n "${GITHUB_BASE_REF:-}" ]]; then
    printf 'origin/%s' "$GITHUB_BASE_REF"
    return 0
  fi
  if [[ -n "${GITHUB_EVENT_BEFORE:-}" && "${GITHUB_EVENT_BEFORE:-}" != "0000000000000000000000000000000000000000" ]]; then
    printf '%s' "$GITHUB_EVENT_BEFORE"
    return 0
  fi
  if git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
    printf '%s' "HEAD~1"
    return 0
  fi
  return 1
}

resolve_docs_link_head_ref() {
  if [[ -n "${UIQ_DOCS_LINK_HEAD_REF:-}" ]]; then
    printf '%s' "$UIQ_DOCS_LINK_HEAD_REF"
    return 0
  fi
  if [[ "${GITHUB_EVENT_NAME:-}" == "pull_request" && -n "${GITHUB_EVENT_PATH:-}" && -f "${GITHUB_EVENT_PATH:-}" ]]; then
    local pr_head_sha=""
    pr_head_sha="$(python3 - "$GITHUB_EVENT_PATH" <<'PY'
import json
import sys
from pathlib import Path

event = json.loads(Path(sys.argv[1]).read_text())
head_sha = ((event.get("pull_request") or {}).get("head") or {}).get("sha")
if not head_sha:
    raise SystemExit(1)
print(head_sha)
PY
    )" || true
    if [[ -n "$pr_head_sha" ]]; then
      printf '%s' "$pr_head_sha"
      return 0
    fi
  fi
  if [[ -n "${GITHUB_SHA:-}" ]]; then
    printf '%s' "$GITHUB_SHA"
    return 0
  fi
  printf '%s' "HEAD"
}

DOCS_LINK_BASE_REF="$(resolve_docs_link_base_ref || true)"
DOCS_LINK_HEAD_REF="$(resolve_docs_link_head_ref)"
if [[ -z "$DOCS_LINK_BASE_REF" ]]; then
  echo "[$SCRIPT_NAME] unable to resolve docs-link base ref (set UIQ_DOCS_LINK_BASE_REF)" >&2
  exit 1
fi

echo "[$SCRIPT_NAME] docs_link_base_ref=${DOCS_LINK_BASE_REF}"
echo "[$SCRIPT_NAME] docs_link_head_ref=${DOCS_LINK_HEAD_REF}"

now_ms() {
  python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
}

run_step() {
  local name="$1"
  shift
  local start_ms end_ms duration_ms rc=0
  local command_display="$*"
  echo "[$SCRIPT_NAME] RUN ${name}: ${command_display}"

  start_ms="$(now_ms)"
  if "$@"; then
    rc=0
  else
    rc=$?
  fi

  end_ms="$(now_ms)"
  duration_ms="$(( end_ms - start_ms ))"
  STEP_NAMES+=("$name")
  STEP_COMMANDS+=("$command_display")
  STEP_DURATIONS+=("$duration_ms")
  STEP_EXIT_CODES+=("$rc")
  if [[ "$rc" -eq 0 ]]; then
    STEP_STATUSES+=("passed")
    echo "[$SCRIPT_NAME] PASS ${name} (${duration_ms}ms)"
    return 0
  fi

  STEP_STATUSES+=("failed")
  echo "[$SCRIPT_NAME] FAIL ${name} (${duration_ms}ms) rc=${rc}" >&2
  return "$rc"
}

has_container_task() {
  local wanted="$1"
  local padded=",${CONTAINER_TASKS// /},"
  [[ "$padded" == *",$wanted,"* ]]
}

docker_daemon_available() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

resolve_container_timeout_prefix() {
  local task="$1"
  local timeout_seconds="${UIQ_CONTAINER_GATE_LOCAL_TIMEOUT_SEC:-120}"
  if [[ "$task" == "lint" ]]; then
    timeout_seconds="${UIQ_CONTAINER_GATE_LINT_TIMEOUT_SEC:-2400}"
  fi
  if [[ "$task" == "coverage" ]]; then
    timeout_seconds="${UIQ_CONTAINER_GATE_COVERAGE_TIMEOUT_SEC:-2400}"
  fi
  if ! [[ "$timeout_seconds" =~ ^[0-9]+$ ]] || [[ "$timeout_seconds" -lt 1 ]]; then
    echo "[$SCRIPT_NAME] invalid UIQ_CONTAINER_GATE_LOCAL_TIMEOUT_SEC=${timeout_seconds}; expected integer >= 1" >&2
    exit 2
  fi

  if command -v timeout >/dev/null 2>&1; then
    printf 'timeout %ss' "$timeout_seconds"
    return 0
  fi
  if command -v gtimeout >/dev/null 2>&1; then
    printf 'gtimeout %ss' "$timeout_seconds"
    return 0
  fi
  return 1
}

run_gate_with_container_toggle() {
  local task="$1"
  local step_name="$2"
  shift 2
  if has_container_task "$task"; then
    if ! docker_daemon_available; then
      echo "[$SCRIPT_NAME] docker daemon unavailable; using host fallback for task=${task}" >&2
      run_step "${step_name}_host" "$@"
      return $?
    fi
    local -a container_cmd=(bash scripts/ci/run-in-container.sh --task "$task" --gate hooks-equivalence)
    local timeout_prefix=""
    if timeout_prefix="$(resolve_container_timeout_prefix "$task" 2>/dev/null)"; then
      if run_step "${step_name}_container" bash -lc "${timeout_prefix} ${container_cmd[*]}"; then
        return 0
      fi
    else
      if run_step "${step_name}_container" "${container_cmd[@]}"; then
        return 0
      fi
    fi
    local rc=$?
    return "$rc"
  fi
  run_step "${step_name}_host" "$@"
}

verify_prepush_policy_contract() {
  UIQ_PREPUSH_ALLOW_BALANCED_IN_CI=true \
  UIQ_PREPUSH_REQUIRED_MODE=balanced \
  UIQ_PREPUSH_RUN_HEAVY_GATES=false \
    bash scripts/ci/pre-push-required-gates.sh --dry-run 2>&1 | tee "$PREPUSH_BALANCED_DRYRUN_LOG"
  grep -q "mode=balanced" "$PREPUSH_BALANCED_DRYRUN_LOG"
  grep -q "openai-residue-gate" "$PREPUSH_BALANCED_DRYRUN_LOG"
  grep -q "delegation_summary=ci_required" "$PREPUSH_BALANCED_DRYRUN_LOG"

  UIQ_PREPUSH_REQUIRED_MODE=strict \
  UIQ_PREPUSH_RUN_HEAVY_GATES=true \
    bash scripts/ci/pre-push-required-gates.sh --dry-run 2>&1 | tee "$PREPUSH_STRICT_DRYRUN_LOG"
  grep -q "mode=strict" "$PREPUSH_STRICT_DRYRUN_LOG"
  grep -q "hooks-equivalence-gate" "$PREPUSH_STRICT_DRYRUN_LOG"
  grep -q "docs-gate" "$PREPUSH_STRICT_DRYRUN_LOG"
}

verify_precommit_policy_contract() {
  bash scripts/ci/pre-commit-required-gates.sh --dry-run 2>&1 | tee "$PRECOMMIT_CANONICAL_DRYRUN_LOG"
  grep -q "mode=strict" "$PRECOMMIT_CANONICAL_DRYRUN_LOG"
  grep -q "repo_wide=false" "$PRECOMMIT_CANONICAL_DRYRUN_LOG"
  grep -q "env_docs=false" "$PRECOMMIT_CANONICAL_DRYRUN_LOG"
  grep -q "heavy=false" "$PRECOMMIT_CANONICAL_DRYRUN_LOG"
  grep -q "repo-wide lint/container delegated to pre-push/CI" "$PRECOMMIT_CANONICAL_DRYRUN_LOG"
  grep -q "docs/governance gates delegated to pre-push/CI" "$PRECOMMIT_CANONICAL_DRYRUN_LOG"
  grep -q "heavy gates delegated to pre-push/CI" "$PRECOMMIT_CANONICAL_DRYRUN_LOG"

  UIQ_PRECOMMIT_REQUIRED_MODE=strict \
  UIQ_PRECOMMIT_REQUIRED_REPO_WIDE_GATES=true \
  UIQ_PRECOMMIT_REQUIRED_ENV_DOCS_GATES=true \
  UIQ_PRECOMMIT_REQUIRED_HEAVY_GATES=true \
    bash scripts/ci/pre-commit-required-gates.sh --dry-run 2>&1 | tee "$PRECOMMIT_STRICT_DRYRUN_LOG"
  grep -q "mode=strict" "$PRECOMMIT_STRICT_DRYRUN_LOG"
  grep -q "container-contract-gate" "$PRECOMMIT_STRICT_DRYRUN_LOG"
  grep -q "lint-all-container" "$PRECOMMIT_STRICT_DRYRUN_LOG"
  grep -q "docs-gate" "$PRECOMMIT_STRICT_DRYRUN_LOG"
  grep -q "mutation-ts-strict" "$PRECOMMIT_STRICT_DRYRUN_LOG"
  grep -q "security-scan" "$PRECOMMIT_STRICT_DRYRUN_LOG"
}

failed_steps=0
run_step "container_contract_gate" bash scripts/ci/run-in-container.sh --task contract --gate hooks-equivalence || ((failed_steps += 1))
run_gate_with_container_toggle "lint" "lint_all" bash scripts/ci/lint-all.sh || ((failed_steps += 1))
run_gate_with_container_toggle "backend-lint" "backend_lint" env RUFF_CACHE_DIR=".runtime-cache/cache/ruff" uv run ruff check apps/api/app apps/api/tests || ((failed_steps += 1))
run_gate_with_container_toggle "frontend-lint" "frontend_lint" bash -lc "cd apps/web && pnpm run lint" || ((failed_steps += 1))
run_step "observability_contract" bash scripts/ci/check-observability-contract.sh || ((failed_steps += 1))
run_gate_with_container_toggle "coverage" "unit_coverage_gate" bash scripts/ci/run-unit-coverage-gate.sh || ((failed_steps += 1))
run_step "test_truth_gate" node scripts/ci/uiq-test-truth-gate.mjs --profile ci-equivalence --strict true --scope staged-or-changed || ((failed_steps += 1))
run_step "py_test_truth_gate" python3 scripts/ci/uiq-pytest-truth-gate.py --profile ci-equivalence --strict true || ((failed_steps += 1))
run_step "docs_link_gate" node scripts/ci/check-doc-links.mjs || ((failed_steps += 1))
run_step "atomic_commit_gate" bash scripts/ci/atomic-commit-gate.sh --from "$DOCS_LINK_BASE_REF" --to "$DOCS_LINK_HEAD_REF" || ((failed_steps += 1))
run_step "secret_leak_gitleaks" run_gitleaks_precommit || ((failed_steps += 1))
run_step "workflow_actionlint" run_actionlint_precommit || ((failed_steps += 1))
run_step "commitlint_range" run_commitlint_range "$DOCS_LINK_BASE_REF" "$DOCS_LINK_HEAD_REF" || ((failed_steps += 1))
run_step "prepush_policy_contract" verify_prepush_policy_contract || ((failed_steps += 1))
run_step "precommit_policy_contract" verify_precommit_policy_contract || ((failed_steps += 1))

NAMES_FILE="$(mktemp)"
COMMANDS_FILE="$(mktemp)"
DURATIONS_FILE="$(mktemp)"
STATUSES_FILE="$(mktemp)"
EXIT_CODES_FILE="$(mktemp)"
printf "%s\n" "${STEP_NAMES[@]}" >"$NAMES_FILE"
printf "%s\n" "${STEP_COMMANDS[@]}" >"$COMMANDS_FILE"
printf "%s\n" "${STEP_DURATIONS[@]}" >"$DURATIONS_FILE"
printf "%s\n" "${STEP_STATUSES[@]}" >"$STATUSES_FILE"
printf "%s\n" "${STEP_EXIT_CODES[@]}" >"$EXIT_CODES_FILE"

export NAMES_FILE COMMANDS_FILE DURATIONS_FILE STATUSES_FILE EXIT_CODES_FILE REPORT_JSON REPORT_MD SCRIPT_NAME DOCS_LINK_BASE_REF DOCS_LINK_HEAD_REF
python3 - <<'PY'
import json
import os
from datetime import datetime, timezone
from pathlib import Path

def read_lines(path: str) -> list[str]:
    with open(path, "r", encoding="utf-8") as fh:
        return [line.rstrip("\n") for line in fh if line.rstrip("\n")]

names = read_lines(os.environ["NAMES_FILE"])
commands = read_lines(os.environ["COMMANDS_FILE"])
durations = [int(item) for item in read_lines(os.environ["DURATIONS_FILE"])]
statuses = read_lines(os.environ["STATUSES_FILE"])
exit_codes = [int(item) for item in read_lines(os.environ["EXIT_CODES_FILE"])]

steps = []
for idx, name in enumerate(names):
    steps.append(
        {
            "name": name,
            "command": commands[idx] if idx < len(commands) else "",
            "duration_ms": durations[idx] if idx < len(durations) else 0,
            "status": statuses[idx] if idx < len(statuses) else "unknown",
            "exit_code": exit_codes[idx] if idx < len(exit_codes) else 1,
        }
    )

report = {
    "script": os.environ["SCRIPT_NAME"],
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "docs_link_base_ref": os.environ.get("DOCS_LINK_BASE_REF", ""),
    "docs_link_head_ref": os.environ.get("DOCS_LINK_HEAD_REF", ""),
    "steps": steps,
}
report["gate"] = {
    "status": "passed" if all(step["status"] == "passed" for step in steps) else "failed",
    "reasonCode": "gate.hooks_equivalence.passed.all_checks_passed"
    if all(step["status"] == "passed" for step in steps)
    else "gate.hooks_equivalence.failed.step_failed",
}
report["total_duration_ms"] = sum(step["duration_ms"] for step in steps)

json_path = Path(os.environ["REPORT_JSON"])
json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

lines = [
    "# Hooks Equivalence Gate",
    "",
    f"- Gate Status: **{report['gate']['status']}**",
    f"- reasonCode: `{report['gate']['reasonCode']}`",
    f"- docsLink range: `{report['docs_link_base_ref']}...{report['docs_link_head_ref']}`",
    f"- totalDurationMs: `{report['total_duration_ms']}`",
    "",
    "| Step | Status | Duration(ms) |",
    "|---|---|---:|",
]
for step in steps:
    lines.append(f"| `{step['name']}` | `{step['status']}` | `{step['duration_ms']}` |")

Path(os.environ["REPORT_MD"]).write_text("\n".join(lines) + "\n", encoding="utf-8")
PY

rm -f "$NAMES_FILE" "$COMMANDS_FILE" "$DURATIONS_FILE" "$STATUSES_FILE" "$EXIT_CODES_FILE"

echo "[$SCRIPT_NAME] report_json=${REPORT_JSON}"
echo "[$SCRIPT_NAME] report_md=${REPORT_MD}"
if (( failed_steps > 0 )); then
  echo "[$SCRIPT_NAME] gate_status=failed reason_code=gate.hooks_equivalence.failed.step_failed failed_steps=${failed_steps}" >&2
  exit 1
fi

echo "[$SCRIPT_NAME] gate_status=passed reason_code=gate.hooks_equivalence.passed.all_checks_passed"
