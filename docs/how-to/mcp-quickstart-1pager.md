# MCP for Browser Automation

This page is for builders and operators who need the MCP side road without
confusing it with the repo default road.

ProofTrail uses MCP as a **governed integration surface for AI clients**.
It does not turn MCP into a second backend or a replacement for `just run`.

This is also the page to read when your integration starts from Codex, Claude
Code, or another tool-consuming AI-agent shell and you need to decide whether
that shell should attach through MCP or through the API directly.

Repo mainline: `just run` / `pnpm uiq run --profile pr --target web.local`

Machine-readable MCP tool contract:
`docs/reference/generated/mcp-tool-contract.md`

Registry-facing MCP package/install contract:
`docs/reference/mcp-distribution-contract.md`

Optional advanced tool groups:
`UIQ_MCP_TOOL_GROUPS=advanced,register,proof,analysis`

<!-- markdownlint-disable-next-line MD013 -->
The repo mainline is the public default road, while this MCP page is the operator side road.

<!-- markdownlint-disable-next-line MD013 -->
If you use an internal generic `run` surface, it should still resolve to that same repo mainline rather than the manual workshop pipeline.

When you document an internal generic `run` surface,
it should still resolve to that same repo mainline
rather than the manual workshop pipeline.

Use this page when:

- you already understand the canonical repo run
- you now need MCP-specific local operator setup
- you want a browser-automation tool surface for an external AI client

Do not treat MCP setup as the first-run public story.

## Who this page is for

Use this page if all three statements are already true:

- you understand that `just run` is still the default public road
- you want an external AI client to call ProofTrail through tools
  instead of raw REST or shell
- you still want the browser, evidence, and recovery substrate to stay governed

If you are still deciding whether ProofTrail itself fits your category, read
[ProofTrail vs Generic Browser Agents](../compare/proofyard-vs-generic-browser-agents.md)
first.

This page is also a truthful landing point if your search intent looked like:

- `MCP server for Codex`
- `MCP server for Claude Code`
- `MCP browser automation for coding agents`

## Why this page matters

MCP is not here to replace the mainline.

It matters because it lets an external AI client consume ProofTrail as a
governed tool surface instead of forcing the client to speak raw REST or shell
commands directly.

## Useful for Codex and Claude Code workflows

This MCP path is especially relevant when:

- Codex needs browser tools without losing retained evidence
- Claude Code needs governed browser-facing tools instead of raw shell glue
- another tool-using AI agent needs ProofTrail to stay the browser-evidence
  substrate instead of becoming the agent shell itself

Truth boundary:

- this repo can be a strong MCP-side road for those workflows
- this repo is **not** claiming an official Codex adapter
- this repo is **not** claiming an official Claude Code adapter

## What MCP gives you here

In ProofTrail, MCP is useful because it lets an external AI client:

- inspect recent runs and retained evidence without inventing
  a second control plane
- launch supported automation and register-oriented flows
  through a governed tool layer
- stay attached to the same backend, orchestrator,
  and run artifacts that power the local product

That is the real category fit:

- **mainline first** for first proof
- **API** for direct contract control
- **MCP** for tool-consumable AI-client integration

## Codex and Claude Code style client fit

ProofTrail does **not** claim an official Codex-only or Claude Code-only MCP
integration.

The truthful claim is:

- if your coding agent already speaks tools, ProofTrail's MCP server can act as
  the governed browser-evidence surface
- if your coding agent needs exact request and response semantics, use the API
  instead

That makes this page highly relevant to **Codex- and Claude Code-style coding
agent workflows** without overstating product scope.

## When not to use MCP first

Do not start here if your real question is still one of these:

- "Can this repo produce one trustworthy run at all?"
- "What does a healthy evidence bundle look like?"
- "Should I integrate the API directly instead of adding another tool layer?"

In those cases, go back to:

1. [README.md](../../README.md)
2. [docs/reference/run-evidence-example.md](../reference/run-evidence-example.md)
3. [API Builder Quickstart](api-builder-quickstart.md)

## API vs MCP

Use **API** when you want direct request/response control.

Use **MCP** when an external AI client should consume tools instead of raw REST
semantics.

That makes MCP especially relevant for browser automation because it keeps the
agent shell and the browser/evidence/recovery substrate separate and honest.

That is the truthful Codex / Claude Code angle here:

- their shell stays the shell
- ProofTrail stays the browser-evidence and recovery substrate
- MCP is the governed bridge between them

## Choose the right surface

| If your main need is... | Start here | Why |
| :--- | :--- | :--- |
| prove one workflow locally | `just run` | deterministic first-proof path |
| integrate exact request/response semantics | [API Builder Quickstart](api-builder-quickstart.md) | API is the contract layer |
| let an external AI client call governed tools | [ProofTrail MCP Server README](../../apps/mcp-server/README.md) | MCP is the governed tool layer |

## Minimal builder path

If you already know you need MCP, keep the first pass short:

1. verify the contract layer with [API Builder Quickstart](api-builder-quickstart.md)
2. read the [ProofTrail MCP Server README](../../apps/mcp-server/README.md)
3. verify the checked-in MCP surface with `pnpm mcp:check`
4. only then attach your MCP client

That order prevents a common mistake: treating MCP like a shortcut around the
repo contract and evidence model.

## Current install that works today

The current supported install mode is **local checkout + stdio**.

Example configuration:

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

Optional backend token forwarding example:

```json
{
  "mcpServers": {
    "proofyard": {
      "command": "pnpm",
      "args": ["mcp:start"],
      "cwd": "/absolute/path/to/proofyard",
      "env": {
        "UIQ_MCP_API_BASE_URL": "http://127.0.0.1:18080",
        "UIQ_MCP_AUTOMATION_TOKEN": "optional-backend-token"
      }
    }
  }
}
```

Protocol and auth boundary:

- protocol = `stdio`
- transport = `stdio`
- auth = `local-with-optional-backend-token`
- OAuth is not part of the current MCP contract

## Publish-ready but not yet published

The following surfaces are part of the public contract now, but they are
**not usable today** because they are not yet published:

- npm package: `@proofyard/mcp-server`
- Docker image: `ghcr.io/xiaojiou176-open/proofyard-mcp-server:0.1.1`

Future package example (**not yet published**):

```json
{
  "mcpServers": {
    "proofyard": {
      "command": "npx",
      "args": ["-y", "@proofyard/mcp-server@0.1.1"]
    }
  }
}
```

Future Docker example (**not yet published**):

```json
{
  "mcpServers": {
    "proofyard": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "-v",
        "/absolute/path/to/proofyard:/workspace",
        "-e",
        "UIQ_MCP_WORKSPACE_ROOT=/workspace",
        "ghcr.io/xiaojiou176-open/proofyard-mcp-server:0.1.1"
      ]
    }
  }
}
```

## Suggested reading path

1. [ProofTrail for AI Agents](proofyard-for-ai-agents.md)
2. [ProofTrail for Coding Agents and Agent Ecosystems](proofyard-for-coding-agents.md)
3. [Evidence, Recovery, and Review Workspace](evidence-recovery-review-workspace.md)
4. [API Builder Quickstart](api-builder-quickstart.md)
5. [ProofTrail MCP Server README](../../apps/mcp-server/README.md)
6. [MCP Distribution Contract](../reference/mcp-distribution-contract.md)
7. [AI Reconstruction Side Road](ai-reconstruction-side-road.md)

That reading path keeps MCP in the right role:

- not the first-run story
- not the whole product story
- but a real governed side road for AI-client browser automation
