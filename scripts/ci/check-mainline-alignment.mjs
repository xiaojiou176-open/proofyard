#!/usr/bin/env node

import fs from "node:fs"

const checks = [
  {
    path: "README.md",
    required: [
      {
        label: "canonical public mainline heading",
        pattern: /The canonical public mainline is:/,
      },
      {
        label: "canonical public run wrapper",
        pattern: /just run/,
      },
      {
        label: "canonical orchestrator command",
        pattern: /pnpm uiq run --profile pr --target web\.local/,
      },
      {
        label: "legacy path explicitly downgraded",
        pattern: /no longer the canonical public mainline\.|not the canonical public mainline\./,
      },
    ],
  },
  {
    path: "justfile",
    required: [
      {
        label: "run recipe points at orchestrator-first command",
        pattern: /^\s*run:\n\s+pnpm uiq run --profile pr --target web\.local/m,
      },
      {
        label: "run-legacy recipe remains manual pipeline wrapper",
        pattern: /^\s*run-legacy:\n\s+\.\/scripts\/run-pipeline\.sh manual/m,
      },
      {
        label: "legacy helper recipes announce canonical public mainline",
        pattern: /canonical public mainline is: pnpm uiq run --profile pr --target web\.local/,
      },
    ],
  },
  {
    path: "configs/tooling/Makefile",
    required: [
      {
        label: "tooling Makefile run recipe points at orchestrator-first command",
        pattern: /^\s*run:\n\tpnpm uiq run --profile pr --target web\.local/m,
      },
      {
        label: "tooling Makefile keeps explicit run-legacy recipe",
        pattern: /^\s*run-legacy:\n\t\.\/scripts\/run-pipeline\.sh manual/m,
      },
      {
        label: "tooling Makefile helper recipes announce canonical public mainline",
        pattern: /canonical public mainline is: pnpm uiq run --profile pr --target web\.local/,
      },
    ],
    forbidden: [
      {
        label: "tooling Makefile run still points at manual pipeline",
        pattern: /^\s*run:\n\t\.\/scripts\/run-pipeline\.sh manual/m,
      },
    ],
  },
  {
    path: "docs/showcase/minimal-success-case.md",
    required: [
      {
        label: "showcase names canonical public mainline",
        pattern: /The canonical public mainline can:/,
      },
      {
        label: "showcase points to just run",
        pattern: /just run/,
      },
      {
        label: "showcase includes direct orchestrator command",
        pattern: /pnpm uiq run --profile pr --target web\.local/,
      },
      {
        label: "showcase demotes legacy path",
        pattern: /not the canonical public mainline/,
      },
      {
        label: "showcase keeps internal run aligned with canonical chain",
        pattern: /Internal automation surfaces should resolve `run` to this same command\./,
      },
    ],
  },
  {
    path: "docs/cli.md",
    required: [
      {
        label: "cli guide names just run as canonical public mainline",
        pattern: /canonical public mainline[\s\S]*?`just run`/,
      },
      {
        label: "cli guide includes direct orchestrator command",
        pattern: /pnpm uiq run --profile pr --target web\.local/,
      },
      {
        label: "cli guide marks run-legacy as manual workshop path",
        pattern: /`just run-legacy`[\s\S]*?manual workshop path/,
      },
      {
        label: "cli guide aligns internal run surfaces with canonical path",
        pattern: /Internal automation surfaces that expose `run` should resolve to the same orchestrator-first path/,
      },
    ],
  },
  {
    path: "docs/reference/run-evidence-example.md",
    required: [
      {
        label: "run evidence reference includes canonical orchestrator command",
        pattern: /pnpm uiq run --profile pr --target web\.local/,
      },
      {
        label: "run evidence reference aligns internal run with canonical chain",
        pattern: /internal automation surface executes `run` against that canonical chain/,
      },
      {
        label: "run evidence reference demotes helper outputs",
        pattern: /helper-path outputs, not the canonical public mainline evidence surface/,
      },
    ],
  },
  {
    path: "docs/getting-started/human-first-10-min.md",
    required: [
      {
        label: "human-first guide keeps just run as canonical wrapper",
        pattern: /`just run`: canonical public mainline wrapper for `pnpm uiq run --profile pr --target web\.local`/,
      },
      {
        label: "human-first guide aligns internal run surfaces",
        pattern: /Internal automation surfaces should map `run` to that same orchestrator-first command/,
      },
      {
        label: "human-first guide demotes run-legacy",
        pattern: /`just run-legacy`: lower-level record\/extract\/replay helper path, not the public default mainline/,
      },
    ],
  },
  {
    path: "docs/how-to/mcp-quickstart-1pager.md",
    required: [
      {
        label: "mcp quickstart includes canonical repo mainline",
        pattern: /Repo mainline: `just run` \/ `pnpm uiq run --profile pr --target web\.local`/,
      },
      {
        label: "mcp quickstart keeps mcp as side road",
        pattern: /repo mainline is the public default road, while this MCP page is the operator side road/,
      },
      {
        label: "mcp quickstart aligns internal generic run surface",
        pattern: /internal generic `run` surface, it should still resolve to that same repo mainline rather than the manual workshop pipeline/,
      },
    ],
  },
  {
    path: "docs/architecture.md",
    required: [
      {
        label: "architecture retains orchestrator-first contract",
        pattern: /- Orchestrator-first: `pnpm uiq <command>` composes profile \+ target and writes/,
      },
      {
        label: "architecture retains manifest-first contract",
        pattern: /- Manifest-first: every run writes/,
      },
    ],
    forbidden: [
      {
        label: "legacy Flow -> Template -> Run path presented as canonical primary path",
        pattern: /Canonical primary path is `Flow -> Template -> Run`, executed by\s+`scripts\/run-pipeline\.sh`\./m,
      },
    ],
  },
  {
    path: "apps/api/app/services/automation_commands.py",
    required: [
      {
        label: "automation command run title names canonical orchestrator mainline",
        pattern: /title="Run canonical orchestrator mainline"/,
      },
      {
        label: "automation command run uses canonical orchestrator argv",
        pattern:
          /"run": CommandSpec\([\s\S]*?argv=\["pnpm", "uiq", "run", "--profile", "pr", "--target", "web\.local"\]/m,
      },
      {
        label: "helper commands are explicitly demoted",
        pattern: /not the canonical public mainline/,
      },
    ],
    forbidden: [
      {
        label: "automation command run still points to manual pipeline",
        pattern:
          /"run": CommandSpec\([\s\S]*?argv=\["\.\/scripts\/run-pipeline\.sh", "manual"\]/m,
      },
    ],
  },
  {
    path: "apps/api/app/services/automation_commands.py",
    required: [
      {
        label: "run command points at canonical orchestrator command",
        pattern: /"run":[\s\S]*?argv=\["pnpm", "uiq", "run", "--profile", "pr", "--target", "web\.local"\]/,
      },
      {
        label: "run command describes canonical orchestrator mainline",
        pattern: /"run":[\s\S]*?title="Run canonical orchestrator mainline"/,
      },
      {
        label: "helper commands are explicitly downgraded",
        pattern: /not the canonical public mainline/,
      },
    ],
    forbidden: [
      {
        label: "run command still points at manual pipeline",
        pattern: /"run":[\s\S]*?argv=\["\.\/scripts\/run-pipeline\.sh", "manual"\]/,
      },
    ],
  },
]

const failures = []

for (const check of checks) {
  if (!fs.existsSync(check.path)) {
    failures.push(`missing required mainline surface: ${check.path}`)
    continue
  }

  const content = fs.readFileSync(check.path, "utf8")

  for (const requirement of check.required ?? []) {
    if (!requirement.pattern.test(content)) {
      failures.push(`${check.path}: missing ${requirement.label}`)
    }
  }

  for (const forbidden of check.forbidden ?? []) {
    if (forbidden.pattern.test(content)) {
      failures.push(`${check.path}: found forbidden drift: ${forbidden.label}`)
    }
  }
}

if (failures.length > 0) {
  console.error("[mainline-alignment] failed:")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`[mainline-alignment] ok (${checks.length} surface(s))`)
