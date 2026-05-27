# Run Evidence Example

The canonical public mainline is `just run`, which resolves to
`pnpm uiq run --profile pr --target web.local`.

Treat this page as the evidence-and-recovery landing seed inside the docs
surface. It explains what a trustworthy retained run looks like before you move
to AI or MCP side roads.

When a run succeeds, review the evidence bundle in this order:

1. `.runtime-cache/artifacts/runs/<runId>/manifest.json`
2. `.runtime-cache/artifacts/runs/<runId>/reports/summary.json`
3. `.runtime-cache/artifacts/runs/<runId>/reports/proof.stability.json`
4. `.runtime-cache/artifacts/runs/<runId>/reports/proof.coverage.json`
5. `.runtime-cache/artifacts/runs/<runId>/reports/proof.gaps.json`
6. `.runtime-cache/artifacts/runs/<runId>/reports/proof.repro.json`
7. `.runtime-cache/artifacts/runs/<runId>/reports/diagnostics.index.json`
8. `.runtime-cache/artifacts/runs/<runId>/reports/log-index.json`

Interpret the evidence state like this:

- `retained`: the key proof files are still available and ready to inspect, explain, or share
- `empty`: the runs directory exists, but there is no retained run to inspect yet
- `missing`: the canonical runs surface is not available in this checkout right now

If you reach `empty` or `missing`, go back to the canonical mainline before you
open lower-level helper paths.

Example shape:

```text
.runtime-cache/artifacts/runs/<runId>/
├── manifest.json
└── reports/
    ├── proof.coverage.json
    ├── proof.gaps.json
    ├── proof.repro.json
    ├── proof.stability.json
    ├── summary.json
    ├── diagnostics.index.json
    └── log-index.json
```

The stable public contract is:

- `manifest.json` is the anchor file
- `manifest.proof` points to the four `proof.*.json` artifacts
- `manifest.reports` mirrors those proof paths and the index files for quick lookup

Optional reports such as accessibility, performance, visual, load, AI review,
or security outputs may appear when the selected profile enables them, but they
are not guaranteed by the minimum active mainline contract.

If an internal automation surface executes `run`, it should execute `run` against that canonical chain rather than a helper path.

That means an internal automation surface executes `run` against that canonical chain instead of bypassing it with a helper-only route.

Treat `.runtime-cache/automation/` as helper-path outputs, not the canonical public mainline evidence surface.

For the adjacent side roads, continue with:

- [Evidence, Recovery, and Review Workspace](../how-to/evidence-recovery-review-workspace.md)
- [AI reconstruction side road](../how-to/ai-reconstruction-side-road.md)
- [MCP for Browser Automation](../how-to/mcp-quickstart-1pager.md)
- [Proofyard vs generic browser agents](../compare/proofyard-vs-generic-browser-agents.md)

When the UI talks about evidence state, read it this way:

- `retained`: the canonical bundle is complete enough to inspect, explain, share, and compare
- `partial` or `missing`: some required proof paths are not available, so inspect the explanation before treating the run as authoritative
- `empty`: the evidence surface exists, but no retained canonical run has landed yet

The practical operator path is:

1. inspect the retained bundle
2. explain what happened
3. prepare the share pack
4. compare if you need more context
5. build the review workspace packet when you need maintainer handoff
6. only then decide whether the run is strong enough for promotion

Treat compare like a baseline judgment surface, not like a replacement for the
bundle itself:

- the baseline and the candidate should both be retained evidence runs
- `partial_compare` means the comparison is still useful for context, but not
  strong enough for a release or promotion decision
- promotion is downstream of explain, share, and compare; it is never the first
  evidence action

In the local command center, treat the evidence state like this:

- `retained`: the key evidence is still present and worth inspecting, sharing,
  or comparing
- `partial`: some evidence remains, but the bundle is incomplete
- `missing`: the canonical evidence surface is not currently usable as
  authoritative proof
- `empty`: the surface exists, but you have not retained a run there yet

When a retained run is selected in **Task Center**, use the next actions in this
order:

1. **Failure Explainer** to understand the run before reading raw logs
2. **Share Pack** when you need a handoff-friendly summary
3. **Compare** when you need to understand how this run differs from another
4. **Review Workspace** when you need one review-ready packet
5. **Promotion Candidate** only when you are making a release/showcase decision

Think of this like a checkout line, not a buffet:

- the **explainer** gives the first grounded reading
- the **share pack** turns that reading into a handoff-ready packet
- **compare** strengthens judgment when you need a baseline
- the **review workspace** is the maintainer-facing packet
- **promotion** stays last, after the packet is already explainable and reviewable

If you want the shortest operator rule of thumb, use this same ladder:

1. explain first, before raw logs or promotion
2. prepare the share pack before widening handoff
3. compare against a retained baseline when context still feels thin
4. open the review workspace before treating promotion as the default next move
5. use promotion guidance only after the packet is reviewable

Keep the recovery safety policy in mind while you do that:

- inspect first when you only need more context
- replay only with human confirmation
- keep OTP, provider, and manual-input steps manual-only

Reference:

- [Recovery safety policy](recovery-safety-policy.md)
- [Hosted review workspace MVP](hosted-review-workspace-mvp.md)

When you move from inspection into reuse or operator tuning, keep the same lane
discipline:

1. use template readiness to decide whether a flow should be reused or kept in
   workshop mode
2. use Profile / Target Studio only for allowlisted guarded tuning
3. use AI reconstruction only when artifacts already exist and a human still
   plans to review the result
4. use MCP only when an external AI client needs the governed integration
   surface
