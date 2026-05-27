#!/usr/bin/env bash
set -euo pipefail

repo="${GH_REPO:-xiaojiou176-open/webaudit}"
tag="${1:-}"

if [[ -z "$tag" ]]; then
  echo "usage: $0 <tag>"
  echo "example: $0 v0.1.0"
  exit 2
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh is required"
  exit 2
fi

if [[ -n "$(git status --short)" ]]; then
  echo "error: worktree is dirty; commit or stash changes before creating a GitHub release"
  exit 1
fi

default_branch="$(gh api "repos/${repo}" --jq '.default_branch')"
remote_sha="$(git ls-remote origin "refs/heads/${default_branch}" | awk '{print $1}')"
local_sha="$(git rev-parse HEAD)"

if [[ -z "$remote_sha" ]]; then
  echo "error: could not resolve remote default branch sha"
  exit 1
fi

if [[ "$local_sha" != "$remote_sha" ]]; then
  echo "error: local HEAD (${local_sha}) does not match origin/${default_branch} (${remote_sha})"
  echo "error: push the storefront changes first so the release points at the right code state"
  exit 1
fi

notes=".runtime-cache/artifacts/release/release-notes-vnext.md"
if [[ ! -f "$notes" ]]; then
  echo "error: release notes not found at ${notes}"
  echo "hint: run bash scripts/release/generate-release-notes.sh first"
  exit 1
fi

gh release create "$tag" \
  --repo "$repo" \
  --notes-file "$notes" \
  --target "$default_branch" \
  --draft

echo "draft release created for ${repo} tag=${tag}"
