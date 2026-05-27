# Proofyard for Coding Agents and Agent Ecosystems

This page is for one very specific search intent:

> how do I give Codex, Claude Code, OpenHands, OpenCode, OpenClaw, or another
> coding agent a browser automation layer without losing evidence, recovery,
> and operator review?

Proofyard is not trying to replace your coding agent shell.

It gives that shell a **governed browser execution layer** with:

- one canonical run path
- retained evidence bundles
- recovery and review surfaces
- API and MCP integration roads

## Use this page when

You already use one of these patterns:

- Codex
- Claude Code
- OpenHands
- OpenCode
- OpenClaw
- another coding agent shell that can call tools or orchestrate repo tasks

And now you need browser automation that stays:

- inspectable
- replayable
- recoverable
- reviewable by humans

## The short answer

Use Proofyard when your coding agent still needs a browser lane, but you do
not want that browser lane to disappear into one-shot logs or generic bot
behavior.

Think of it like adding a flight recorder and recovery checklist to a vehicle:

- your coding agent still drives the broader workflow
- Proofyard records what happened in the browser lane
- the retained run becomes something you can inspect, compare, and hand off

## Truthful ecosystem fit matrix

Proofyard does **not** claim first-party Codex-native, Claude-Code-native,
OpenHands-native, OpenCode-native, or OpenClaw-native product integrations.

It does claim something more grounded:

| Ecosystem | Most truthful fit | Best first road | What this page is not claiming |
| --- | --- | --- | --- |
| Claude Code | governed browser-evidence side road for a tool-using coding shell | [MCP for Browser Automation](mcp-quickstart-1pager.md) | official vendor adapter |
| Codex | browser-evidence substrate with direct API control and optional MCP | [API Builder Quickstart](api-builder-quickstart.md) | official Codex plugin |
| OpenHands | browser-evidence subsystem behind a larger orchestration runtime | [API Builder Quickstart](api-builder-quickstart.md) | Proofyard replacing the outer runtime |
| OpenCode | governed MCP browser surface behind the coding-agent shell | [MCP for Browser Automation](mcp-quickstart-1pager.md) | official OpenCode adapter |
| OpenClaw | browser workflow backend behind a multi-channel gateway or tool router | [API Builder Quickstart](api-builder-quickstart.md) | first-party OpenClaw plugin |

If you need a generic AI shell or a vendor-owned integration, this repo is not
pretending to be that.

## What these ecosystems actually get here

Across all five ecosystems, the grounded promise stays the same:

1. **A canonical browser execution road**
   - start from `just run`
   - keep one deterministic baseline instead of many unofficial scripts
2. **Retained browser evidence**
   - inspect manifests, summaries, and proof reports after the run
3. **Recovery and review surfaces**
   - explain, share, compare, and review before widening handoff
4. **Two integration roads**
   - **API** for exact contract control
   - **MCP** for governed tool consumption by an external AI client

## Where this fits in a coding-agent stack

| Layer | What stays outside Proofyard | What Proofyard contributes |
| --- | --- | --- |
| Coding agent shell | planning, code edits, issue flow, repo reasoning | browser execution substrate |
| Browser lane | raw scripts, helper-only replay, brittle one-offs | canonical run plus retained evidence |
| Failure handling | ad-hoc debugging in logs | recovery, compare, and review packet surfaces |
| Tool integration | custom glue for every browser action | API and MCP surfaces over the same governed substrate |

That means the most honest category fit is:

> Proofyard is browser automation **for** coding agents, not a coding agent
> replacement.

## When API is the better road

Use the API road when your outer agent needs:

- exact request/response control
- contract-level integration
- direct access to runs, evidence, or automation endpoints

Start here:

1. [API Builder Quickstart](api-builder-quickstart.md)
2. [Universal API Reference](../reference/universal-api.md)
3. `node --import tsx contracts/scripts/generate-client.ts --verify`

## When MCP is the better road

Use the MCP road when your outer agent shell should consume tools instead of
raw REST semantics.

This is the most natural fit when your coding-agent environment already thinks
in tools, tasks, and delegable actions.

Start here:

1. [MCP for Browser Automation](mcp-quickstart-1pager.md)
2. [Proofyard MCP Server README](../../apps/mcp-server/README.md)
3. `pnpm mcp:check`

## Why this matters for named agent ecosystems

Coding agents and agent gateways are strong at planning, orchestration, or
tool routing.

What they often still need from a browser layer is:

- proof after the run
- a stable recovery ladder
- a way to compare and explain what changed
- a governed integration surface instead of ad-hoc scripts

That is exactly where Proofyard fits, whether the outer shell is Codex,
Claude Code, OpenHands, OpenCode, OpenClaw, or another tool-using agent stack.

## Honest boundary

This page does **not** claim:

- a first-party Codex plugin
- a first-party Claude Code plugin
- a first-party OpenHands integration
- a first-party OpenCode integration
- a first-party OpenClaw integration
- hosted collaboration for agent teams
- open-ended browser autonomy as the product default

It only claims what the repo already supports:

- evidence-first browser automation
- retained browser evidence
- recovery and review surfaces
- API and MCP integration roads
- a bounded AI reconstruction and autonomy side-road story

## Suggested reading order

1. [README.md](../../README.md)
2. [Proofyard for AI Agents](proofyard-for-ai-agents.md)
3. this page
4. [MCP for Browser Automation](mcp-quickstart-1pager.md)
5. [Universal API Reference](../reference/universal-api.md)
6. [Evidence, Recovery, and Review Workspace](evidence-recovery-review-workspace.md)
