#!/usr/bin/env bash
set -euo pipefail

if ! command -v pre-commit >/dev/null 2>&1; then
  echo "pre-commit is not installed. Install it first (e.g. uv tool install pre-commit)." >&2
  exit 1
fi

PRECOMMIT_CONFIG="configs/tooling/pre-commit-config.yaml"
pre-commit install --config "$PRECOMMIT_CONFIG" --hook-type pre-commit --hook-type pre-push
pre-commit install --config "$PRECOMMIT_CONFIG" --hook-type commit-msg
echo "Installed git hooks: pre-commit, pre-push, commit-msg"
