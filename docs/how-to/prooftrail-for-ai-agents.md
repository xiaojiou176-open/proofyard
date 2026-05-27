# ProofTrail for AI Agents

ProofTrail matters to AI-agent builders for one practical reason:

> it gives an agent stack a governed browser execution layer with retained
> evidence, guided recovery, and MCP, instead of only a one-shot browser bot.

This page is intentionally narrow. It does **not** claim that ProofTrail is a
generic AI agent platform. It explains why an AI-agent team would still care
about this repo.

It is also the right page when your team is evaluating ProofTrail as the
browser-evidence layer behind Codex, Claude Code, OpenHands, OpenCode,
OpenClaw, or another AI-agent shell.

## Use this page when

You are trying to answer one of these questions:

- how can an AI agent use browser automation without losing proof?
- where does MCP fit if the browser layer still needs retained evidence?
- why would I use ProofTrail instead of wiring a raw browser bot into my agent
  loop?

This page is also the right landing page if your search sounded like:

- `browser automation for Codex`
- `browser automation for Claude Code`
- `browser automation for OpenHands`
- `browser automation for OpenCode`
- `browser automation for OpenClaw`
- `browser evidence layer for coding agents`
- `MCP browser automation for AI agents`

If that is your exact search intent, continue with
[ProofTrail for Coding Agents and Agent Ecosystems](proofyard-for-coding-agents.md)
after this page.

If you are still asking "can this repo produce one truthful baseline run at
all?", start with the canonical evaluation path first:

1. [Human-first 10 minute guide](../getting-started/human-first-10-min.md)
2. [Run evidence example](../reference/run-evidence-example.md)
3. [Evidence, Recovery, and Review Workspace](evidence-recovery-review-workspace.md)

## What an AI agent actually gets here

AI agents do not get a magic autonomy shell from ProofTrail.

They get four concrete things:

1. **One canonical run lane**
   - start from `just run`
   - keep one public baseline instead of many unofficial entrypoints
2. **Retained evidence bundles**
   - inspect the run later through the manifest and linked proof reports
3. **Recovery and review surfaces**
   - explain, share, compare, and review the run before widening handoff
4. **A governed MCP road**
   - let an external AI client consume tools without turning ProofTrail into a
     hidden second backend

## If you are using coding-agent or agent-stack workflows

ProofTrail does **not** claim a dedicated first-class Codex integration or a
Claude-only runtime, and it does not claim first-party OpenHands, OpenCode, or
OpenClaw adapters either.

The truthful fit is narrower and still useful:

- a coding agent plans and reasons outside ProofTrail
- ProofTrail handles browser execution, retained evidence, and recovery
- the same system can be consumed through either API or MCP

That means the most honest search-intent mapping is:

| If you searched for... | The truthful fit here |
| --- | --- |
| browser automation for Codex | ProofTrail can be the browser-evidence layer behind a Codex-style agent loop |
| browser automation for Claude Code | ProofTrail can be the browser execution and evidence layer behind Claude Code style workflows |
| browser automation for OpenHands | ProofTrail can sit behind an OpenHands-style runtime as the browser-evidence and recovery subsystem |
| browser automation for OpenCode | ProofTrail can provide a governed browser tool layer beneath an OpenCode-style shell |
| browser automation for OpenClaw | ProofTrail can act as the browser workflow backend behind an OpenClaw-style gateway or tool router |
| MCP server for coding agents | ProofTrail exposes a governed MCP surface on top of the same backend and artifacts |
| browser automation API for AI agents | ProofTrail exposes a contract-first API for direct integration |

This is a strong fit for **Codex-, Claude Code-, OpenHands-, OpenCode-, and
OpenClaw-style agent stacks** without pretending that ProofTrail is the whole
coding agent.

That combination matters because most agent systems eventually hit the same
moment:

> the run already happened, and now you need to inspect it, compare it,
> recover it, or hand it to a human without losing trust.

## Search phrases builders actually use

If your team is searching for this category, the truthful intent usually looks
more like:

- browser automation for AI agents
- MCP browser automation
- Codex browser automation evidence
- Claude Code browser automation MCP
- OpenHands browser evidence layer
- OpenCode MCP browser tooling
- OpenClaw browser workflow backend
- API and MCP layer for browser agents

This repo is trying to win those searches honestly by being strong at browser
evidence, recovery, API, and MCP, not by pretending to be a generic autonomy
product.

## If you arrived here from a named agent ecosystem

Many builders land here with a very direct search intent:

- browser automation for Codex
- browser automation for Claude Code
- browser automation for OpenHands
- browser automation for OpenCode
- browser automation for OpenClaw
- MCP tools for coding agents
- API-first browser evidence for AI agents

The truthful answer is:

- yes, ProofTrail can fit those workflows well
- no, ProofTrail is not claiming an official Codex integration
- no, ProofTrail is not claiming an official Claude Code integration
- no, ProofTrail is not claiming official OpenHands, OpenCode, or OpenClaw integrations
- yes, ProofTrail can still be the browser-execution, retained-evidence, and
  governed MCP/API layer underneath those agent shells

That means the practical fit is:

- **Codex, Claude Code, OpenHands, OpenCode, or OpenClaw as the outer shell**
- **ProofTrail as the browser-evidence and recovery substrate**

If you need a vendor-specific plugin or a generic AI copilot shell, this repo is
not pretending to be that.

## The category fit in one paragraph

ProofTrail is not trying to beat generic browser agents at open-ended roaming.

It is trying to win on:

- reproducible browser execution
- inspectable retained evidence
- guided recovery after failure
- governed integration for external AI clients

If your need is "let the browser improvise freely," this repo is not pretending
to be that.

If your need is "let the agent use browser automation without losing the
evidence and recovery story," this repo is highly relevant.

## Three useful roads for AI-agent teams

### 1. Canonical run first

Use this road when the AI system still needs one truthful baseline.

The rule is simple:

1. run the mainline
2. inspect the retained evidence
3. only then decide whether MCP or AI reconstruction should enter the picture

Start here:

- [Human-first 10 minute guide](../getting-started/human-first-10-min.md)
- [Run evidence example](../reference/run-evidence-example.md)
- [Evidence, Recovery, and Review Workspace](evidence-recovery-review-workspace.md)

### 2. MCP for governed tool use

Use this road when an external AI client should consume tools instead of raw
REST calls.

The role split stays clean:

- the agent shell stays external
- ProofTrail stays the browser, evidence, and recovery layer

Continue here:

- [MCP for Browser Automation](mcp-quickstart-1pager.md)
- [ProofTrail MCP Server README](../../apps/mcp-server/README.md)

### 3. AI reconstruction after artifacts exist

Use this road when artifacts already exist and an agent or operator needs help
rebuilding or refining a flow.

The important boundary is unchanged:

- proof still comes first
- reconstruction stays downstream of proof
- human review still matters

Continue here:

- [AI Reconstruction Side Road](ai-reconstruction-side-road.md)

## Where this fits in a real agent stack

ProofTrail fits best as the browser execution and evidence layer inside a
larger system.

Think of the stack like this:

| Layer | What stays outside ProofTrail | What ProofTrail contributes |
| --- | --- | --- |
| Agent shell | planning, tool choice, multi-step reasoning | governed browser-facing capability |
| Browser execution | raw browser scripts or helper-only replay | canonical run lane and retained evidence |
| Recovery and judgment | ad-hoc human debugging | explain, share, compare, and review packet surfaces |
| Integration | direct tool consumption by external AI clients | MCP surface over the same trusted backend and evidence model |

This is why ProofTrail can matter to AI agents without claiming to be the whole
agent platform.

## Builder path after the audience fit is clear

Once the category fit makes sense, move from positioning to contract:

1. [API Builder Quickstart](api-builder-quickstart.md)
2. [Universal API Reference](../reference/universal-api.md)
3. `node --import tsx contracts/scripts/generate-client.ts --verify`

That path keeps the story honest:

- audience fit first
- runtime proof second
- integration contract after that

## Suggested reading order

Use this order if you want the shortest truthful route from category fit to
repo reality:

1. [README.md](../../README.md)
2. [Run evidence example](../reference/run-evidence-example.md)
3. [Evidence, Recovery, and Review Workspace](evidence-recovery-review-workspace.md)
4. [MCP for Browser Automation](mcp-quickstart-1pager.md)
5. [AI Reconstruction Side Road](ai-reconstruction-side-road.md)
6. [ProofTrail vs Generic Browser Agents](../compare/proofyard-vs-generic-browser-agents.md)

## Honest boundary

This page does **not** claim:

- hosted agent collaboration
- browser plugin distribution
- autonomous self-heal loops
- open-ended browser autonomy as the default product story

It only claims what the repo already supports:

- evidence-first browser automation
- retained run evidence
- recovery and review surfaces
- AI reconstruction as a side road
- MCP as a governed integration surface
