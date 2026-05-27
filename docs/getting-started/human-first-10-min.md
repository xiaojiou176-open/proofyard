# Human-First 10 Minute Start

This page is for the first run when you want the fewest moving parts possible.

Proofyard is **evidence-first browser automation with recovery and MCP**.
This page covers the first evaluation path, not the AI or MCP side roads.

## The public road

- `just run`: canonical public mainline wrapper for `pnpm uiq run --profile pr --target web.local`
- `just run-legacy`: lower-level record/extract/replay helper path, not the public default mainline

Internal automation surfaces should map `run` to that same orchestrator-first command, not to a helper path, not the public default mainline, and not to an older manual workshop entry.

## Step 1 - Check prerequisites

You need:

- Python 3.11+
- Node.js 20+
- `pnpm`
- `uv`
- `just`

## Step 2 - Install the workspace

```bash
just setup
```

Expected result:

- Python dependencies sync through `uv`
- workspace packages install through `pnpm`
- browser dependencies for the automation runner are available locally

## Step 3 - Run the canonical flow

```bash
just run
```

Expected result:

- a run is emitted under `.runtime-cache/artifacts/runs/<runId>/`
- the run writes `manifest.json` and report files you can inspect
- the command may still exit non-zero if PR gates fail, but the evidence bundle
  remains the first place to inspect what happened

## Step 4 - Confirm the first result in Task Center

After the run starts or finishes, treat Task Center as the next checkpoint:

1. confirm whether you have a visible outcome
2. inspect the canonical evidence state
3. use the Recovery Center guidance inside Task Center before dropping to raw logs or helper paths

If the evidence surface is empty, go back to the canonical run first.
If the evidence surface is retained, explain or share that run before jumping
into lower-level workshop debugging.

## Step 5 - Follow the same path in the command center

If you are evaluating through the local UI rather than only the shell, keep the
same order:

1. **Quick Launch**: submit the canonical run first
2. **Task Center**: confirm whether you now have a result, an evidence bundle,
   or a recovery action
3. **Recovery Center**: use the suggested recovery action from Task Center or
   Flow Workshop before raw logs
4. **Flow Workshop**: open it only when you intentionally need the advanced
   draft, replay, or selector-editing surfaces

## If it fails

Start in this order:

1. confirm the direct orchestrator command also resolves: `pnpm uiq run --profile pr --target web.local`
2. inspect the run surface guide at [docs/reference/run-evidence-example.md](../reference/run-evidence-example.md)
3. use `just run-legacy` only when you are intentionally debugging the helper path, not the public default mainline

## What to do next when the first run finishes

Keep the follow-up path in this order:

1. confirm that a run directory exists under `.runtime-cache/artifacts/runs/<runId>/`
2. read `manifest.json` and `reports/summary.json` first
3. open the command center only after you already have one visible result:
   - `Task Center` for evidence, explanation, share, compare, and the Recovery Center lane
   - `Flow Workshop` for draft editing and deeper workshop debugging

The rule is simple: default path first, advanced workshop controls later.

If you need the broader category story after the first run, continue with:

- [docs/how-to/proofyard-for-ai-agents.md](../how-to/proofyard-for-ai-agents.md)
- [docs/reference/run-evidence-example.md](../reference/run-evidence-example.md)
- [docs/how-to/ai-reconstruction-side-road.md](../how-to/ai-reconstruction-side-road.md)
- [docs/how-to/mcp-quickstart-1pager.md](../how-to/mcp-quickstart-1pager.md)
- [docs/compare/proofyard-vs-generic-browser-agents.md](../compare/proofyard-vs-generic-browser-agents.md)

When the Web command center is open, the product-side troubleshooting order is:

1. check **Task Center** first
2. read the **Failure Explainer**
3. use **Recovery Center**
4. fall back to raw logs or helper paths only after the higher-level surfaces
   still leave uncertainty
