# Universal API Reference

This page is the public API reference landing page for Webaudit.

It does not try to restate every schema inline. Its job is simpler: explain
which API families exist, what lane they belong to, and where to look next when
you need the exact contract.

## Builder Start Here

If you are integrating Webaudit from another tool, start with this order:

1. read this page for lane boundaries
2. read [API builder quickstart](../how-to/api-builder-quickstart.md) for runnable examples
3. inspect `contracts/openapi/api.yaml` for the exact schema contract
4. verify the generated web client is current:

```bash
node --import tsx contracts/scripts/generate-client.ts --verify
```

5. choose one of the two public integration roads:
   - **API** when you want direct contract-level integration
   - **MCP** when you want a governed tool surface for an external AI client

Think of it like plumbing versus appliances:

- the **API** is the pipe layout and pressure contract
- the **MCP server** is the controlled faucet surface an external AI client can safely turn

You should not treat those as interchangeable.

If your real question is:

- `How would a Codex-style workflow call this directly?`
- `How would a Claude Code style agent use browser automation through HTTP instead of MCP?`
- `How would an OpenHands runtime call this as a browser subsystem?`
- `How would an OpenClaw gateway keep browser work in a separate backend?`

the truthful answer is: use this API layer when you want direct contract-level
control and keep the coding agent outside Webaudit.

If you reached this page from a Codex, Claude Code, OpenHands, OpenCode, or
OpenClaw workflow, the same rule still applies:

- use **API** when that outer agent shell needs exact request/response control
- use **MCP** when that outer agent shell should consume governed tools instead
  of raw REST semantics

Webaudit is the browser-evidence contract layer in that setup, not the
vendor-specific shell.

For the shortest repo-native contract check, run:

```bash
pnpm test:contract
```

That command validates the checked-in contract tests and the generated-client
freshness gate together. Add `pnpm contracts:check-openapi-coverage` when you
want the broader endpoint coverage check as well.

## Category Fit

Webaudit's API is part of an evidence-first browser automation platform with
recovery and MCP.

That means the API should be read through the same lane model as the product:

- canonical evidence runs
- operator runs
- automation tasks

Do not collapse those records into one object model just because they can all
appear in the same user story.

## OpenAPI Contract

- source of truth: `contracts/openapi/api.yaml`
- public title: `Webaudit Platform API`
- purpose: describe the backend contract that supports canonical runs,
  operator workflows, retained evidence, recovery, reconstruction, and MCP side
  roads

## Useful Endpoint Families

- `GET /health/diagnostics`
- `GET /health/alerts`
- `GET /api/automation/commands`
- `GET /api/automation/tasks`
- `POST /api/automation/run`
- `GET /api/templates`
- `GET /api/templates/{template_id}/readiness`
- `GET /api/profiles/studio`
- `PATCH /api/profiles/studio/profiles/{profile_name}`
- `PATCH /api/profiles/studio/targets/{target_name}`
- `POST /api/reconstruction/preview`
- `POST /api/reconstruction/generate`
- `GET /api/runs`
- `GET /api/runs/{run_id}/recover-plan`
- `GET /api/evidence-runs`
- `GET /api/evidence-runs/latest`
- `GET /api/evidence-runs/{run_id}`
- `GET /api/evidence-runs/{run_id}/compare/{candidate_run_id}`
- `GET /api/evidence-runs/{run_id}/share-pack`
- `GET /api/evidence-runs/{run_id}/explain`
- `GET /api/evidence-runs/{run_id}/promotion-candidate`

## First Builder Calls

If you want the shortest path to prove you are talking to the right backend,
use these calls first:

```bash
curl http://127.0.0.1:17380/health/diagnostics
curl http://127.0.0.1:17380/api/evidence-runs/latest
curl http://127.0.0.1:17380/api/automation/commands
```

What each one tells you:

- `/health/diagnostics`
  gives runtime health and task counters
- `/api/evidence-runs/latest`
  tells you whether the canonical evidence surface already has a latest retained run
- `/api/automation/commands`
  shows the low-level automation command catalog instead of forcing you to guess command ids

## TypeScript Client Path

If you are integrating from TypeScript, the repo already checks in generated
web client artifacts under:

- `apps/web/src/api-gen/client.ts`
- `apps/web/src/api-gen/api/automation.ts`
- `apps/web/src/api-gen/api/command-tower.ts`
- `apps/web/src/api-gen/api/health.ts`

The freshness gate is the generator itself:

```bash
node --import tsx contracts/scripts/generate-client.ts --verify
```

When that passes, the generated client is aligned with the checked-in OpenAPI
contract.

Treat that client as a **repo-local helper surface**, not as a published SDK.

## API vs MCP

Use **API** when:

- you are building a service-to-service integration
- you want exact request/response control
- you are consuming runs, evidence, or automation endpoints directly

Use **MCP** when:

- an external AI client should inspect runs or launch workflows through a governed tool surface
- you want the repo to expose tools instead of raw REST semantics
- you need one integration lane that stays aligned with the same backend and retained artifacts

For Codex-, Claude Code-, OpenHands-, OpenCode-, OpenClaw-, and other
AI-agent-shell workflows, the decision rule stays the same:

- choose **API** when the shell should own exact request/response orchestration
- choose **MCP** when the shell should consume governed tools on top of the same
  retained-evidence substrate

The API is the contract layer.

The MCP server is the governed tool layer built on top of that contract.

For named agent ecosystems, the split is simplest when you read it like this:

- choose **API** first when your outer runtime looks more like Codex,
  OpenHands, or OpenClaw and wants explicit request/response orchestration
- choose **MCP** first when your outer shell looks more like Claude Code or
  OpenCode and already prefers governed tool calls
- either road is still valid whenever your outer system changes shape

For the dedicated search-intent landing page, see
[Webaudit for Coding Agents and Agent Ecosystems](../how-to/webaudit-for-coding-agents.md).

## Reading Order

If you are new to the product, do not start from raw endpoint enumeration.

Use this order instead:

1. [README.md](../../README.md)
2. [docs/architecture.md](../architecture.md)
3. [docs/reference/run-evidence-example.md](run-evidence-example.md)
4. `contracts/openapi/api.yaml`
5. `node --import tsx contracts/scripts/generate-client.ts --verify`
6. [apps/mcp-server/README.md](../../apps/mcp-server/README.md)

That order helps you understand what the API is for before you study the exact
shapes.
