#!/usr/bin/env bash
set -euo pipefail

required=(
  ".devcontainer/devcontainer.json"
)

compose_candidates=(
  "docker-compose.yml"
  "docker-compose.yaml"
  "compose.yaml"
)

missing=0

for file in "${required[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "[check-iac-exists] missing required file: $file" >&2
    missing=1
  fi
done

has_compose=0
for compose_file in "${compose_candidates[@]}"; do
  if [[ -f "$compose_file" ]]; then
    has_compose=1
    break
  fi
done

if [[ "$has_compose" -ne 1 ]]; then
  echo "[check-iac-exists] missing compose file (expected one of: docker-compose.yml, docker-compose.yaml, compose.yaml)" >&2
  missing=1
fi

if [[ "$missing" -ne 0 ]]; then
  exit 1
fi

echo "[check-iac-exists] ok"
