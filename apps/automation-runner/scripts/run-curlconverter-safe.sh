#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
# shellcheck source=/dev/null
source "$REPO_ROOT/scripts/lib/target-allowlist.sh"

run_curlconverter_cli() {
  if pnpm --dir "$REPO_ROOT/apps/automation-runner" exec curlconverter "$@" 2>/dev/null; then
    return
  fi
  echo "warn: curlconverter runtime is missing or stale; repairing apps/automation-runner dependencies" >&2
  (
    cd "$REPO_ROOT/apps/automation-runner"
    CI="${CI:-true}" pnpm install --frozen-lockfile --ignore-workspace || CI="${CI:-true}" pnpm install --no-frozen-lockfile --ignore-workspace
  )
  if pnpm --dir "$REPO_ROOT/apps/automation-runner" exec curlconverter "$@"; then
    return
  fi
  echo "error: curlconverter is not installed under apps/automation-runner; run pnpm --dir apps/automation-runner install --frozen-lockfile" >&2
  exit 2
}

usage() {
  cat <<'EOF'
Usage:
  bash apps/automation-runner/scripts/run-curlconverter-safe.sh --curl "<curl command>" [options]
  bash apps/automation-runner/scripts/run-curlconverter-safe.sh --input <curl.txt> [options]

Options:
  --target-url <url>  Explicit target URL used for allowlist validation.
  --allow-remote      Equivalent to ALLOW_REMOTE_TARGETS=true for this invocation.
  --help              Show this help.

Any remaining args are forwarded to curlconverter CLI.
Example:
  bash apps/automation-runner/scripts/run-curlconverter-safe.sh \
    --curl "curl http://127.0.0.1:8000/health" \
    -- --language python
EOF
}

curl_payload=""
input_file=""
target_url=""
tool_args=()
help_requested=0

if [[ "${1:-}" == "--" ]]; then
  shift
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --curl)
      curl_payload="${2:-}"
      shift 2
      ;;
    --input)
      input_file="${2:-}"
      shift 2
      ;;
    --target|--target-url)
      target_url="${2:-}"
      shift 2
      ;;
    --allow-remote)
      export ALLOW_REMOTE_TARGETS=true
      shift
      ;;
    --help|-h)
      usage
      run_curlconverter_cli --help
      exit $?
      ;;
    --)
      shift
      while [[ $# -gt 0 ]]; do
        if [[ "$1" == "--help" || "$1" == "-h" ]]; then
          help_requested=1
        fi
        tool_args+=("$1")
        shift
      done
      ;;
    *)
      if [[ "$1" == "--help" || "$1" == "-h" ]]; then
        help_requested=1
      fi
      tool_args+=("$1")
      shift
      ;;
  esac
done

if [[ "$help_requested" -eq 1 && -z "$curl_payload" && -z "$input_file" ]]; then
  run_curlconverter_cli --help
  exit $?
fi

if [[ -n "$input_file" ]]; then
  if [[ ! -f "$input_file" ]]; then
    echo "error: input file not found: $input_file" >&2
    exit 2
  fi
  curl_payload="$(cat "$input_file")"
fi

if [[ -z "$curl_payload" ]]; then
  usage >&2
  echo "error: --curl or --input is required." >&2
  exit 2
fi

targets=()
if [[ -n "$target_url" ]]; then
  targets+=("$target_url")
fi

while IFS= read -r detected; do
  [[ -n "$detected" ]] && targets+=("$detected")
done < <(uiq_extract_urls_from_text "$curl_payload")

if [[ ${#targets[@]} -eq 0 ]]; then
  cat >&2 <<'EOF'
error: no URL detected from cURL payload.
Please provide --target-url so local-only safety validation can run.
EOF
  exit 2
fi

for target in "${targets[@]}"; do
  uiq_assert_target_allowed "$target"
done

printf '%s\n' "$curl_payload" | run_curlconverter_cli - "${tool_args[@]}"
