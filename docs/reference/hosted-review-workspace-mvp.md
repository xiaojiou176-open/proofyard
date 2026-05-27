# Hosted Review Workspace MVP

Wave 5 does not ship a full hosted review product.

What it does ship is a **local-first review workspace packet** for a retained evidence run.

Think of it like this:

- the raw run directory is the warehouse shelf
- the share pack is the packed box
- the review workspace is the review table where the maintainer sees the box, the notes, and the release judgment together

## What the MVP Includes

`GET /api/evidence-runs/{runId}/review-workspace`

The response aggregates:

- retained run detail
- failure explanation
- share pack
- compare context when requested
- promotion candidate metadata
- recommended review order

## What It Is Good For

Use it when you want one review-ready packet before you:

1. share a proof bundle
2. decide whether the run is strong enough for promotion
3. hand the result to another maintainer

## What It Does Not Claim

This MVP is **not**:

- a hosted SaaS
- a multi-user review system
- a comment or annotation platform
- a permissions or tenancy layer
- remote artifact storage

Those items require a separate hosted program of work and should not be implied by this MVP.
