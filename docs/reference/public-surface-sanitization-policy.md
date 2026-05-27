# Public Surface Sanitization Policy

Proofyard keeps a governed public surface on purpose.

## Public Surface

The intended public documentation surface includes:

- `README.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `SUPPORT.md`
- root and module `AGENTS.md` / `CLAUDE.md`
- `docs/index.md`
- `docs/README.md`
- `docs/architecture.md`
- `docs/cli.md`
- `docs/getting-started/human-first-10-min.md`
- `docs/showcase/minimal-success-case.md`
- `docs/reference/run-evidence-example.md`
- `docs/reference/public-surface-policy.md`
- `docs/reference/release-supply-chain-policy.md`
- `docs/reference/dependencies-and-third-party.md`
- `docs/reference/public-surface-sanitization-policy.md`
- `docs/release/README.md`
- `docs/assets/README.md`
- `docs/quality-gates.md`
- `docs/ai/agent-guide.md`
- `docs/ai/maintainer-governance-canon.md`
- `docs/archive/README.md`
- `docs/localized/zh-CN/README.md`

## Non-Public Surface

The following must not be tracked as live public repository content:

- `.agents/`
- `.agent/`
- `.codex/`
- `.claude/`
- `.runtime-cache/`
- `logs/`
- `log/`
- `*.log`
- local `.env` files with live values

These directories and files are part of the non-public surface even when they
exist locally for development.

## Documentation Policy

- Keep the main storefront docs in English.
- Keep localized docs clearly marked as localized support paths.
- Keep archive pages as boundaries and history markers, not as the main route.
- Delete internal planning, audit, rehearsal, and closure records instead of
  publishing them as live product docs.

## Validation

Public-surface verification should include:

- tracked tree sensitive-surface scanning via `pnpm repo:sensitive:check`
- tracked history scanning via `pnpm repo:sensitive:history:check`
- tracked high-signal PII scanning via `pnpm repo:pii:check`
- working tree secret scanning via `./scripts/security-scan.sh`
- public-surface current-content scanning via `pnpm public:redaction:check`
- public-surface history scanning via `pnpm public:history:check`
- source-tree runtime residue scanning via `node scripts/ci/check-source-tree-runtime-residue.mjs`
- public docs gate
- storefront routing checks
- remote GitHub platform review

## Generated Runtime Governance References

- Log event schema: `docs/reference/generated/governance/log-event-schema.md`
- Runtime output registry: `docs/reference/generated/governance/runtime-output-registry.md`
