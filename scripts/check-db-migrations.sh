#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
source "$ROOT_DIR/scripts/lib/python-runtime.sh"
ensure_project_python_env_exports

MIGRATION_DB_PATH="${DB_MIGRATION_DB_PATH:-$ROOT_DIR/.runtime-cache/migrations/ci-migration-check.db}"
SQL_DRY_RUN_OUTPUT="${DB_MIGRATION_SQL_OUT:-$ROOT_DIR/.runtime-cache/migrations/ci-migration-dry-run.sql}"
SQL_DRY_RUN_DATABASE_URL="${DB_MIGRATION_DRY_RUN_DATABASE_URL:-postgresql+psycopg://ci:ci@127.0.0.1:6543/ci_migration_dry_run}"

mkdir -p "$(dirname "$MIGRATION_DB_PATH")"
rm -f "$MIGRATION_DB_PATH" "$SQL_DRY_RUN_OUTPUT"

export DATABASE_URL="sqlite+pysqlite:///${MIGRATION_DB_PATH}"

assert_single_head() {
  local heads_output head_count
  heads_output="$(uv run --extra dev alembic -c apps/api/alembic.ini heads)"
  head_count="$(printf '%s\n' "$heads_output" | rg -c "\(head\)" || true)"
  if [[ "$head_count" -ne 1 ]]; then
    echo "[migration-check] expected exactly 1 alembic head, got $head_count"
    echo "$heads_output"
    exit 1
  fi
}

echo "[migration-check] DATABASE_URL=$DATABASE_URL"
echo "[migration-check] validate single head"
assert_single_head
echo "[migration-check] upgrade head"
uv run --extra dev alembic -c apps/api/alembic.ini upgrade head

echo "[migration-check] downgrade base"
uv run --extra dev alembic -c apps/api/alembic.ini downgrade base

echo "[migration-check] upgrade head (again)"
uv run --extra dev alembic -c apps/api/alembic.ini upgrade head

echo "[migration-check] dry-run SQL output"
DATABASE_URL="$SQL_DRY_RUN_DATABASE_URL" uv run --extra dev alembic -c apps/api/alembic.ini upgrade head --sql > "$SQL_DRY_RUN_OUTPUT"
echo "[migration-check] dry-run saved: $SQL_DRY_RUN_OUTPUT"
echo "[migration-check] dry-run DATABASE_URL=$SQL_DRY_RUN_DATABASE_URL"
echo "[migration-check] validate single head (post-check)"
assert_single_head
