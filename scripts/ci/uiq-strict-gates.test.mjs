import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const TEST_TRUTH_GATE_SCRIPT = resolve(REPO_ROOT, "scripts/ci/uiq-test-truth-gate.mjs")
const FLAKE_BUDGET_SCRIPT = resolve(REPO_ROOT, "scripts/ci/uiq-flake-budget.mjs")
const MCP_STRESS_GATE_SCRIPT = resolve(REPO_ROOT, "scripts/ci/uiq-mcp-stress-gate.mjs")
const GEMINI_LIVE_SMOKE_GATE_SCRIPT = resolve(
  REPO_ROOT,
  "scripts/ci/uiq-gemini-live-smoke-gate.mjs"
)
const GEMINI_UIUX_AUDIT_SCRIPT = resolve(REPO_ROOT, "scripts/ci/uiq-gemini-uiux-audit.mjs")
const AI_REVIEW_SCRIPT = resolve(REPO_ROOT, "scripts/ci/uiq-ai-review.mjs")
const REPO_PACKAGE_JSON = resolve(REPO_ROOT, "package.json")

test("uiq-test-truth-gate exits non-zero in strict mode when gate is blocked", () => {
  const root = mkdtempSync(join(tmpdir(), "uiq-truth-gate-"))
  try {
    const emptyTests = join(root, "empty-tests")
    const outDir = join(root, "out")
    mkdirSync(emptyTests, { recursive: true })

    const run = spawnSync(
      process.execPath,
      [
        TEST_TRUTH_GATE_SCRIPT,
        "--profile",
        "pr",
        "--strict",
        "true",
        "--paths",
        emptyTests,
        "--out-dir",
        outDir,
      ],
      {
        cwd: REPO_ROOT,
        env: process.env,
        encoding: "utf8",
      }
    )

    assert.equal(run.status, 1)
    const report = JSON.parse(readFileSync(join(outDir, "uiq-test-truth-gate-pr.json"), "utf8"))
    assert.equal(report.gate.status, "blocked")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("uiq-flake-budget exits non-zero in strict mode when gate is blocked", () => {
  const root = mkdtempSync(join(tmpdir(), "uiq-flake-gate-"))
  try {
    const runsDir = join(root, "runs")
    const runDir = join(runsDir, "run-1")
    const outDir = join(root, "out")
    const profilesDir = join(root, "profiles")
    mkdirSync(runDir, { recursive: true })
    mkdirSync(outDir, { recursive: true })
    mkdirSync(profilesDir, { recursive: true })
    writeFileSync(join(profilesDir, "test.yaml"), "name: test\nsteps: []\ngates: {}\n", "utf8")
    writeFileSync(
      join(runDir, "manifest.json"),
      `${JSON.stringify({ runId: "run-1", profile: "test", summary: {} }, null, 2)}\n`,
      "utf8"
    )

    const run = spawnSync(
      process.execPath,
      [
        FLAKE_BUDGET_SCRIPT,
        "--profile",
        "test",
        "--runs-dir",
        runsDir,
        "--strict",
        "true",
        "--out-dir",
        outDir,
      ],
      {
        cwd: root,
        env: process.env,
        encoding: "utf8",
      }
    )

    assert.equal(run.status, 2)
    const report = JSON.parse(readFileSync(join(outDir, "uiq-test-flake-budget.json"), "utf8"))
    assert.equal(report.flake.gate.status, "blocked")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("uiq-mcp-stress-gate exits non-zero in strict mode when gate is blocked", () => {
  const root = mkdtempSync(join(tmpdir(), "uiq-mcp-stress-gate-"))
  try {
    const outDir = join(root, "out")
    const profilesDir = join(root, "profiles")
    mkdirSync(outDir, { recursive: true })
    mkdirSync(profilesDir, { recursive: true })
    writeFileSync(join(profilesDir, "test.yaml"), "name: test\nsteps: []\ngates: {}\n", "utf8")

    const run = spawnSync(
      process.execPath,
      [
        MCP_STRESS_GATE_SCRIPT,
        "--profile",
        "test",
        "--iterations",
        "1",
        "--strict",
        "true",
        "--out-dir",
        outDir,
      ],
      {
        cwd: root,
        env: process.env,
        encoding: "utf8",
      }
    )

    assert.equal(run.status, 1)
    const report = JSON.parse(readFileSync(join(outDir, "uiq-mcp-stress-gate-test.json"), "utf8"))
    assert.equal(report.gate.status, "blocked")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("uiq-gemini-live-smoke-gate accepts local WebUI runtime URLs in strict mode", () => {
  const root = mkdtempSync(join(tmpdir(), "uiq-gemini-live-smoke-gate-"))
  try {
    const outDir = join(root, "out")
    mkdirSync(outDir, { recursive: true })
    const env = {
      ...process.env,
      UIQ_GEMINI_LIVE_SMOKE_REQUIRED: "true",
      UIQ_BASE_URL: "http://127.0.0.1:17380",
      LIVE_GEMINI_API_KEY: "live-fallback-key",
    }
    const run = spawnSync(
      process.execPath,
      [GEMINI_LIVE_SMOKE_GATE_SCRIPT, "--strict", "true", "--out-dir", outDir],
      {
        cwd: REPO_ROOT,
        env,
        encoding: "utf8",
      }
    )
    assert.ok(run.status === 0 || run.status === 1)
    const report = JSON.parse(readFileSync(join(outDir, "uiq-gemini-live-smoke-gate.json"), "utf8"))
    assert.equal(report.request.browserBaseUrl, "http://127.0.0.1:17380/")
    assert.notEqual(report.reasonCode, "gate.gemini_live_smoke.failed.base_url_not_external")
    assert.notEqual(report.reasonCode, "gate.gemini_live_smoke.failed.missing_api_key")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("uiq-gemini-live-smoke-gate returns blocked+0 when live smoke is not required", () => {
  const root = mkdtempSync(join(tmpdir(), "uiq-gemini-live-smoke-gate-skip-"))
  try {
    const outDir = join(root, "out")
    mkdirSync(outDir, { recursive: true })
    const env = {
      ...process.env,
      UIQ_GEMINI_LIVE_SMOKE_REQUIRED: "false",
      GEMINI_API_KEY: "",
    }
    const run = spawnSync(
      process.execPath,
      [GEMINI_LIVE_SMOKE_GATE_SCRIPT, "--strict", "true", "--out-dir", outDir],
      {
        cwd: REPO_ROOT,
        env,
        encoding: "utf8",
      }
    )
    assert.equal(run.status, 0)
    const report = JSON.parse(readFileSync(join(outDir, "uiq-gemini-live-smoke-gate.json"), "utf8"))
    assert.equal(report.status, "blocked")
    assert.equal(report.reasonCode, "gate.gemini_live_smoke.blocked.not_required")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("uiq-gemini-live-smoke-gate defaults to required in CI when toggle is unset", () => {
  const root = mkdtempSync(join(tmpdir(), "uiq-gemini-live-smoke-gate-ci-default-"))
  try {
    const outDir = join(root, "out")
    mkdirSync(outDir, { recursive: true })
    const env = {
      ...process.env,
      CI: "true",
      UIQ_BASE_URL: "",
      GEMINI_API_KEY: "",
    }
    delete env.UIQ_GEMINI_LIVE_SMOKE_REQUIRED
    const run = spawnSync(
      process.execPath,
      [GEMINI_LIVE_SMOKE_GATE_SCRIPT, "--strict", "true", "--out-dir", outDir],
      {
        cwd: REPO_ROOT,
        env,
        encoding: "utf8",
      }
    )
    assert.ok(run.status === 0 || run.status === 1)
    const report = JSON.parse(readFileSync(join(outDir, "uiq-gemini-live-smoke-gate.json"), "utf8"))
    assert.equal(report.required, true)
    assert.notEqual(report.reasonCode, "gate.gemini_live_smoke.blocked.not_required")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("uiq-gemini-live-smoke-gate clamps retries to max 2", () => {
  const root = mkdtempSync(join(tmpdir(), "uiq-gemini-live-smoke-gate-retries-"))
  try {
    const outDir = join(root, "out")
    mkdirSync(outDir, { recursive: true })
    const env = {
      ...process.env,
      UIQ_GEMINI_LIVE_SMOKE_REQUIRED: "false",
      UIQ_GEMINI_LIVE_SMOKE_RETRIES: "99",
      GEMINI_API_KEY: "",
    }
    const run = spawnSync(
      process.execPath,
      [GEMINI_LIVE_SMOKE_GATE_SCRIPT, "--strict", "true", "--out-dir", outDir],
      {
        cwd: REPO_ROOT,
        env,
        encoding: "utf8",
      }
    )
    assert.equal(run.status, 0)
    const report = JSON.parse(readFileSync(join(outDir, "uiq-gemini-live-smoke-gate.json"), "utf8"))
    assert.equal(report.request.retries, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("uiq-gemini-live-smoke-gate accepts LIVE_GEMINI_API_KEY fallback", () => {
  const root = mkdtempSync(join(tmpdir(), "uiq-gemini-live-smoke-gate-live-key-"))
  try {
    const outDir = join(root, "out")
    mkdirSync(outDir, { recursive: true })
    const env = {
      ...process.env,
      UIQ_GEMINI_LIVE_SMOKE_REQUIRED: "true",
      UIQ_BASE_URL: "https://example.com",
      GEMINI_API_KEY: "",
      LIVE_GEMINI_API_KEY: "live-fallback-key",
    }
    const run = spawnSync(
      process.execPath,
      [GEMINI_LIVE_SMOKE_GATE_SCRIPT, "--strict", "true", "--out-dir", outDir],
      {
        cwd: REPO_ROOT,
        env,
        encoding: "utf8",
      }
    )
    assert.ok(run.status === 0 || run.status === 1)
    const report = JSON.parse(readFileSync(join(outDir, "uiq-gemini-live-smoke-gate.json"), "utf8"))
    assert.equal(report.request.apiKeySource, "process.env.LIVE_GEMINI_API_KEY")
    assert.notEqual(report.reasonCode, "gate.gemini_live_smoke.failed.missing_api_key")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("uiq-gemini-uiux-audit returns blocked when strict=false and key is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "uiq-gemini-uiux-audit-missing-key-"))
  try {
    const outDir = join(root, "out")
    const uiFile = join(root, "sample.tsx")
    mkdirSync(outDir, { recursive: true })
    writeFileSync(uiFile, "export const Demo = () => <button>Demo</button>\n", "utf8")
    const env = {
      ...process.env,
      GEMINI_API_KEY: "",
      LIVE_GEMINI_API_KEY: "",
    }
    const run = spawnSync(
      process.execPath,
      [GEMINI_UIUX_AUDIT_SCRIPT, "--strict", "false", uiFile],
      {
        cwd: root,
        env,
        encoding: "utf8",
      }
    )
    assert.equal(run.status, 0)
    const report = JSON.parse(readFileSync(join(root, ".runtime-cache/artifacts/ci/uiq-gemini-uiux-audit.json"), "utf8"))
    assert.equal(report.status, "blocked")
    assert.equal(report.reasonCode, "gate.uiux.gemini.blocked.missing_api_key")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("uiq-gemini-uiux-audit accepts LIVE_GEMINI_API_KEY fallback and writes markdown artifact", () => {
  const root = mkdtempSync(join(tmpdir(), "uiq-gemini-uiux-audit-live-key-"))
  try {
    const uiFile = join(root, "sample.tsx")
    writeFileSync(uiFile, "export const Demo = () => <button>Demo</button>\n", "utf8")
    const env = {
      ...process.env,
      GEMINI_API_KEY: "",
      LIVE_GEMINI_API_KEY: "live-fallback-key",
    }
    const run = spawnSync(
      process.execPath,
      [GEMINI_UIUX_AUDIT_SCRIPT, "--strict", "true", "--timeout-ms", "1", uiFile],
      {
        cwd: root,
        env,
        encoding: "utf8",
      }
    )
    assert.ok(run.status === 0 || run.status === 1)
    const jsonPath = join(root, ".runtime-cache/artifacts/ci/uiq-gemini-uiux-audit.json")
    const mdPath = join(root, ".runtime-cache/artifacts/ci/uiq-gemini-uiux-audit.md")
    const report = JSON.parse(readFileSync(jsonPath, "utf8"))
    assert.equal(report.apiKeySource, "process.env.LIVE_GEMINI_API_KEY")
    assert.notEqual(report.reasonCode, "gate.uiux.gemini.failed.missing_api_key")
    assert.match(readFileSync(mdPath, "utf8"), /# Gemini UI\/UX Audit/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("uiq-gemini-uiux-audit exits non-zero in strict mode when response schema is invalid", () => {
  const root = mkdtempSync(join(tmpdir(), "uiq-gemini-uiux-audit-invalid-response-"))
  try {
    const frontendDir = join(root, "frontend", "src")
    const uiFile = join(frontendDir, "styles.css")
    mkdirSync(frontendDir, { recursive: true })
    writeFileSync(uiFile, ".demo { color: red; }\n", "utf8")
    const env = {
      ...process.env,
      LIVE_GEMINI_API_KEY: "live-key",
      UIQ_GEMINI_UIUX_TEST_RAW_RESPONSE: "not-json",
    }
    const run = spawnSync(
      process.execPath,
      [GEMINI_UIUX_AUDIT_SCRIPT, "--strict", "true", uiFile],
      {
        cwd: root,
        env,
        encoding: "utf8",
      }
    )
    assert.equal(run.status, 1)
    const report = JSON.parse(
      readFileSync(join(root, ".runtime-cache/artifacts/ci/uiq-gemini-uiux-audit.json"), "utf8")
    )
    assert.equal(report.status, "failed")
    assert.equal(report.reasonCode, "gate.uiux.gemini.failed.invalid_response")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("uiq-gemini-uiux-audit fails strict mode when input is truncated by max-file-chars", () => {
  const root = mkdtempSync(join(tmpdir(), "uiq-gemini-uiux-audit-truncated-input-"))
  try {
    const uiFile = join(root, "sample.tsx")
    const longBody = "a".repeat(600)
    writeFileSync(uiFile, `export const Demo = () => <div>${longBody}</div>\\n`, "utf8")
    const env = {
      ...process.env,
      LIVE_GEMINI_API_KEY: "live-key",
      UIQ_GEMINI_UIUX_TEST_RAW_RESPONSE: JSON.stringify({
        passed: true,
        summary: "ok",
        issues: [],
      }),
    }
    const run = spawnSync(
      process.execPath,
      [GEMINI_UIUX_AUDIT_SCRIPT, "--strict", "true", "--max-file-chars", "120", uiFile],
      {
        cwd: root,
        env,
        encoding: "utf8",
      }
    )
    assert.equal(run.status, 1)
    const report = JSON.parse(
      readFileSync(join(root, ".runtime-cache/artifacts/ci/uiq-gemini-uiux-audit.json"), "utf8")
    )
    assert.equal(report.status, "failed")
    assert.equal(report.reasonCode, "gate.uiux.gemini.failed.partial_analysis")
    assert.equal(report.coverage.discovered_files, 1)
    assert.equal(report.coverage.analyzed_files, 0)
    assert.equal(report.coverage.skipped_files, 1)
    assert.equal(report.coverage.skipped_reasons[0]?.reason, "max_file_chars")
    assert.match(String(report.message || ""), /strict mode requires full untruncated coverage/i)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("uiq-ai-review uses failed-check fallback when Gemini findings are empty", async () => {
  const { shouldUseGeminiFindingsOverride } = await import(pathToFileURL(AI_REVIEW_SCRIPT).href)
  assert.equal(
    shouldUseGeminiFindingsOverride({
      parsed: { model: "gemini-3.0-flash", findings: [] },
    }),
    false
  )
  assert.equal(
    shouldUseGeminiFindingsOverride({
      parsed: {
        model: "gemini-3.0-flash",
        findings: [{ id: "F-1", severity: "high", title: "Primary CTA clipped on mobile" }],
      },
    }),
    true
  )
})

test("uiq-ai-review keeps failed gate checks when Gemini report has empty findings", () => {
  const root = mkdtempSync(join(tmpdir(), "uiq-ai-review-empty-findings-"))
  try {
    const runsDir = join(root, "runs")
    const runDir = join(runsDir, "run-1")
    const outDir = join(root, "out")
    mkdirSync(join(runDir, "reports"), { recursive: true })
    mkdirSync(outDir, { recursive: true })

    const manifest = {
      runId: "run-1",
      profile: "test",
      target: { type: "web", name: "demo" },
      summary: { consoleError: 1, pageError: 0, http5xx: 0 },
      reports: {},
      gateResults: {
        status: "failed",
        checks: [
          {
            id: "console.error",
            status: "failed",
            reasonCode: "gate.console.failed",
            evidencePath: "reports/console-errors.json",
          },
        ],
      },
      evidenceIndex: [],
    }
    writeFileSync(join(runDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
    writeFileSync(
      join(runDir, "reports", "ui-ux-gemini-report.json"),
      `${JSON.stringify({ model: "gemini-3.0-flash", findings: [] }, null, 2)}\n`,
      "utf8"
    )

    const run = spawnSync(
      "pnpm",
      [
        "exec",
        "node",
        "--import",
        "tsx",
        AI_REVIEW_SCRIPT,
        "--profile",
        "test",
        "--runs-dir",
        runsDir,
        "--run-id",
        "run-1",
        "--out-dir",
        outDir,
        "--strict",
        "true",
      ],
      {
        cwd: REPO_ROOT,
        env: process.env,
        encoding: "utf8",
      }
    )

    assert.equal(run.status, 2)
    const report = JSON.parse(readFileSync(join(outDir, "uiq-ai-review-test.json"), "utf8"))
    assert.equal(report.gate.status, "failed")
    assert.equal(report.gate.reasonCode, "gate.ai_review.failed.high_severity_findings")
    assert.ok(Number(report.summary.totalFindings || 0) > 0)
    assert.match(
      String(report.findings[0]?.reason_code || ""),
      /^(gate\.ai_review\.finding\.|ai\.gemini\.review\.finding\.)/
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("package.json test:matrix:full enables integration full and authenticity gate", () => {
  const pkg = JSON.parse(readFileSync(REPO_PACKAGE_JSON, "utf8"))
  const command = String(pkg?.scripts?.["test:matrix:full"] || "")
  assert.match(command, /UIQ_SUITE_INTEGRATION=1/)
  assert.match(command, /UIQ_INTEGRATION_PROFILE=full/)
  assert.match(command, /UIQ_TEST_MATRIX_RUN_E2E_AUTHENTICITY_GATE=1/)
})
