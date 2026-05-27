from __future__ import annotations

import shutil
from dataclasses import dataclass


@dataclass(frozen=True)
class CommandSpec:
    command_id: str
    title: str
    description: str
    argv: list[str]
    tags: list[str]


# Commands explicitly allowed from remote automation APIs.
# High-risk commands are intentionally excluded and must return 403.
SAFE_AUTOMATION_COMMANDS: frozenset[str] = frozenset(
    {
        "run",
        "run-midscene",
        "run-ui",
        "run-ui-midscene",
        "lint-frontend",
        "automation-lint",
        "automation-extract",
        "automation-extract-video",
        "automation-generate-case",
        "automation-generate-reconstruction",
        "automation-replay",
        "automation-reconstruct-and-replay",
        "automation-replay-flow",
        "automation-replay-flow-step",
        "automation-test",
        "backend-test",
    }
)

# Commands rejected from remote automation APIs because they can mutate local
# development environment, delete data, or keep long-running local processes.
HIGH_RISK_AUTOMATION_COMMANDS: frozenset[str] = frozenset(
    {
        "setup",
        "clean",
        "map",
        "diagnose",
        "dev-frontend",
        "automation-install",
        "automation-record",
        "automation-record-manual",
        "automation-record-midscene",
    }
)


def is_safe_automation_command(command_id: str) -> bool:
    return command_id in SAFE_AUTOMATION_COMMANDS


def is_high_risk_automation_command(command_id: str) -> bool:
    return command_id in HIGH_RISK_AUTOMATION_COMMANDS


def _shell_argv(command: str) -> list[str]:
    for shell in ("zsh", "bash", "sh"):
        if shutil.which(shell):
            return [shell, "-lc", command]
    return ["sh", "-lc", command]


def build_command_specs() -> dict[str, CommandSpec]:
    return {
        "setup": CommandSpec(
            command_id="setup",
            title="Initialize environment",
            description="Prepare the local runtime environment using scripts/setup.sh",
            argv=["./scripts/setup.sh"],
            tags=["init", "env"],
        ),
        "run": CommandSpec(
            command_id="run",
            title="Run canonical orchestrator mainline",
            description="Execute the default orchestrator-first PR run and emit manifest-first evidence",
            argv=["pnpm", "uiq", "run", "--profile", "pr", "--target", "web.local"],
            tags=["pipeline", "full", "canonical"],
        ),
        "run-midscene": CommandSpec(
            command_id="run-midscene",
            title="Run legacy workshop helper pipeline (intelligent vision mode)",
            description=(
                "Execute the lower-level record -> extract -> generate -> replay helper path "
                "with intelligent vision; not the canonical public mainline"
            ),
            argv=["./scripts/run-pipeline.sh", "midscene"],
            tags=["pipeline", "full", "ai", "helper", "legacy", "workshop"],
        ),
        "run-ui": CommandSpec(
            command_id="run-ui",
            title="Run legacy workshop UI helper pipeline",
            description=(
                "Capture the lower-level UI-only workshop helper path without replaying API "
                "traffic; not the canonical public mainline"
            ),
            argv=["./scripts/run-pipeline.sh", "manual", "ui-only"],
            tags=["pipeline", "ui-only", "helper", "legacy", "workshop"],
        ),
        "run-ui-midscene": CommandSpec(
            command_id="run-ui-midscene",
            title="Run legacy workshop UI helper pipeline (intelligent vision mode)",
            description=(
                "Capture the lower-level UI-only workshop helper path with intelligent vision "
                "without replaying API traffic; not the canonical public mainline"
            ),
            argv=["./scripts/run-pipeline.sh", "midscene", "ui-only"],
            tags=["pipeline", "ui-only", "ai", "helper", "legacy", "workshop"],
        ),
        "clean": CommandSpec(
            command_id="clean",
            title="Clean temporary files",
            description="Clean runtime caches and Python bytecode artifacts",
            argv=[
                "zsh",
                "-lc",
                "mkdir -p .runtime-cache/temp && find .runtime-cache/temp -mindepth 1 -maxdepth 1 -exec rm -rf {} + && find . -type d -name '__pycache__' -prune -exec rm -rf {} + && find . -type f -name '*.pyc' -delete",
            ],
            tags=["maintenance"],
        ),
        "map": CommandSpec(
            command_id="map",
            title="Refresh repository map",
            description="Regenerate the repository tree map at .codex/repo-map.tree",
            argv=[
                "zsh",
                "-lc",
                "tree -I 'node_modules|.git|.runtime-cache|__pycache__|.venv|dist' -L 4 > .codex/repo-map.tree",
            ],
            tags=["maintenance"],
        ),
        "diagnose": CommandSpec(
            command_id="diagnose",
            title="Large file diagnostics",
            description="Scan apps and shared packages for Python or TypeScript files over 500 lines",
            argv=[
                "zsh",
                "-lc",
                "echo 'Checking for files > 500 lines' && find apps packages -type f \\( -name '*.py' -o -name '*.ts' -o -name '*.tsx' \\) -exec wc -l {} + | awk '$1 > 500 { print }'",
            ],
            tags=["maintenance", "diagnose"],
        ),
        "dev-frontend": CommandSpec(
            command_id="dev-frontend",
            title="Start frontend preview service",
            description="Start the frontend development server (long-running, stop manually when finished)",
            argv=_shell_argv("cd apps/web && pnpm dev"),
            tags=["frontend", "dev", "long-running"],
        ),
        "lint-frontend": CommandSpec(
            command_id="lint-frontend",
            title="Lint frontend code",
            description="Run frontend lint checks with ESLint",
            argv=_shell_argv("cd apps/web && pnpm lint"),
            tags=["frontend", "lint"],
        ),
        "automation-install": CommandSpec(
            command_id="automation-install",
            title="Install automation dependencies",
            description="Install dependencies required by the automation runner",
            argv=_shell_argv("cd apps/automation-runner && pnpm install"),
            tags=["automation", "install"],
        ),
        "automation-lint": CommandSpec(
            command_id="automation-lint",
            title="Lint automation code",
            description="Run automation lint checks with ESLint",
            argv=_shell_argv("cd apps/automation-runner && pnpm lint"),
            tags=["automation", "lint"],
        ),
        "automation-record": CommandSpec(
            command_id="automation-record",
            title="Record actions (default mode)",
            description="Run the default recording command (pnpm record)",
            argv=_shell_argv("cd apps/automation-runner && pnpm record"),
            tags=["automation", "record"],
        ),
        "automation-record-manual": CommandSpec(
            command_id="automation-record-manual",
            title="Record actions (manual mode)",
            description="Run the manual recording command (pnpm record:manual)",
            argv=_shell_argv("cd apps/automation-runner && pnpm record:manual"),
            tags=["automation", "record", "manual"],
        ),
        "automation-record-midscene": CommandSpec(
            command_id="automation-record-midscene",
            title="Record actions (intelligent vision mode)",
            description="Run the intelligent vision recording command (pnpm record:midscene)",
            argv=_shell_argv("cd apps/automation-runner && pnpm record:midscene"),
            tags=["automation", "record", "ai"],
        ),
        "automation-extract": CommandSpec(
            command_id="automation-extract",
            title="Extract flow specification",
            description="Extract the recorded flow and generate flow_request.spec.json",
            argv=_shell_argv("cd apps/automation-runner && pnpm extract"),
            tags=["automation", "extract"],
        ),
        "automation-extract-video": CommandSpec(
            command_id="automation-extract-video",
            title="Extract video step candidates",
            description="Run the video step extraction command (pnpm extract:video)",
            argv=_shell_argv("cd apps/automation-runner && pnpm extract:video"),
            tags=["automation", "extract", "video"],
        ),
        "automation-generate-case": CommandSpec(
            command_id="automation-generate-case",
            title="Generate test cases",
            description="Run the test case generation command (pnpm generate-case)",
            argv=_shell_argv("cd apps/automation-runner && pnpm generate-case"),
            tags=["automation", "generate"],
        ),
        "automation-generate-reconstruction": CommandSpec(
            command_id="automation-generate-reconstruction",
            title="Generate reconstruction artifacts",
            description="Run the reconstruction generation command (pnpm generate:reconstruction)",
            argv=_shell_argv("cd apps/automation-runner && pnpm generate:reconstruction"),
            tags=["automation", "generate", "reconstruction"],
        ),
        "automation-replay": CommandSpec(
            command_id="automation-replay",
            title="Replay registration flow",
            description="Run the flow replay command (pnpm replay)",
            argv=_shell_argv("cd apps/automation-runner && pnpm replay"),
            tags=["automation", "replay"],
        ),
        "automation-reconstruct-and-replay": CommandSpec(
            command_id="automation-reconstruct-and-replay",
            title="Reconstruct and replay",
            description="Generate reconstruction artifacts and replay the flow automatically",
            argv=_shell_argv("cd apps/automation-runner && pnpm reconstruct-and-replay"),
            tags=["automation", "reconstruction", "replay"],
        ),
        "automation-replay-flow": CommandSpec(
            command_id="automation-replay-flow",
            title="Replay latest flow draft",
            description="Replay the most recent flow draft (pnpm replay-flow)",
            argv=_shell_argv("cd apps/automation-runner && pnpm replay-flow"),
            tags=["automation", "replay", "flow"],
        ),
        "automation-replay-flow-step": CommandSpec(
            command_id="automation-replay-flow-step",
            title="Replay latest flow draft one step at a time",
            description="Run a single-step replay for the latest flow draft by step_id",
            argv=_shell_argv("cd apps/automation-runner && pnpm replay-flow-step"),
            tags=["automation", "replay", "flow", "step"],
        ),
        "automation-test": CommandSpec(
            command_id="automation-test",
            title="Run automation tests",
            description="Run browser automation tests with Playwright",
            argv=_shell_argv("cd apps/automation-runner && pnpm test"),
            tags=["automation", "test"],
        ),
        "backend-test": CommandSpec(
            command_id="backend-test",
            title="Run backend tests",
            description="Run the backend test suite with pytest",
            argv=_shell_argv(
                ". scripts/lib/python-runtime.sh && ensure_project_python_env_exports && "
                "\"$(project_python_bin)\" -m pytest"
            ),
            tags=["backend", "test"],
        ),
    }
