# ProofTrail vs Generic Browser Agents

This page is for people asking a high-intent question:

> when should I use ProofTrail instead of a generic browser agent?

The short answer is:

ProofTrail fits best when you care about **retained evidence, guided recovery,
review-ready handoff, and governed side roads** more than open-ended browser
autonomy.

## Decision in one minute

Choose **ProofTrail** when you want a browser workflow that is easier to prove,
inspect, recover, compare, and hand off after the first run.

Choose a **generic browser agent** when you primarily want open-ended autonomy
and are comfortable with less structure around evidence and recovery.

Choose **neither yet** if you still have not clarified whether your first goal
is deterministic proof, direct API integration, or general-purpose browsing.

## Who this page is for

- AI agents that need governed browser access with inspectable output
- human operators who need replay, compare, and recovery after the first run
- teams replacing brittle one-off browser scripts with something more explainable
- builders deciding whether they need a generic agent shell or a governed browser evidence layer

## Where generic browser agents still win

Generic browser agents may be a better fit when you want:

- open-ended browsing autonomy with less structure
- fast demo loops where retained evidence is not the main goal
- hosted or agent-native ecosystems that ProofTrail does not currently provide

Those are real strengths. This page is not trying to pretend otherwise.

## When ProofTrail is the wrong fit

Do not choose ProofTrail first when your actual requirement is:

- a hosted agent platform with broad built-in ecosystems
- unconstrained autonomous exploration as the main product value
- a generic browser copilot that hides the evidence model from the operator

Those are category boundaries, not temporary copywriting issues.

## Where ProofTrail wins

ProofTrail is stronger when you need:

- one canonical path instead of many unofficial entrypoints
- retained evidence bundles you can inspect later
- recovery guidance before raw-log guesswork
- compare, share-pack, and promotion decisions grounded in evidence
- local-first review packet before wider handoff
- MCP as a governed side road instead of a hidden backdoor
- AI reconstruction that stays optional and reviewable

## Comparison frame

| Need | Generic browser agents | ProofTrail |
|:---|:---|:---|
| Open-ended browser autonomy | often stronger | not the primary focus |
| Canonical run path | varies | built around `just run` |
| Retained evidence bundle | often incidental | core product contract |
| Recovery guidance | often manual | built into product surfaces |
| Compare / share / promotion path | often ad hoc | attached to retained evidence |
| MCP integration | varies | explicit governed side road |
| AI reconstruction | often bundled into generic agent loop | optional side road after artifacts exist |
| Review-ready handoff | often improvised | local-first review packet |
| Deterministic mainline | often weaker | explicit design goal |

## What makes this an alternatives page instead of a marketing page

The point is not "ProofTrail beats every browser agent."

The point is that the product makes a different trade:

- less emphasis on unconstrained autonomy
- more emphasis on retained evidence and governed recovery surfaces
- a clearer line between the mainline, MCP integration, and AI reconstruction

If those trade-offs are not what you need, the honest answer is to use a
different class of tool.

## How to evaluate the difference yourself

1. [Run the 15-minute evaluation path](../getting-started/human-first-10-min.md)
2. [Inspect the run evidence example](../reference/run-evidence-example.md)
3. [Read MCP for Browser Automation](../how-to/mcp-quickstart-1pager.md)
4. [Open the AI Reconstruction Side Road](../how-to/ai-reconstruction-side-road.md)
5. [Read Evidence, Recovery, and Review Workspace](../how-to/evidence-recovery-review-workspace.md)

That order keeps the comparison grounded in what this repo can actually do
today, not in imagined future positioning.

## Reading path after this page

- go to [ProofTrail for AI Agents](../how-to/proofyard-for-ai-agents.md) if you are still testing audience fit
- go to [MCP for Browser Automation](../how-to/mcp-quickstart-1pager.md) if your next question is AI-client tool integration
- go to [AI Reconstruction Side Road](../how-to/ai-reconstruction-side-road.md) if your next question is artifact-driven AI help
- go to [Evidence, Recovery, and Review Workspace](../how-to/evidence-recovery-review-workspace.md) if you want the deepest current product proof
