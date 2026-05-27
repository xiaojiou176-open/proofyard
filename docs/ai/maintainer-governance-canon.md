# Maintainer Governance Canon

This file is the English maintainer-side canon for storefront and public
collaboration decisions.

## Current public identity

- Product name: `Webaudit`
- Public category: auditable browser automation platform
- Canonical public mainline: `just run`
- Direct orchestrator command: `pnpm uiq run --profile pr --target web.local`

## Public writing rules

- README is the conversion page.
- `docs/index.md` is the public docs map.
- Helper paths may exist, but they must be explicitly downgraded when mentioned.
- Release and supply-chain wording must not overclaim proof strength.
- GitHub-only closure checks should be recorded through `just github-closure-report`.
- Manual GitHub evidence steps live in `scripts/github/GITHUB_CLOSURE_EVIDENCE_SOP.md`.

## Not public canon

These may exist locally, but are not public storefront truth:

- planning logs
- execution scratchpads
- closure memos
- runtime artifacts under `.runtime-cache/`
