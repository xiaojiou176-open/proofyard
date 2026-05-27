# Changelog

## Unreleased
- Release prep for `v0.1.1` is complete and ready to publish.

## 0.1.1 - 2026-04-01
- Strengthened truthful AI/coding-agent discoverability across README, docs hub, API/MCP guides, and Quick Launch hero surfaces.
- Added storefront SEO and AI discovery regression gates so Codex / Claude Code / MCP / API search surfaces stay aligned.
- Synced GitHub topics and storefront closure contract to current public metadata truth.

- Switched the public collaboration surface to an English canonical README, PR template, and Code of Conduct, while moving Chinese quickstart guidance into `docs/localized/zh-CN/README.md`.
- Added public-surface, redaction, history-sensitive, tracked-artifact, and release supply-chain gates to separate real readiness from surface maturity.
- Hardened repository governance truth sources so `docs-gate` is treated as docs asset/render validation, while strict repository governance remains the authoritative closure signal.
- Removed fake upstream health semantics by exposing `same_as_origin` in drift audit output and supporting explicit `mode: none` when no real canonical upstream exists yet.
- Added a minimal success case and run evidence reference to improve public proof surface.
- Migrated repository workflows to self-hosted runners and refreshed automation lock metadata for deterministic dependency resolution.
- Simplified CI/PR/pre-commit workflow routing to pure self-hosted execution and removed redundant hosted-capacity probe indirection.
- Upgraded `@modelcontextprotocol/sdk` to `^1.27.1` to pull patched `hono` / `@hono/node-server` and clear dependency security advisories.
- Pinned transitive `picomatch` to `4.0.4` via root `pnpm.overrides` so the default-branch lockfile no longer carries the two open GitHub Dependabot advisories.
- Hardened automation security and task isolation.
- Added docs governance baseline and docs CI gate.
- Standardized the public product identity around `Webaudit` and moved older naming drift into legacy/internal mapping docs.
- Added reconstruction pipeline: profile resolve, preview, generate, and orchestrate-from-artifacts endpoints.
- Added video/HAR/HTML reconstruction services with compliance `manual_gate` behavior.
- Added MCP tool packaging for reconstruction (`recon_profile_resolve`, `recon_preview`, `recon_generate`, `recon_orchestrate_from_artifacts`).
- Added automation reconstruction scripts/tests and CI core gates for contract + k6 smoke.
- Refreshed `apps/web/pnpm-lock.yaml` to capture deterministic Rollup darwin arm64 lockfile metadata.
