# Quality Gates

Webaudit keeps storefront truth and engineering truth separate on purpose.

Generated governance references:

- `docs/reference/generated/profile-thresholds.md`
- `docs/reference/generated/ci-governance-topology.md`

## Governance Layers

Webaudit's current governance model uses five layers on purpose:

- `pre-commit`: local-fast commit gate
- `pre-push`: stronger local pre-push gate
- `hosted`: GitHub-hosted deterministic PR, CI, release, and maintenance workflows
- `nightly`: scheduled deep verification
- `manual`: operator-invoked heavy review and release-prep lanes

## Truth Layers

Think of these as four different report cards instead of one giant checkmark:

- `control-plane green`: `pnpm governance:control-plane:check`
- `repo truth green`: `pnpm repo:truth:check`
- `public truth green`: `pnpm public:truth:check`
- `release truth green`: `pnpm release:truth:check`

Each layer answers a different question:

- control-plane green: are the internal governance rules wired correctly?
- repo truth green: does the repository-wide truth surface hold together
  end to end?
- public truth green: is the public/open-source-facing surface safe and aligned?
- release truth green: are release-facing proof claims still honest?

## Storefront-facing gates

- `bash scripts/docs-gate.sh`
- `pnpm -s docs:entrypoints:check`
- `pnpm -s docs:surface:check`
- `pnpm -s docs:value-narrative:check`
- `pnpm -s mainline:alignment:check`
- `pnpm -s identity:drift:check`

These answer questions like:

- does the README still explain the right public road?
- do the supporting docs pages actually exist?
- did a legacy name or helper path leak back into the public surface?
- do the tracked storefront assets match the same policy used by public
  readiness checks?

## Feature-specific gates

- `pnpm -s evidence:registry:check`
- `pnpm -s run:graph:check`

These answer questions like:

- can the backend, shared core, and MCP agree on canonical evidence run history?
- do run/task correlation fields survive through the public API and test surfaces?

## Security and collaboration gates

- `./scripts/security-scan.sh`
- `pnpm -s repo:sensitive:check`
- `pnpm -s repo:sensitive:history:check`
- `pnpm -s repo:pii:check`
- `node scripts/ci/check-source-tree-runtime-residue.mjs`
- `pnpm -s public:collaboration:check`
- `pnpm -s docs:links:check`
- `pnpm check:host-safety`
- `bash scripts/github/check-storefront-settings.sh`
- `just github-closure-report`

These answer questions like:

- are the public collaboration files present and readable?
- are the docs links still valid?
- did an absolute local path, raw secret token, or cookie-like value leak
  into the tracked repo tree?
- does tracked Git history still carry high-signal secret or local-path residue?
- did a real-looking non-placeholder email address leak into tracked content?
- did runtime/tool residue land inside repo-owned source roots?
- did secrets or unsafe dependencies leak into the tracked tree?
- do desktop smoke/e2e/business/soak lanes stay fail-closed behind
  operator-manual env gates and protected environments?
- are the tracked storefront PNG assets explicitly allowed as public-facing
  proof surfaces instead of being treated as accidental heavy artifacts?
- are the GitHub storefront settings still aligned with the current public story?
- do we have a current machine-readable closure verdict for
  storefront/community/security and any manual-required GitHub evidence?

## Local Git Hook Contract

The default local git-hook path is intentionally narrower than the full repo
CI graph.

- `pre-commit` should stay local-fast:
  - env contract and alias checks
  - tracked sensitive-surface and PII checks
  - staged truth gates
  - changed-file hook checks from `configs/tooling/pre-commit-config.yaml`
- repo-wide lint/container parity, docs truth, governance hallway, mutation, and
  similar wider gates should be delegated to `pre-push`, hosted CI, or explicit
  opt-in toggles instead of being mandatory on every local commit
- `pre-push` may keep a stronger deterministic repo-wide path, but heavy lanes
  such as mutation, nonstub browser replay, deep security scans, or live audits
  must stay opt-in or hosted

This split keeps the default local loop honest:

- commit-time hooks stay fast enough for normal iteration
- repo-wide parity still exists before merge
- heavy proof remains available without turning every commit into a mini CI run

## Workspace Hygiene Contract

Artifacts/reports/logs may live under `.runtime-cache/`, but workspace hygiene
still requires every cache and temp surface to stay in an explicit, isolated
lane.

- Use `UV_CACHE_DIR` for uv cache isolation.
- Use `PIP_CACHE_DIR` for pip cache isolation.
- Use `TMPDIR` for temporary files that must not land in tracked repo roots.
- Use `RUNNER_TOOL_CACHE` and `AGENT_TOOLSDIRECTORY` only as runner-owned tool
  cache surfaces, not as ad-hoc repo-local dump locations.
- Prefer `${{ runner.temp }}/pre-commit` for `PRE_COMMIT_HOME`.
- Prefer `${{ runner.temp }}/uv-cache` for uv cache during CI.
- Prefer `${{ runner.temp }}/pip-cache` for pip cache during CI.
- Use `${{ runner.tool_cache }}` only for runner-managed tool caches.
- If a workflow intentionally needs `clean: false`, mark the reason inline with
  `workspace-hygiene: allow-checkout-clean-false`.

## AI-Dependent Audits

Gemini/AI audits are intentionally treated as advisory or maintainer-only checks,
not deterministic merge blockers.

- Keep deterministic checks such as docs truth, security, lint, contract, and
  smoke gates on strong local/CI paths.
- Keep Gemini live smoke, Gemini web/UI audits, and similar model-dependent
  reviews on `workflow_dispatch`, scheduled non-blocking workflows, or explicit
  maintainer commands.
- Scheduled core lanes stay deterministic by using non-AI profiles such as
  `nightly-core` and `manual-core`; Gemini trend reviews remain advisory.

This split keeps CI trustworthy: reproducible gates stay on the mainline, while
model-dependent audits still exist without turning branch quality into a
provider-availability lottery.
