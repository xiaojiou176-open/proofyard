#!/usr/bin/env bash
set -euo pipefail

IMAGE_TAG="${UIQ_MCP_CONTAINER_SMOKE_TAG:-webaudit-mcp-smoke:local}"
CONTAINER_NAME="webaudit-mcp-smoke-$$"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}

trap cleanup EXIT

docker build -f apps/mcp-server/Dockerfile -t "$IMAGE_TAG" .

docker run \
  --detach \
  --interactive \
  --name "$CONTAINER_NAME" \
  --volume "$PWD:/workspace" \
  --env UIQ_MCP_WORKSPACE_ROOT=/workspace \
  "$IMAGE_TAG" >/dev/null

sleep 2

status="$(docker inspect -f '{{.State.Status}}' "$CONTAINER_NAME")"
if [[ "$status" != "running" ]]; then
  echo "[mcp-container-smoke] container failed to stay running" >&2
  docker logs "$CONTAINER_NAME" >&2 || true
  exit 1
fi

echo "[mcp-container-smoke] ok image built and stdio process is running"
