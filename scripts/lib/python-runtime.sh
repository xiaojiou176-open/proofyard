#!/usr/bin/env bash
set -euo pipefail

PROJECT_PYTHON_ENV_DEFAULT=".runtime-cache/toolchains/python/.venv"

resolve_project_python_env() {
  local configured="${PROJECT_PYTHON_ENV:-${UV_PROJECT_ENVIRONMENT:-$PROJECT_PYTHON_ENV_DEFAULT}}"
  printf '%s\n' "$configured"
}

project_python_env_root() {
  resolve_project_python_env
}

project_python_bin() {
  printf '%s/bin/python\n' "$(resolve_project_python_env)"
}

project_uvicorn_bin() {
  printf '%s/bin/uvicorn\n' "$(resolve_project_python_env)"
}

project_alembic_bin() {
  printf '%s/bin/alembic\n' "$(resolve_project_python_env)"
}

project_ruff_bin() {
  printf '%s/bin/ruff\n' "$(resolve_project_python_env)"
}

ensure_project_python_env_exports() {
  local env_root
  env_root="$(resolve_project_python_env)"
  export PROJECT_PYTHON_ENV="$env_root"
  export UV_PROJECT_ENVIRONMENT="$env_root"
}
