# Distribution Status

This page separates **repo-ready surfaces** from **actual published registry
state**.

Current public release truth:

- GitHub release/tag: `v0.1.1`
- GitHub Pages storefront: `https://xiaojiou176-open.github.io/webaudit/`
- GHCR Docker image public surface: **not currently evidenced as listed/live**;
  today
  `https://github.com/orgs/xiaojiou176-open/packages/container/package/webaudit-mcp-server`
  returns `404`, and the repo-filtered packages page
  `https://github.com/orgs/xiaojiou176-open/packages?repo_name=webaudit`
  reports `0 packages`
- npm / PyPI publication: **not yet published**
- Official MCP Registry listing: **not live yet** because upstream package
  `@webaudit/mcp-server` is still missing on npm

## Current Distribution Ledger

| Surface | Materialized in repo | Publish-ready today | Published / listed today | Notes |
| --- | --- | --- | --- | --- |
| GitHub release/tag | yes | yes | yes | Current live release/tag is `v0.1.1`. |
| GitHub Pages storefront | yes | yes | yes | Current live homepage points to GitHub Pages and returns HTTP 200. |
| Root npm package (`webaudit`) | yes | no | no | Root `package.json` is `private: true`, so the repo does not currently expose a publishable npm package. |
| MCP npm package (`@webaudit/mcp-server`) | yes | yes | no | The package now has a publish-ready contract, but it is **not yet published**. |
| AI prompts npm package (`@uiq/ai-prompts`) | yes | no | no | The package exists for repo-local use, but `packages/ai-prompts/package.json` is `private: true`. |
| PyPI package (`webaudit`) | yes | no | no | `pyproject.toml` exists, but this repo does not currently prove a PyPI release, and the Python package version is not release-synced with `v0.1.1`. |
| MCP Registry listing | partial | no | no | The repo now materializes `apps/mcp-server/server.json` as the registry submission artifact, but the npm package is still unpublished and no upstream listing proof exists. |
| OpenHands/extensions lane | yes | yes | no | External review receipt exists at PR `#161`, but `review-pending` is still not `listed-live`. |
| ClawHub skill page | yes | yes | yes | The Webaudit MCP skill page can be read back live at `https://clawhub.ai/xiaojiou176/webaudit-mcp`. |
| Webaudit MCP install skill | yes | yes | no | `skills/webaudit-mcp/` is materialized in the repo, but it is **not yet published** to any skill registry. |
| MCP Docker image (`ghcr.io/xiaojiou176-open/webaudit-mcp-server:0.1.1`) | yes | yes | no | The repo defines the GHCR container contract, but today `https://github.com/orgs/xiaojiou176-open/packages/container/package/webaudit-mcp-server` returns `404` and `https://github.com/orgs/xiaojiou176-open/packages?repo_name=webaudit` reports `0 packages`. Plain-English boundary: repo-ready container docs do **not** prove a live public GHCR package. |
| Starter / plugin bundle metadata | no dedicated surface | no | no | This repo still does not ship a dedicated starter bundle or browser-plugin distribution surface. |

## What "Ready" Means Here

For this repository, "ready for final distribution prep" means:

- the repo-side truth surface is explicit
- the GitHub storefront and closure evidence are aligned
- security and public-truth gates are green
- registry publication is still a separate later action

It does **not** mean that npm, PyPI, Official MCP Registry, or the GHCR public
package surface are already live just because the repo carries a Docker image
contract.

## Intentionally Deferred

These remain outside the current repo-side closeout scope:

- npm publication
- PyPI publication
- GHCR public package listing verification
- MCP Registry submission or listing verification
- MCP package publication read-back
- skill registry publication
- Chrome Web Store packaging or submission
- social preview upload evidence
- hosted / multi-tenant deployment rollout

## Why There Is No `proof.html`

This repo intentionally does **not** add a separate `proof.html` truth surface
right now.

Reason:

- the README already owns the storefront story
- `docs/index.md` already owns the public docs map
- this page and `INTEGRATIONS.md` now own the distribution and integration truth
- adding one more HTML proof page would create another drift-prone surface

That keeps the truth surface lighter and easier to keep honest.
