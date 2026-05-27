# MCP Distribution Contract

This page is the **registry-facing contract** for the Proofyard MCP surface.
It documents four separate truth lanes: local stdio works now; the ClawHub
skill page is live as a public discovery page for the repo-owned skill packet;
Goose `#26` and agent-skill.co `#182` are active upstream review lanes; the
OpenHands/extensions lane is closed-not-accepted; and the npm, Official
MCP Registry, and GHCR lanes are still unpublished or contract-only upstream.

Use it when you need the shortest truthful summary of:

- what the MCP package is called
- which protocol it uses
- how it authenticates
- where the auth boundary is
- what it can do
- which install paths work today
- which install paths are only publish-ready and **not yet published**

## MCP Package Metadata

| Field | Value |
| --- | --- |
| Name | `@proofyard/mcp-server` |
| Registry server name | `io.github.xiaojiou176-open/proofyard-mcp` |
| Description | `Governed MCP access to Proofyard runs, proof, and workflows` |
| Version | `0.1.1` |
| Homepage | `https://xiaojiou176-open.github.io/proofyard/` |
| Repository | `https://github.com/xiaojiou176-open/proofyard` |
| License | `MIT` |
| Protocol | `stdio` |
| Transport | `stdio` |
| Auth boundary | `local-with-optional-backend-token` |

## Capability Summary

The MCP surface is a **governed browser-evidence bridge** for external AI
clients.

It is designed for clients that need to:

- inspect retained run evidence
- launch supported run profiles
- read manifests and proof bundles
- operate on the same governed backend/API/runtime surfaces as the local repo

It is **not**:

- a hosted MCP endpoint
- an official vendor plugin
- a browser plugin
- a generic AI-agent shell

## Current / usable today

The current supported path is a **local checkout + stdio** install.

Use it when you have the repo locally and want your agent shell to call the MCP
surface directly from the checkout.

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

Truth boundary:

- local stdio is supported now
- the ClawHub skill page is `listed-live`, but only as a public discovery page
  for the repo-owned skill packet
- the repo-owned skill packet is separate from generic cross-host
  skill-registry publication
- the GHCR image name
  `ghcr.io/xiaojiou176-open/proofyard-mcp-server:0.1.1` is part of the
  repo-defined container contract, but today
  `https://github.com/orgs/xiaojiou176-open/packages/container/package/proofyard-mcp-server`
  returns `404` and
  `https://github.com/orgs/xiaojiou176-open/packages?repo_name=proofyard`
  reports `0 packages`
- backend token forwarding is optional
- OAuth is not part of the current MCP contract
- npm and Official MCP Registry are still blocked upstream because
  `@proofyard/mcp-server` is not yet published on npm
- Goose and agent-skill.co are `review-pending`, not live listings
- OpenHands/extensions is `closed-not-accepted`, not a live listing

## Upstream publication split

The following names are the current discovery, review, package, and container
surfaces for this repository:

- ClawHub skill page
  - identifier: `https://clawhub.ai/skills/proofyard-mcp`
  - current state: listed-live packet discovery page
- Repo-owned skill packet
  - identifier: `skills/proofyard-mcp/`
  - current state: materialized in repo / generic registry not evidenced
- OpenHands/extensions lane
  - identifier: `OpenHands/extensions#161`
  - current state: closed-not-accepted / not live
- Goose Skills Marketplace lane
  - identifier: `block/Agent-Skills#26`
  - current state: review-pending / not live
- agent-skill.co source repo lane
  - identifier: `heilcheng/awesome-agent-skills#182`
  - current state: review-pending / not live
- npm package
  - identifier: `@proofyard/mcp-server`
  - current state: ready / **not published**
- Docker image
  - identifier: `ghcr.io/...:0.1.1`
  - current state: contract only / not public today

The repo-local registry submission artifact now lives at
`apps/mcp-server/server.json`.

Future package example (**not usable today**):

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

Future container example (**not publicly evidenced today**):

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
        "UIQ_MCP_API_BASE_URL=http://host.docker.internal:18080",
        "-e",
        "UIQ_MCP_WORKSPACE_ROOT=/workspace",
        "ghcr.io/xiaojiou176-open/proofyard-mcp-server:0.1.1"
      ]
    }
  }
}
```

The package example above still describes an intended publish-facing contract
only. It must not be described as a live install path until the npm package is
actually published and read back from the upstream registry.

The container example above describes the intended GHCR install shape only. A
mounted Proofyard checkout (or another compatible workspace root) is still
assumed, and it is not a standalone hosted MCP endpoint. Today public read-back
does **not** confirm a live GitHub Packages page for this image, so Docker must
not be described as a listed/live public lane here. That also means Docker does
**not** upgrade the npm package or Official MCP Registry listing to live.

The live ClawHub page above does **not** upgrade the npm package, Official MCP
Registry, or GHCR lane to live either. It is a separate skill-page lane for the
repo-owned packet.

Repo validation command:

```bash
pnpm mcp:container:smoke
```

## Supporting docs

- [Proofyard MCP Server README](../../apps/mcp-server/README.md)
- [Registry submission artifact](../../apps/mcp-server/server.json)
- [MCP for Browser Automation](../how-to/mcp-quickstart-1pager.md)
- [Distribution Status](../../DISTRIBUTION.md)
- [Integration Boundaries](../../INTEGRATIONS.md)
- [Proofyard MCP Skill](../../skills/proofyard-mcp/SKILL.md)
