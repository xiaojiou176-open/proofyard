import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "verify-run-evidence.mjs")

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "verify-run-evidence-"))
  t.after(() => {
    rmSync(root, { recursive: true, force: true })
  })
  const profilesDir = join(root, "profiles")
  const runsDir = join(root, "runs")
  mkdirSync(profilesDir, { recursive: true })
  mkdirSync(runsDir, { recursive: true })
  writeFileSync(join(profilesDir, "test.yaml"), "steps: []\n", "utf8")
  return { root, runsDir }
}

function writeManifest(runsDir, runDirName, manifest) {
  const runDir = join(runsDir, runDirName)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(runDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8")
}

function runVerifier(args, cwd) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: "utf8",
  })
}

test("without --run-id keeps legacy behavior by verifying latest run manifest", (t) => {
  const fixture = createFixture(t)
  writeManifest(fixture.runsDir, "run-older", { runId: "run-older", profile: "wrong-profile" })
  writeManifest(fixture.runsDir, "run-latest", { runId: "run-latest", profile: "test" })
  utimesSync(join(fixture.runsDir, "run-older", "manifest.json"), 1000, 1000)
  utimesSync(join(fixture.runsDir, "run-latest", "manifest.json"), 2000, 2000)

  const result = runVerifier(["--profile", "test", "--runs-dir", fixture.runsDir], fixture.root)
  assert.equal(result.status, 0, `expected pass, stderr=${result.stderr}`)
  assert.match(result.stdout, /passed/)
})

test("with --run-id verifies only the requested run even when it is not latest", (t) => {
  const fixture = createFixture(t)
  writeManifest(fixture.runsDir, "run-target", { runId: "run-target", profile: "test" })
  writeManifest(fixture.runsDir, "run-latest", { runId: "run-latest", profile: "wrong-profile" })
  utimesSync(join(fixture.runsDir, "run-target", "manifest.json"), 1000, 1000)
  utimesSync(join(fixture.runsDir, "run-latest", "manifest.json"), 2000, 2000)

  const result = runVerifier(
    ["--profile", "test", "--runs-dir", fixture.runsDir, "--run-id", "run-target"],
    fixture.root
  )
  assert.equal(result.status, 0, `expected pass, stderr=${result.stderr}`)
  assert.match(result.stdout, /passed/)
})

test("with --run-id fails hard when manifest.runId mismatches requested run-id", (t) => {
  const fixture = createFixture(t)
  writeManifest(fixture.runsDir, "run-target", { runId: "different-run-id", profile: "test" })

  const result = runVerifier(
    ["--profile", "test", "--runs-dir", fixture.runsDir, "--run-id", "run-target"],
    fixture.root
  )
  assert.equal(
    result.status,
    2,
    `expected hard failure, stdout=${result.stdout}, stderr=${result.stderr}`
  )
  assert.match(result.stderr, /manifest\.runId mismatch/)
})

test("fails hard when aiReview is enabled but report is missing", (t) => {
  const fixture = createFixture(t)
  writeFileSync(
    join(fixture.root, "profiles", "test.yaml"),
    "steps: []\naiReview:\n  enabled: true\n",
    "utf8"
  )
  writeManifest(fixture.runsDir, "run-target", {
    runId: "run-target",
    profile: "test",
    reports: {},
    diagnostics: { aiReview: { enabled: true } },
    gateResults: { checks: [] },
    evidenceIndex: [],
  })

  const result = runVerifier(
    ["--profile", "test", "--runs-dir", fixture.runsDir, "--run-id", "run-target"],
    fixture.root
  )
  assert.equal(
    result.status,
    2,
    `expected hard failure, stdout=${result.stdout}, stderr=${result.stderr}`
  )
  assert.match(result.stderr, /aiReview enabled but manifest\.reports\.aiReview is missing/)
})

test("fails hard when aiReview report schema is invalid", (t) => {
  const fixture = createFixture(t)
  writeFileSync(
    join(fixture.root, "profiles", "test.yaml"),
    "steps: []\naiReview:\n  enabled: true\n",
    "utf8"
  )
  const runDir = join(fixture.runsDir, "run-target")
  mkdirSync(join(runDir, "reports"), { recursive: true })
  writeFileSync(
    join(runDir, "reports", "ai-review.json"),
    JSON.stringify(
      {
        schemaVersion: "1.0",
        runId: "run-target",
        profile: "test",
        gate: { status: "passed", reasonCode: "gate.ai_review.passed.threshold_met" },
        summary: { totalFindings: 1, highOrAbove: 0, candidateArtifacts: 1 },
        findings: [
          {
            issue_id: "AI-001-sample",
            severity: "high",
            risk_level: "high",
            reason_code: "bad.prefix.reason",
            file_path: "reports/summary.json",
            evidence: ["reports/summary.json"],
          },
        ],
      },
      null,
      2
    ),
    "utf8"
  )
  writeManifest(fixture.runsDir, "run-target", {
    runId: "run-target",
    profile: "test",
    reports: { aiReview: "reports/ai-review.json" },
    diagnostics: {
      aiReview: { enabled: true, reportPath: "reports/ai-review.json" },
    },
    gateResults: { checks: [] },
    evidenceIndex: [],
  })

  const result = runVerifier(
    ["--profile", "test", "--runs-dir", fixture.runsDir, "--run-id", "run-target"],
    fixture.root
  )
  assert.equal(
    result.status,
    2,
    `expected hard failure, stdout=${result.stdout}, stderr=${result.stderr}`
  )
  assert.match(result.stderr, /aiReview report schema invalid/)
})

test("passes when aiReview is enabled and report schema is valid", (t) => {
  const fixture = createFixture(t)
  writeFileSync(
    join(fixture.root, "profiles", "test.yaml"),
    "steps: []\naiReview:\n  enabled: true\n",
    "utf8"
  )
  const runDir = join(fixture.runsDir, "run-target")
  mkdirSync(join(runDir, "reports"), { recursive: true })
  writeFileSync(
    join(runDir, "reports", "ai-review.json"),
    JSON.stringify(
      {
        schemaVersion: "1.0",
        runId: "run-target",
        profile: "test",
        gate: { status: "passed", reasonCode: "gate.ai_review.passed.threshold_met" },
        summary: { totalFindings: 1, highOrAbove: 1, candidateArtifacts: 2 },
        findings: [
          {
            issue_id: "AI-001-page-error",
            severity: "high",
            risk_level: "high",
            reason_code: "ai.gemini.review.finding.page-error",
            file_path: "reports/summary.json",
            evidence: ["reports/summary.json"],
          },
        ],
      },
      null,
      2
    ),
    "utf8"
  )
  writeManifest(fixture.runsDir, "run-target", {
    runId: "run-target",
    profile: "test",
    reports: { aiReview: "reports/ai-review.json" },
    diagnostics: {
      aiReview: { enabled: true, reportPath: "reports/ai-review.json" },
    },
    gateResults: { checks: [] },
    evidenceIndex: [],
  })

  const result = runVerifier(
    ["--profile", "test", "--runs-dir", fixture.runsDir, "--run-id", "run-target"],
    fixture.root
  )
  assert.equal(result.status, 0, `expected pass, stdout=${result.stdout}, stderr=${result.stderr}`)
  assert.match(result.stdout, /passed/)
})

test("passes when logIndex exists and indexed paths resolve inside runDir", (t) => {
  const fixture = createFixture(t)
  const runDir = join(fixture.runsDir, "run-target")
  mkdirSync(join(runDir, "reports"), { recursive: true })
  mkdirSync(join(runDir, "logs"), { recursive: true })
  writeFileSync(join(runDir, "reports", "summary.json"), JSON.stringify({ ok: true }, null, 2), "utf8")
  writeFileSync(join(runDir, "logs", "state.log"), "ok\n", "utf8")
  writeFileSync(
    join(runDir, "reports", "log-index.json"),
    JSON.stringify(
      {
        runId: "run-target",
        profile: "test",
        status: "passed",
        target: { type: "web", name: "web.ci" },
        entries: [
          { channel: "runtime", source: "state.home.log", path: "logs/state.log" },
          { channel: "runtime", source: "report.report", path: "reports/summary.json" },
        ],
      },
      null,
      2
    ),
    "utf8"
  )
  writeManifest(fixture.runsDir, "run-target", {
    runId: "run-target",
    profile: "test",
    reports: {
      report: "reports/summary.json",
      logIndex: "reports/log-index.json",
    },
    gateResults: { status: "passed", checks: [] },
    evidenceIndex: [
      { id: "report.report", source: "report", kind: "report", path: "reports/summary.json" },
      { id: "state.home.log", source: "state", kind: "log", path: "logs/state.log" },
    ],
  })

  const result = runVerifier(
    ["--profile", "test", "--runs-dir", fixture.runsDir, "--run-id", "run-target"],
    fixture.root
  )
  assert.equal(result.status, 0, `expected pass, stdout=${result.stdout}, stderr=${result.stderr}`)
  assert.match(result.stdout, /passed/)
})

test("fails hard when logIndex path is not indexed in manifest evidence", (t) => {
  const fixture = createFixture(t)
  const runDir = join(fixture.runsDir, "run-target")
  mkdirSync(join(runDir, "reports"), { recursive: true })
  writeFileSync(join(runDir, "reports", "summary.json"), JSON.stringify({ ok: true }, null, 2), "utf8")
  writeFileSync(
    join(runDir, "reports", "log-index.json"),
    JSON.stringify(
      {
        runId: "run-target",
        profile: "test",
        status: "passed",
        target: { type: "web", name: "web.ci" },
        entries: [{ channel: "runtime", source: "report.report", path: "reports/summary.json" }],
      },
      null,
      2
    ),
    "utf8"
  )
  writeManifest(fixture.runsDir, "run-target", {
    runId: "run-target",
    profile: "test",
    reports: {
      report: "reports/summary.json",
      logIndex: "reports/log-index.json",
    },
    gateResults: { status: "passed", checks: [] },
    evidenceIndex: [],
  })

  const result = runVerifier(
    ["--profile", "test", "--runs-dir", fixture.runsDir, "--run-id", "run-target"],
    fixture.root
  )
  assert.equal(result.status, 2, `expected hard failure, stdout=${result.stdout}, stderr=${result.stderr}`)
  assert.match(result.stderr, /logIndex report schema invalid/)
})

test("fails hard when failed check evidencePath escapes runDir via absolute path", (t) => {
  const fixture = createFixture(t)
  const outsideEvidence = join(fixture.root, "outside-proof.json")
  writeFileSync(outsideEvidence, '{"ok":true}\\n', "utf8")
  writeManifest(fixture.runsDir, "run-target", {
    runId: "run-target",
    profile: "test",
    gateResults: {
      checks: [
        {
          id: "gate.outside.path",
          status: "failed",
          reasonCode: "gate.ai_fix.failed.missing_evidence",
          evidencePath: outsideEvidence,
        },
      ],
    },
    evidenceIndex: [{ path: outsideEvidence }],
  })

  const result = runVerifier(
    ["--profile", "test", "--runs-dir", fixture.runsDir, "--run-id", "run-target"],
    fixture.root
  )
  assert.equal(
    result.status,
    2,
    `expected hard failure, stdout=${result.stdout}, stderr=${result.stderr}`
  )
  assert.match(result.stderr, /missing valid evidence/)
})

test("passes when failed check uses normalized in-run evidence path and indexed path variant", (t) => {
  const fixture = createFixture(t)
  const runDir = join(fixture.runsDir, "run-target")
  mkdirSync(join(runDir, "reports"), { recursive: true })
  writeFileSync(join(runDir, "reports", "proof.json"), '{"ok":true}\\n', "utf8")
  writeManifest(fixture.runsDir, "run-target", {
    runId: "run-target",
    profile: "test",
    gateResults: {
      checks: [
        {
          id: "gate.in.run.path",
          status: "failed",
          reasonCode: "gate.ai_fix.failed.missing_evidence",
          evidencePath: "./reports/../reports/proof.json",
        },
      ],
    },
    evidenceIndex: [{ path: "reports/proof.json" }],
  })

  const result = runVerifier(
    ["--profile", "test", "--runs-dir", fixture.runsDir, "--run-id", "run-target"],
    fixture.root
  )
  assert.equal(result.status, 0, `expected pass, stdout=${result.stdout}, stderr=${result.stderr}`)
  assert.match(result.stdout, /passed/)
})

test("passes when Gemini accuracy/concurrency gate artifacts are present and schema matches checks", (t) => {
  const fixture = createFixture(t)
  const runDir = join(fixture.runsDir, "run-target")
  mkdirSync(join(runDir, "reports"), { recursive: true })
  writeFileSync(
    join(runDir, "reports", "uiq-gemini-accuracy-gate-test.json"),
    JSON.stringify(
      {
        checkId: "gemini_accuracy_min",
        status: "passed",
        reasonCode: "gate.gemini_accuracy_min.passed.threshold_met",
        metrics: { accuracy: 0.98, sampleSize: 20 },
        thresholds: { accuracyMin: 0.95, sampleSizeMin: 10 },
      },
      null,
      2
    ),
    "utf8"
  )
  writeFileSync(
    join(runDir, "reports", "uiq-gemini-concurrency-gate-test.json"),
    JSON.stringify(
      {
        checkId: "gemini_parallel_consistency_min",
        status: "passed",
        reasonCode: "gate.gemini_parallel_consistency_min.passed.threshold_met",
        metrics: { parallelConsistency: 0.99, sampleSize: 20 },
        thresholds: { parallelConsistencyMin: 0.95, sampleSizeMin: 10 },
      },
      null,
      2
    ),
    "utf8"
  )
  writeManifest(fixture.runsDir, "run-target", {
    runId: "run-target",
    profile: "test",
    gateResults: {
      checks: [
        {
          id: "ai_review.gemini_accuracy",
          status: "passed",
          reasonCode: "gate.gemini_accuracy_min.passed.threshold_met",
          evidencePath: "reports/uiq-gemini-accuracy-gate-test.json",
        },
        {
          id: "ai_review.gemini_concurrency",
          status: "passed",
          reasonCode: "gate.gemini_parallel_consistency_min.passed.threshold_met",
          evidencePath: "reports/uiq-gemini-concurrency-gate-test.json",
        },
      ],
    },
    evidenceIndex: [
      { path: "reports/uiq-gemini-accuracy-gate-test.json" },
      { path: "reports/uiq-gemini-concurrency-gate-test.json" },
    ],
  })

  const result = runVerifier(
    ["--profile", "test", "--runs-dir", fixture.runsDir, "--run-id", "run-target"],
    fixture.root
  )
  assert.equal(result.status, 0, `expected pass, stdout=${result.stdout}, stderr=${result.stderr}`)
  assert.match(result.stdout, /passed/)
})

test("fails when Gemini gate report payload mismatches manifest check fields", (t) => {
  const fixture = createFixture(t)
  const runDir = join(fixture.runsDir, "run-target")
  mkdirSync(join(runDir, "reports"), { recursive: true })
  writeFileSync(
    join(runDir, "reports", "uiq-gemini-accuracy-gate-test.json"),
    JSON.stringify(
      {
        checkId: "gemini_accuracy_min",
        status: "passed",
        reasonCode: "gate.gemini_accuracy_min.passed.threshold_met",
        metrics: { accuracy: 0.98, sampleSize: 20 },
        thresholds: { accuracyMin: 0.95, sampleSizeMin: 10 },
      },
      null,
      2
    ),
    "utf8"
  )
  writeManifest(fixture.runsDir, "run-target", {
    runId: "run-target",
    profile: "test",
    gateResults: {
      checks: [
        {
          id: "ai_review.gemini_accuracy",
          status: "failed",
          reasonCode: "gate.gemini_accuracy_min.failed.threshold_not_met",
          evidencePath: "reports/uiq-gemini-accuracy-gate-test.json",
        },
      ],
    },
    evidenceIndex: [{ path: "reports/uiq-gemini-accuracy-gate-test.json" }],
  })

  const result = runVerifier(
    ["--profile", "test", "--runs-dir", fixture.runsDir, "--run-id", "run-target"],
    fixture.root
  )
  assert.equal(
    result.status,
    2,
    `expected hard failure, stdout=${result.stdout}, stderr=${result.stderr}`
  )
  assert.match(result.stderr, /gemini gate report schema invalid/)
})
