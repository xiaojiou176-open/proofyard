# Documentation

This directory is the one public doc surface that supports the README storefront.

Use [docs/index.md](index.md) as the public docs hub.
Use [docs/architecture.md](architecture.md) as the architecture contract.
Use
[docs/reference/generated/ci-governance-topology.md](reference/generated/ci-governance-topology.md)
when you need the rendered CI and governance topology instead of the storefront
narrative.
Use
[docs/reference/mcp-distribution-contract.md](reference/mcp-distribution-contract.md)
when you need the machine-facing MCP package/install contract instead of the
storefront narrative.
Use [../DISTRIBUTION.md](../DISTRIBUTION.md) when you need the current
distribution and publication truth.
Use [../INTEGRATIONS.md](../INTEGRATIONS.md) when you need the current
integration boundary and "not an official plugin" truth.
Use [../skills/proofyard-mcp/SKILL.md](../skills/proofyard-mcp/SKILL.md)
when you need the repo-owned generic install skill for agent shells.
Use [docs/archive/README.md](archive/README.md) to understand what stays
outside the live public route.
Use [docs/assets/README.md](assets/README.md) when you need the reviewable
source of storefront visuals.

The goal is not "more docs at any cost." The goal is one public doc surface
that helps a new visitor move from first impression to first successful run
without exposing local planning noise.

The category line for that surface is:

> **Evidence-first browser automation with recovery and MCP**

For the current Wave 2 product path, the recommended reading order is:

1. [README.md](../README.md)
2. [docs/getting-started/human-first-10-min.md](getting-started/human-first-10-min.md)
3. [docs/reference/run-evidence-example.md](reference/run-evidence-example.md)
4. [docs/showcase/minimal-success-case.md](showcase/minimal-success-case.md)

Use that sequence when you want the same first-run story the UI now tries to
teach: start the canonical run, inspect evidence in Task Center, then use
Recovery Center inside Task Center before raw logs or workshop surfaces.

For the current Wave 3 operator-growth story, use this follow-up reading order
after the first successful run already exists:

1. [docs/reference/run-evidence-example.md](reference/run-evidence-example.md)
2. [docs/architecture.md](architecture.md)
3. [docs/release/README.md](release/README.md)
4. [docs/how-to/mcp-quickstart-1pager.md](how-to/mcp-quickstart-1pager.md)

That sequence teaches the second-stage path:

- reuse a template only when the flow is actually ready to reuse
- compare retained evidence before making a handoff or release judgment
- use Studio only for guarded operator tuning
- treat AI reconstruction and MCP as advanced side roads, not as the repo's
  default road

For the current Wave 4 outward story, use this visible-surface sequence and
current outward matrix:

1. [README.md](../README.md)
2. [docs/index.md](index.md)
3. [docs/how-to/proofyard-for-ai-agents.md](how-to/proofyard-for-ai-agents.md)
4. [docs/how-to/proofyard-for-coding-agents.md](how-to/proofyard-for-coding-agents.md)
5. [docs/how-to/mcp-quickstart-1pager.md](how-to/mcp-quickstart-1pager.md)
6. [docs/how-to/ai-reconstruction-side-road.md](how-to/ai-reconstruction-side-road.md)
7. [docs/compare/proofyard-vs-generic-browser-agents.md](compare/proofyard-vs-generic-browser-agents.md)
8. [docs/how-to/evidence-recovery-review-workspace.md](how-to/evidence-recovery-review-workspace.md)
9. [docs/how-to/api-builder-quickstart.md](how-to/api-builder-quickstart.md)
10. [docs/reference/universal-api.md](reference/universal-api.md)

That sequence keeps the public story honest:

- start with the category line and first evaluation path
- move into the AI-agent and coding-agent bridge before contract-level builder entry
- then explain AI and MCP as governed side roads instead of replacement mainlines
- only then use the alternatives page to explain where Proofyard fits and
  where generic browser agents still win
- use the API builder quickstart and universal API pages only when the reader
  is integrating Proofyard into another toolchain instead of evaluating the
  operator story first

For the current Wave 5 closeout and bounded-bet story, continue with:

1. [docs/reference/hosted-review-workspace-mvp.md](reference/hosted-review-workspace-mvp.md)
2. [docs/reference/recovery-safety-policy.md](reference/recovery-safety-policy.md)
3. [docs/how-to/template-exchange-mvp.md](how-to/template-exchange-mvp.md)
4. [docs/reference/final-closeout-wave5.md](reference/final-closeout-wave5.md)

That sequence answers the "what actually shipped?" question without pretending
that Wave 5 built a hosted platform, an autonomous self-heal agent, or a
public marketplace.
