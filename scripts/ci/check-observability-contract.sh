#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="check-observability-contract"
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

SCAN_DIRS=(
  "apps/api/app/api"
  "apps/api/app/services"
  "apps/api/app/core"
)

if [[ -n "${UIQ_OBSERVABILITY_SCAN_DIRS:-}" ]]; then
  IFS=',' read -r -a SCAN_DIRS <<<"${UIQ_OBSERVABILITY_SCAN_DIRS}"
fi

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[$SCRIPT_NAME] dry-run enabled"
fi

if command -v rg >/dev/null 2>&1; then
  SCAN_FILES="$(rg --files "${SCAN_DIRS[@]}" -g '*.py' | tr '\n' ':')"
else
  echo "[$SCRIPT_NAME] ripgrep (rg) not found; fallback to find" >&2
  SCAN_FILES="$(
    find "${SCAN_DIRS[@]}" -type f -name '*.py' 2>/dev/null | sort | tr '\n' ':'
  )"
fi
if [[ -z "$SCAN_FILES" ]]; then
  echo "[$SCRIPT_NAME] no python files found in scan directories" >&2
  exit 1
fi

export SCRIPT_NAME SCAN_FILES
set +e
PYTHON_OUTPUT="$(
python3 - <<'PY'
import ast
import os
import pathlib
import re
from typing import Iterable, Optional

script_name = os.environ["SCRIPT_NAME"]
scan_files = [item for item in os.environ["SCAN_FILES"].split(":") if item]

banned_message_patterns = [
    re.compile(r"\bsomething went wrong\b", re.IGNORECASE),
    re.compile(r"\ban error occurred\b", re.IGNORECASE),
    re.compile(r"\bunexpected error\b", re.IGNORECASE),
    re.compile(r"\binternal server error\b", re.IGNORECASE),
    re.compile(r"\boperation failed\b", re.IGNORECASE),
]

required_anchor_keys = {"request_id", "trace_id", "status_code", "error", "audit_reason"}
log_methods = {"debug", "info", "warning", "warn", "error", "exception", "critical", "log"}

violations: list[tuple[str, int, str, str]] = []
anchor_keys_found: set[str] = set()
parsed_files = 0


def iter_dict_string_keys(node: ast.AST) -> Iterable[str]:
    if isinstance(node, ast.Dict):
        for key in node.keys:
            if isinstance(key, ast.Constant) and isinstance(key.value, str):
                yield key.value


def resolve_static_string(node: ast.AST) -> Optional[str]:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        segments: list[str] = []
        for item in node.values:
            if isinstance(item, ast.Constant) and isinstance(item.value, str):
                segments.append(item.value)
        if segments:
            return "".join(segments)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left = resolve_static_string(node.left)
        right = resolve_static_string(node.right)
        if left is not None and right is not None:
            return left + right
    return None


def is_logger_like_call(node: ast.Call) -> bool:
    func = node.func
    if not isinstance(func, ast.Attribute):
        return False

    value = func.value
    while isinstance(value, ast.Attribute):
        attr_name = value.attr.lower()
        if "logger" in attr_name or attr_name == "logging":
            return True
        value = value.value

    if isinstance(value, ast.Name):
        name = value.id.lower()
        return "logger" in name or name in {"log", "logging"}

    if isinstance(value, ast.Call) and isinstance(value.func, ast.Attribute):
        return value.func.attr.lower() == "get_logger"

    return False


for file_path_str in scan_files:
    file_path = pathlib.Path(file_path_str)
    source = file_path.read_text(encoding="utf-8")
    try:
        tree = ast.parse(source, filename=str(file_path))
    except SyntaxError as exc:
        print(
            f"[{script_name}] BLOCKER syntax error while parsing {file_path}:{exc.lineno}: {exc.msg}"
        )
        raise SystemExit(2)

    parsed_files += 1
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if not isinstance(node.func, ast.Attribute):
            continue
        if node.func.attr not in log_methods:
            continue
        if not is_logger_like_call(node):
            continue

        # Collect structured keys from logger kwargs and extra={...}.
        for kw in node.keywords:
            if kw.arg is not None and kw.arg in required_anchor_keys:
                anchor_keys_found.add(kw.arg)
            if kw.arg == "extra":
                for extra_key in iter_dict_string_keys(kw.value):
                    if extra_key in required_anchor_keys:
                        anchor_keys_found.add(extra_key)

        # Check message quality when message is a literal string.
        message_node = node.args[0] if node.args else None
        for kw in node.keywords:
            if kw.arg in {"msg", "message"}:
                message_node = kw.value
                break
        if message_node is None:
            continue
        message_raw = resolve_static_string(message_node)
        if message_raw is None:
            continue
        message = message_raw.strip()
        for pattern in banned_message_patterns:
            if pattern.search(message):
                violations.append(
                    (
                        str(file_path),
                        getattr(message_node, "lineno", getattr(node, "lineno", 1)),
                        "vague_log_phrase",
                        message,
                    )
                )
                break

missing_anchor_keys = sorted(required_anchor_keys - anchor_keys_found)

print(f"[{script_name}] scanned_python_files={parsed_files}")
print(f"[{script_name}] anchor_keys_found={','.join(sorted(anchor_keys_found)) or 'none'}")
if missing_anchor_keys:
    print(f"[{script_name}] missing_anchor_keys={','.join(missing_anchor_keys)}")
if violations:
    print(f"[{script_name}] vague_phrase_count={len(violations)}")
    for file_path, lineno, code, message in violations:
        print(f"{file_path}:{lineno}: [{code}] {message}")
    raise SystemExit(1)
if missing_anchor_keys:
    raise SystemExit(1)
print(f"[{script_name}] pass: observability contract satisfied")
PY
)"
PYTHON_EXIT=$?
set -e

echo "$PYTHON_OUTPUT"

if [[ "$DRY_RUN" == "true" ]]; then
  if [[ "$PYTHON_EXIT" -ne 0 ]]; then
    echo "[$SCRIPT_NAME] dry-run result: would fail (exit=${PYTHON_EXIT})"
    exit 0
  fi
  echo "[$SCRIPT_NAME] dry-run result: would pass"
  exit 0
fi

if [[ "$PYTHON_EXIT" -ne 0 ]]; then
  exit "$PYTHON_EXIT"
fi
