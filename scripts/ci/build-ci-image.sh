#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

RUNTIME_LOCK_PATH="${UIQ_CI_RUNTIME_LOCK_PATH:-configs/ci/runtime.lock.json}"
DRY_RUN=false
PUSH=false
PRINT_REF_ONLY=false
PRINT_HASH_ONLY=false

usage() {
  cat <<'EOF'
Usage: bash scripts/ci/build-ci-image.sh [options]

Options:
  --dry-run         Print the resolved build command without executing it
  --push            Push the built image to its registry
  --print-ref       Print only the resolved image ref
  --print-hash      Print only the runtime lock hash
  -h, --help        Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --push)
      PUSH=true
      shift
      ;;
    --print-ref)
      PRINT_REF_ONLY=true
      shift
      ;;
    --print-hash)
      PRINT_HASH_ONLY=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[build-ci-image] unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if [[ ! -f "$RUNTIME_LOCK_PATH" ]]; then
  echo "[build-ci-image] missing runtime lock: $RUNTIME_LOCK_PATH" >&2
  exit 1
fi

LOCK_HASH="$(sha256sum "$RUNTIME_LOCK_PATH" | awk '{print substr($1,1,12)}')"
IMAGE_REPO="${UIQ_CI_IMAGE_REPOSITORY:-}"
if [[ -z "$IMAGE_REPO" ]]; then
  if [[ -n "${GITHUB_REPOSITORY:-}" ]]; then
    IMAGE_REPO="ghcr.io/${GITHUB_REPOSITORY,,}/ci"
  else
    IMAGE_REPO="ghcr.io/local/webaudit/ci"
  fi
fi
IMAGE_REF="${IMAGE_REPO}:${LOCK_HASH}"

if [[ "$PRINT_REF_ONLY" == "true" ]]; then
  printf '%s\n' "$IMAGE_REF"
  exit 0
fi

if [[ "$PRINT_HASH_ONLY" == "true" ]]; then
  printf '%s\n' "$LOCK_HASH"
  exit 0
fi

read_runtime_field() {
  local field="$1"
  python3 - "$RUNTIME_LOCK_PATH" "$field" <<'PY'
import json
import sys

lock_path, field = sys.argv[1:]
payload = json.loads(open(lock_path, encoding="utf-8").read())
value = payload
for part in field.split("."):
    value = value[part]
print(value)
PY
}

NODE_IMAGE="$(read_runtime_field "base_images.node.reference")"
PYTHON_VERSION="$(read_runtime_field "toolchain.python")"
PNPM_VERSION="$(read_runtime_field "toolchain.pnpm")"
UV_VERSION="$(read_runtime_field "toolchain.uv")"
PLAYWRIGHT_VERSION="$(read_runtime_field "browsers.playwright")"
ACTIONLINT_VERSION="$(read_runtime_field "security_tools.actionlint")"
GITLEAKS_VERSION="$(read_runtime_field "security_tools.gitleaks")"
PLATFORM="$(read_runtime_field "platform")"

cmd=(
  docker buildx build
  --platform "$PLATFORM"
  --file docker/ci/Dockerfile
  --build-arg "NODE_IMAGE=$NODE_IMAGE"
  --build-arg "PYTHON_VERSION=$PYTHON_VERSION"
  --build-arg "PNPM_VERSION=$PNPM_VERSION"
  --build-arg "UV_VERSION=$UV_VERSION"
  --build-arg "PLAYWRIGHT_VERSION=$PLAYWRIGHT_VERSION"
  --build-arg "ACTIONLINT_VERSION=$ACTIONLINT_VERSION"
  --build-arg "GITLEAKS_VERSION=$GITLEAKS_VERSION"
  --tag "$IMAGE_REF"
)

if [[ "$PUSH" == "true" ]]; then
  cmd+=(--push)
else
  cmd+=(--load)
fi

cmd+=(.)

docker_build_supports_platform() {
  command -v docker >/dev/null 2>&1 && docker build --help 2>/dev/null | grep -q -- '--platform'
}

use_plain_docker=false
if [[ "$PUSH" != "true" && "$PLATFORM" == "linux/amd64" ]] && docker_build_supports_platform; then
  use_plain_docker=true
fi

plain_cmd=(
  docker build
  --platform "$PLATFORM"
  --file docker/ci/Dockerfile
  --build-arg "NODE_IMAGE=$NODE_IMAGE"
  --build-arg "PYTHON_VERSION=$PYTHON_VERSION"
  --build-arg "PNPM_VERSION=$PNPM_VERSION"
  --build-arg "UV_VERSION=$UV_VERSION"
  --build-arg "PLAYWRIGHT_VERSION=$PLAYWRIGHT_VERSION"
  --build-arg "ACTIONLINT_VERSION=$ACTIONLINT_VERSION"
  --build-arg "GITLEAKS_VERSION=$GITLEAKS_VERSION"
  --tag "$IMAGE_REF"
  .
)

if [[ "$DRY_RUN" == "true" ]]; then
  if [[ "$use_plain_docker" == "true" ]]; then
    printf '[dry-run] %q ' "${plain_cmd[@]}"
    if [[ "$PUSH" == "true" ]]; then
      printf '&& '
      printf '%q ' docker push "$IMAGE_REF"
    fi
  else
    printf '[dry-run] %q ' "${cmd[@]}"
  fi
  printf '\n'
  exit 0
fi

if [[ "$use_plain_docker" == "true" ]]; then
  "${plain_cmd[@]}"
  if [[ "$PUSH" == "true" ]]; then
    docker push "$IMAGE_REF"
  fi
else
  "${cmd[@]}"
fi
printf '%s\n' "$IMAGE_REF"
