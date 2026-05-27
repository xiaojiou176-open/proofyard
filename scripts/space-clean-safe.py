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
    gather_safe_clean_candidates,
    human_bytes,
    load_space_governance,
    protected_path_rules,
    remove_candidate,
    repo_root_from,
    resolve_runtime_root,
    size_bytes,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Safely clean repo-exclusive low-risk residues.")
    parser.add_argument("--repo-root", default=None, help="Repo root to inspect. Defaults to the current repository.")
    parser.add_argument(
        "--runtime-root",
        default=".runtime-cache",
        help="Runtime root to inspect. Relative values resolve from --repo-root.",
    )
    parser.add_argument("--apply", action="store_true", help="Apply deletions. Default mode is dry-run.")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = repo_root_from(Path(args.repo_root) if args.repo_root else None)
    runtime_root = resolve_runtime_root(repo_root, args.runtime_root)
    policy, _registry = load_space_governance(repo_root)

    before_bytes = size_bytes(repo_root)
    candidates = gather_safe_clean_candidates(repo_root, runtime_root, policy)
    deleted_entries = []

    if args.apply:
        for candidate in candidates:
            deleted_entries.append(candidate.to_dict(repo_root))
            remove_candidate(candidate)

    after_bytes = size_bytes(repo_root)
    payload = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "repo_root": str(repo_root),
        "runtime_root": str(runtime_root),
        "apply": bool(args.apply),
        "dry_run": not args.apply,
        "before_bytes": before_bytes,
        "before_human": human_bytes(before_bytes),
        "after_bytes": after_bytes,
        "after_human": human_bytes(after_bytes),
        "candidate_count": len(candidates),
        "deleted_count": len(deleted_entries),
        "bytes_freed": max(0, before_bytes - after_bytes) if args.apply else 0,
        "bytes_freed_human": human_bytes(max(0, before_bytes - after_bytes) if args.apply else 0),
        "safe_clean_candidates": [candidate.to_dict(repo_root) for candidate in candidates],
        "deleted_entries": deleted_entries,
        "protected_paths": policy.get("spaceGovernance", {}).get("protectedPaths", []),
        "protected_path_rules": [
            {
                "path": str(rule["path"]),
                "relative_path": str(rule["path"].relative_to(repo_root)),
                "mode": rule["mode"],
                "allow_safe_clean_kinds": rule["allow_safe_clean_kinds"],
                "notes": rule["notes"],
            }
            for rule in protected_path_rules(repo_root, policy)
        ],
    }

    json.dump(payload, sys.stdout, ensure_ascii=False, indent=2 if args.pretty else None)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
