# ProofTrail MCP Listings Cockpit

This page is the honest outer-lane cockpit for ProofTrail's MCP surface.

It separates:

- exact registry blocker
- live discovery receipts
- issue-intake receipts
- owner-manual packets
- lanes that are not honest cargo today

## Current Verdict

- `Official MCP Registry`
  - status: `exact blocker`
  - exact blocker:
    `npm publish` for `@proofyard/mcp-server@0.1.1` returned
    `404 Not Found - PUT https://registry.npmjs.org/@proofyard%2fmcp-server`.
    The narrow blocker is npm scope/package ownership under the active
    `xiaojiou176` account.
- `Cline MCP Marketplace`
  - status: `review-pending` after issue creation
  - receipt:
    `https://github.com/cline/mcp-marketplace/issues/1322`
- `OpenHands/extensions`
  - status: `closed-not-accepted`
  - receipt:
    `https://github.com/OpenHands/extensions/pull/161`
  - exact blocker: maintainer closed the upstream lane and pointed contributors
    to a custom `marketplace.json` distribution alternative
- `mcpservers.org`
  - status: `owner-manual-ready`
  - note: public form packet below is complete enough for owner submit
- `MCP.so`
  - status: `owner-manual-ready`
  - note: public `/submit` packet below is complete enough for owner submit
- `LobeHub MCP Marketplace`
  - status: `owner-manual-ready`
  - note: listing packet below is prepared; login/import remains owner-only
- `Smithery`
  - status: `exact blocker`
  - exact blocker: no public HTTPS MCP runtime is evidenced today; the current
    usable path is local checkout + stdio, with optional local backend
    forwarding
- `HiMarket`
  - status: `exact blocker`
  - exact blocker: the repo does not currently ship an honest Higress
    `mcp-server.yaml`, and the current MCP surface is a stdio package rather
    than a Higress-ready gateway packet

## Live Packet Receipts

- ClawHub discovery page:
  - `https://clawhub.ai/skills/proofyard-mcp`
- repo-native MCP install docs:
  - `llms-install.md`
  - `apps/mcp-server/README.md`
  - `docs/reference/mcp-distribution-contract.md`

## Cline Packet

- repo URL:
  - `https://github.com/xiaojiou176-open/proofyard`
- logo URL:
  - `https://raw.githubusercontent.com/xiaojiou176-open/proofyard/docs/proofyard-publication-receipt-bundle/assets/storefront/proofyard-social-preview.png`
- install doc:
  - `llms-install.md`
- tested repo-owned path:
  - `pnpm mcp:check`
  - `pnpm mcp:smoke`
- truthful additional info:
  - current install path is local checkout + stdio
  - startup command is `pnpm mcp:start`
  - optional env forwarding is `UIQ_MCP_API_BASE_URL` and
    `UIQ_MCP_AUTOMATION_TOKEN`
  - the ClawHub page is a live discovery page for the skill packet, not proof
    of a hosted MCP runtime
  - npm and Official MCP Registry remain blocked by package ownership and
    publication

## Owner-Manual Packet

### mcpservers.org

- `Title / Project Name`
  - `ProofTrail MCP`
- `Link to GitHub Repository`
  - `https://github.com/xiaojiou176-open/proofyard`
- `Short Description`
  - Governed stdio MCP surface for ProofTrail browser-evidence,
    retained proof, and recovery workflows.
- `Full Description`
  - ProofTrail MCP gives coding-agent shells a governed bridge into
    browser-evidence runs, retained proof bundles, and recovery workflows.
  - The current supported road is local checkout + stdio, with optional
    live-backend forwarding.
  - It does not claim a hosted HTTP MCP endpoint or a live npm-installed
    registry package today.
- `Project Homepage`
  - `https://xiaojiou176-open.github.io/proofyard/`
- `Documentation URL`
  - `https://xiaojiou176-open.github.io/proofyard/`
- `Listing Category`
  - `Developer Tools`
- `Tags`
  - `mcp, proofyard, browser-automation, evidence, recovery, coding-agents`
- `Platform`
  - `macOS, Linux`
- `Programming Language`
  - `TypeScript`
- `License Type`
  - `MIT`
- `Type`
  - `MCP Server`

### MCP.so

- `Type`
  - `MCP Server`
- `Name`
  - `ProofTrail MCP`
- `URL`
  - `https://github.com/xiaojiou176-open/proofyard`
- `Server Config`
  - see the JSON snippet below

```json
{
  "mcpServers": {
    "proofyard": {
      "command": "pnpm",
      "args": ["mcp:start"],
      "cwd": "/absolute/path/to/proofyard"
    }
  }
}
```

### LobeHub MCP Marketplace

- `GitHub Repository URL`
  - `https://github.com/xiaojiou176-open/proofyard`
- `Title`
  - `ProofTrail MCP`
- `One-liner`
  - Governed stdio MCP surface for browser-evidence, retained proof,
    and recovery workflows.
- `Long description`
  - ProofTrail MCP helps coding-agent shells inspect retained run evidence,
    launch governed workflow tools, and operate on ProofTrail's recovery
    surfaces through a local stdio bridge.
  - The honest install road today is repo checkout + stdio, with optional
    local backend forwarding; it is not a hosted HTTP MCP runtime.
- `Docs / homepage`
  - `https://xiaojiou176-open.github.io/proofyard/`
- `Suggested logo`
  - `assets/storefront/proofyard-social-preview.png`
- `Suggested screenshots`
  - `assets/storefront/proofyard-studio-preview.svg`
  - `assets/storefront/proofyard-hero.png`

## Owner Last Click

- `mcpservers.org`: open submit form, paste fields, submit
- `MCP.so`: open `/submit`, select `MCP Server`, paste repo URL and config,
  submit
- `LobeHub`: log in, open community profile, `Submit Repo`, paste GitHub URL, submit
