# Release Guide

Webaudit does not treat the GitHub Releases tab as decorative metadata.

Use releases to answer one public question clearly: what changed, what broke,
what should an evaluator subscribe to, and what proof can they inspect.

This page sits after the first evaluation path, not before it. If you still
need the product/category story, start with [README.md](../../README.md). If
you need the evidence/recovery story first, start with
[docs/reference/run-evidence-example.md](../reference/run-evidence-example.md).
If you need the publication-lane receipts themselves, start with
[publication-receipt-bundle.md](./publication-receipt-bundle.md).

For the current active mainline, "proof" means the canonical run artifacts
written by `just run`: `manifest.json`, `reports/summary.json`,
`reports/diagnostics.index.json`, `reports/log-index.json`, and the four
`reports/proof.*.json` files. Do not claim richer release proof than that
contract unless the active pipeline is already writing it.

## Generate release notes

Use:

```bash
./scripts/release/generate-release-notes.sh
```

The default output lands under `.runtime-cache/artifacts/release/`, but
`RELEASE_NOTES_OUTPUT` can redirect the file during CI or review.

## Generate supply-chain summary artifacts

Use:

```bash
node scripts/release/generate-supply-chain-artifacts.mjs .runtime-cache/artifacts/release/supply-chain
```

These repository-side artifacts are inspection aids. They are not signed
release-grade proof by themselves.

## Generate an evidence share pack

Use:

```bash
node --import tsx scripts/release/generate-evidence-share-pack.mts <runId> [compareRunId]
```

This emits two release-facing artifacts under
`.runtime-cache/artifacts/release/share-pack/`:

- `<runId>.share-pack.json`
- `<runId>.share-pack.md`

Use the share-pack files for the human-readable evidence bundle, and use the
promotion-candidate files when a release or showcase surface needs the explicit
promotion eligibility metadata instead of only the raw run/share-pack summary.

Before you treat a share pack as release-facing evidence, ask three questions in
order:

1. Is the run retained?
2. If a compare is attached, is it a real retained baseline comparison instead
   of a `partial_compare`?
3. Has the run been reviewed strongly enough that promotion is the next honest
   step instead of more explanation or comparison?

## Generate promotion candidate metadata

Use:

```bash
node --import tsx scripts/release/generate-promotion-candidate.mts \
  <runId> [compareRunId] [candidate|review|approved]
```

This emits the release-facing promotion metadata under
`.runtime-cache/artifacts/release/promotion-candidates/` and refreshes the
supporting share-pack files at the same time.

Do not cite a raw run directory directly in release/showcase copy. Think of it
like shipping: the raw run is the warehouse inventory, the share pack is the
packed box, and the promotion candidate is the signed dispatch label that says
this box is actually approved to leave the building.

That means the release-facing order should stay:

1. explain the run
2. package the share pack
3. compare against a retained baseline when needed
4. build or inspect the review workspace packet when you want one
   maintainer-ready surface
5. only then cite the promotion candidate

If you want that maintainer-ready packet, use the API review workspace seed:

- `GET /api/evidence-runs/{runId}/review-workspace`

This remains a local-first review packet. It is not a hosted review SaaS.

## Create the GitHub release safely

Use:

```bash
./scripts/release/create-github-release.sh v0.1.0
```

This helper refuses to create a release when:

- the worktree is dirty
- local `HEAD` does not match the remote default branch
- release notes have not been generated yet

That guard exists to avoid publishing a release that points at the wrong code
state.

## Release checklist

Every public release should include:

1. user-facing highlights
2. breaking changes or an explicit `None`
3. migration notes when behavior changed
4. links back to the canonical docs surfaces that describe the active proof contract:
   - `docs/showcase/minimal-success-case.md`
   - `docs/reference/run-evidence-example.md`
   - `docs/reference/release-supply-chain-policy.md`
5. the promotion candidate artifact for the promoted run:
   - `.runtime-cache/artifacts/release/promotion-candidates/<runId>.promotion-candidate.json`
