#!/usr/bin/env python3
from __future__ import annotations

import argparse
import ast
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

OUTPUT_PREFIX = "uiq-pytest-truth-gate"
DEFAULT_OUT_DIR = Path(".runtime-cache/artifacts/ci")
DEFAULT_ROOTS = [Path("apps/api/tests")]
SKIP_DIR_NAMES = {
    "__pycache__",
    ".git",
    ".runtime-cache",
    "node_modules",
    "dist",
    "build",
    ".pytest_cache",
}

REASON_CODE = {
    "passed": "gate.py_test_truthiness.passed.no_weak_patterns",
    "failed": "gate.py_test_truthiness.failed.weak_patterns_detected",
    "blocked": "gate.py_test_truthiness.blocked.no_test_files",
}

COMMENTED_TEST_RE = re.compile(r"^\s*#\s*(def\s+test_[A-Za-z0-9_]*\s*\(|test_[A-Za-z0-9_]+\s*=)")


@dataclass
class Finding:
    rule_id: str
    file: str
    line: int
    message: str
    snippet: str


class TestFunctionAnalyzer(ast.NodeVisitor):
    def __init__(self, test_func: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        self.test_func = test_func
        self.has_assertion = False
        self.conditional_assertions: list[ast.Assert] = []
        self.trivial_assertions: list[ast.Assert] = []
        self._ancestors: list[ast.AST] = []

    def visit(self, node: ast.AST) -> None:  # noqa: D401
        self._ancestors.append(node)
        super().visit(node)
        self._ancestors.pop()

    def visit_With(self, node: ast.With) -> None:
        if any(_is_pytest_raises(item.context_expr) for item in node.items):
            self.has_assertion = True
        self.generic_visit(node)

    def visit_AsyncWith(self, node: ast.AsyncWith) -> None:
        if any(_is_pytest_raises(item.context_expr) for item in node.items):
            self.has_assertion = True
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        if _is_unittest_assert_call(node):
            self.has_assertion = True
        self.generic_visit(node)

    def visit_Assert(self, node: ast.Assert) -> None:
        self.has_assertion = True
        if _is_conditional_context(self._ancestors[:-1]):
            self.conditional_assertions.append(node)
        if _is_trivial_assertion(node):
            self.trivial_assertions.append(node)
        self.generic_visit(node)


def _is_unittest_assert_call(node: ast.Call) -> bool:
    func = node.func
    return isinstance(func, ast.Attribute) and func.attr.startswith("assert")


def _is_pytest_raises(node: ast.AST) -> bool:
    if not isinstance(node, ast.Call):
        return False
    func = node.func
    if isinstance(func, ast.Name) and func.id == "raises":
        return True
    return (
        isinstance(func, ast.Attribute)
        and isinstance(func.value, ast.Name)
        and func.value.id == "pytest"
        and func.attr == "raises"
    )


def _is_conditional_context(ancestors: Iterable[ast.AST]) -> bool:
    conditional_nodes = (ast.If, ast.IfExp, ast.ExceptHandler)
    return any(isinstance(node, conditional_nodes) for node in ancestors)


def _literal_value(node: ast.AST):
    if isinstance(node, ast.Constant):
        return node.value
    return None


def _is_trivial_assertion(node: ast.Assert) -> bool:
    if isinstance(node.test, ast.Constant):
        return node.test.value is True

    if (
        isinstance(node.test, ast.Compare)
        and len(node.test.ops) == 1
        and len(node.test.comparators) == 1
    ):
        left = _literal_value(node.test.left)
        right = _literal_value(node.test.comparators[0])
        if left is None and right is None:
            return False
        if isinstance(node.test.ops[0], ast.Eq) and left == right:
            return True

    return False


def _decorator_name(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parts: list[str] = []
        current: ast.AST | None = node
        while isinstance(current, ast.Attribute):
            parts.append(current.attr)
            current = current.value
        if isinstance(current, ast.Name):
            parts.append(current.id)
        return ".".join(reversed(parts))
    if isinstance(node, ast.Call):
        return _decorator_name(node.func)
    return ""


def _is_skip_decorator(node: ast.AST) -> bool:
    name = _decorator_name(node)
    if not name:
        return False
    return (
        name in {"unittest.skip", "unittest.skipIf", "unittest.skipUnless"}
        or name.endswith(".skip")
        or name.endswith(".skipif")
        or name.endswith(".xfail")
    )


def _is_skip_call(node: ast.Call) -> bool:
    func = node.func
    if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
        if func.value.id == "pytest" and func.attr in {"skip", "xfail"}:
            return True
        if func.value.id == "self" and func.attr == "skipTest":
            return True
    return False


def _line_snippet(source_lines: list[str], line_no: int) -> str:
    if line_no <= 0 or line_no > len(source_lines):
        return ""
    return source_lines[line_no - 1].strip()


def _is_likely_test_file(path: Path) -> bool:
    if path.suffix != ".py":
        return False
    name = path.name.lower()
    return name.startswith("test_") or name.endswith("_test.py")


def _collect_files(root: Path) -> list[Path]:
    if not root.exists():
        return []
    if root.is_file():
        return [root]

    files: list[Path] = []
    stack = [root]
    while stack:
        current = stack.pop()
        for entry in current.iterdir():
            if entry.is_dir():
                if entry.name in SKIP_DIR_NAMES:
                    continue
                stack.append(entry)
                continue
            if entry.is_file():
                files.append(entry)
    return files


def _collect_commented_test_findings(source_lines: list[str], file_path: Path) -> list[Finding]:
    findings: list[Finding] = []
    for idx, line in enumerate(source_lines, start=1):
        if COMMENTED_TEST_RE.search(line):
            findings.append(
                Finding(
                    rule_id="weak.commented_out_test",
                    file=str(file_path),
                    line=idx,
                    message="Detected commented-out Python test declaration.",
                    snippet=line.strip(),
                )
            )
    return findings


def _collect_file_findings(file_path: Path) -> list[Finding]:
    source = file_path.read_text(encoding="utf-8")
    source_lines = source.splitlines()
    findings: list[Finding] = []

    findings.extend(_collect_commented_test_findings(source_lines, file_path))

    try:
        module = ast.parse(source, filename=str(file_path))
    except SyntaxError as exc:
        findings.append(
            Finding(
                rule_id="blocked.syntax_error",
                file=str(file_path),
                line=max(exc.lineno or 1, 1),
                message=f"Unable to parse Python test file: {exc.msg}",
                snippet=_line_snippet(source_lines, max(exc.lineno or 1, 1)),
            )
        )
        return findings

    test_funcs: list[ast.FunctionDef | ast.AsyncFunctionDef] = [
        node
        for node in module.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name.startswith("test_")
    ]

    for test_func in test_funcs:
        analyzer = TestFunctionAnalyzer(test_func)
        analyzer.visit(test_func)

        for decorator in test_func.decorator_list:
            if _is_skip_decorator(decorator):
                findings.append(
                    Finding(
                        rule_id="weak.skip_usage",
                        file=str(file_path),
                        line=decorator.lineno,
                        message="Detected Python skip marker (skip/skipif/xfail) on test case.",
                        snippet=_line_snippet(source_lines, decorator.lineno),
                    )
                )

        if not analyzer.has_assertion:
            findings.append(
                Finding(
                    rule_id="weak.no_assertion_in_test_case",
                    file=str(file_path),
                    line=test_func.lineno,
                    message="Detected Python test case without assert/pytest.raises-style assertions.",
                    snippet=f"def {test_func.name}(...)",
                )
            )

        for assertion in analyzer.conditional_assertions:
            findings.append(
                Finding(
                    rule_id="weak.conditional_assertion",
                    file=str(file_path),
                    line=assertion.lineno,
                    message="Detected conditional assertion pattern (if/try/except around assert).",
                    snippet=_line_snippet(source_lines, assertion.lineno),
                )
            )

        for assertion in analyzer.trivial_assertions:
            findings.append(
                Finding(
                    rule_id="weak.trivial_assertion",
                    file=str(file_path),
                    line=assertion.lineno,
                    message="Detected trivial Python assertion (assert True or same-literal equality).",
                    snippet=_line_snippet(source_lines, assertion.lineno),
                )
            )

    for node in ast.walk(module):
        if isinstance(node, ast.Call) and _is_skip_call(node):
            findings.append(
                Finding(
                    rule_id="weak.skip_usage",
                    file=str(file_path),
                    line=node.lineno,
                    message="Detected runtime skip marker in Python test (pytest.skip/pytest.xfail/self.skipTest).",
                    snippet=_line_snippet(source_lines, node.lineno),
                )
            )

    return findings


def _render_markdown(report: dict) -> str:
    findings = report["findings"]
    lines = [
        "## UIQ Python Test Truthiness Gate",
        f"- Profile: `{report['profile']}`",
        f"- Strict Mode: {'true' if report['strict'] else 'false'}",
        f"- Gate Status: **{report['gate']['status']}**",
        f"- reasonCode: `{report['gate']['reasonCode']}`",
        f"- Scan Roots: {', '.join(f'`{root}`' for root in report['scan']['roots']) or '(none)'}",
        f"- Candidate Files: {report['scan']['candidateFiles']}",
        f"- Test Files: {report['scan']['testFiles']}",
        f"- Findings: {len(findings)}",
        "",
        "| # | Rule | File | Line | Message |",
        "|---:|---|---|---:|---|",
    ]
    if not findings:
        lines.append("| 1 | `none` | `n/a` | 0 | No weak patterns detected. |")
    else:
        for idx, finding in enumerate(findings, start=1):
            message = str(finding["message"]).replace("|", "\\|")
            lines.append(
                f"| {idx} | `{finding['ruleId']}` | `{finding['file']}` | {finding['line']} | {message} |"
            )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", default="pr")
    parser.add_argument("--strict", choices=["true", "false"], default="false")
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR))
    parser.add_argument("--paths", default="")
    args = parser.parse_args()

    strict = args.strict == "true"
    roots = [Path(p.strip()) for p in args.paths.split(",") if p.strip()] or DEFAULT_ROOTS
    resolved_roots = [str(path.resolve()) for path in roots]

    candidate_files: list[Path] = []
    for root in roots:
        candidate_files.extend(_collect_files(root))
    deduped_candidates = sorted(set(candidate_files), key=lambda p: str(p))
    test_files = [path for path in deduped_candidates if _is_likely_test_file(path)]

    findings: list[Finding] = []
    for test_file in test_files:
        findings.extend(_collect_file_findings(test_file))

    if not test_files:
        gate = {"status": "blocked", "reasonCode": REASON_CODE["blocked"]}
    elif findings:
        gate = {"status": "failed", "reasonCode": REASON_CODE["failed"]}
    else:
        gate = {"status": "passed", "reasonCode": REASON_CODE["passed"]}

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "profile": args.profile,
        "strict": strict,
        "scan": {
            "roots": resolved_roots,
            "candidateFiles": len(deduped_candidates),
            "testFiles": len(test_files),
        },
        "gate": gate,
        "findings": [
            {
                "ruleId": finding.rule_id,
                "file": finding.file,
                "line": finding.line,
                "message": finding.message,
                "snippet": finding.snippet,
            }
            for finding in findings
        ],
    }

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_json = out_dir / f"{OUTPUT_PREFIX}-{args.profile}.json"
    out_md = out_dir / f"{OUTPUT_PREFIX}-{args.profile}.md"
    out_json.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    out_md.write_text(_render_markdown(report), encoding="utf-8")

    print(
        f"[uiq-pytest-truth-gate] gate_status={gate['status']} reason_code={gate['reasonCode']} "
        f"findings={len(findings)} test_files={len(test_files)}"
    )
    print(f"[uiq-pytest-truth-gate] artifact_json={out_json.resolve()}")
    print(f"[uiq-pytest-truth-gate] artifact_md={out_md.resolve()}")

    if strict and gate["status"] != "passed":
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
