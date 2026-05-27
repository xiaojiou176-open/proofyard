from __future__ import annotations

import json
import os
import pwd
import shutil
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Candidate:
    path: Path
    kind: str
    reason: str
    cleanup_class: str = "safe-clean"

    @property
    def size_bytes(self) -> int:
        return size_bytes(self.path)

    def to_dict(self, repo_root: Path) -> dict[str, Any]:
        return {
            "path": str(self.path),
            "relative_path": relative_to_root(self.path, repo_root),
            "kind": self.kind,
            "reason": self.reason,
            "cleanup_class": self.cleanup_class,
            "size_bytes": self.size_bytes,
            "size_human": human_bytes(self.size_bytes),
        }


@dataclass(frozen=True)
class ReclaimCandidate:
    id: str
    path: Path
    kind: str
    owner: str
    rebuild_command: str
    risk: str
    preconditions: tuple[str, ...]
    cleanup_class: str = "reclaim"
    notes: str = ""
    blocked_by: tuple[str, ...] = ()

    @property
    def exists(self) -> bool:
        return self.path.exists() or self.path.is_symlink()

    @property
    def size_bytes(self) -> int:
        return size_bytes(self.path)

    @property
    def apply_allowed(self) -> bool:
        return self.exists and not self.blocked_by

    def to_dict(self, repo_root: Path) -> dict[str, Any]:
        return {
            "id": self.id,
            "path": str(self.path),
            "relative_path": relative_to_root(self.path, repo_root),
            "kind": self.kind,
            "owner": self.owner,
            "cleanup_class": self.cleanup_class,
            "exists": self.exists,
            "size_bytes": self.size_bytes,
            "size_human": human_bytes(self.size_bytes),
            "rebuild_command": self.rebuild_command,
            "risk": self.risk,
            "preconditions": list(self.preconditions),
            "apply_allowed": self.apply_allowed,
            "blocked_by": list(self.blocked_by),
            "notes": self.notes,
        }


def repo_root_from(default: Path | None = None) -> Path:
    if default is None:
        default = Path(__file__).resolve().parents[2]
    return default.resolve()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_space_governance(repo_root: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    policy_path = repo_root / "configs/governance/runtime-live-policy.json"
    registry_path = repo_root / "configs/governance/runtime-output-registry.json"
    return load_json(policy_path), load_json(registry_path)


def resolve_runtime_root(repo_root: Path, runtime_root: str | Path | None) -> Path:
    if runtime_root is None:
        runtime_root = ".runtime-cache"
    runtime_path = Path(runtime_root)
    if not runtime_path.is_absolute():
        runtime_path = repo_root / runtime_path
    return runtime_path.resolve()


def human_bytes(num_bytes: int) -> str:
    value = float(num_bytes)
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if value < 1024 or unit == "TiB":
            if unit == "B":
                return f"{int(value)} {unit}"
            return f"{value:.2f} {unit}"
        value /= 1024
    return f"{num_bytes} B"


def size_bytes(path: Path) -> int:
    if not path.exists() and not path.is_symlink():
        return 0
    if path.is_symlink():
        return path.lstat().st_size
    if path.is_file():
        return path.stat().st_size
    total = 0
    for child in path.iterdir():
        total += size_bytes(child)
    return total


def relative_to_root(path: Path, repo_root: Path) -> str:
    try:
        return str(path.resolve().relative_to(repo_root.resolve()))
    except ValueError:
        return str(path)


def policy_bucket_classes(policy: dict[str, Any]) -> dict[str, str]:
    return dict(policy.get("spaceGovernance", {}).get("bucketCleanupClasses", {}))


def protected_paths(repo_root: Path, policy: dict[str, Any]) -> list[Path]:
    raw_paths = policy.get("spaceGovernance", {}).get("protectedPaths", [])
    resolved: list[Path] = []
    for raw in raw_paths:
        candidate = Path(raw)
        if not candidate.is_absolute():
          candidate = repo_root / candidate
        resolved.append(candidate.resolve())
    return resolved


def protected_path_rules(repo_root: Path, policy: dict[str, Any]) -> list[dict[str, Any]]:
    rules = []
    for raw_rule in policy.get("spaceGovernance", {}).get("protectedPathRules", []):
        candidate = Path(raw_rule["path"])
        if not candidate.is_absolute():
            candidate = repo_root / candidate
        rules.append(
            {
                "path": candidate.resolve(),
                "mode": raw_rule.get("mode", "always-protect"),
                "allow_safe_clean_kinds": list(raw_rule.get("allowSafeCleanKinds", [])),
                "notes": raw_rule.get("notes", ""),
            }
        )
    return rules


def should_skip_protected(path: Path, repo_root: Path, policy: dict[str, Any], kind: str | None = None) -> bool:
    try:
        resolved = path.resolve()
    except FileNotFoundError:
        resolved = path
    for protected in protected_paths(repo_root, policy):
        if resolved == protected or protected in resolved.parents:
            return True
    for rule in protected_path_rules(repo_root, policy):
        protected = rule["path"]
        if resolved != protected and protected not in resolved.parents:
            continue
        if kind and kind in rule["allow_safe_clean_kinds"]:
            return False
        return True
    return False


def is_older_than(path: Path, cutoff: datetime) -> bool:
    modified_at = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    return modified_at <= cutoff


def gather_safe_clean_candidates(
    repo_root: Path,
    runtime_root: Path,
    policy: dict[str, Any],
) -> list[Candidate]:
    candidates: dict[Path, Candidate] = {}
    retention_days = int(policy.get("retentionDefaults", {}).get("cacheRetentionDays", 7))
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    automation_test_prefixes = (
        "hardening-",
        "provider-domain-gate-",
        "secret-missing-",
        "secure-defaults-",
    )

    def add_candidate(path: Path, kind: str, reason: str) -> None:
        if not path.exists() and not path.is_symlink():
            return
        if should_skip_protected(path, repo_root, policy, kind=kind):
            return
        candidates[path.resolve()] = Candidate(path=path.resolve(), kind=kind, reason=reason)

    temp_dir = runtime_root / "temp"
    if temp_dir.is_dir():
        for child in sorted(temp_dir.iterdir()):
            add_candidate(child, "runtime-temp", "runtime temp subtree is always safe-clean")

    test_drivers_dir = runtime_root / "test-drivers"
    if test_drivers_dir.exists():
        add_candidate(
            test_drivers_dir,
            "test-driver-runtime",
            "test driver sandbox is removable test residue",
        )

    preflight_dir = runtime_root / "logs" / "preflight"
    if preflight_dir.is_dir():
        for child in sorted(preflight_dir.iterdir()):
            add_candidate(child, "preflight-log", "preflight logs are safe-clean maintainer residue")

    automation_dir = runtime_root / "automation"
    if automation_dir.is_dir():
        for child in sorted(automation_dir.iterdir()):
            if child.is_dir() and child.name.startswith(automation_test_prefixes):
                add_candidate(
                    child,
                    "automation-test-session",
                    "automation test session sandbox is removable residue",
                )

    for cache_name in ("pytest", "ruff", "hypothesis"):
        cache_dir = runtime_root / "cache" / cache_name
        if cache_dir.exists() and is_older_than(cache_dir, cutoff):
            add_candidate(
                cache_dir,
                "aged-cache",
                f"{cache_name} cache is older than configured cache retention ({retention_days} day(s))",
            )

    runs_dir = runtime_root / "artifacts" / "runs"
    if runs_dir.is_dir():
        for child in sorted(runs_dir.iterdir()):
            if child.is_dir() and not any(child.iterdir()):
                add_candidate(child, "empty-run-stub", "empty run directory can be removed after emptiness verification")

    for pycache_dir in repo_root.rglob("__pycache__"):
        add_candidate(pycache_dir, "python-bytecode-cache", "__pycache__ is a pure Python bytecode residue")

    for pyc_file in repo_root.rglob("*.pyc"):
        add_candidate(pyc_file, "python-bytecode-file", "*.pyc is a pure Python bytecode residue")

    for nested_runtime_dir in repo_root.rglob(".runtime-cache"):
        if nested_runtime_dir.resolve() == runtime_root.resolve():
            continue
        add_candidate(nested_runtime_dir, "nested-runtime-cache", "nested runtime cache is treated as removable residue")

    return sorted(candidates.values(), key=lambda item: (str(item.path), item.kind))


def remove_candidate(candidate: Candidate) -> None:
    path = candidate.path
    if path.is_symlink() or path.is_file():
        path.unlink(missing_ok=True)
        return
    if path.is_dir():
        shutil.rmtree(path)


def resolve_external_layers(repo_root: Path, registry: dict[str, Any]) -> list[dict[str, Any]]:
    fallback_homes = fallback_home_dirs(repo_root)
    layers = []
    for layer in registry.get("repoExclusiveExternalLayers", []):
        layer_path = resolve_registry_path(repo_root, layer["path"], fallback_homes=fallback_homes)
        exists = layer_path.exists()
        size = size_bytes(layer_path) if exists else 0
        layers.append(
            {
                "id": layer["id"],
                "path": str(layer_path),
                "exists": exists,
                "owner": layer["owner"],
                "kind": layer["kind"],
                "cleanup_class": layer["cleanupClass"],
                "size_budget_mb": layer.get("sizeBudgetMb"),
                "must_keep_latest": bool(layer.get("mustKeepLatest", False)),
                "size_bytes": size,
                "size_human": human_bytes(size),
                "notes": layer.get("notes", ""),
            }
        )
    return layers


def fallback_home_dirs(repo_root: Path) -> list[Path]:
    fallback_homes: list[Path] = []
    for candidate in (
        Path.home(),
        Path(pwd.getpwuid(repo_root.stat().st_uid).pw_dir),
    ):
        resolved = candidate.expanduser().resolve()
        if resolved not in fallback_homes:
            fallback_homes.append(resolved)
    return fallback_homes


def resolve_registry_path(repo_root: Path, raw_path: str, *, fallback_homes: list[Path] | None = None) -> Path:
    if fallback_homes is None:
        fallback_homes = fallback_home_dirs(repo_root)
    if "${HOME}" in raw_path:
        for home_dir in fallback_homes:
            candidate = Path(raw_path.replace("${HOME}", str(home_dir))).expanduser()
            if candidate.exists():
                return candidate.resolve()
    expanded = os.path.expandvars(raw_path)
    expanded = expanded.replace("${HOME}", str(Path.home()))
    candidate = Path(expanded).expanduser()
    if not candidate.is_absolute():
        candidate = repo_root / candidate
    return candidate.resolve()


def root_venv_retirement_blockers(repo_root: Path) -> list[str]:
    checks = (
        ("scripts/thirdparty/sync-upstream.sh", "./.venv/bin/", "legacy sync guidance still recommends root .venv"),
        ("scripts/ci/check-relocation-readiness.mjs", 'linkIfPresent(".venv")', "relocation readiness still injects root .venv"),
        ("scripts/ci/uiq-pytest-truth-gate.py", '".venv"', "truth gate still special-cases root .venv"),
        ("configs/governance/root-allowlist.json", '".venv"', "root allowlist still permits root .venv"),
        ("configs/governance/runtime-live-policy.json", '".venv"', "runtime live policy still protects root .venv"),
        ("scripts/runtime-gc.sh", '".venv"', "runtime-gc payload still advertises root .venv as a protected path"),
    )
    blockers: list[str] = []
    for relative_path, needle, message in checks:
        path = repo_root / relative_path
        if not path.exists():
            continue
        if needle in path.read_text(encoding="utf-8"):
            blockers.append(f"{message} ({relative_path})")
    managed_python_env = repo_root / ".runtime-cache/toolchains/python/.venv/bin/python"
    if not managed_python_env.exists():
        blockers.append("managed Python environment is missing (.runtime-cache/toolchains/python/.venv/bin/python)")
    return blockers


def isolated_install_blockers(repo_root: Path) -> list[str]:
    checks = (
        ("scripts/setup.sh", "--ignore-workspace", "setup still rebuilds isolated installs with pnpm --ignore-workspace"),
        ("scripts/dev-up.sh", "--ignore-workspace", "dev-up still auto-repairs isolated installs with pnpm --ignore-workspace"),
    )
    blockers: list[str] = []
    for relative_path, needle, message in checks:
        path = repo_root / relative_path
        if not path.exists():
            continue
        if needle in path.read_text(encoding="utf-8"):
            blockers.append(f"{message} ({relative_path})")
    return blockers


def gather_reclaim_candidates(repo_root: Path, registry: dict[str, Any]) -> list[ReclaimCandidate]:
    fallback_homes = fallback_home_dirs(repo_root)
    shared_blockers = tuple(isolated_install_blockers(repo_root))
    reclaim_candidates: list[ReclaimCandidate] = []
    for scope in registry.get("reclaimScopes", []):
        candidate_path = resolve_registry_path(repo_root, scope["path"], fallback_homes=fallback_homes)
        blocked_by: tuple[str, ...]
        if scope["id"] == "root-venv":
            blocked_by = tuple(root_venv_retirement_blockers(repo_root))
        elif scope["id"] in {"repo-pnpm-store", "automation-runner-node-modules", "mcp-server-node-modules"}:
            blocked_by = shared_blockers
        else:
            blocked_by = ()
        reclaim_candidates.append(
            ReclaimCandidate(
                id=scope["id"],
                path=candidate_path,
                kind=scope["kind"],
                owner=scope["owner"],
                rebuild_command=scope["rebuildCommand"],
                risk=scope["risk"],
                preconditions=tuple(scope.get("preconditions", [])),
                cleanup_class=scope.get("cleanupClass", "reclaim"),
                notes=scope.get("notes", ""),
                blocked_by=blocked_by,
            )
        )
    return sorted(reclaim_candidates, key=lambda item: item.id)


def summarize_bucket(
    repo_root: Path,
    runtime_root: Path,
    policy: dict[str, Any],
    bucket: dict[str, Any],
) -> dict[str, Any]:
    bucket_path = repo_root / bucket["path"]
    bucket_size = size_bytes(bucket_path)
    return {
        "id": bucket["id"],
        "path": bucket["path"],
        "absolute_path": str(bucket_path.resolve()),
        "owner": bucket["cleanupOwner"],
        "kind": bucket["kind"],
        "retention": bucket.get("retention", {}),
        "cleanup_class": bucket.get("cleanupClass", policy_bucket_classes(policy).get(bucket["id"], "review")),
        "size_budget_mb": bucket.get("sizeBudgetMb"),
        "must_keep_latest": bool(bucket.get("mustKeepLatest", False)),
        "size_bytes": bucket_size,
        "size_human": human_bytes(bucket_size),
    }
