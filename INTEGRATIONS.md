# Integration Boundaries

ProofTrail is a **browser-evidence and recovery layer**.

It can sit behind coding-agent or operator workflows, but this repository does
**not** currently claim:

- an official Codex integration
- an official Claude Code integration
- an official OpenHands integration
- an official OpenCode integration
- an official OpenClaw integration
- a browser plugin
- a first-party hosted agent shell

## Current Repo-Native Integration Surfaces

| Surface | Exists in repo | Current status | Notes |
| --- | --- | --- | --- |
| HTTP API | yes | repo-native | The canonical API contract lives in `docs/reference/universal-api.md` and the checked-in generated client stays repo-local. |
| MCP server | yes | repo-native | `apps/mcp-server/` provides the governed MCP surface for local or self-managed use. |
| AI prompt contracts | yes | repo-native | `packages/ai-prompts/` exists as a private workspace package, not as a published registry surface. |
| ProofTrail MCP install skill | yes | repo-native guidance | `skills/proofyard-mcp/` explains how agent shells should install and use the current stdio surface without pretending a registry package is already live. |
| GitHub Pages storefront | yes | public-facing | Pages explains product fit and routes people into docs, but it is not a plugin or marketplace listing. |

## Ecosystem Fit, Truthfully

| Ecosystem | Current truthful fit | Best first path | Official plugin or listing today |
| --- | --- | --- | --- |
| Codex | API-first or hybrid browser-evidence layer | `docs/how-to/proofyard-for-coding-agents.md` -> `docs/how-to/api-builder-quickstart.md` | no |
| Claude Code | MCP-first browser-evidence side road | `docs/how-to/proofyard-for-coding-agents.md` -> `docs/how-to/mcp-quickstart-1pager.md` | no |
| OpenHands | browser subsystem behind a larger runtime | `docs/how-to/proofyard-for-ai-agents.md` -> `docs/how-to/api-builder-quickstart.md` | no |
| OpenCode | governed MCP browser surface | `docs/how-to/proofyard-for-coding-agents.md` -> `docs/how-to/mcp-quickstart-1pager.md` | no |
| OpenClaw | browser workflow backend behind a tool router | `docs/how-to/proofyard-for-coding-agents.md` -> `docs/how-to/api-builder-quickstart.md` | no |

## What Is Not Materialized Here Yet

These surfaces are **not** currently materialized as dedicated publishable
integration products in this repo:

- vendor-specific plugins
- official marketplace listings
- starter template packages
- dedicated skills registry packages
- formal SDK packages

## What The Skill Does

The ProofTrail MCP skill is an **installation and usage guide**, not a plugin.

Its job is to help Codex-, Claude Code-, OpenHands-, OpenCode-, and
OpenClaw-style shells understand:

- the current install path that works today
- the protocol and auth boundary
- the future publish-ready names that are **not yet published**

It must stay aligned with:

- `apps/mcp-server/README.md`
- `docs/how-to/mcp-quickstart-1pager.md`
- `docs/reference/mcp-distribution-contract.md`
- `DISTRIBUTION.md`

## How To Read The Current Repo

If you are evaluating ProofTrail for an external toolchain, the truthful order
is:

1. decide whether you need API-first or MCP-first control
2. use the existing repo-native API or MCP surface
3. treat any future registry publication or marketplace packaging as a later step

That keeps current capability and future packaging clearly separated.
