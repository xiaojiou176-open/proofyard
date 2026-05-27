#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/proofyard-github-closure-XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

fake_bin="$tmp_dir/bin"
mkdir -p "$fake_bin"

cat > "$fake_bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" != "api" ]]; then
  echo "unsupported gh usage" >&2
  exit 2
fi

shift
endpoint="$1"
shift || true

case "$endpoint" in
  repos/xiaojiou176-open/proofyard)
    cat <<'JSON'
{"name":"proofyard","description":"Evidence-first browser automation for AI agents and operators, with recovery and MCP.","homepage":"https://github.com/xiaojiou176-open/proofyard/blob/main/docs/index.md","has_discussions":true,"topics":["ai-agents","coding-agents","codex","browser-automation","developer-tools","e2e-testing","fastapi","mcp","model-context-protocol","openapi","playwright","reproducibility","workflow-automation"],"default_branch":"main","open_issues_count":0,"owner":{"login":"xiaojiou176-open","type":"Organization"}}
JSON
    ;;
  orgs/xiaojiou176-open)
    cat <<'JSON'
{"login":"xiaojiou176-open","plan":{"name":"free"}}
JSON
    ;;
  repos/xiaojiou176-open/proofyard/releases)
    if [[ "${1:-}" == "--jq" ]]; then
      echo "1"
    else
      cat <<'JSON'
[{"id":1}]
JSON
    fi
    ;;
  repos/xiaojiou176-open/proofyard/community/profile)
    cat <<'JSON'
{"health_percentage":87,"content_reports_enabled":false,"files":{"issue_template":{"url":"https://example.com/issue-template"},"pull_request_template":{"url":"https://example.com/pr-template"},"readme":{"url":"https://example.com/readme"},"license":{"url":"https://example.com/license"},"contributing":{"url":"https://example.com/contributing"},"code_of_conduct":{"url":"https://example.com/coc"}}}
JSON
    ;;
  "repos/xiaojiou176-open/proofyard/code-scanning/alerts?state=open")
    echo "0"
    ;;
  "repos/xiaojiou176-open/proofyard/secret-scanning/alerts?state=open")
    echo "0"
    ;;
  "repos/xiaojiou176-open/proofyard/dependabot/alerts?state=open")
    echo "0"
    ;;
  *)
    echo "unexpected endpoint: $endpoint" >&2
    exit 3
    ;;
esac
EOF
chmod +x "$fake_bin/gh"

template_path="$tmp_dir/social-preview-template.json"
template_output="$(python3 -B scripts/github/write-social-preview-manual-evidence-template.py --output "$template_path" --checked-by-placeholder tester)"
TEMPLATE_OUTPUT="$template_output" TEMPLATE_PATH="$template_path" python3 - <<'PY'
import json, os
from pathlib import Path
assert Path(os.environ["TEMPLATE_OUTPUT"]).resolve() == Path(os.environ["TEMPLATE_PATH"]).resolve()
payload = json.loads(Path(os.environ["TEMPLATE_PATH"]).read_text(encoding="utf-8"))
section = payload["sections"]["social_preview"]
assert payload["version"] == 1
assert section["status"] == "manual_required"
assert section["checked_by"] == "tester"
assert section["evidence"] == ["screenshots/github-social-preview.png"]
PY

template_pass_path="$tmp_dir/social-preview-template-pass.json"
python3 -B scripts/github/write-social-preview-manual-evidence-template.py \
  --output "$template_pass_path" \
  --checked-by-placeholder tester \
  --status pass >/dev/null
TEMPLATE_PASS_PATH="$template_pass_path" python3 - <<'PY'
import json, os
from pathlib import Path
payload = json.loads(Path(os.environ["TEMPLATE_PASS_PATH"]).read_text(encoding="utf-8"))
section = payload["sections"]["social_preview"]
assert section["status"] == "pass"
assert section["checked_by"] == "tester"
assert section["checked_at"]
assert section["evidence"] == ["screenshots/github-social-preview.png"]
PY

storefront_output="$(PATH="$fake_bin:$PATH" bash scripts/github/check-storefront-settings.sh --json xiaojiou176-open/proofyard)"
STORE="$storefront_output" python3 - <<'PY'
import json, os
payload = json.loads(os.environ["STORE"])
assert payload["checks"]["releases"]["status"] == "pass"
assert payload["checks"]["social_preview"]["status"] == "manual_required"
assert payload["checks"]["community_profile"]["status"] == "manual_required"
assert payload["checks"]["community_profile"]["classification"] == "platform_setting_required"
PY

report_output="$(PATH="$fake_bin:$PATH" python3 -B scripts/github/collect-closure-evidence.py --repo xiaojiou176-open/proofyard)"
REPORT="$report_output" python3 - <<'PY'
import json, os
payload = json.loads(os.environ["REPORT"])
assert payload["security"]["dependabot"]["status"] == "pass"
assert payload["security"]["code_scanning"]["status"] == "pass"
assert payload["security"]["secret_scanning"]["status"] == "pass"
assert payload["manual_evidence"]["sections"]["content_reports"]["status"] == "manual_required"
assert payload["manual_evidence"]["sections"]["code_quality"]["status"] == "pass"
assert payload["manual_evidence"]["sections"]["code_quality"]["availability"] == "not_applicable"
assert payload["manual_evidence"]["sections"]["ai_findings"]["status"] == "pass"
assert payload["manual_evidence"]["sections"]["ai_findings"]["availability"] == "not_applicable"
assert payload["verdict"] == "closed_with_limitations"
PY

mkdir -p "$tmp_dir/manual"
cat > "$tmp_dir/manual/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" != "api" ]]; then
  echo "unsupported gh usage" >&2
  exit 2
fi

shift
endpoint="$1"
shift || true

case "$endpoint" in
  repos/xiaojiou176-open/proofyard)
    cat <<'JSON'
{"name":"proofyard","description":"Evidence-first browser automation for AI agents and operators, with recovery and MCP.","homepage":"https://github.com/xiaojiou176-open/proofyard/blob/main/docs/index.md","has_discussions":true,"topics":["ai-agents","coding-agents","codex","browser-automation","developer-tools","e2e-testing","fastapi","mcp","model-context-protocol","openapi","playwright","reproducibility","workflow-automation"],"default_branch":"main","open_issues_count":0,"owner":{"login":"xiaojiou176-open","type":"Organization"}}
JSON
    ;;
  orgs/xiaojiou176-open)
    cat <<'JSON'
{"login":"xiaojiou176-open","plan":{"name":"free"}}
JSON
    ;;
  repos/xiaojiou176-open/proofyard/releases)
    if [[ "${1:-}" == "--jq" ]]; then
      echo "1"
    else
      cat <<'JSON'
[{"id":1}]
JSON
    fi
    ;;
  repos/xiaojiou176-open/proofyard/community/profile)
    cat <<'JSON'
{"health_percentage":100,"content_reports_enabled":true,"files":{"issue_template":{"url":"https://example.com/issue-template"},"pull_request_template":{"url":"https://example.com/pr-template"},"readme":{"url":"https://example.com/readme"},"license":{"url":"https://example.com/license"},"contributing":{"url":"https://example.com/contributing"},"code_of_conduct":{"url":"https://example.com/coc"}}}
JSON
    ;;
  "repos/xiaojiou176-open/proofyard/code-scanning/alerts?state=open")
    echo "0"
    ;;
  "repos/xiaojiou176-open/proofyard/secret-scanning/alerts?state=open")
    echo "0"
    ;;
  "repos/xiaojiou176-open/proofyard/dependabot/alerts?state=open")
    echo "0"
    ;;
  *)
    echo "unexpected endpoint: $endpoint" >&2
    exit 3
    ;;
esac
EOF
chmod +x "$tmp_dir/manual/gh"

pass_output="$(PATH="$tmp_dir/manual:$PATH" python3 -B scripts/github/collect-closure-evidence.py --repo xiaojiou176-open/proofyard)"
PASS_REPORT="$pass_output" python3 - <<'PY'
import json, os
payload = json.loads(os.environ["PASS_REPORT"])
assert payload["storefront"]["checks"]["community_profile"]["status"] == "pass"
assert payload["manual_evidence"]["sections"]["content_reports"]["status"] == "pass"
assert payload["manual_evidence"]["sections"]["content_reports"]["source"] == "automation"
assert payload["manual_evidence"]["sections"]["social_preview"]["status"] == "manual_required"
assert payload["effective_storefront"]["checks"]["social_preview"]["status"] == "manual_required"
assert payload["verdict"] == "closed_with_limitations"
PY

manual_evidence_path="$tmp_dir/github-closure-manual-evidence.json"
cat > "$manual_evidence_path" <<'JSON'
{
  "version": 1,
  "sections": {
    "social_preview": {
      "status": "pass",
      "reason": "GitHub Social Preview matches the tracked PNG asset.",
      "checked_at": "2026-03-26T10:00:00Z",
      "checked_by": "maintainer",
      "evidence": [
        "screenshots/github-social-preview.png"
      ]
    }
  }
}
JSON

resolved_output="$(PATH="$tmp_dir/manual:$PATH" python3 -B scripts/github/collect-closure-evidence.py --repo xiaojiou176-open/proofyard --manual-evidence "$manual_evidence_path")"
RESOLVED_REPORT="$resolved_output" python3 - <<'PY'
import json, os
payload = json.loads(os.environ["RESOLVED_REPORT"])
assert payload["manual_evidence"]["sections"]["social_preview"]["status"] == "pass"
assert payload["effective_storefront"]["checks"]["social_preview"]["status"] == "pass"
assert payload["status"]["storefront"] == "pass"
assert payload["status"]["manual_evidence"] == "pass"
assert payload["verdict"] == "closed_clean"
PY

invalid_manual_evidence_path="$tmp_dir/github-closure-manual-evidence-invalid.json"
cat > "$invalid_manual_evidence_path" <<'JSON'
{
  "version": 1,
  "sections": {
    "social_preview": {
      "status": "pass",
      "reason": "missing the audit metadata on purpose"
    }
  }
}
JSON

invalid_output="$(PATH="$tmp_dir/manual:$PATH" python3 -B scripts/github/collect-closure-evidence.py --repo xiaojiou176-open/proofyard --manual-evidence "$invalid_manual_evidence_path")"
INVALID_REPORT="$invalid_output" python3 - <<'PY'
import json, os
payload = json.loads(os.environ["INVALID_REPORT"])
assert payload["manual_evidence"]["sections"]["social_preview"]["status"] == "manual_required"
assert "missing required field(s)" in payload["manual_evidence"]["sections"]["social_preview"]["reason"]
assert payload["verdict"] == "closed_with_limitations"
PY

mkdir -p "$tmp_dir/missing-plan"
cat > "$tmp_dir/missing-plan/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" != "api" ]]; then
  echo "unsupported gh usage" >&2
  exit 2
fi

shift
endpoint="$1"
shift || true

case "$endpoint" in
  repos/xiaojiou176-open/proofyard)
    cat <<'JSON'
{"name":"proofyard","description":"Evidence-first browser automation for AI agents and operators, with recovery and MCP.","homepage":"https://github.com/xiaojiou176-open/proofyard/blob/main/docs/index.md","has_discussions":true,"topics":["ai-agents","coding-agents","codex","browser-automation","developer-tools","e2e-testing","fastapi","mcp","model-context-protocol","openapi","playwright","reproducibility","workflow-automation"],"default_branch":"main","open_issues_count":0,"owner":{"login":"xiaojiou176-open","type":"Organization"}}
JSON
    ;;
  orgs/xiaojiou176-open)
    cat <<'JSON'
{"login":"xiaojiou176-open","plan":{}}
JSON
    ;;
  repos/xiaojiou176-open/proofyard/releases)
    if [[ "${1:-}" == "--jq" ]]; then
      echo "1"
    else
      cat <<'JSON'
[{"id":1}]
JSON
    fi
    ;;
  repos/xiaojiou176-open/proofyard/community/profile)
    cat <<'JSON'
{"health_percentage":100,"content_reports_enabled":true,"files":{"issue_template":{"url":"https://example.com/issue-template"},"pull_request_template":{"url":"https://example.com/pr-template"},"readme":{"url":"https://example.com/readme"},"license":{"url":"https://example.com/license"},"contributing":{"url":"https://example.com/contributing"},"code_of_conduct":{"url":"https://example.com/coc"}}}
JSON
    ;;
  "repos/xiaojiou176-open/proofyard/code-scanning/alerts?state=open")
    echo "0"
    ;;
  "repos/xiaojiou176-open/proofyard/secret-scanning/alerts?state=open")
    echo "0"
    ;;
  "repos/xiaojiou176-open/proofyard/dependabot/alerts?state=open")
    echo "0"
    ;;
  *)
    echo "unexpected endpoint: $endpoint" >&2
    exit 3
    ;;
esac
EOF
chmod +x "$tmp_dir/missing-plan/gh"

missing_plan_output="$(PATH="$tmp_dir/missing-plan:$PATH" python3 -B scripts/github/collect-closure-evidence.py --repo xiaojiou176-open/proofyard)"
MISSING_PLAN_REPORT="$missing_plan_output" python3 - <<'PY'
import json, os
payload = json.loads(os.environ["MISSING_PLAN_REPORT"])
assert payload["platform_capabilities"]["org_plan_status"] == "resolved"
assert payload["platform_capabilities"]["org_plan"] is None
assert payload["manual_evidence"]["sections"]["code_quality"]["status"] == "manual_required"
assert payload["manual_evidence"]["sections"]["ai_findings"]["status"] == "manual_required"
assert "plan name" in payload["manual_evidence"]["sections"]["code_quality"]["reason"]
assert payload["verdict"] == "closed_with_limitations"
PY

echo "github-closure-evidence smoke passed"
