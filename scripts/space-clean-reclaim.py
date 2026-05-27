#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.dont_write_bytecode = True

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR / "lib"))

from space_governance import (  # noqa: E402
    gather_reclaim_candidates,
    human_bytes,
    load_space_governance,
    remove_candidate,
    repo_root_from,
    size_bytes,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Reclaim repo-exclusive large, rebuildable disk surfaces.")
    parser.add_argument("--repo-root", default=None, help="Repo root to inspect. Defaults to the current repository.")
    parser.add_argument(
        "--scope",
        action="append",
        default=[],
        help="Reclaim scope id to inspect/apply. Repeat for multiple scopes.",
    )
    parser.add_argument("--apply", action="store_true", help="Apply deletions. Default mode is dry-run.")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = repo_root_from(Path(args.repo_root) if args.repo_root else None)
    _policy, registry = load_space_governance(repo_root)
    all_candidates = gather_reclaim_candidates(repo_root, registry)
    candidates_by_id = {candidate.id: candidate for candidate in all_candidates}

    unknown_scopes = [scope for scope in args.scope if scope not in candidates_by_id]
    if unknown_scopes:
        raise SystemExit(f"unknown reclaim scope(s): {', '.join(sorted(unknown_scopes))}")

    selected_ids = args.scope or [candidate.id for candidate in all_candidates]
    selected_candidates = [candidates_by_id[candidate_id] for candidate_id in selected_ids]

    if args.apply and not args.scope:
        raise SystemExit("--apply requires at least one explicit --scope")

    blocked_apply = [
        {"id": candidate.id, "blocked_by": list(candidate.blocked_by)}
        for candidate in selected_candidates
        if args.apply and not candidate.apply_allowed
    ]
    if blocked_apply:
        payload = {
            "version": 1,
            "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "repo_root": str(repo_root),
            "apply": bool(args.apply),
            "dry_run": not args.apply,
            "selected_scopes": selected_ids,
            "candidate_count": len(selected_candidates),
            "deleted_count": 0,
            "bytes_freed": 0,
            "bytes_freed_human": human_bytes(0),
            "reclaim_candidates": [candidate.to_dict(repo_root) for candidate in selected_candidates],
            "blocked_scopes": blocked_apply,
            "status": "blocked",
        }
        json.dump(payload, sys.stdout, ensure_ascii=False, indent=2 if args.pretty else None)
        sys.stdout.write("\n")
        return 2

    before_bytes = sum(size_bytes(candidate.path) for candidate in selected_candidates)
    deleted_entries = []
    if args.apply:
        for candidate in selected_candidates:
            if not candidate.exists:
                continue
            deleted_entries.append(candidate.to_dict(repo_root))
            remove_candidate(candidate)

    after_bytes = sum(size_bytes(candidate.path) for candidate in selected_candidates)
    payload = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "repo_root": str(repo_root),
        "apply": bool(args.apply),
        "dry_run": not args.apply,
        "selected_scopes": selected_ids,
        "candidate_count": len(selected_candidates),
        "deleted_count": len(deleted_entries),
        "bytes_freed": max(0, before_bytes - after_bytes) if args.apply else 0,
        "bytes_freed_human": human_bytes(max(0, before_bytes - after_bytes) if args.apply else 0),
        "reclaim_candidates": [candidate.to_dict(repo_root) for candidate in selected_candidates],
        "deleted_entries": deleted_entries,
        "status": "ok",
    }
    json.dump(payload, sys.stdout, ensure_ascii=False, indent=2 if args.pretty else None)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
