#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

RUNTIME_LOCK_PATH="${UIQ_CI_RUNTIME_LOCK_PATH:-configs/ci/runtime.lock.json}"
DRY_RUN=false
ENSURE_LOCAL=false
OUTPUT="ref"
IMAGE_REPO="${UIQ_CI_IMAGE_REPOSITORY:-}"
if [[ -z "$IMAGE_REPO" ]]; then
  if [[ -n "${GITHUB_REPOSITORY:-}" ]]; then
    IMAGE_REPO="ghcr.io/${GITHUB_REPOSITORY,,}/ci"
  else
    IMAGE_REPO="ghcr.io/local/proofyard/ci"
  fi
fi

usage() {
  cat <<'EOF'
Usage: bash scripts/ci/resolve-ci-image.sh [options]

Options:
  --dry-run          Do not trigger a local build fallback
  --ensure-local     Build the runtime image when no env/workflow ref is set
  --output <format>  ref | json | hash (default: ref)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --ensure-local)
      ENSURE_LOCAL=true
      shift
      ;;
    --output)
      OUTPUT="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[resolve-ci-image] unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$OUTPUT" != "ref" && "$OUTPUT" != "json" && "$OUTPUT" != "hash" ]]; then
  echo "[resolve-ci-image] invalid output format: $OUTPUT" >&2
  exit 2
fi

LOCK_HASH="$(bash scripts/ci/build-ci-image.sh --print-hash)"
LOCAL_REF="$(bash scripts/ci/build-ci-image.sh --print-ref)"
SOURCE_KIND="local"

emit_json() {
  python3 - "$1" "$2" "$3" "$4" <<'PY'
import json
import sys

ref, source_kind, lock_hash, local_ref = sys.argv[1:]
print(json.dumps(
    {
        "ref": ref,
        "source": source_kind,
        "runtime_lock_hash": lock_hash,
        "local_ref": local_ref,
    },
    ensure_ascii=True,
))
PY
}

if [[ "$OUTPUT" == "hash" ]]; then
  printf '%s\n' "$LOCK_HASH"
  exit 0
fi

if [[ -n "${UIQ_CI_IMAGE_REF:-}" ]]; then
  SOURCE_KIND="env"
  RESOLVED_REF="$UIQ_CI_IMAGE_REF"
elif [[ -n "${UIQ_CI_IMAGE_DIGEST:-}" ]]; then
  SOURCE_KIND="workflow-digest"
  RESOLVED_REF="${IMAGE_REPO}@${UIQ_CI_IMAGE_DIGEST}"
elif [[ "$ENSURE_LOCAL" == "true" && "$DRY_RUN" != "true" ]]; then
  bash scripts/ci/build-ci-image.sh >/dev/null
  RESOLVED_REF="$LOCAL_REF"
else
  RESOLVED_REF="$LOCAL_REF"
fi

if [[ "$OUTPUT" == "json" ]]; then
  emit_json "$RESOLVED_REF" "$SOURCE_KIND" "$LOCK_HASH" "$LOCAL_REF"
  exit 0
fi
printf '%s\n' "$RESOLVED_REF"
