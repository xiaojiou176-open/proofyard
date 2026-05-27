# Minimal Success Case

Webaudit's minimum public promise is not "an AI agent can click around."
It is: one canonical run, one retained evidence bundle, and one recovery-ready
story a human can inspect later.

If you need the higher-level category framing first, start at [README.md](../../README.md).
If you need the comparison story next, continue to
[Webaudit vs generic browser agents](../compare/webaudit-vs-generic-browser-agents.md).

## What is the smallest real thing this repository can do end-to-end?

Run one canonical browser automation flow, emit one manifest-anchored evidence
bundle, and leave behind enough structured proof for a human to inspect what
happened, even when a PR gate fails.

This is not a decorative example.

The canonical public mainline can:

1. install the repo with `just setup`
2. execute the main run with `just run`
3. resolve to `pnpm uiq run --profile pr --target web.local`
4. produce a run bundle rooted at `.runtime-cache/artifacts/runs/<runId>/`

After a healthy run, inspect:

- `.runtime-cache/artifacts/runs/<runId>/manifest.json`
- `.runtime-cache/artifacts/runs/<runId>/reports/summary.json`
- `.runtime-cache/artifacts/runs/<runId>/reports/diagnostics.index.json`
- `.runtime-cache/artifacts/runs/<runId>/reports/log-index.json`
- `.runtime-cache/artifacts/runs/<runId>/reports/proof.coverage.json`
- `.runtime-cache/artifacts/runs/<runId>/reports/proof.stability.json`
- `.runtime-cache/artifacts/runs/<runId>/reports/proof.gaps.json`
- `.runtime-cache/artifacts/runs/<runId>/reports/proof.repro.json`

Then use that retained run in this order:

1. explain what happened
2. package the evidence for sharing
3. decide whether the run is strong enough to become a promotion candidate

`manifest.json` is the anchor document. The same run writes the proof files
above and records them under both `manifest.proof` and `manifest.reports`.

Other quality reports such as accessibility, performance, visual, load, and
security outputs remain conditional on the enabled engines and profile
configuration. They are not part of the minimum public proof contract.

`just run-legacy` still exists for lower-level workshop troubleshooting, but it
is not the canonical public mainline. Treat `.runtime-cache/automation/` as a
helper-path output area, not as the canonical public evidence surface.

Internal automation surfaces should resolve `run` to this same command.

## Guided evaluator path

If you are evaluating the product rather than debugging the workshop lane, use
this order:

1. produce one canonical run
2. inspect the retained evidence bundle
3. explain and share the result
4. only then move into replay, recovery, and promotion decisions

That order keeps the first experience grounded in the canonical proof surface
instead of dropping straight into helper-path complexity.

## Promotion candidate contract

When a canonical run is considered for release/showcase promotion, the
repository now publishes a separate promotion-candidate artifact alongside the
share pack.

Inspect:

- `.runtime-cache/artifacts/release/promotion-candidates/<runId>.promotion-candidate.json`
- `.runtime-cache/artifacts/release/promotion-candidates/<runId>.promotion-candidate.md`

The promotion candidate is a small release-facing summary that answers one
question directly: is this retained canonical run actually promotion-ready?

It must report:

- `eligible`
- `retentionState`
- `provenanceReady`
- `sharePackReady`
- `compareReady`
- `reviewState`
- `reasonCodes`

Treat this checklist like the release boarding pass. The run bundle is the
suitcase full of proof, while the promotion candidate is the stamped card that
says whether that suitcase is complete enough to board.

For a first evaluator pass, do not start here. Start with the canonical run,
confirm the result in Task Center, and only then come back to promotion-facing
artifacts.

For a first evaluator pass, keep the product path short:

1. run the canonical flow
2. inspect the retained evidence bundle
3. use **Failure Explainer** before raw logs
4. use **Share Pack** when you want a human-readable handoff
5. only then ask whether the run is ready to become a **Promotion Candidate**

If you are still deciding whether this product category fits your problem, read
[Webaudit vs generic browser agents](../compare/webaudit-vs-generic-browser-agents.md).
