#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

repo="${1:-xiaojiou176-open/webaudit}"
output_json=0

if [[ "${1:-}" == "--json" ]]; then
  output_json=1
  repo="${2:-xiaojiou176-open/webaudit}"
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh is required"
  exit 2
fi

json="$(gh api "repos/${repo}")"
community_json="$(gh api "repos/${repo}/community/profile")"
pages_json="$(gh api "repos/${repo}/pages")"
releases_count="$(gh api "repos/${repo}/releases" --jq 'length')"

repo_owner="${repo%%/*}"
repo_name="${repo##*/}"
expected_homepage="https://${repo_owner}.github.io/${repo_name}/"

description="$(jq -r '.description // ""' <<<"$json")"
homepage="$(jq -r '.homepage // ""' <<<"$json")"
has_issues="$(jq -r '.has_issues' <<<"$json")"
has_discussions="$(jq -r '.has_discussions' <<<"$json")"
topics="$(jq -r '.topics | join(",")' <<<"$json")"
health_percentage="$(jq -r '.health_percentage // 0' <<<"$community_json")"
content_reports_enabled="$(jq -r '.content_reports_enabled' <<<"$community_json")"
pages_url="$(jq -r '.html_url // ""' <<<"$pages_json")"
pages_build_status="$(jq -r '.status // ""' <<<"$pages_json")"
pages_https_enforced="$(jq -r '.https_enforced // false' <<<"$pages_json")"
pages_http_status="$(curl -fsS -o /dev/null -w '%{http_code}' "$expected_homepage")"

social_preview_asset="assets/storefront/webaudit-social-preview.png"
social_preview_exists="false"
if [[ -f "$social_preview_asset" ]]; then
  social_preview_exists="true"
fi

required_topics=(
  ai-agents
  coding-agents
  codex
  browser-automation
  developer-tools
  e2e-testing
  fastapi
  mcp
  model-context-protocol
  openapi
  playwright
  reproducibility
  workflow-automation
)

description_status="pass"
description_reason="description aligned to storefront copy"
if [[ "$description" != "Evidence-first browser automation for AI agents and operators, with recovery and MCP." ]]; then
  description_status="fail"
  description_reason="description is not aligned to storefront copy"
fi

discussions_status="pass"
discussions_reason="discussions enabled"
if [[ "$has_discussions" != "true" ]]; then
  discussions_status="fail"
  discussions_reason="discussions are not enabled"
fi

issues_status="pass"
issues_reason="issues enabled"
if [[ "$has_issues" != "true" ]]; then
  issues_status="fail"
  issues_reason="issues are not enabled"
fi

homepage_status="pass"
homepage_reason="homepage aligned to GitHub Pages"
if [[ "$homepage" != "$expected_homepage" ]]; then
  homepage_status="fail"
  homepage_reason="homepage is not aligned to the GitHub Pages URL"
fi

pages_status="pass"
pages_reason="GitHub Pages points to the canonical URL and returns HTTP 200"
if [[ "$pages_url" != "$expected_homepage" ]]; then
  pages_status="fail"
  pages_reason="GitHub Pages html_url is not aligned to the canonical GitHub Pages URL"
elif [[ "$pages_build_status" != "built" ]]; then
  pages_status="fail"
  pages_reason="GitHub Pages is not in built status"
elif [[ "$pages_https_enforced" != "true" ]]; then
  pages_status="fail"
  pages_reason="GitHub Pages does not enforce HTTPS"
elif [[ "$pages_http_status" != "200" ]]; then
  pages_status="fail"
  pages_reason="GitHub Pages does not return HTTP 200"
fi

topics_status="pass"
topics_reason="all storefront topics are present"
missing_topics=()
for topic in "${required_topics[@]}"; do
  if [[ ",${topics}," != *",${topic},"* ]]; then
    missing_topics+=("$topic")
  fi
done
if (( ${#missing_topics[@]} > 0 )); then
  topics_status="fail"
  topics_reason="missing topic(s): ${missing_topics[*]}"
fi

releases_status="pass"
releases_reason="at least one release exists"
if [[ "${releases_count}" == "0" ]]; then
  releases_status="fail"
  releases_reason="at least one release is required"
fi

social_preview_status="manual_required"
social_preview_reason="verify GitHub Social Preview uses assets/storefront/webaudit-social-preview.png"
if [[ "$social_preview_exists" != "true" ]]; then
  social_preview_status="fail"
  social_preview_reason="missing repo social preview asset assets/storefront/webaudit-social-preview.png"
elif [[ "$(jq -r '.open_graph_image_url // ""' <<<"$json")" == "" ]]; then
  social_preview_status="manual_required"
  social_preview_reason="GitHub does not expose a stable API proof for Social Preview; confirm the UI state with manual evidence"
fi

community_status="pass"
community_reason="community profile is complete"
community_classification="pass"
if [[ "$health_percentage" != "100" ]]; then
  if [[ "$content_reports_enabled" != "true" ]]; then
    community_status="manual_required"
    community_reason="community profile incomplete because GitHub content reports are disabled"
    community_classification="platform_setting_required"
  else
    community_status="fail"
    community_reason="community profile is below 100% for repo-fixable reasons"
    community_classification="repo_fixable"
  fi
fi

overall_status="pass"
for status in \
  "$description_status" \
  "$discussions_status" \
  "$issues_status" \
  "$homepage_status" \
  "$pages_status" \
  "$topics_status" \
  "$releases_status" \
  "$social_preview_status" \
  "$community_status"; do
  if [[ "$status" == "fail" ]]; then
    overall_status="fail"
    break
  fi
  if [[ "$status" == "manual_required" && "$overall_status" != "fail" ]]; then
    overall_status="manual_required"
  fi
done

if (( output_json == 1 )); then
  jq -n \
    --arg repo "$repo" \
    --arg description "$description" \
    --arg homepage "$homepage" \
    --arg expected_homepage "$expected_homepage" \
    --arg has_issues "$has_issues" \
    --arg has_discussions "$has_discussions" \
    --arg topics "$topics" \
    --arg pages_url "$pages_url" \
    --arg pages_build_status "$pages_build_status" \
    --arg pages_https_enforced "$pages_https_enforced" \
    --arg pages_http_status "$pages_http_status" \
    --argjson releases_count "$releases_count" \
    --argjson health_percentage "$health_percentage" \
    --arg content_reports_enabled "$content_reports_enabled" \
    --arg social_preview_asset "$social_preview_asset" \
    --arg social_preview_exists "$social_preview_exists" \
    --arg overall_status "$overall_status" \
    --arg description_status "$description_status" \
    --arg description_reason "$description_reason" \
    --arg discussions_status "$discussions_status" \
    --arg discussions_reason "$discussions_reason" \
    --arg issues_status "$issues_status" \
    --arg issues_reason "$issues_reason" \
    --arg homepage_status "$homepage_status" \
    --arg homepage_reason "$homepage_reason" \
    --arg pages_status "$pages_status" \
    --arg pages_reason "$pages_reason" \
    --arg topics_status "$topics_status" \
    --arg topics_reason "$topics_reason" \
    --arg releases_status "$releases_status" \
    --arg releases_reason "$releases_reason" \
    --arg social_preview_status "$social_preview_status" \
    --arg social_preview_reason "$social_preview_reason" \
    --arg community_status "$community_status" \
    --arg community_reason "$community_reason" \
    --arg community_classification "$community_classification" \
    --argjson missing_topics "$(printf '%s\n' "${missing_topics[@]-}" | jq -R . | jq -s 'map(select(length>0))')" \
    '{
      version: 1,
      repo: $repo,
      overall_status: $overall_status,
      repo_metadata: {
        description: $description,
        homepage: $homepage,
        expected_homepage: $expected_homepage,
        has_issues: ($has_issues == "true"),
        has_discussions: ($has_discussions == "true"),
        topics: ($topics | if length == 0 then [] else split(",") end),
        releases_count: $releases_count,
        pages_url: $pages_url,
        pages_build_status: $pages_build_status,
        pages_https_enforced: ($pages_https_enforced == "true"),
        pages_http_status: ($pages_http_status | tonumber)
      },
      checks: {
        description: {
          status: $description_status,
          reason: $description_reason
        },
        discussions: {
          status: $discussions_status,
          reason: $discussions_reason
        },
        issues: {
          status: $issues_status,
          reason: $issues_reason
        },
        homepage: {
          status: $homepage_status,
          reason: $homepage_reason
        },
        pages: {
          status: $pages_status,
          reason: $pages_reason,
          expected_url: $expected_homepage,
          actual_url: $pages_url,
          build_status: $pages_build_status,
          https_enforced: ($pages_https_enforced == "true"),
          http_status: ($pages_http_status | tonumber)
        },
        topics: {
          status: $topics_status,
          reason: $topics_reason,
          missing_topics: $missing_topics
        },
        releases: {
          status: $releases_status,
          reason: $releases_reason,
          actual: $releases_count,
          expected_min: 1
        },
        social_preview: {
          status: $social_preview_status,
          reason: $social_preview_reason,
          repo_asset: $social_preview_asset,
          repo_asset_exists: ($social_preview_exists == "true")
        },
        community_profile: {
          status: $community_status,
          reason: $community_reason,
          health_percentage: $health_percentage,
          content_reports_enabled: ($content_reports_enabled == "true"),
          classification: $community_classification
        }
      }
    }'
  exit 0
fi

echo "repo=${repo}"
echo "description=${description}"
echo "homepage=${homepage}"
echo "expected_homepage=${expected_homepage}"
echo "has_issues=${has_issues}"
echo "has_discussions=${has_discussions}"
echo "pages_url=${pages_url}"
echo "pages_build_status=${pages_build_status}"
echo "pages_http_status=${pages_http_status}"
echo "topics=${topics}"
echo "releases=${releases_count}"
echo "community_health=${health_percentage}"
echo "content_reports_enabled=${content_reports_enabled}"

failures=0
manual_required=0

if [[ "$description_status" == "fail" ]]; then
  echo "fail: ${description_reason}"
  failures=$((failures + 1))
fi

if [[ "$discussions_status" == "fail" ]]; then
  echo "fail: ${discussions_reason}"
  failures=$((failures + 1))
fi

if [[ "$issues_status" == "fail" ]]; then
  echo "fail: ${issues_reason}"
  failures=$((failures + 1))
fi

if [[ "$homepage_status" == "fail" ]]; then
  echo "fail: ${homepage_reason}"
  failures=$((failures + 1))
fi

if [[ "$pages_status" == "fail" ]]; then
  echo "fail: ${pages_reason}"
  failures=$((failures + 1))
fi

if [[ "$topics_status" == "fail" ]]; then
  echo "fail: ${topics_reason}"
  failures=$((failures + 1))
fi

if [[ "$releases_status" == "fail" ]]; then
  echo "fail: ${releases_reason}"
  failures=$((failures + 1))
fi

if [[ "$social_preview_status" == "fail" ]]; then
  echo "fail: ${social_preview_reason}"
  failures=$((failures + 1))
elif [[ "$social_preview_status" == "manual_required" ]]; then
  echo "manual_required: ${social_preview_reason}"
  manual_required=$((manual_required + 1))
fi

if [[ "$community_status" == "fail" ]]; then
  echo "fail: ${community_reason}"
  failures=$((failures + 1))
elif [[ "$community_status" == "manual_required" ]]; then
  echo "manual_required: ${community_reason} (${community_classification})"
  manual_required=$((manual_required + 1))
fi

if ((failures > 0)); then
  exit 1
fi

if ((manual_required > 0)); then
  echo "storefront-settings ok (manual checks remaining)"
else
  echo "storefront-settings ok"
fi
