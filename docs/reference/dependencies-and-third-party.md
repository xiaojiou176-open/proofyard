# Dependencies and Third-Party Notes

Webaudit depends on Python and Node.js packages, plus a small set of external developer tools used in CI and local verification.

## Current Repository License

- Project license: MIT

## Third-Party Review Expectations

Before release-facing changes:

- review new runtime dependencies
- review new build or CI tools
- check license compatibility
- check vulnerability status

## Local Scan Tooling

The repository uses these tools during public-surface and security review:

- Gitleaks
- TruffleHog
- git-secrets
- pre-commit
- Presidio
- ScanCode Toolkit

These tools support repository review. They do not replace human review.

## Generated Governance References

- Dependency baselines: `docs/reference/generated/governance/dependency-baselines.md`
- Upstream registry source: `configs/governance/upstream-registry.json`
- Upstream compatibility matrix: `docs/reference/generated/governance/upstream-compat-matrix.md`
