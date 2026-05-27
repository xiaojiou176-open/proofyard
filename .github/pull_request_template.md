## Summary
- Why is this change needed?
- What changed?
- What are the main risks?

## Validation
```bash
# Paste the real commands you ran.
bash scripts/docs-gate.sh
./scripts/security-scan.sh
# Add ./scripts/preflight.sh when you changed setup, runtime, or container surfaces.
```

## Public surface checklist
- [ ] I did not add secrets, runtime artifacts, or local-only files.
- [ ] I updated docs for public-facing behavior or configuration changes.
- [ ] I included the smallest relevant verification commands.
- [ ] I have the right to submit this contribution under the repository license.
- [ ] Every commit in this PR includes a DCO-style `Signed-off-by:` line.

## Rollback
- Revert the merge commit or the individual commit(s).
- Re-run the minimum validation for the affected scope.
