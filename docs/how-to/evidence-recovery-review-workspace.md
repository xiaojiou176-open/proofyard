# Evidence, Recovery, and Review Workspace

This page explains the strongest current product path after a run already
exists:

> keep the evidence bundle, use recovery before guesswork, and build one
> review-ready packet before you widen handoff or promotion.

That is where Proofyard feels different from a pile of browser scripts or a
single replay log.

## Use this page when

You already have a retained run, and now the real question is no longer "did it
run?" but:

- what happened, in a way another maintainer can trust?
- what is the safe next move?
- how do I hand this run off without losing context?

If you do **not** have a retained run yet, go back first:

1. [Human-first 10 minute guide](../getting-started/human-first-10-min.md)
2. [Run evidence example](../reference/run-evidence-example.md)

## The product promise in one sentence

Proofyard does not stop at "the automation ran."

It keeps three layers attached to the same run:

1. **evidence**
2. **recovery**
3. **review workspace**

## What each layer contributes

### Evidence

Evidence tells you what happened and whether the retained run is still strong
enough to inspect.

Use it to answer:

- what ran?
- which proof files were retained?
- is the run state `retained`, `partial`, `missing`, or `empty`?

Start here:

- [Run evidence example](../reference/run-evidence-example.md)

### Recovery

Recovery tells you what to do next when the run is blocked, incomplete, or
failed.

Use it to answer:

- should I inspect, wait, resume, or replay?
- which actions are suggestion-first?
- which actions still require human confirmation?

Continue here:

- [Recovery safety policy](../reference/recovery-safety-policy.md)

### Review workspace

The review workspace packages the run into one maintainer-facing packet.

Use it when you need one place that can carry:

- the retained run detail
- explanation
- share pack
- compare context when it helps
- promotion guidance after the packet is already reviewable

Continue here:

- [Hosted Review Workspace MVP](../reference/hosted-review-workspace-mvp.md)

## The actual reading path inside the loop

If one retained run is already selected, use this order:

1. **Explain** the run first
2. **Prepare the share pack** so another maintainer can read the same story
3. **Compare** against another retained run when context is still thin
4. **Open the review workspace packet** to gather the packet in one place
5. **Make promotion-level judgments last**

That order matters because it keeps promotion downstream of evidence and review
instead of turning it into the first button you click.

If you want the shortest mental model, treat it like an evidence ladder:

- the retained bundle is the shelf
- recovery is the decision rail
- the review workspace is the handoff table

## What the review workspace packet really is

The current repo ships a **local-first review packet**, not a hosted review
product.

The packet is useful because it brings together the exact things a maintainer
usually has to gather by hand:

| Packet part | Why it matters |
| --- | --- |
| retained run detail | anchors the packet to one specific evidence run |
| failure explanation | gives the first grounded reading before raw logs |
| share pack | turns the reading into a handoff-friendly summary |
| compare context | strengthens judgment when a baseline run helps |
| promotion guidance | stays last, after the packet is already explainable |

That matches the current API shape described here:

- [Hosted Review Workspace MVP](../reference/hosted-review-workspace-mvp.md)

## Why teams care about this path

This loop is useful when:

- a human maintainer needs a review-ready packet
- an operator needs to recover without jumping to raw logs first
- a team needs to compare one retained run against another
- an AI-adjacent workflow still needs human-readable proof before wider handoff

This is also why the page belongs in the outward matrix. It is not a vague
"operations concept." It is one of the strongest current proofs that the repo
keeps evidence, judgment, and handoff connected.

## Where this page sits in the outward matrix

Use the current public matrix in this order:

1. [Proofyard for AI Agents](proofyard-for-ai-agents.md) for audience fit
2. [Proofyard for Coding Agents and Agent Ecosystems](proofyard-for-coding-agents.md) for coding-agent fit
3. [MCP for Browser Automation](mcp-quickstart-1pager.md) for the governed tool road
4. [AI Reconstruction Side Road](ai-reconstruction-side-road.md) for the downstream AI helper lane
5. [Proofyard vs Generic Browser Agents](../compare/proofyard-vs-generic-browser-agents.md) for category fit
6. this page for the deepest current product proof after a run already exists

If you only need the shortest evidence-and-handoff route, use this tighter
path:

1. [Run evidence example](../reference/run-evidence-example.md)
2. [Recovery safety policy](../reference/recovery-safety-policy.md)
3. [Hosted Review Workspace MVP](../reference/hosted-review-workspace-mvp.md)

## Honest boundary

This page does **not** claim:

- hosted collaboration
- autonomous self-heal
- remote artifact storage
- marketplace-style review exchange

It only claims the bounded current repo reality:

- retained evidence
- suggestion-first recovery
- explain and share-pack surfaces
- compare as supporting context
- a local-first review packet
