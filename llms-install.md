# Proofyard MCP Install For Agent Shells

This file is the shortest honest install path for agent shells that want the
repo-native Proofyard MCP surface.

## What This Installs

- a governed stdio MCP surface
- backed by the local Proofyard checkout
- optional live backend token forwarding
- **not** a hosted HTTP endpoint
- **not** a published npm install today

## Current Working Path

1. Clone the repository.
2. Install dependencies from the repo root:

```bash
pnpm install
```

3. Start the MCP surface from the repo root:

```bash
pnpm mcp:start
```

## MCP Client Snippet

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

Optional live-backend forwarding:

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

## Verification

The repo-owned smoke path that works today is:

```bash
pnpm mcp:check
pnpm mcp:smoke
```

## Truth Boundary

- usable today: **local checkout + stdio**
- publish-ready but blocked upstream today:
  - `@proofyard/mcp-server`
  - Official MCP Registry listing
- not evidenced today:
  - public GHCR listing
  - hosted HTTP MCP runtime
  - Smithery listing
