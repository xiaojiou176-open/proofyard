# Claude Entry

If this file conflicts with `AGENTS.md`, follow `AGENTS.md`.

## Read order

1. `AGENTS.md`
2. `README.md`
3. `docs/README.md`
4. `docs/architecture.md`
5. module navigation files for the touched area

## Fast commands

```bash
just setup
just run
./scripts/dev-up.sh
./scripts/dev-status.sh
./scripts/dev-down.sh
bash scripts/docs-gate.sh
./scripts/security-scan.sh
```

## Minimal verification

- Docs-only change: `bash scripts/docs-gate.sh`
- Backend change: `uv run --extra dev pytest -q apps/api/tests`
- Frontend change: `pnpm --dir apps/web test && pnpm --dir apps/web build`
- Cross-module change: `./scripts/preflight.sh`
