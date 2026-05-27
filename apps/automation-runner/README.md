# Automation Pipeline

This package records and replays a local registration flow.

## Record Modes

- `manual`: you operate browser manually, script only records artifacts.

Default mode is `manual`.

## Scripts

- `pnpm record`: run recorder (default `manual` mode).
- `pnpm record:manual`: same as above, explicit mode.
- `pnpm extract`: parse HAR and emit canonical `flow_request.spec.json` (and compatibility `register_request.spec.json`).
- `pnpm extract:register`: compatibility wrapper for legacy register extractor.
- `pnpm extract:video`: parse video/transcript signals and emit candidate flow steps (Gemini-only via Python helper, fail-fast on misconfiguration).
- `pnpm generate-case`: generate Playwright API test template from extracted spec (default output: `apps/automation-runner/tests/generated/`).
- `pnpm generate:reconstruction`: generate flow/code/readiness outputs from reconstruction preview JSON (including API replay template from action endpoint/bootstrap hints when available).
- `pnpm replay`: replay registration using the extracted spec.
- `pnpm test`: run Playwright API test.
- `pnpm reconstruct-and-replay`: call backend reconstruction preview+generate pipeline in one shot.

## Generated Artifacts

Artifacts are written under `../.runtime-cache/automation/`.

Reconstruction generated outputs include:
- `generated-playwright.spec.ts`: UI flow replay scaffold.
- `generated-api.spec.ts`: API replay scaffold (bootstrap + action endpoint + success assertion).
- `run-readiness-report.json`: readiness summary with:
  - replay readiness: `apiReplayReady`, `requiredBootstrapSteps`
  - replay SLA: `replaySuccessRate7d`, `replaySuccessSamples7d`, `replaySla`
  - manual gate matrix/panel: `manualGateReasonMatrix`, `manualGateStatsPanel`, `manualGateReasons`

SLA note:
- If no historical replay attempts exist in the last 7 days, output is explicit and non-placebo:
  - `replaySuccessSamples7d = 0`
  - `replaySuccessRate7d = null`

Sensitive retention:
- `AUTOMATION_RETENTION_HOURS` controls automatic cleanup of old session folders (default: 24h).
- Generated specs and replay outputs are redacted before writing to disk.

## Required Secrets

The following environment variables are required for secure replay/generation paths:

- `RECON_SECRET_PASSWORD`: required by generated reconstruction API/UI replay for password fields.
- `RECON_SECRET_INPUT`: required by generated reconstruction UI replay for secret input placeholders.
- `REPLAY_PASSWORD`: required by `pnpm replay` whenever payload contains password/secret fields.

Scripts now fail fast when these values are missing instead of using a weak default password fallback.
