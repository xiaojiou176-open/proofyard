import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const SCRIPT_PATH = resolve(REPO_ROOT, "scripts/ci/check-coverage-thresholds.mjs")

function writeJson(pathname, payload) {
  writeFileSync(pathname, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

function runGateWithFixtures({
  backendCoverage,
  frontendCoverage,
  appsWebCoverage = null,
  extraSources = [],
  extraCoverageFiles = [],
  governanceExceptions = [],
  debtRegisterRows = [],
  includeAppsWeb = false,
  coreTarget = "apps/api/app/api/register.py",
  globalBlockingSources = null,
}) {
  const root = mkdtempSync(join(tmpdir(), "uiq-coverage-thresholds-"))
  try {
    const configPath = join(root, "coverage-sources.json")
    const backendPath = join(root, "backend-coverage.json")
    const frontendPath = join(root, "frontend-coverage.json")
    const appsWebPath = join(root, "apps-web-coverage.json")
    const governancePath = join(root, "governance-exceptions.json")
    const debtRegisterPath = join(root, "debt-register.md")
    writeJson(configPath, {
      thresholds: {
        globalMin: 85,
        coreMin: 95,
        globalBranchesMin: 80,
        comparisonEpsilon: 0.05,
      },
      globalBlockingSources:
        globalBlockingSources ??
        ["backend", "frontend", ...(appsWebCoverage ? ["apps-web"] : []), ...extraSources.map((s) => s.name)],
      sources: [
        {
          name: "backend",
          kind: "pytest-json",
          path: backendPath,
          prefixes: ["apps/api/app/"],
          includeInGlobalGate: true,
        },
        {
          name: "frontend",
          kind: "summary-json",
          path: frontendPath,
          prefixes: ["apps/web/src/"],
          includeInGlobalGate: true,
        },
        ...(appsWebCoverage
          ? [
              {
                name: "apps-web",
                kind: "summary-json",
                path: appsWebPath,
                prefixes: ["apps/web/src/"],
                includeInGlobalGate: true,
              },
            ]
          : []),
        ...extraSources,
      ],
      coreTargets: [coreTarget],
    })
    writeJson(backendPath, backendCoverage)
    writeJson(frontendPath, frontendCoverage)
    writeJson(governancePath, {
      schemaVersion: 1,
      exceptions: governanceExceptions,
      examples: [],
    })
    writeFileSync(
      debtRegisterPath,
      [
        "# Governance Debt Register",
        "",
        "## Register",
        "",
        "| ID | 类型 | 路径 | 风险 | owner_role | 截止日期 | 退出标准 | 状态 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ...(debtRegisterRows.length > 0
          ? debtRegisterRows
          : [
              "| sample-gate-failure | gate_failure | packages/example.ts | sample risk | platform-owner | 2026-03-23 | remove the exception after the file is fixed | example |",
            ]),
        "",
      ].join("\n"),
      "utf8"
    )
    if (appsWebCoverage) {
      writeJson(appsWebPath, appsWebCoverage)
    }
    for (const file of extraCoverageFiles) {
      writeJson(file.path, file.payload)
    }

    return spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        UIQ_COVERAGE_CONFIG_PATH: configPath,
        UIQ_BACKEND_COVERAGE_JSON: backendPath,
        UIQ_FRONTEND_COVERAGE_JSON: frontendPath,
        UIQ_COVERAGE_INCLUDE_APPS_WEB: includeAppsWeb ? "true" : "false",
        ...(appsWebCoverage ? { UIQ_APPS_WEB_COVERAGE_JSON: appsWebPath } : {}),
        UIQ_CORE_COVERAGE_TARGETS: coreTarget,
        UIQ_GOVERNANCE_EXCEPTIONS_PATH: governancePath,
        UIQ_DEBT_REGISTER_PATH: debtRegisterPath,
        UIQ_GOVERNANCE_TODAY: "2026-03-10",
      },
      encoding: "utf8",
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("check-coverage-thresholds passes when core target has non-zero line/branch basis", () => {
  const run = runGateWithFixtures({
    backendCoverage: {
      totals: {
        percent_covered: 96,
        num_statements: 100,
        covered_lines: 96,
        percent_branches_covered: 96,
        num_branches: 20,
        covered_branches: 19,
      },
      files: {
        "apps/api/app/api/register.py": {
          summary: {
            percent_covered: 100,
            num_statements: 10,
            covered_lines: 10,
            percent_branches_covered: 100,
            num_branches: 4,
            covered_branches: 4,
          },
        },
      },
    },
    frontendCoverage: {
      total: {
        lines: { pct: 96, total: 25, covered: 24 },
        branches: { pct: 95, total: 20, covered: 19 },
      },
    },
  })

  assert.equal(run.status, 0, `stdout=${run.stdout}\nstderr=${run.stderr}`)
  assert.match(run.stdout, /\[coverage-gate\] pass/)
})

test("check-coverage-thresholds fails when core target has vacuous zero basis", () => {
  const run = runGateWithFixtures({
    backendCoverage: {
      totals: {
        percent_covered: 96,
        num_statements: 100,
        covered_lines: 96,
        percent_branches_covered: 96,
        num_branches: 20,
        covered_branches: 19,
      },
      files: {
        "apps/api/app/api/register.py": {
          summary: {
            percent_covered: 100,
            num_statements: 0,
            covered_lines: 0,
            percent_branches_covered: 100,
            num_branches: 0,
            covered_branches: 0,
          },
        },
      },
    },
    frontendCoverage: {
      total: {
        lines: { pct: 96, total: 25, covered: 24 },
        branches: { pct: 95, total: 20, covered: 19 },
      },
    },
  })

  assert.equal(run.status, 1, `stdout=${run.stdout}\nstderr=${run.stderr}`)
  assert.match(run.stderr, /lines basis is zero/)
  assert.match(run.stderr, /branches basis is zero/)
})

test("check-coverage-thresholds fails when optional apps/web source is enabled and below the global threshold", () => {
  const run = runGateWithFixtures({
    includeAppsWeb: true,
    backendCoverage: {
      totals: {
        percent_covered: 97,
        num_statements: 100,
        covered_lines: 97,
        percent_branches_covered: 96,
        num_branches: 25,
        covered_branches: 24,
      },
      files: {
        "apps/api/app/api/register.py": {
          summary: {
            percent_covered: 100,
            num_statements: 10,
            covered_lines: 10,
            percent_branches_covered: 100,
            num_branches: 4,
            covered_branches: 4,
          },
        },
      },
    },
    frontendCoverage: {
      total: {
        lines: { pct: 96, total: 50, covered: 48 },
        branches: { pct: 95, total: 20, covered: 19 },
      },
    },
    appsWebCoverage: {
      total: {
        lines: { pct: 84, total: 50, covered: 42 },
        branches: { pct: 76.66, total: 30, covered: 23 },
      },
      "apps/web/src/App.tsx": {
        lines: { pct: 84, total: 50, covered: 42 },
        branches: { pct: 76.66, total: 30, covered: 23 },
      },
    },
  })

  assert.equal(run.status, 1, `stdout=${run.stdout}\nstderr=${run.stderr}`)
  assert.match(run.stderr, /global lines/)
  assert.match(run.stderr, /global branches/)
})

test("check-coverage-thresholds honors explicit governance exceptions for global sources", () => {
  const packagesPath = join(tmpdir(), "packages-coverage.json")
  const run = runGateWithFixtures({
    backendCoverage: {
      totals: {
        percent_covered: 97,
        num_statements: 100,
        covered_lines: 97,
        percent_branches_covered: 96,
        num_branches: 25,
        covered_branches: 24,
      },
      files: {
        "apps/api/app/api/register.py": {
          summary: {
            percent_covered: 100,
            num_statements: 10,
            covered_lines: 10,
            percent_branches_covered: 100,
            num_branches: 4,
            covered_branches: 4,
          },
        },
      },
    },
    frontendCoverage: {
      total: {
        lines: { pct: 96, total: 50, covered: 48 },
        branches: { pct: 95, total: 20, covered: 19 },
      },
    },
    extraSources: [
      {
        name: "packages",
        kind: "summary-json",
        path: packagesPath,
        prefixes: ["packages/orchestrator/src/commands/run/"],
        includeInGlobalGate: true,
      },
    ],
    extraCoverageFiles: [
      {
        path: packagesPath,
        payload: {
          total: {
            lines: { pct: 70, total: 100, covered: 70 },
            branches: { pct: 70, total: 40, covered: 28 },
          },
          "packages/orchestrator/src/commands/run/example.ts": {
            lines: { pct: 70, total: 100, covered: 70 },
            branches: { pct: 70, total: 40, covered: 28 },
          },
        },
      },
    ],
    governanceExceptions: [
      {
        id: "coverage-packages",
        gate: "coverage-global-source",
        path: "packages",
        reason: "tracked debt",
        owner_role: "platform-owner",
        expires_on: "2026-03-24",
        debt_ref: "DEBT-2026-03-10-100",
      },
    ],
    debtRegisterRows: [
      "| DEBT-2026-03-10-100 | test_gap | packages | pending coverage | platform-owner | 2026-03-24 | raise coverage | active |",
    ],
  })

  assert.equal(run.status, 0, `stdout=${run.stdout}\nstderr=${run.stderr}`)
  assert.match(run.stdout, /\[coverage-gate\]\[source-exception\] packages/)
  assert.match(run.stdout, /\[coverage-gate\]\[excepted\].*source lines packages/)
})

test("check-coverage-thresholds fails when configured global source list drifts", () => {
  const run = runGateWithFixtures({
    globalBlockingSources: ["backend", "frontend", "apps-web", "packages", "automation"],
    backendCoverage: {
      totals: {
        percent_covered: 96,
        num_statements: 100,
        covered_lines: 96,
        percent_branches_covered: 96,
        num_branches: 20,
        covered_branches: 19,
      },
      files: {
        "apps/api/app/api/register.py": {
          summary: {
            percent_covered: 100,
            num_statements: 10,
            covered_lines: 10,
            percent_branches_covered: 100,
            num_branches: 4,
            covered_branches: 4,
          },
        },
      },
    },
    frontendCoverage: {
      total: {
        lines: { pct: 96, total: 25, covered: 24 },
        branches: { pct: 95, total: 20, covered: 19 },
      },
    },
  })

  assert.equal(run.status, 2, `stdout=${run.stdout}\nstderr=${run.stderr}`)
  assert.match(run.stderr, /global source drift/)
})
