# Storefront Assets

This directory documents the reviewable source assets for Proofyard's public
storefront.

## Current asset set

- `../../assets/storefront/proofyard-social-preview.svg`
  - Purpose: GitHub social preview source asset
  - Message: one public command, one evidence trail, one recovery story
- `../../assets/storefront/proofyard-social-preview.png`
  - Purpose: GitHub-upload-ready social preview asset derived from a real product view
  - Message: the operator UI, evidence-first workflow, and parameter rail are visible in one frame
- `../../assets/storefront/proofyard-hero.png`
  - Purpose: README hero asset based on the real product UI
  - Message: start from the canonical run path, keep the parameter rail visible, and move into evidence review without leaving the product shell
- `../../assets/storefront/proofyard-hero.svg`
  - Purpose: legacy concept-art hero retained as a reviewable storefront draft
  - Message: original synthetic storefront concept before the real UI screenshot replaced it in README
- `../../assets/storefront/proofyard-readme-hero.svg`
  - Purpose: current README and docs-hub proof-loop visual
  - Message: `just run -> retained evidence bundle -> recover exact failed step`
- `../../assets/storefront/proofyard-agent-ecosystem-map.svg`
  - Purpose: README ecosystem-fit visual for coding-agent and agent-stack discovery
  - Message: which named ecosystems are MCP-first, API-first, or hybrid while Proofyard stays the browser-evidence layer

## Source of truth

The current storefront asset set is intentionally split:

- real product screenshots are the public-facing truth for README / GitHub preview
- one SVG proof-loop visual explains the core product rhythm before the screenshot
- SVG concept art stays as an auditable draft reference, not as the primary hero
- tracked PNG storefront assets are an explicit public-surface exception, not an accidental heavy-artifact leak

The copy is grounded in:

- `README.md` for the public name and value promise
- `apps/web/src/views/QuickLaunchView.tsx` for the quick-start command deck
- `apps/web/src/views/FlowWorkshopView.tsx` for evidence review and resumable
  recovery

## Replacement slots

- Upload `../../assets/storefront/proofyard-social-preview.png` in GitHub
  Settings while keeping the SVG as the reviewable source of truth.
- Keep filenames stable unless the README and Settings references change.
