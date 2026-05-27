# API Claude Guide

For global rules, read `../AGENTS.md` and `../CLAUDE.md`.

## Quick commands

```bash
just dev-backend
uv run --extra dev pytest -q apps/api/tests
uv run --extra dev ruff check apps/api/app apps/api/tests
./scripts/check-db-migrations.sh
```
