#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="atomic-commit-gate"
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

MAX_STAGED_FILES="${UIQ_ATOMIC_COMMIT_MAX_STAGED_FILES:-15}"
MAX_STAGED_LINES="${UIQ_ATOMIC_COMMIT_MAX_STAGED_LINES:-600}"
DEFAULT_WHITELIST="pnpm-lock.yaml,**/pnpm-lock.yaml"
WHITELIST_RAW="${UIQ_ATOMIC_COMMIT_WHITELIST:-$DEFAULT_WHITELIST}"
DRY_RUN=false
FROM_REF=""
TO_REF=""
SNAPSHOT_GATE_STATUS="passed"

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/ci/atomic-commit-gate.sh [--dry-run]
  bash scripts/ci/atomic-commit-gate.sh --from <ref> --to <ref> [--dry-run]

Env:
  UIQ_ATOMIC_COMMIT_MAX_STAGED_FILES  max effective files per commit (default: 15)
  UIQ_ATOMIC_COMMIT_MAX_STAGED_LINES  max effective changed lines per commit (default: 600)
  UIQ_ATOMIC_COMMIT_WHITELIST         comma-separated glob allowlist ignored by this gate
                                      default: "pnpm-lock.yaml,**/pnpm-lock.yaml"
                                      e.g. "docs/**,**/*.md,CHANGELOG.md"
USAGE
}

is_non_negative_int() {
  [[ "${1:-}" =~ ^[0-9]+$ ]]
}

trim_spaces() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

declare -a WHITELIST_PATTERNS=()
parse_whitelist() {
  if [[ -z "$WHITELIST_RAW" ]]; then
    return 0
  fi
  local item
  IFS=',' read -r -a items <<< "$WHITELIST_RAW"
  for item in "${items[@]}"; do
    item="$(trim_spaces "$item")"
    if [[ -n "$item" ]]; then
      WHITELIST_PATTERNS+=("$item")
    fi
  done
}

is_whitelisted() {
  local path="$1"
  local pattern
  for pattern in "${WHITELIST_PATTERNS[@]-}"; do
    # Intentional glob matching against allowlist patterns.
    # shellcheck disable=SC2053
    if [[ "$path" == $pattern ]]; then
      return 0
    fi
  done
  return 1
}

accumulate_from_numstat_stream() {
  local input="$1"
  local files=0
  local lines=0
  local added deleted path
  while IFS=$'\t' read -r added deleted path; do
    [[ -z "${path:-}" ]] && continue
    if is_whitelisted "$path"; then
      continue
    fi
    ((files += 1))
    if [[ "$added" =~ ^[0-9]+$ ]]; then
      ((lines += added))
    fi
    if [[ "$deleted" =~ ^[0-9]+$ ]]; then
      ((lines += deleted))
    fi
  done <<< "$input"
  printf '%s %s' "$files" "$lines"
}

evaluate_snapshot() {
  local mode="$1"
  local label="$2"
  local numstat_content="$3"
  local counts
  local files
  local lines

  counts="$(accumulate_from_numstat_stream "$numstat_content")"
  files="${counts%% *}"
  lines="${counts##* }"

  echo "[$SCRIPT_NAME] ${label}: effective_files=${files} effective_lines=${lines} max_files=${MAX_STAGED_FILES} max_lines=${MAX_STAGED_LINES}"

  local violated=0
  if (( files > MAX_STAGED_FILES )); then
    echo "[$SCRIPT_NAME] ERROR ${label}: effective staged file count ${files} exceeds ${MAX_STAGED_FILES}" >&2
    violated=1
  fi
  if (( lines > MAX_STAGED_LINES )); then
    echo "[$SCRIPT_NAME] ERROR ${label}: effective staged changed lines ${lines} exceeds ${MAX_STAGED_LINES}" >&2
    violated=1
  fi

  if (( violated > 0 )); then
    if [[ "$DRY_RUN" == "true" ]]; then
      SNAPSHOT_GATE_STATUS="would_block"
      echo "[$SCRIPT_NAME] gate_status=would_block mode=${mode} target=\"${label}\" dry_run_non_blocking=true" >&2
      return 0
    fi
    SNAPSHOT_GATE_STATUS="failed"
    echo "[$SCRIPT_NAME] gate_status=failed mode=${mode} target=\"${label}\" dry_run_non_blocking=false" >&2
    return 1
  fi
  SNAPSHOT_GATE_STATUS="passed"
  echo "[$SCRIPT_NAME] gate_status=passed mode=${mode} target=\"${label}\" dry_run_non_blocking=${DRY_RUN}"
  return 0
}

main() {
  while (($# > 0)); do
    case "$1" in
      --dry-run)
        DRY_RUN=true
        ;;
      --from)
        FROM_REF="${2:-}"
        shift
        ;;
      --to)
        TO_REF="${2:-}"
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        echo "[$SCRIPT_NAME] unknown argument: $1" >&2
        usage >&2
        exit 2
        ;;
    esac
    shift
  done

  if ! is_non_negative_int "$MAX_STAGED_FILES"; then
    echo "[$SCRIPT_NAME] UIQ_ATOMIC_COMMIT_MAX_STAGED_FILES must be a non-negative integer" >&2
    exit 2
  fi
  if ! is_non_negative_int "$MAX_STAGED_LINES"; then
    echo "[$SCRIPT_NAME] UIQ_ATOMIC_COMMIT_MAX_STAGED_LINES must be a non-negative integer" >&2
    exit 2
  fi

  parse_whitelist

  if [[ -n "$FROM_REF" || -n "$TO_REF" ]]; then
    if [[ -z "$FROM_REF" || -z "$TO_REF" ]]; then
      echo "[$SCRIPT_NAME] --from and --to must be provided together" >&2
      exit 2
    fi
    if ! git rev-parse --verify "$FROM_REF" >/dev/null 2>&1; then
      echo "[$SCRIPT_NAME] invalid --from ref: $FROM_REF" >&2
      exit 2
    fi
    if ! git rev-parse --verify "$TO_REF" >/dev/null 2>&1; then
      echo "[$SCRIPT_NAME] invalid --to ref: $TO_REF" >&2
      exit 2
    fi

    local failed=0
    local would_block=0
    local commit
    while IFS= read -r commit; do
      [[ -z "$commit" ]] && continue
      local numstat
      numstat="$(git show --numstat --format='' "$commit")"
      if ! evaluate_snapshot "range" "commit ${commit}" "$numstat"; then
        failed=1
      fi
      if [[ "$SNAPSHOT_GATE_STATUS" == "would_block" ]]; then
        would_block=1
      fi
    done < <(git rev-list --reverse "$FROM_REF..$TO_REF")

    if (( failed > 0 )); then
      echo "[$SCRIPT_NAME] gate_status=failed mode=range range=${FROM_REF}..${TO_REF} dry_run_non_blocking=false"
      exit 1
    fi
    if [[ "$DRY_RUN" == "true" && "$would_block" -eq 1 ]]; then
      echo "[$SCRIPT_NAME] gate_status=would_block mode=range range=${FROM_REF}..${TO_REF} dry_run_non_blocking=true"
      exit 0
    fi
    echo "[$SCRIPT_NAME] gate_status=passed mode=range range=${FROM_REF}..${TO_REF} dry_run_non_blocking=${DRY_RUN}"
    exit 0
  fi

  local staged_numstat
  staged_numstat="$(git diff --cached --numstat --diff-filter=ACDMRTUXB)"
  if ! evaluate_snapshot "staged" "staged" "$staged_numstat"; then
    echo "[$SCRIPT_NAME] gate_status=failed mode=staged dry_run_non_blocking=false"
    exit 1
  fi
  if [[ "$DRY_RUN" == "true" && "$SNAPSHOT_GATE_STATUS" == "would_block" ]]; then
    echo "[$SCRIPT_NAME] gate_status=would_block mode=staged dry_run_non_blocking=true"
    exit 0
  fi
  echo "[$SCRIPT_NAME] gate_status=passed mode=staged dry_run_non_blocking=${DRY_RUN}"
}

main "$@"
