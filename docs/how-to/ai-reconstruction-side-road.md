# AI Reconstruction Side Road

ProofTrail's AI reconstruction path is for the moment after artifacts already
exist and a human or AI-adjacent workflow still wants help rebuilding or
refining a flow.

It is not the public default road.

If you are still asking "Did the first canonical run even work?", go back to:

1. [README.md](../../README.md)
2. [docs/getting-started/human-first-10-min.md](../getting-started/human-first-10-min.md)
3. [docs/reference/run-evidence-example.md](../reference/run-evidence-example.md)

## Why AI builders still care

AI reconstruction matters here because it gives an AI-relevant capability
without redefining the repo into a generic AI browser bot.

The rule is simple:

- proof still comes first
- reconstruction comes after proof exists

## Why this side road exists at all

ProofTrail is not trying to win on generic browser autonomy.

This side road exists because browser evidence is often rich enough to help an
AI system rebuild intent, suggest a draft, or recover flow structure after the
first run. That is useful. It is also exactly where teams can drift into
wishful "let the model figure it out" behavior if the boundary is not made
explicit.

So the product stance is intentionally narrow:

- evidence creates the starting point
- AI reconstruction proposes
- operators review and decide

## When to use this side road

Use AI reconstruction when:

- you already have HAR, HTML, video, or session artifacts
- you want help rebuilding a flow or generating a reusable draft
- a human still plans to inspect the result before trusting it

Do not use it when:

- you have not run the canonical path yet
- you still do not know whether the retained evidence bundle is healthy
- you want AI to replace the deterministic mainline

## Inputs, outputs, and guardrails

| Layer | What belongs here | What does not belong here |
| :--- | :--- | :--- |
| Inputs | retained HAR, HTML, video, session artifacts, evidence bundles | a blank prompt with no artifact ground truth |
| Outputs | reconstructed drafts, template candidates, profile hints, reviewable next steps | silent autonomous promotion straight into default production use |
| Guardrails | preview first, inspect artifacts, keep human review in the loop | treating generated output as proof on its own |

## What this path does

In ProofTrail, AI reconstruction helps with:

1. resolving a likely profile from artifacts
2. previewing a reconstructed draft
3. generating a flow or template candidate
4. handing that draft back to the operator workflow for human review

The product rule is simple:

> AI reconstruction is an optional assistant after proof exists, not a
> prerequisite before proof exists.

## How it reconnects to the main product

This side road only makes sense when it flows back into the normal operator
loop:

1. evidence is retained from the canonical run
2. reconstruction proposes a draft or likely profile
3. Flow Workshop previews or refines that draft
4. operators inspect the result before reuse, compare, or promotion

That handoff matters more than the generation step itself.

## Product path

Use the path in this order:

1. run the canonical path first
2. inspect retained evidence in Task Center
3. open Flow Workshop only when artifact-driven reconstruction is actually useful
4. preview before you generate
5. review before you reuse

## Why this matters for AI agents and operators

Generic AI browser tools often optimize for open-ended autonomy.

ProofTrail optimizes for a different thing:

- evidence you can inspect later
- recovery you can explain
- AI help that stays attached to the evidence and operator workflow

That is exactly why it matters to AI-agent builders:

- the AI capability is real
- but it stays anchored to retained artifacts and human review
- it does not erase the deterministic mainline

## Do not confuse this with a generic AI agent loop

If you want a system whose main value is open-ended browser autonomy, this page
should probably push you toward the alternatives framing instead of trying to
stretch ProofTrail into something else.

If you want AI help that starts from retained artifacts, stays reviewable, and
feeds back into a governed operator workflow, this side road is the right fit.

## Next pages

- [docs/reference/run-evidence-example.md](../reference/run-evidence-example.md)
- [ProofTrail for AI Agents](proofyard-for-ai-agents.md)
- [docs/how-to/mcp-quickstart-1pager.md](mcp-quickstart-1pager.md)
- [docs/compare/proofyard-vs-generic-browser-agents.md](../compare/proofyard-vs-generic-browser-agents.md)
