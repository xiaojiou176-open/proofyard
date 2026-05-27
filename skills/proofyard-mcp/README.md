# Webaudit MCP Public Skill

This folder is the public, self-contained skill packet for Webaudit's
governed MCP surface.

## Purpose

Use it when you want one portable skill folder that teaches:

- what Webaudit helps an outer agent shell do
- how to attach the current repo-native stdio MCP server
- which tool families are safest first
- what one concrete first-success path looks like
- which package or registry claims are still out of bounds, even though the
  repo already defines a GHCR Docker image contract

## What this packet includes

- `SKILL.md`
- `manifest.yaml`
- `references/README.md`
- `references/INSTALL.md`
- `references/OPENHANDS_MCP_CONFIG.json`
- `references/OPENCLAW_MCP_CONFIG.json`
- `references/CAPABILITIES.md`
- `references/DEMO.md`
- `references/TROUBLESHOOTING.md`

## Best-fit hosts

- ClawHub-style skill publication
- Goose Skills Marketplace contribution flow
- agent-skill.co source-repo index entry
- awesome-opencode project-entry flow anchored by the repo front door
- OpenHands/extensions contribution flow only as a closed historical receipt
- repo-local skill import flows that expect one standalone folder with install,
  capability, and demo notes

## Current truthful state

- the repo-owned packet is complete as a portable MCP-aware skill folder
- a ClawHub skill page for this packet can be read back live today
- the Goose Skills Marketplace lane now has a fresh external review receipt at
  PR #26
- the agent-skill.co source-repo lane now has a fresh external review receipt
  at PR #182
- the awesome-opencode project-entry lane now has a fresh external review
  receipt at PR #275
- the OpenHands/extensions lane is now a closed historical receipt at PR #161;
  it is not `review-pending`, and the maintainer pointed contributors to a
  custom `marketplace.json` distribution instead
- the GHCR Docker image
  `ghcr.io/xiaojiou176-open/webaudit-mcp-server:0.1.1` is part of the
  repo-defined container contract, but today
  `https://github.com/orgs/xiaojiou176-open/packages/container/package/webaudit-mcp-server`
  returns `404` and
  `https://github.com/orgs/xiaojiou176-open/packages?repo_name=webaudit`
  reports `0 packages`
- npm is still not published, and Official MCP Registry is still not live
  because it depends on that missing npm package

## What this packet must not claim

- no listed-live Goose, agent-skill.co, or awesome-opencode entry without fresh
  read-back
- no live OpenHands listing; that lane was closed rather than accepted
- no published npm package claim without fresh proof
- no claim that a repo-defined Docker contract means Docker-live or
  registry-live; those are different counters
- no hosted Webaudit SaaS or hosted MCP endpoint
