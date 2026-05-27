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
    gather_safe_clean_candidates,
    human_bytes,
    load_space_governance,
    protected_path_rules,
    repo_root_from,
    resolve_external_layers,
    resolve_runtime_root,
    size_bytes,
    summarize_bucket,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Emit a repo-exclusive disk space report for Proofyard.")
    parser.add_argument("--repo-root", default=None, help="Repo root to inspect. Defaults to the current repository.")
    parser.add_argument(
        "--runtime-root",
        default=".runtime-cache",
        help="Runtime root to inspect. Relative values resolve from --repo-root.",
    )
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = repo_root_from(Path(args.repo_root) if args.repo_root else None)
    runtime_root = resolve_runtime_root(repo_root, args.runtime_root)
    policy, registry = load_space_governance(repo_root)

    buckets = [summarize_bucket(repo_root, runtime_root, policy, bucket) for bucket in registry.get("managedBuckets", [])]
    safe_candidates = [candidate.to_dict(repo_root) for candidate in gather_safe_clean_candidates(repo_root, runtime_root, policy)]
    reclaim_candidates = [candidate.to_dict(repo_root) for candidate in gather_reclaim_candidates(repo_root, registry)]
    external_layers = resolve_external_layers(repo_root, registry)

    repo_total_bytes = size_bytes(repo_root)
    runtime_total_bytes = size_bytes(runtime_root)
    external_total_bytes = sum(layer["size_bytes"] for layer in external_layers)
    safe_clean_total_bytes = sum(candidate["size_bytes"] for candidate in safe_candidates)
    reclaim_total_bytes = sum(candidate["size_bytes"] for candidate in reclaim_candidates)
    protected_total_bytes = sum(
        bucket["size_bytes"] for bucket in buckets if bucket["cleanup_class"] in {"review", "preserve"}
    )

    payload = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "repo_root": str(repo_root),
        "runtime_root": str(runtime_root),
        "repo_internal_total_bytes": repo_total_bytes,
        "repo_internal_total_human": human_bytes(repo_total_bytes),
        "runtime_total_bytes": runtime_total_bytes,
        "runtime_total_human": human_bytes(runtime_total_bytes),
        "repo_exclusive_external_total_bytes": external_total_bytes,
        "repo_exclusive_external_total_human": human_bytes(external_total_bytes),
        "safe_clean_total_bytes": safe_clean_total_bytes,
        "safe_clean_total_human": human_bytes(safe_clean_total_bytes),
        "reclaim_total_bytes": reclaim_total_bytes,
        "reclaim_total_human": human_bytes(reclaim_total_bytes),
        "protected_total_bytes": protected_total_bytes,
        "protected_total_human": human_bytes(protected_total_bytes),
        "managed_buckets": buckets,
        "safe_clean_candidates": safe_candidates,
        "reclaim_candidates": reclaim_candidates,
        "repo_exclusive_external_layers": external_layers,
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
        "bucket_cleanup_classes": policy.get("spaceGovernance", {}).get("bucketCleanupClasses", {}),
    }

    json.dump(payload, sys.stdout, ensure_ascii=False, indent=2 if args.pretty else None)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
