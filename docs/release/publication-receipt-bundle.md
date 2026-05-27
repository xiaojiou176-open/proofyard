# Publication Receipt Bundle

This page is the receipt wall for ProofTrail's later publication lanes.

Use it when you need to answer a plain question:

> Which receipts are already real, which ones are only review receipts, and
> which ones are still contract-only boxes waiting for a later heavy push?

Think of it like a loading dock.
Some boxes already have signed delivery slips, some only have a courier pickup
ticket, and some are still packed but have not left the warehouse.

## Receipt layers

### GitHub release/tag

- strongest current receipt:
  - release `v0.1.1` exists
- current status:
  - `listed-live`
- repo-owned source of truth:
  - `docs/release/README.md`
  - `DISTRIBUTION.md`
- what this receipt does not prove:
  - npm, GHCR, or Official MCP Registry publication

### GitHub Pages storefront

- strongest current receipt:
  - public site returns
- current status:
  - `listed-live`
- repo-owned source of truth:
  - `README.md`
  - `docs/index.md`
  - `DISTRIBUTION.md`
- what this receipt does not prove:
  - package publication or hosted MCP

### ClawHub skill page

- strongest current receipt:
  - `https://clawhub.ai/skills/proofyard-mcp`
- current status:
  - `listed-live` for the packet discovery page
- repo-owned source of truth:
  - `skills/proofyard-mcp/README.md`
  - `docs/reference/mcp-distribution-contract.md`
- what this receipt does not prove:
  - generic skill-registry publication
  - official plugin status
  - hosted endpoint

### OpenHands/extensions

- strongest current receipt:
  - PR receipt
- current status:
  - `closed-not-accepted`
- repo-owned source of truth:
  - `skills/proofyard-mcp/README.md`
  - `docs/reference/mcp-distribution-contract.md`
- what this receipt does not prove:
  - a live listing
  - an active upstream review queue

### Goose Skills Marketplace

- strongest current receipt:
  - `https://github.com/block/agent-skills/pull/26`
- current status:
  - `review-pending`
- repo-owned source of truth:
  - `skills/proofyard-mcp/README.md`
  - `skills/proofyard-mcp/SKILL.md`
- what this receipt does not prove:
  - a listed-live marketplace entry

### Agent Skill Index

- strongest current receipt:
  - `https://github.com/heilcheng/awesome-agent-skills/pull/182`
- current status:
  - `review-pending`
- repo-owned source of truth:
  - `skills/proofyard-mcp/README.md`
  - `skills/proofyard-mcp/SKILL.md`
- what this receipt does not prove:
  - a listed-live directory entry

### awesome-opencode project entry

- strongest current receipt:
  - `https://github.com/awesome-opencode/awesome-opencode/pull/275`
- current status:
  - `review-pending`
- repo-owned source of truth:
  - `README.md`
  - `docs/release/publication-receipt-bundle.md`
- what this receipt does not prove:
  - an accepted or listed-live project entry

### npm package `@proofyard/mcp-server`

- strongest current receipt:
  - repo-owned package metadata only
- current status:
  - `packet-ready / not published`
- repo-owned source of truth:
  - `apps/mcp-server/package.json`
  - `apps/mcp-server/server.json`
- what this receipt does not prove:
  - installable upstream package

### Official MCP Registry

- strongest current receipt:
  - repo-owned descriptor only
- current status:
  - `packet-ready / not submitted-live`
- repo-owned source of truth:
  - `apps/mcp-server/server.json`
  - `docs/reference/mcp-distribution-contract.md`
- what this receipt does not prove:
  - registry acceptance or search read-back

### GHCR image `ghcr.io/xiaojiou176-open/proofyard-mcp-server:0.1.1`

- strongest current receipt:
  - repo-owned container contract, but public page read-back is absent
- current status:
  - `contract-only / not published`
- repo-owned source of truth:
  - `DISTRIBUTION.md`
  - `docs/reference/mcp-distribution-contract.md`
- what this receipt does not prove:
  - public container listing or hosted service

## Repo-owned packet for the next heavy lane

If the next worker needs one reviewable repo-owned bundle before pushing
publication again, start with these files:

1. `DISTRIBUTION.md`
2. `llms-install.md`
3. `docs/reference/mcp-distribution-contract.md`
4. `apps/mcp-server/package.json`
5. `apps/mcp-server/server.json`
6. `skills/proofyard-mcp/README.md`
7. `docs/release/README.md`
8. `docs/release/mcp-listings-cockpit.md`

That bundle keeps four truths separate:

- release/live storefront receipts
- packet-discovery receipts
- review receipts
- contract-only later lanes

## Current order for later heavy work

The clean order is:

1. keep the release/tag, Pages, and packet docs aligned
2. treat ClawHub as packet-discovery truth only
3. treat OpenHands as a review receipt only
4. publish `@proofyard/mcp-server` before claiming Official MCP Registry
   progress
5. keep GHCR in the contract-only bucket until public read-back stops saying
   `404 / 0 packages`

## What not to mix into this wall

Do **not** rewrite these receipts as proof that:

- ProofTrail already has a live generic skill-registry listing
- the npm package is already installable from upstream
- the Official MCP Registry already lists the repo
- the GHCR package is publicly available
- the repo now needs new Docker/runtime code to "look more real"

Theater C's current job here is clearer paperwork, not bigger machinery.
