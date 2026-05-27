import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const SCRIPT = resolve(REPO_ROOT, "scripts/ci/hooks-equivalence-gate.sh")

function writeExecutable(pathname, source) {
  writeFileSync(pathname, source, "utf8")
  chmodSync(pathname, 0o755)
}

test("hooks-equivalence gate preserves failing step exit codes in its report", () => {
  const root = mkdtempSync(join(tmpdir(), "hooks-equivalence-gate-"))
  const binDir = join(root, "bin")
  const scriptPath = join(root, "scripts/ci/hooks-equivalence-gate.sh")
  const reportPath = join(root, ".runtime-cache/artifacts/ci/hooks-equivalence-gate.json")

  try {
    mkdirSync(binDir, { recursive: true })
    mkdirSync(dirname(scriptPath), { recursive: true })
    cpSync(SCRIPT, scriptPath)
    writeExecutable(
      join(binDir, "git"),
      `#!/usr/bin/env bash
if [[ "$1" == "rev-parse" ]]; then
  exit 1
fi
if [[ "$1" == "log" ]]; then
  exit 0
fi
exit 0
`
    )
    writeExecutable(
      join(binDir, "python3"),
      `#!/usr/bin/env bash
if [[ "$1" == "-" ]]; then
  /usr/bin/python3 "$@"
  exit $?
fi
printf '0\n'
`
    )

    const stubCommands = {
      "scripts/ci/run-in-container.sh": 42,
      "scripts/ci/lint-all.sh": 0,
      "scripts/ci/check-observability-contract.sh": 0,
      "scripts/ci/run-unit-coverage-gate.sh": 0,
      "scripts/ci/uiq-test-truth-gate.mjs": 0,
      "scripts/ci/uiq-pytest-truth-gate.py": 0,
      "scripts/ci/check-doc-links.mjs": 0,
      "scripts/ci/atomic-commit-gate.sh": 0,
      "scripts/ci/pre-push-required-gates.sh": 0,
      "scripts/ci/pre-commit-required-gates.sh": 0,
    }

    for (const [relativePath, exitCode] of Object.entries(stubCommands)) {
      const target = join(root, relativePath)
      mkdirSync(dirname(target), { recursive: true })
      writeExecutable(
        target,
        `#!/usr/bin/env bash
exit ${exitCode}
`
      )
    }

    const run = spawnSync("bash", [scriptPath], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        UIQ_DOCS_LINK_BASE_REF: "HEAD~1",
        UIQ_DOCS_LINK_HEAD_REF: "HEAD",
      },
      encoding: "utf8",
    })

    assert.equal(run.status, 1)
    const report = JSON.parse(readFileSync(reportPath, "utf8"))
    const failedStep = report.steps.find((step) => step.name === "container_contract_gate")
    assert.ok(failedStep)
    assert.equal(failedStep.status, "failed")
    assert.equal(failedStep.exit_code, 42)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("hooks-equivalence gate uses pull request head sha instead of synthetic merge sha", () => {
  const root = mkdtempSync(join(tmpdir(), "hooks-equivalence-gate-pr-head-"))
  const binDir = join(root, "bin")
  const scriptPath = join(root, "scripts/ci/hooks-equivalence-gate.sh")
  const argsPath = join(root, "atomic-commit-args.txt")
  const eventPath = join(root, "pull-request-event.json")

  try {
    mkdirSync(binDir, { recursive: true })
    mkdirSync(dirname(scriptPath), { recursive: true })
    cpSync(SCRIPT, scriptPath)
    writeFileSync(
      eventPath,
      JSON.stringify({
        pull_request: {
          head: {
            sha: "pr-head-sha-123",
          },
        },
      }),
      "utf8"
    )
    writeExecutable(
      join(binDir, "git"),
      `#!/usr/bin/env bash
if [[ "$1" == "rev-parse" ]]; then
  exit 0
fi
if [[ "$1" == "rev-list" ]]; then
  exit 0
fi
exit 0
`
    )
    writeExecutable(
      join(binDir, "python3"),
      `#!/usr/bin/env bash
/usr/bin/python3 "$@"
`
    )
    writeExecutable(
      join(binDir, "node"),
      `#!/usr/bin/env bash
exit 0
`
    )
    writeExecutable(
      join(binDir, "pre-commit"),
      `#!/usr/bin/env bash
exit 0
`
    )
    writeExecutable(
      join(binDir, "pnpm"),
      `#!/usr/bin/env bash
exit 0
`
    )

    const stubCommands = {
      "scripts/ci/run-in-container.sh": "#!/usr/bin/env bash\nexit 0\n",
      "scripts/ci/lint-all.sh": "#!/usr/bin/env bash\nexit 0\n",
      "scripts/ci/check-observability-contract.sh": "#!/usr/bin/env bash\nexit 0\n",
      "scripts/ci/run-unit-coverage-gate.sh": "#!/usr/bin/env bash\nexit 0\n",
      "scripts/ci/uiq-test-truth-gate.mjs": "process.exit(0)\n",
      "scripts/ci/uiq-pytest-truth-gate.py": "#!/usr/bin/env python3\nprint('ok')\n",
      "scripts/ci/check-doc-links.mjs": "process.exit(0)\n",
      "scripts/ci/pre-push-required-gates.sh": `#!/usr/bin/env bash
if [[ "$*" == *"--dry-run"* ]]; then
  if [[ "\${UIQ_PREPUSH_REQUIRED_MODE:-}" == "balanced" ]]; then
    printf '%s\n' "mode=balanced"
    printf '%s\n' "openai-residue-gate"
    printf '%s\n' "delegation_summary=ci_required"
  else
    printf '%s\n' "mode=strict"
    printf '%s\n' "hooks-equivalence-gate"
    printf '%s\n' "docs-gate"
  fi
fi
exit 0
`,
      "scripts/ci/pre-commit-required-gates.sh": `#!/usr/bin/env bash
if [[ "$*" == *"--dry-run"* ]]; then
  if [[ "\${UIQ_PRECOMMIT_REQUIRED_REPO_WIDE_GATES:-false}" == "true" ]]; then
    printf '%s\n' "mode=strict"
    printf '%s\n' "container-contract-gate"
    printf '%s\n' "lint-all-container"
    printf '%s\n' "docs-gate"
    printf '%s\n' "mutation-ts-strict"
    printf '%s\n' "security-scan"
  else
    printf '%s\n' "mode=strict"
    printf '%s\n' "repo_wide=false"
    printf '%s\n' "env_docs=false"
    printf '%s\n' "heavy=false"
    printf '%s\n' "repo-wide lint/container delegated to pre-push/CI"
    printf '%s\n' "docs/governance gates delegated to pre-push/CI"
    printf '%s\n' "heavy gates delegated to pre-push/CI"
  fi
fi
exit 0
`,
    }

    for (const [relativePath, source] of Object.entries(stubCommands)) {
      const target = join(root, relativePath)
      mkdirSync(dirname(target), { recursive: true })
      writeExecutable(target, source)
    }

    writeExecutable(
      join(root, "scripts/ci/atomic-commit-gate.sh"),
      `#!/usr/bin/env bash
printf '%s\\n' "$*" > "${argsPath}"
exit 0
`
    )

    const run = spawnSync("bash", [scriptPath], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        UIQ_DOCS_LINK_BASE_REF: "origin/main",
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_SHA: "synthetic-merge-sha",
      },
      encoding: "utf8",
    })

    assert.equal(run.status, 0)
    const atomicArgs = readFileSync(argsPath, "utf8")
    assert.match(atomicArgs, /--to pr-head-sha-123/)
    assert.doesNotMatch(atomicArgs, /synthetic-merge-sha/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
