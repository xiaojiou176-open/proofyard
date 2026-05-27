#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

STRICT="${UIQ_OSS_AUDIT_STRICT:-false}"
SCANCODE_TOTAL_TIMEOUT_SECONDS="${UIQ_OSS_AUDIT_SCANCODE_TOTAL_TIMEOUT_SEC:-10}"
SCANCODE_STRICT_TOTAL_TIMEOUT_SECONDS="${UIQ_OSS_AUDIT_SCANCODE_STRICT_TIMEOUT_SEC:-120}"
PRESIDIO_TOTAL_TIMEOUT_SECONDS="${UIQ_OSS_AUDIT_PRESIDIO_TIMEOUT_SEC:-60}"
SCANCODE_SNAPSHOT_PATH="${UIQ_SCANCODE_SNAPSHOT_PATH:-reports/licenses-scan.json}"
SCANCODE_SNAPSHOT_META_PATH="${UIQ_SCANCODE_SNAPSHOT_META_PATH:-reports/licenses-scan.meta.json}"
tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/webaudit-oss-audit.XXXXXX")"
trap 'rm -rf "$tmpdir"' EXIT

failures=0
warnings=0

pass() {
  echo "[oss-redaction-tooling] PASS: $1"
}

warn() {
  echo "[oss-redaction-tooling] WARN: $1" >&2
  warnings=$((warnings + 1))
}

fail() {
  echo "[oss-redaction-tooling] FAIL: $1" >&2
  failures=$((failures + 1))
}

strict_fail_or_warn() {
  local message="$1"
  if [[ "$STRICT" == "true" ]]; then
    fail "$message"
  else
    warn "$message"
  fi
}

run_with_python_timeout() {
  local timeout_seconds="$1"
  shift

  python3 - <<'PY' "$timeout_seconds" "$@"
import subprocess
import sys

timeout = int(sys.argv[1])
command = sys.argv[2:]

try:
    completed = subprocess.run(command, timeout=timeout)
except subprocess.TimeoutExpired:
    sys.exit(124)
except KeyboardInterrupt:
    sys.exit(130)

sys.exit(completed.returncode)
PY
}

require_cmd() {
  local tool="$1"
  if command -v "$tool" >/dev/null 2>&1; then
    return 0
  fi
  if [[ "$STRICT" == "true" ]]; then
    fail "required tool missing: $tool"
  else
    warn "tool unavailable, skipping: $tool"
  fi
  return 1
}

node --input-type=module - "$tmpdir/public-targets.txt" "$tmpdir/public-history-regex.txt" <<'JS'
import fs from "node:fs"
import { canonicalPublicFiles, collectTrackedPublicSurfaceTargets, escapeRegex } from "./scripts/ci/lib/public-surface-targets.mjs"

const [targetsOut, historyOut] = process.argv.slice(2)
const targets = collectTrackedPublicSurfaceTargets()
fs.writeFileSync(targetsOut, `${targets.join("\n")}\n`, "utf8")
const regexLines = canonicalPublicFiles.map((target) => `^${escapeRegex(target)}$`)
fs.writeFileSync(historyOut, `${regexLines.join("\n")}\n`, "utf8")
JS

run_trufflehog() {
  require_cmd trufflehog || return 0

  local filesystem_json="$tmpdir/trufflehog-filesystem.jsonl"
  local filesystem_err="$tmpdir/trufflehog-filesystem.stderr"
  local history_json="$tmpdir/trufflehog-history.jsonl"
  local history_err="$tmpdir/trufflehog-history.stderr"
  local -a public_targets=()
  local rc=0

  while IFS= read -r target; do
    if [[ -n "$target" ]]; then
      public_targets+=("$target")
    fi
  done < "$tmpdir/public-targets.txt"
  if (( ${#public_targets[@]} == 0 )); then
    warn "no tracked public-surface targets found for trufflehog scan"
    return 0
  fi

  set +e
  trufflehog filesystem \
    --no-update \
    --no-verification \
    --json \
    --results=verified,unverified,unknown \
    --fail \
    "${public_targets[@]}" >"$filesystem_json" 2>"$filesystem_err"
  rc=$?
  set -e
  if [[ $rc -eq 183 ]]; then
    fail "trufflehog filesystem found candidate secrets on tracked public surfaces"
    python3 - <<'PY' "$filesystem_json"
import json
import sys
from pathlib import Path

for raw in Path(sys.argv[1]).read_text().splitlines()[:10]:
    if not raw.strip():
        continue
    item = json.loads(raw)
    meta = ((item.get("SourceMetadata") or {}).get("Data") or {}).get("Filesystem") or {}
    print(f"  - {item.get('DetectorName')} :: {meta.get('file')}:{meta.get('line')}")
PY
  elif [[ $rc -ne 0 ]]; then
    fail "trufflehog filesystem scan failed"
    sed -n '1,40p' "$filesystem_err" >&2 || true
  else
    pass "trufflehog filesystem public surface clean"
  fi

  set +e
  trufflehog git "file://$PWD" \
    --no-update \
    --no-verification \
    --json \
    --results=verified,unverified,unknown \
    --include-paths="$tmpdir/public-history-regex.txt" \
    --fail >"$history_json" 2>"$history_err"
  rc=$?
  set -e
  if [[ $rc -eq 183 ]]; then
    fail "trufflehog git found candidate secrets in public-surface history"
    python3 - <<'PY' "$history_json"
import json
import sys
from pathlib import Path

for raw in Path(sys.argv[1]).read_text().splitlines()[:10]:
    if not raw.strip():
        continue
    item = json.loads(raw)
    meta = ((item.get("SourceMetadata") or {}).get("Data") or {}).get("Git") or {}
    print(f"  - {item.get('DetectorName')} :: {meta.get('file')} @ {meta.get('commit')}")
PY
  elif [[ $rc -ne 0 ]]; then
    fail "trufflehog git history scan failed"
    sed -n '1,40p' "$history_err" >&2 || true
  else
    pass "trufflehog public history clean"
  fi
}

run_git_secrets() {
  require_cmd git-secrets || return 0

  local -a git_cfg=(
    -c "secrets.patterns=AKIA[0-9A-Z]{16}"
    -c "secrets.patterns=gh[pousr]_[A-Za-z0-9]{20,}"
    -c "secrets.patterns=(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}"
    -c "secrets.allowed=SCRUBBED_"
    -c "secrets.allowed=PLACEHOLDER_"
    -c "secrets.allowed=TEST_"
    -c "secrets.allowed=EXAMPLE_"
    -c "secrets.allowed=example\\.com"
    -c "secrets.allowed=example\\.invalid"
    -c "secrets.allowed=\\*\\*\\*@\\*\\*\\*"
    -c "secrets.allowed=@maintainers"
  )

  local history_out="$tmpdir/git-secrets-history.out"
  local rc=0
  set +e
  # Keep this as a repo-wide high-confidence tripwire rather than a broad public-surface mirror.
  git "${git_cfg[@]}" secrets --scan-history >"$history_out" 2>&1
  rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then
    fail "git-secrets history scan failed"
    sed -n '1,40p' "$history_out" >&2 || true
  else
    pass "git-secrets history clean for repo-specific patterns"
  fi
}

run_presidio() {
  local presidio_out="$tmpdir/presidio-findings.json"
  local presidio_script="$tmpdir/presidio-scan.py"
  cat >"$presidio_script" <<'PY'
from pathlib import Path
import json
import re
import sys

targets_path = Path(sys.argv[1])
output_path = Path(sys.argv[2])
targets = [line.strip() for line in targets_path.read_text(encoding="utf-8").splitlines() if line.strip()]
engine = None
high_signal = {
    "EMAIL_ADDRESS",
    "PHONE_NUMBER",
    "CREDIT_CARD",
    "CRYPTO",
    "IBAN_CODE",
    "US_BANK_NUMBER",
    "US_PASSPORT",
    "US_SSN",
}
placeholder_email = re.compile(r"@example\.(com|invalid)$", re.IGNORECASE)
technical_numeric_sentinels = {"2147483647", "9223372036854775807"}
loopback_ip = re.compile(r"^127(?:\.\d{1,3}){3}$")
private_ip = re.compile(r"^(?:10|192\.168|172\.(?:1[6-9]|2\d|3[0-1]))(?:\.\d{1,3}){2}$")
fallback_patterns = {
    "EMAIL_ADDRESS": re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
    "PHONE_NUMBER": re.compile(r"\b(?:\+?\d[\d(). -]{7,}\d)\b"),
    "CREDIT_CARD": re.compile(r"\b(?:\d[ -]?){13,19}\b"),
    "US_SSN": re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    "IBAN_CODE": re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b", re.IGNORECASE),
}
findings = []

if not bool(int(__import__("os").environ.get("UIQ_FORCE_REGEX_PII_FALLBACK", "0"))):
    try:
        from presidio_analyzer import AnalyzerEngine
        engine = AnalyzerEngine()
    except Exception:
        engine = None


def collect_with_regex(target: str, text: str) -> None:
    for entity, pattern in fallback_patterns.items():
        for match in pattern.finditer(text[:120000]):
            sample = match.group(0)
            lowered = sample.lower()
            if entity == "EMAIL_ADDRESS" and (placeholder_email.search(lowered) or "***@***" in lowered):
                continue
            if entity == "PHONE_NUMBER" and (
                sample in technical_numeric_sentinels
                or loopback_ip.match(sample)
                or private_ip.match(sample)
            ):
                continue
            findings.append(
                {
                    "path": target,
                    "entity": entity,
                    "sample": sample[:80],
                    "detector": "regex-fallback",
                }
            )

for target in targets:
    path = Path(target)
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        continue
    if not text.strip():
        continue
    if engine is None:
        collect_with_regex(target, text)
        continue
    try:
        results = engine.analyze(text=text[:120000], language="en")
    except Exception:
        collect_with_regex(target, text)
        continue
    for result in results:
        if result.entity_type not in high_signal:
            continue
        sample = text[result.start:result.end]
        if result.entity_type == "EMAIL_ADDRESS":
            lowered = sample.lower()
            if placeholder_email.search(lowered) or "***@***" in lowered:
                continue
        if result.entity_type in {"PHONE_NUMBER", "US_BANK_NUMBER"} and (
            sample in technical_numeric_sentinels
            or loopback_ip.match(sample)
            or private_ip.match(sample)
        ):
            continue
        findings.append(
            {
                "path": target,
                "entity": result.entity_type,
                "sample": sample[:80],
                "detector": "presidio",
            }
        )

output_path.write_text(json.dumps(findings, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"count": len(findings), "sample": findings[:10]}, ensure_ascii=False, indent=2))
PY

  local rc=0
  if command -v uvx >/dev/null 2>&1; then
    set +e
    run_with_python_timeout "$PRESIDIO_TOTAL_TIMEOUT_SECONDS" \
      env UIQ_FORCE_REGEX_PII_FALLBACK=0 \
      uvx --from presidio-analyzer python "$presidio_script" "$tmpdir/public-targets.txt" "$presidio_out"
    rc=$?
    set -e
    if [[ $rc -eq 124 ]]; then
      warn "presidio analyzer timed out after ${PRESIDIO_TOTAL_TIMEOUT_SECONDS}s; falling back to regex-only scan"
      UIQ_FORCE_REGEX_PII_FALLBACK=1 python3 "$presidio_script" "$tmpdir/public-targets.txt" "$presidio_out"
    elif [[ $rc -ne 0 ]]; then
      warn "presidio analyzer bootstrap failed; falling back to regex-only scan"
      UIQ_FORCE_REGEX_PII_FALLBACK=1 python3 "$presidio_script" "$tmpdir/public-targets.txt" "$presidio_out"
    fi
  else
    warn "uvx unavailable for presidio analyzer bootstrap; falling back to regex-only scan"
    UIQ_FORCE_REGEX_PII_FALLBACK=1 python3 "$presidio_script" "$tmpdir/public-targets.txt" "$presidio_out"
  fi

  local finding_count
  finding_count="$(python3 - <<'PY' "$presidio_out"
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
print(len(payload))
PY
)"

  if [[ "$finding_count" != "0" ]]; then
    fail "presidio found high-signal PII candidates on tracked public surfaces"
    sed -n '1,80p' "$presidio_out" >&2 || true
  else
    pass "presidio high-signal public surface scan clean"
  fi
}

run_scancode() {
  local -a targets=(
    "LICENSE"
    "package.json"
    "pyproject.toml"
    "apps/web/package.json"
    "apps/automation-runner/package.json"
    "apps/mcp-server/package.json"
  )
  local -a existing_targets=()
  local strict_live_scan=false
  for target in "${targets[@]}"; do
    if [[ -f "$target" ]]; then
      existing_targets+=("$target")
    fi
  done

  validate_scancode_snapshot() {
    python3 - <<'PY' "$SCANCODE_SNAPSHOT_PATH" "$SCANCODE_SNAPSHOT_META_PATH" "${existing_targets[@]}"
import json
import sys
from pathlib import Path

snapshot_path = Path(sys.argv[1])
meta_path = Path(sys.argv[2])
targets = sys.argv[3:]

if not snapshot_path.exists():
    raise SystemExit(f"missing ScanCode snapshot: {snapshot_path}")
if not meta_path.exists():
    raise SystemExit(f"missing ScanCode snapshot metadata: {meta_path}")

json.loads(snapshot_path.read_text(encoding="utf-8"))
meta = json.loads(meta_path.read_text(encoding="utf-8"))
if meta.get("version") != 1:
    raise SystemExit("ScanCode snapshot metadata must declare version=1")
if meta.get("targets") != targets:
    raise SystemExit("ScanCode snapshot targets drifted from current contract")

snapshot_mtime = snapshot_path.stat().st_mtime
for target in targets:
    target_path = Path(target)
    if not target_path.exists():
        raise SystemExit(f"ScanCode target missing: {target}")
    if target_path.stat().st_mtime > snapshot_mtime:
        raise SystemExit(f"ScanCode snapshot stale; regenerate after changes to {target}")
PY
  }

  if [[ "$STRICT" == "true" ]]; then
    if ! validate_scancode_snapshot; then
      warn "ScanCode snapshot missing or stale; regenerating via repo-owned snapshot generator"
      bash scripts/ci/generate-scancode-license-snapshot.sh
      validate_scancode_snapshot
      pass "scancode snapshot contract valid"
      return 0
    else
      pass "scancode snapshot contract valid"
      return 0
    fi
  fi

  require_cmd uvx || return 0

  local scancode_out="$tmpdir/scancode-core.json"
  local scancode_err="$tmpdir/scancode-core.stderr"
  local timeout_seconds="$SCANCODE_TOTAL_TIMEOUT_SECONDS"
  if [[ "$STRICT" == "true" ]]; then
    timeout_seconds="$SCANCODE_STRICT_TOTAL_TIMEOUT_SECONDS"
  fi

  local rc=0
  set +e
  run_with_python_timeout "$timeout_seconds" \
    uvx --from scancode-toolkit scancode \
    --license \
    --copyright \
    --processes 1 \
    --timeout 5 \
    --json "$scancode_out" \
    "${existing_targets[@]}" >"$tmpdir/scancode-core.stdout" 2>"$scancode_err"
  rc=$?
  set -e
  if [[ $rc -eq 124 ]]; then
    strict_fail_or_warn "scancode core manifest/license scan timed out after ${timeout_seconds}s"
    sed -n '1,80p' "$scancode_err" >&2 || true
    return 0
  fi
  if [[ $rc -ne 0 ]]; then
    strict_fail_or_warn "scancode core manifest/license scan failed"
    sed -n '1,80p' "$scancode_err" >&2 || true
    return 0
  fi

  local summary
  summary="$(python3 - <<'PY' "$scancode_out"
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
files = payload.get("files", [])
license_keys = set()
for item in files:
    for lic in item.get("licenses", []) or []:
        key = lic.get("spdx_license_key") or lic.get("key")
        if key:
            license_keys.add(key)
print(",".join(sorted(license_keys)[:12]))
PY
)"

  if [[ "$STRICT" == "true" && "$strict_live_scan" == "true" ]]; then
    mkdir -p "$(dirname "$SCANCODE_SNAPSHOT_PATH")"
    cp "$scancode_out" "$SCANCODE_SNAPSHOT_PATH"
    python3 - <<'PY' "$SCANCODE_SNAPSHOT_META_PATH" "${existing_targets[@]}"
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

meta_path = Path(sys.argv[1])
targets = sys.argv[2:]
payload = {
    "version": 1,
    "generatedAt": datetime.now(timezone.utc).isoformat(),
    "scanner": "uvx --from scancode-toolkit scancode",
    "targets": targets,
}
meta_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY
    validate_scancode_snapshot
    pass "scancode live scan regenerated snapshot"
    return 0
  fi

  pass "scancode core license surface scanned (${summary:-no-license-keys-reported})"
}

run_github_remote_status() {
  require_cmd gh || return 0

  local repo_json="$tmpdir/github-repo.json"
  local secret_out="$tmpdir/github-secret-scan.out"
  local code_out="$tmpdir/github-code-scan.out"
  local secret_alerts_json="$tmpdir/github-secret-alerts-open.json"
  local code_alerts_json="$tmpdir/github-code-alerts-open.json"
  local repo_id

  if ! gh repo view --json nameWithOwner,visibility,isPrivate,defaultBranchRef >"$repo_json" 2>/dev/null; then
    if [[ "$STRICT" == "true" ]]; then
      fail "gh repo view failed; cannot inspect remote GitHub security settings"
    else
      warn "gh repo view failed; skipping remote GitHub security check"
    fi
    return 0
  fi

  repo_id="$(python3 - <<'PY' "$repo_json"
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
print(payload["nameWithOwner"])
PY
)"

  local rc_secret=0
  local rc_code=0
  set +e
  gh api -H "Accept: application/vnd.github+json" "repos/${repo_id}/secret-scanning/alerts?per_page=1" >"$secret_out" 2>&1
  rc_secret=$?
  gh api -H "Accept: application/vnd.github+json" "repos/${repo_id}/code-scanning/alerts?per_page=1" >"$code_out" 2>&1
  rc_code=$?
  set -e

  if [[ $rc_secret -eq 0 ]]; then
    pass "GitHub secret scanning endpoint reachable"
    if gh api -H "Accept: application/vnd.github+json" "repos/${repo_id}/secret-scanning/alerts?state=open&per_page=100" >"$secret_alerts_json" 2>/dev/null; then
      local open_secret_alerts
      open_secret_alerts="$(python3 - <<'PY' "$secret_alerts_json"
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
print(len(payload))
PY
)"
      if [[ "$open_secret_alerts" -gt 0 ]]; then
        strict_fail_or_warn "GitHub secret scanning reports ${open_secret_alerts} open alert(s) on remote repository"
      else
        pass "GitHub secret scanning reports 0 open alerts"
      fi
    else
      strict_fail_or_warn "GitHub secret scanning open-alert query failed"
    fi
  else
    if grep -qi "disabled on this repository\|not available for this repository" "$secret_out"; then
      strict_fail_or_warn "GitHub secret scanning not enabled/available on remote repository"
    else
      strict_fail_or_warn "GitHub secret scanning endpoint check failed"
      sed -n '1,20p' "$secret_out" >&2 || true
    fi
  fi

  if [[ $rc_code -eq 0 ]]; then
    pass "GitHub code scanning endpoint reachable"
    if gh api -H "Accept: application/vnd.github+json" "repos/${repo_id}/code-scanning/alerts?state=open&per_page=100" >"$code_alerts_json" 2>/dev/null; then
      local open_code_alerts
      open_code_alerts="$(python3 - <<'PY' "$code_alerts_json"
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
print(len(payload))
PY
)"
      if [[ "$open_code_alerts" -gt 0 ]]; then
        strict_fail_or_warn "GitHub code scanning reports ${open_code_alerts} open alert(s) on remote repository"
      else
        pass "GitHub code scanning reports 0 open alerts"
      fi
    else
      strict_fail_or_warn "GitHub code scanning open-alert query failed"
    fi
  else
    if grep -qi "Advanced Security must be enabled" "$code_out"; then
      strict_fail_or_warn "GitHub code scanning unavailable because Advanced Security is not enabled"
    else
      strict_fail_or_warn "GitHub code scanning endpoint check failed"
      sed -n '1,20p' "$code_out" >&2 || true
    fi
  fi
}

run_trufflehog
run_git_secrets
run_presidio
run_scancode
run_github_remote_status

if (( failures > 0 )); then
  echo "[oss-redaction-tooling] failed with ${failures} issue(s) and ${warnings} warning(s)." >&2
  exit 1
fi

echo "[oss-redaction-tooling] ok (${warnings} warning(s))"
