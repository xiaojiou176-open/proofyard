# MCP Distribution Contract

This page is the **registry-facing contract** for the Webaudit MCP surface.
It documents a split truth surface: the GHCR container lane is materialized in
repo, but today its public GitHub Packages surface is **not evidenced as
listed/live**, while the npm and Official MCP Registry lanes are still only
publish-ready in repo and not yet accepted upstream.

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
| Name | `@webaudit/mcp-server` |
| Registry server name | `io.github.xiaojiou176-open/webaudit-mcp` |
| Description | `Governed MCP access to Webaudit runs, proof, and workflows` |
| Version | `0.1.1` |
| Homepage | `https://xiaojiou176-open.github.io/webaudit/` |
| Repository | `https://github.com/xiaojiou176-open/webaudit` |
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
    "webaudit": {
      "command": "pnpm",
      "args": ["mcp:start"],
      "cwd": "/absolute/path/to/webaudit"
    }
  }
}
```

Optional backend token forwarding example:

```json
{
  "mcpServers": {
    "webaudit": {
      "command": "pnpm",
      "args": ["mcp:start"],
      "cwd": "/absolute/path/to/webaudit",
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
- the GHCR image name
  `ghcr.io/xiaojiou176-open/webaudit-mcp-server:0.1.1` is part of the
  repo-defined container contract, but today
  `https://github.com/orgs/xiaojiou176-open/packages/container/package/webaudit-mcp-server`
  returns `404` and
  `https://github.com/orgs/xiaojiou176-open/packages?repo_name=webaudit`
  reports `0 packages`
- backend token forwarding is optional
- OAuth is not part of the current MCP contract
- npm and Official MCP Registry are still blocked upstream because
  `@webaudit/mcp-server` is not yet published on npm
- ClawHub is `listed-live`, while OpenHands/extensions is still
  `review-pending`

## Upstream publication split

The following names are the publish-facing package and container surfaces for
this repository:

| Surface | Planned identifier | Current state |
| --- | --- | --- |
| npm package | `@webaudit/mcp-server` | ready / **not published** |
| Docker image | `ghcr.io/...:0.1.1` | contract only / not public today |

The repo-local registry submission artifact now lives at
`apps/mcp-server/server.json`.

Future package example (**not usable today**):

```json
{
  "mcpServers": {
    "webaudit": {
      "command": "npx",
      "args": ["-y", "@webaudit/mcp-server@0.1.1"]
    }
  }
}
```

Future container example (**not publicly evidenced today**):

```json
{
  "mcpServers": {
    "webaudit": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "-v",
        "/absolute/path/to/webaudit:/workspace",
        "-e",
        "UIQ_MCP_API_BASE_URL=http://host.docker.internal:18080",
        "-e",
        "UIQ_MCP_WORKSPACE_ROOT=/workspace",
        "ghcr.io/xiaojiou176-open/webaudit-mcp-server:0.1.1"
      ]
    }
  }
}
```

The package example above still describes an intended publish-facing contract
only. It must not be described as a live install path until the npm package is
actually published and read back from the upstream registry.

The container example above describes the intended GHCR install shape only. A
mounted Webaudit checkout (or another compatible workspace root) is still
assumed, and it is not a standalone hosted MCP endpoint. Today public read-back
does **not** confirm a live GitHub Packages page for this image, so Docker must
not be described as a listed/live public lane here. That also means Docker does
**not** upgrade the npm package or Official MCP Registry listing to live.

Repo validation command:

```bash
pnpm mcp:container:smoke
```

## Supporting docs

- [Webaudit MCP Server README](../../apps/mcp-server/README.md)
- [Registry submission artifact](../../apps/mcp-server/server.json)
- [MCP for Browser Automation](../how-to/mcp-quickstart-1pager.md)
- [Distribution Status](../../DISTRIBUTION.md)
- [Integration Boundaries](../../INTEGRATIONS.md)
- [Webaudit MCP Skill](../../skills/webaudit-mcp/SKILL.md)
