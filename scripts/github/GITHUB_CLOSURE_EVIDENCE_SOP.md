# GitHub Closure Evidence SOP

Use this SOP when `scripts/github/collect-closure-evidence.py` reports
`manual_required` for GitHub-only surfaces that do not expose a stable CLI/API
contract.

## When to use it

- GitHub Social Preview still needs a human confirmation
- `Code quality` or `AI findings` do not expose a stable `gh api` endpoint in
  the current environment and are actually available for the current GitHub
  owner/plan

## What is already automated

- If the community profile is complete and `content_reports_enabled=true`,
  closure automation now records `content_reports` as `pass` without a separate
  manual JSON section.
- If the current GitHub owner/plan does not expose GitHub Code Quality or AI
  findings, closure automation records those sections as `pass` with an
  `availability: not_applicable` note instead of leaving them as
  `manual_required`.
- Social Preview is still treated as manual because GitHub does not expose a
  stable API that proves the uploaded preview matches the tracked PNG asset.
- Once the manual evidence file marks `social_preview` as `pass`, the closure
  report now uses that section to resolve the final storefront verdict instead
  of leaving `closed_with_limitations` stuck forever.

## Required evidence

Capture these fields for each manual section:

- `status`: `pass`, `fail`, or `manual_required`
- `reason`: short human-readable conclusion
- `checked_at`: ISO timestamp
- `checked_by`: maintainer name or handle
- `evidence`: one or more screenshot paths or issue links
- `notes`: optional context

## Manual evidence file

Write the manual evidence file to:

` .runtime-cache/artifacts/ci/github-closure-manual-evidence.json `

To generate a safe starter template for the remaining Social Preview step, run:

```bash
just github-closure-social-preview-template
```

This writes a `social_preview` section with:

- `status: "manual_required"` so the report cannot fake-pass
- a prefilled screenshot path suggestion
- a reminder to switch the section to `pass` or `fail` only after checking GitHub UI

After you have actually confirmed the GitHub UI state, you can also stamp a
ready-to-review `pass` section with:

```bash
just github-closure-social-preview-pass
```

This does not replace the human check; it only saves you from editing the JSON
by hand after the check is done.

Example:

```json
{
  "version": 1,
  "sections": {
    "social_preview": {
      "status": "pass",
      "reason": "GitHub social preview matches the tracked PNG asset.",
      "checked_at": "2026-03-26T06:00:00Z",
      "checked_by": "maintainer",
      "evidence": [
        "screenshots/github-social-preview.png"
      ]
    },
    "code_quality": {
      "status": "pass",
      "reason": "GitHub Code Quality panel shows no open findings.",
      "checked_at": "2026-03-26T06:02:00Z",
      "checked_by": "maintainer",
      "evidence": [
        "screenshots/github-code-quality.png"
      ]
    },
    "ai_findings": {
      "status": "pass",
      "reason": "GitHub AI findings panel shows no open findings.",
      "checked_at": "2026-03-26T06:03:00Z",
      "checked_by": "maintainer",
      "evidence": [
        "screenshots/github-ai-findings.png"
      ]
    }
  }
}
```

## UI locations

- Social Preview:
  Repository `Settings` → `General` → `Social preview`
- Code Quality / AI Findings:
  Repository GitHub UI surfaces that show repository-level findings; capture the
  exact page title in the screenshot if the label differs

## Final check

After updating the manual evidence file, rerun:

```bash
just github-closure-report
```

The closure report should switch the relevant sections from `manual_required`
to `pass`, and the final verdict should only stay `closed_with_limitations` if
another unresolved section still remains.
