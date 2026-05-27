# Recovery Safety Policy

Proofyard does not treat recovery like a magic self-heal button.

This page defines the Wave 5 contract for recovery actions:

- some actions are safe to suggest immediately
- some actions are useful but must stay human-confirmed
- some actions are manual-only and must never auto-run

## Safety Levels

### `safe_suggestion`

Use this for read-only or clearly bounded actions.

Current examples:

- inspect linked task context
- open a safer operator surface before taking a recovery action

These are the "look before you touch anything" moves.

### `confirm_before_apply`

Use this for replay-style actions that help recovery but still change runtime state.

Current examples:

- `resume_from_step`
- `replay_step`
- `replay_latest`

These are like restarting a machine after checking the issue. Helpful, but still a deliberate choice.

### `manual_only`

Use this for actions that can change provider, account, checkout, payment, or challenge state.

Current examples:

- `submit_otp`
- `submit_input`
- `continue_manual_gate`

These are the "only a person should turn this key" moves.

## Explicit No-Go Boundary

Wave 5 does **not** allow:

- autonomous OTP submission
- autonomous provider-step continuation
- autonomous self-heal loops
- automatic replay chains after external challenges
- hidden background recovery that can mutate external state

If a future program wants to go beyond suggestion-first recovery, it needs a new safety design, a separate approval path, and stronger evidence than this repo currently has.
