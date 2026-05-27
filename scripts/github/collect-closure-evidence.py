#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO_DEFAULT = "xiaojiou176-open/proofyard"
SCRIPT_DIR = Path(__file__).resolve().parent
ROOT_DIR = SCRIPT_DIR.parents[1]
STORE_FRONTEND_SCRIPT = ROOT_DIR / "scripts" / "github" / "check-storefront-settings.sh"
MANUAL_EVIDENCE_DEFAULT = (
    ROOT_DIR / ".runtime-cache" / "artifacts" / "ci" / "github-closure-manual-evidence.json"
)
GITHUB_PLAN_REQUIREMENT = "GitHub Code Quality and AI findings require an organization-owned repository on GitHub Team or GitHub Enterprise Cloud."


def run_json_command(command: list[str]) -> Any:
    completed = subprocess.run(command, cwd=ROOT_DIR, capture_output=True, text=True)
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or completed.stdout.strip() or "command failed")
    return json.loads(completed.stdout)


def run_text_command(command: list[str]) -> str:
    completed = subprocess.run(command, cwd=ROOT_DIR, capture_output=True, text=True)
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or completed.stdout.strip() or "command failed")
    return completed.stdout.strip()


def load_manual_evidence(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("version") != 1:
        raise RuntimeError(f"manual evidence file must declare version=1: {path}")
    return payload


def manual_required_section(name: str, reason: str | None = None) -> dict[str, Any]:
    return {
        "status": "manual_required",
        "reason": reason or f"no manual evidence file found for {name}",
        "source": "manual",
    }


def automated_section(status: str, reason: str, **extra: Any) -> dict[str, Any]:
    payload = {
        "status": status,
        "reason": reason,
        "source": "automation",
    }
    payload.update(extra)
    return payload


def effective_manual_check(
    raw_check: dict[str, Any],
    resolved_section: dict[str, Any],
) -> dict[str, Any]:
    effective = dict(raw_check)
    if raw_check.get("status") == "manual_required" and resolved_section.get("status") in {
        "pass",
        "fail",
    }:
        effective["status"] = resolved_section["status"]
        effective["reason"] = resolved_section["reason"]
        effective["source"] = resolved_section.get("source", "manual")
        if "checked_at" in resolved_section:
            effective["checked_at"] = resolved_section.get("checked_at")
        if "checked_by" in resolved_section:
            effective["checked_by"] = resolved_section.get("checked_by")
        if "evidence" in resolved_section:
            effective["evidence"] = resolved_section.get("evidence")
        if "notes" in resolved_section:
            effective["notes"] = resolved_section.get("notes")
    return effective


def load_manual_section(name: str, payload: dict[str, Any] | None) -> dict[str, Any] | None:
    if payload is None:
        return None
    section = payload.get("sections", {}).get(name)
    if not isinstance(section, dict):
        return None
    status = str(section.get("status", "manual_required")).strip().lower()
    if status not in {"pass", "fail", "manual_required"}:
        status = "manual_required"
    checked_at = str(section.get("checked_at", "")).strip() or None
    checked_by = str(section.get("checked_by", "")).strip() or None
    evidence = section.get("evidence", [])
    if not isinstance(evidence, list):
        evidence = []
    if status in {"pass", "fail"}:
        missing_fields = []
        if not checked_at:
            missing_fields.append("checked_at")
        if not checked_by:
            missing_fields.append("checked_by")
        if not evidence:
            missing_fields.append("evidence")
        if missing_fields:
            return {
                "status": "manual_required",
                "reason": f"manual evidence section '{name}' missing required field(s): {', '.join(missing_fields)}",
                "source": "manual",
            }
    return {
        "status": status,
        "reason": str(section.get("reason", "")).strip()
        or f"manual evidence section '{name}' provided",
        "checked_at": checked_at,
        "checked_by": checked_by,
        "evidence": evidence,
        "notes": str(section.get("notes", "")).strip() or None,
        "source": "manual",
    }


def resolve_owner_plan(repo_metadata: dict[str, Any], repo: str) -> dict[str, Any]:
    owner = repo_metadata.get("owner") or {}
    owner_login = str(owner.get("login") or repo.split("/", 1)[0]).strip()
    owner_type = str(owner.get("type") or "").strip() or None
    org_plan = None
    org_plan_status = "unknown"
    org_plan_reason = None
    if owner_type == "Organization" and owner_login:
        try:
            org_payload = run_json_command(["gh", "api", f"orgs/{owner_login}"])
            org_plan = (
                str((org_payload.get("plan") or {}).get("name") or "").strip().lower() or None
            )
            org_plan_status = "resolved"
        except RuntimeError as exc:
            org_plan_status = "unresolved"
            org_plan_reason = str(exc)
    return {
        "owner_login": owner_login,
        "owner_type": owner_type,
        "org_plan": org_plan,
        "org_plan_status": org_plan_status,
        "org_plan_reason": org_plan_reason,
    }


def feature_availability(owner_context: dict[str, Any], feature_name: str) -> dict[str, Any]:
    owner_type = owner_context.get("owner_type")
    org_plan = owner_context.get("org_plan")
    if owner_type != "Organization":
        return {
            "available": False,
            "reason": f"{feature_name} is not applicable because this repository is not organization-owned. {GITHUB_PLAN_REQUIREMENT}",
        }
    if owner_context.get("org_plan_status") == "unresolved":
        return {
            "available": None,
            "reason": f"could not resolve the organization plan for {feature_name}: {owner_context.get('org_plan_reason')}",
        }
    if org_plan in (None, ""):
        return {
            "available": None,
            "reason": f"could not resolve the organization plan name for {feature_name} even though the organization lookup succeeded",
        }
    if org_plan == "free":
        plan_label = org_plan or "unknown"
        return {
            "available": False,
            "reason": f"{feature_name} is not applicable because organization plan '{plan_label}' does not satisfy the current GitHub plan requirement. {GITHUB_PLAN_REQUIREMENT}",
        }
    return {
        "available": True,
        "reason": f"{feature_name} may be available because this repository is organization-owned and plan '{org_plan}' is not GitHub Free.",
    }


def summarize_alert(count: int, label: str) -> dict[str, Any]:
    return {
        "status": "pass" if count == 0 else "fail",
        "reason": f"{label} open count = {count}",
        "open_count": count,
        "source": "automation",
    }


def overall_status(sections: list[dict[str, Any]]) -> str:
    if any(section.get("status") == "fail" for section in sections):
        return "fail"
    if any(section.get("status") == "manual_required" for section in sections):
        return "manual_required"
    return "pass"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect GitHub closure evidence for Proofyard.")
    parser.add_argument("--repo", default=REPO_DEFAULT, help="GitHub repo in owner/name form.")
    parser.add_argument(
        "--manual-evidence",
        default=str(MANUAL_EVIDENCE_DEFAULT),
        help="Optional path to manual evidence JSON (version=1).",
    )
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    storefront = run_json_command(["bash", str(STORE_FRONTEND_SCRIPT), "--json", args.repo])
    repo_metadata = run_json_command(["gh", "api", f"repos/{args.repo}"])
    community_profile = run_json_command(["gh", "api", f"repos/{args.repo}/community/profile"])
    owner_context = resolve_owner_plan(repo_metadata, args.repo)
    code_scanning_open = int(
        run_text_command(
            ["gh", "api", f"repos/{args.repo}/code-scanning/alerts?state=open", "--jq", "length"]
        )
    )
    secret_scanning_open = int(
        run_text_command(
            ["gh", "api", f"repos/{args.repo}/secret-scanning/alerts?state=open", "--jq", "length"]
        )
    )
    dependabot_open = int(
        run_text_command(
            ["gh", "api", f"repos/{args.repo}/dependabot/alerts?state=open", "--jq", "length"]
        )
    )

    manual_path = Path(args.manual_evidence)
    manual_payload = load_manual_evidence(manual_path)

    security = {
        "dependabot": summarize_alert(dependabot_open, "dependabot"),
        "code_scanning": summarize_alert(code_scanning_open, "code_scanning"),
        "secret_scanning": summarize_alert(secret_scanning_open, "secret_scanning"),
    }

    code_quality_manual = load_manual_section("code_quality", manual_payload)
    ai_findings_manual = load_manual_section("ai_findings", manual_payload)
    social_preview_manual = load_manual_section("social_preview", manual_payload)
    content_reports_manual = load_manual_section("content_reports", manual_payload)

    code_quality_capability = feature_availability(owner_context, "GitHub Code Quality")
    ai_findings_capability = feature_availability(owner_context, "GitHub AI findings")

    if code_quality_manual is not None:
        code_quality = code_quality_manual
    elif code_quality_capability["available"] is False:
        code_quality = automated_section(
            "pass",
            code_quality_capability["reason"],
            availability="not_applicable",
        )
    elif code_quality_capability["available"] is None:
        code_quality = manual_required_section("code_quality", code_quality_capability["reason"])
    else:
        code_quality = manual_required_section(
            "code_quality",
            "GitHub Code Quality may be available for this repository; add UI evidence or a manual evidence section.",
        )

    if ai_findings_manual is not None:
        ai_findings = ai_findings_manual
    elif ai_findings_capability["available"] is False:
        ai_findings = automated_section(
            "pass",
            ai_findings_capability["reason"],
            availability="not_applicable",
        )
    elif ai_findings_capability["available"] is None:
        ai_findings = manual_required_section("ai_findings", ai_findings_capability["reason"])
    else:
        ai_findings = manual_required_section(
            "ai_findings",
            "GitHub AI findings may be available for this repository; add UI evidence or a manual evidence section.",
        )

    if social_preview_manual is not None:
        social_preview = social_preview_manual
    elif storefront["checks"]["social_preview"]["status"] == "fail":
        social_preview = automated_section("fail", storefront["checks"]["social_preview"]["reason"])
    else:
        social_preview = manual_required_section(
            "social_preview", storefront["checks"]["social_preview"]["reason"]
        )

    if content_reports_manual is not None:
        content_reports = content_reports_manual
    elif storefront["checks"]["community_profile"]["status"] == "pass" and bool(
        community_profile.get("content_reports_enabled")
    ):
        content_reports = automated_section(
            "pass",
            "community profile is complete and content reports are enabled",
            health_percentage=community_profile.get("health_percentage"),
        )
    elif storefront["checks"]["community_profile"]["status"] == "fail":
        content_reports = automated_section(
            "fail", storefront["checks"]["community_profile"]["reason"]
        )
    else:
        content_reports = manual_required_section(
            "content_reports", storefront["checks"]["community_profile"]["reason"]
        )

    if (
        storefront["checks"]["social_preview"]["status"] != "fail"
        and social_preview["status"] == "manual_required"
        and social_preview_manual is None
    ):
        social_preview["reason"] = storefront["checks"]["social_preview"]["reason"]
    if (
        storefront["checks"]["community_profile"]["status"] != "fail"
        and content_reports["status"] == "manual_required"
        and content_reports_manual is None
    ):
        content_reports["reason"] = storefront["checks"]["community_profile"]["reason"]

    effective_social_preview = effective_manual_check(
        storefront["checks"]["social_preview"], social_preview
    )

    storefront_sections = [
        storefront["checks"]["description"],
        storefront["checks"]["discussions"],
        storefront["checks"]["issues"],
        storefront["checks"]["homepage"],
        storefront["checks"]["pages"],
        storefront["checks"]["topics"],
        storefront["checks"]["releases"],
        effective_social_preview,
        storefront["checks"]["community_profile"],
    ]
    storefront_status = overall_status(storefront_sections)
    security_status = overall_status(list(security.values()))
    evidence_sections = [code_quality, ai_findings, social_preview, content_reports]
    evidence_status = overall_status(evidence_sections)

    verdict = "closed_clean"
    if "fail" in {storefront_status, security_status, evidence_status}:
        verdict = "closed_with_limitations"
    elif "manual_required" in {storefront_status, security_status, evidence_status}:
        verdict = "closed_with_limitations"

    payload = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "repo": args.repo,
        "repo_metadata": {
            "name": repo_metadata.get("name"),
            "description": repo_metadata.get("description"),
            "homepage": repo_metadata.get("homepage"),
            "has_discussions": repo_metadata.get("has_discussions"),
            "topics": repo_metadata.get("topics", []),
            "default_branch": repo_metadata.get("default_branch"),
            "open_issues_count": repo_metadata.get("open_issues_count"),
            "owner_login": owner_context["owner_login"],
            "owner_type": owner_context["owner_type"],
        },
        "storefront": storefront,
        "effective_storefront": {
            "checks": {
                **storefront["checks"],
                "social_preview": effective_social_preview,
            },
            "overall_status": storefront_status,
        },
        "community_profile": {
            "health_percentage": community_profile.get("health_percentage"),
            "content_reports_enabled": community_profile.get("content_reports_enabled"),
            "files": sorted((community_profile.get("files") or {}).keys()),
        },
        "platform_capabilities": {
            "owner_login": owner_context["owner_login"],
            "owner_type": owner_context["owner_type"],
            "org_plan": owner_context["org_plan"],
            "org_plan_status": owner_context["org_plan_status"],
            "org_plan_reason": owner_context["org_plan_reason"],
            "code_quality": code_quality_capability,
            "ai_findings": ai_findings_capability,
        },
        "security": security,
        "manual_evidence": {
            "path": str(manual_path),
            "exists": manual_payload is not None,
            "sections": {
                "social_preview": social_preview,
                "content_reports": content_reports,
                "code_quality": code_quality,
                "ai_findings": ai_findings,
            },
        },
        "observable_alternatives": {
            "pr_quality_gate_workflow_present": (
                ROOT_DIR / ".github" / "workflows" / "pr.yml"
            ).exists(),
            "uiq_gemini_uiux_audit_present": (
                ROOT_DIR / "scripts" / "ci" / "uiq-gemini-uiux-audit.mjs"
            ).exists(),
        },
        "verdict": verdict,
        "status": {
            "storefront": storefront_status,
            "security": security_status,
            "manual_evidence": evidence_status,
        },
    }

    json.dump(payload, sys.stdout, ensure_ascii=False, indent=2 if args.pretty else None)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
