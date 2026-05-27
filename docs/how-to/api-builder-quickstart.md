# API Builder Quickstart

This page is for builders who already understand the product story and now need
the shortest truthful path into Proofyard's contract layer.

Use this page when you are:

- wiring Proofyard into another script or service
- evaluating the generated TypeScript client
- deciding whether you need raw API semantics or the governed MCP tool surface

It is also the right page when your search intent sounds like:

- `browser automation API for Codex`
- `browser automation API for Claude Code`
- `browser automation backend for coding agents`

## Choose API vs MCP First

- choose **API** when you want direct request/response control
- choose **MCP** when your client already consumes tools and should stay on a
  governed tool surface

Think of it like plumbing versus appliances:

- the **API** is the pipe layout and pressure contract
- the **MCP server** is the controlled faucet surface an external AI client can use

For **Codex- and Claude Code-style workflows**, choose API when the coding
agent should stay in charge of reasoning while Proofyard supplies browser
execution, retained evidence, and recovery semantics.

## Builder Reading Order

1. [README.md](../../README.md)
2. [Universal API Reference](../reference/universal-api.md)
3. `contracts/openapi/api.yaml`
4. `apps/web/src/api-gen/client.ts`
5. [Proofyard MCP Server README](../../apps/mcp-server/README.md)

The generated client in `apps/web/src/api-gen/` is a **repo-local helper** for
this workspace. It is not a published SDK package.

## First Three Calls

### 1. Check runtime diagnostics

```bash
curl http://127.0.0.1:17380/health/diagnostics
```

### 2. Check retained evidence state

```bash
curl http://127.0.0.1:17380/api/evidence-runs/latest
```

### 3. Check automation command catalog

```bash
curl http://127.0.0.1:17380/api/automation/commands
```

Those three calls tell you:

- whether the backend is alive
- whether the canonical evidence surface already has a latest retained run
- which low-level automation commands exist before you guess command ids

## TypeScript Client Example

The generated client is already checked into the repo.
Use it from a repo-local script or another package inside this workspace.

```ts
// Example: a repo-local script launched from the Proofyard workspace root.
import {
  listAutomationCommands,
  listEvidenceRuns,
} from "./apps/web/src/api-gen/client";

const baseUrl = "http://127.0.0.1:17380";

const commands = await listAutomationCommands(baseUrl);
const evidenceRuns = await listEvidenceRuns(baseUrl, { limit: 5 });
```

Useful generated files:

- `apps/web/src/api-gen/client.ts`
- `apps/web/src/api-gen/api/automation.ts`
- `apps/web/src/api-gen/api/command-tower.ts`

## Verify The Contract Surface

Before you trust the generated client, run the fastest repo-native contract
gate first:

```bash
pnpm test:contract
```

That command already runs the checked-in contract tests plus generated-client
freshness verification.

If you want the underlying verify command directly, use:

```bash
node --import tsx contracts/scripts/generate-client.ts --verify
```

If that fails, regenerate:

```bash
pnpm contracts:generate
```

## Minimum Builder Verification Pack

```bash
pnpm contracts:check-openapi-coverage
node --import tsx contracts/scripts/generate-client.ts --verify
bash scripts/docs-gate.sh
```

## Next Stop

- read [Proofyard for Coding Agents and Agent Ecosystems](proofyard-for-coding-agents.md) if
  your search intent started from a coding-agent shell
- read [Proofyard for AI Agents](proofyard-for-ai-agents.md) if you want the
  audience-fit page before you pick an integration road
- stay on [Universal API Reference](../reference/universal-api.md) if you need
  endpoint families and lane semantics
- switch to [MCP for Browser Automation](mcp-quickstart-1pager.md) if your next
  step is an MCP client integration
