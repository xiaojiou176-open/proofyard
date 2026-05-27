# API Guide

This file covers `apps/api/`.

## Commands

```bash
just dev-backend
uv run --extra dev pytest -q apps/api/tests
uv run --extra dev ruff check apps/api/app apps/api/tests
./scripts/check-db-migrations.sh
```
