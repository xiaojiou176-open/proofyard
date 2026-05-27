# Repository Agent Guide

This file defines the minimal maintainer-facing navigation for AI agents and
automation helpers working inside this repository.

## Scope

- Repository areas: `apps/`, `packages/`, `configs/`, `contracts/`, `docs/`, `scripts/`
- Default environment: local development
- Source of truth priority:
  1. user instruction
  2. executable scripts and manifests
  3. canonical docs

## Canonical entry order

1. `README.md`
2. `docs/README.md`
3. `docs/architecture.md`
4. module navigation files when a task touches a specific module

## Module navigation

- Root: `AGENTS.md`, `CLAUDE.md`
- Apps: `apps/AGENTS.md`, `apps/CLAUDE.md`
- API: `apps/api/AGENTS.md`, `apps/api/CLAUDE.md`
- Web: `apps/web/AGENTS.md`, `apps/web/CLAUDE.md`
- Automation runner: `apps/automation-runner/AGENTS.md`, `apps/automation-runner/CLAUDE.md`
- Packages: `packages/AGENTS.md`, `packages/CLAUDE.md`

## Golden commands

```bash
just setup
just run
./scripts/dev-up.sh
./scripts/dev-status.sh
./scripts/dev-down.sh
pnpm test:matrix
bash scripts/docs-gate.sh
./scripts/security-scan.sh
./scripts/preflight.sh
```

## Hard rules

- Read before editing.
- Prefer minimal, auditable changes.
- Keep public docs in English.
- Never commit secrets, local `.env`, runtime artifacts, caches, or logs.
- Keep `AGENTS.md` and `CLAUDE.md` tracked; keep runtime/helper surfaces untracked.
- When docs and scripts disagree, update docs to match live script behavior.
