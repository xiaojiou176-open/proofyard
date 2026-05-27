#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT_DIR / ".runtime-cache" / "artifacts" / "ci" / "github-closure-manual-evidence.json"
DEFAULT_SCREENSHOT = "screenshots/github-social-preview.png"
DEFAULT_ASSET = "assets/storefront/proofyard-social-preview.png"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Write a safe Social Preview manual-evidence template for GitHub closure."
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help="Path to the manual evidence JSON file.",
    )
    parser.add_argument(
        "--screenshot-path",
        default=DEFAULT_SCREENSHOT,
        help="Suggested screenshot path to prefill in the template.",
    )
    parser.add_argument(
        "--checked-by-placeholder",
        default="maintainer",
        help="Placeholder value for checked_by.",
    )
    parser.add_argument(
        "--status",
        choices=["manual_required", "pass", "fail"],
        default="manual_required",
        help="Status to write for the social_preview section.",
    )
    parser.add_argument(
        "--reason",
        default="",
        help="Optional override for the section reason.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite an existing social_preview section even if it already contains pass/fail evidence.",
    )
    return parser.parse_args()


def load_payload(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"version": 1, "sections": {}}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("version") != 1:
        raise SystemExit(f"manual evidence file must declare version=1: {path}")
    sections = payload.get("sections")
    if not isinstance(sections, dict):
        payload["sections"] = {}
    return payload


def build_template(
    screenshot_path: str,
    checked_by_placeholder: str,
    status: str,
    reason_override: str,
) -> dict[str, Any]:
    default_reason = {
        "manual_required": f"Confirm GitHub Social Preview matches {DEFAULT_ASSET}, then change status to pass or fail.",
        "pass": "GitHub Social Preview matches the tracked PNG asset.",
        "fail": "GitHub Social Preview does not match the tracked PNG asset.",
    }[status]
    return {
        "status": status,
        "reason": reason_override.strip() or default_reason,
        "checked_at": ""
        if status == "manual_required"
        else datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "checked_by": checked_by_placeholder,
        "evidence": [screenshot_path],
        "notes": "After confirming or uploading the Social Preview in GitHub Settings, keep this section aligned with the actual UI state.",
    }


def main() -> int:
    args = parse_args()
    output_path = Path(args.output).expanduser().resolve()
    payload = load_payload(output_path)
    sections = payload.setdefault("sections", {})
    if not isinstance(sections, dict):
        raise SystemExit(f"manual evidence sections must be a JSON object: {output_path}")

    existing = sections.get("social_preview")
    if isinstance(existing, dict) and existing.get("status") in {"pass", "fail"} and not args.force:
        raise SystemExit(
            "social_preview already contains pass/fail evidence; rerun with --force if you really want to overwrite it"
        )

    sections["social_preview"] = build_template(
        screenshot_path=args.screenshot_path,
        checked_by_placeholder=args.checked_by_placeholder,
        status=args.status,
        reason_override=args.reason,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
