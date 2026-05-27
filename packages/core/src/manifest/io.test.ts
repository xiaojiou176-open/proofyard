import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"
import {
  assertRelativeArtifactPath,
  assertManifest,
  buildEvidenceIndexFromManifest,
  dedupeEvidence,
  inferEvidenceKind,
  normalizeReasonCode,
  readManifest,
  writeManifest,
} from "./io.js"
import type { Manifest } from "./types.js"

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(resolve(tmpdir(), "uiq-manifest-"))
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function createManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    schemaVersion: "1.1",
    runId: "run-test",
    target: { type: "web", name: "web.local" },
    profile: "pr",
    git: { branch: "main", commit: "abc123", dirty: false },
    timing: {
      startedAt: "2026-02-21T00:00:00.000Z",
      finishedAt: "2026-02-21T00:00:10.000Z",
      durationMs: 10000,
    },
    execution: { maxParallelTasks: 2, stagesMs: { capture: 1200 }, criticalPath: ["capture"] },
    states: [],
    evidenceIndex: [],
    reports: {},
    summary: {
      consoleError: 0,
      pageError: 0,
      http5xx: 0,
      aiModel: "models/gemini-3.1-pro-preview",
      promptVersion: "1.1.0",
      cacheStats: { hit: 0, miss: 0, hitRate: 0 },
      computerUseSafetyConfirmations: 0,
    },
    gateResults: { status: "passed", checks: [] },
    toolchain: { node: process.version },
    ...overrides,
  }
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

test("writeManifest/readManifest round-trip v1.1", () => {
  withTempDir((dir) => {
    mkdirSync(resolve(dir, "reports"), { recursive: true })
    mkdirSync(resolve(dir, "logs"), { recursive: true })
    writeFileSync(resolve(dir, "reports/summary.json"), "{}", "utf8")
    writeFileSync(resolve(dir, "reports/fix-plan.md"), "# fix plan", "utf8")
    writeFileSync(resolve(dir, "reports/fix-result.md"), "# fix result", "utf8")
    writeFileSync(resolve(dir, "reports/post-fix-regression.md"), "# post-fix", "utf8")
    writeFileSync(resolve(dir, "logs/capture.log"), "", "utf8")

    const manifest: Manifest = {
      schemaVersion: "1.1",
      runId: "run-test",
      target: { type: "web", name: "web.local" },
      profile: "pr",
      git: { branch: "main", commit: "abc123", dirty: false },
      timing: {
        startedAt: "2026-02-21T00:00:00.000Z",
        finishedAt: "2026-02-21T00:00:10.000Z",
        durationMs: 10000,
      },
      execution: { maxParallelTasks: 2, stagesMs: { capture: 1200 }, criticalPath: ["capture"] },
      states: [
        {
          id: "home",
          source: "routes",
          steps: ["goto:/"],
          artifacts: { log: "logs/capture.log" },
        },
      ],
      evidenceIndex: [
        { id: "report.summary", source: "report", kind: "report", path: "reports/summary.json" },
        { id: "state.home.log", source: "state", kind: "log", path: "logs/capture.log" },
      ],
      reports: {
        report: "reports/summary.json",
        fixPlan: "reports/fix-plan.md",
        fixResult: "reports/fix-result.md",
        postFixRegression: "reports/post-fix-regression.md",
      },
      summary: {
        consoleError: 0,
        pageError: 0,
        http5xx: 0,
        fixIterations: 2,
        fixConverged: true,
        cacheStats: { hit: 3, miss: 1, hitRate: 0.75 },
      },
      gateResults: {
        status: "passed",
        checks: [
          {
            id: "console.error",
            expected: 0,
            actual: 0,
            severity: "BLOCKER",
            status: "passed",
            reasonCode: "gate.console_error.passed.ok",
            evidencePath: "reports/summary.json",
          },
        ],
      },
      toolchain: { node: process.version },
    }

    const manifestPath = writeManifest(dir, manifest)
    const read = readManifest(manifestPath)
    assert.equal(read.schemaCompatibility, "v1.1")
    assert.equal(read.manifest.schemaVersion, "1.1")
    assert.equal(read.missingEvidence.length, 0)
    assert.equal(read.manifest.summary.fixIterations, 2)
    assert.equal(read.manifest.summary.fixConverged, true)
    assert.equal(read.manifest.summary.cacheStats?.hit, 3)
    assert.equal(read.manifest.summary.cacheStats?.miss, 1)
    assert.equal(read.manifest.summary.cacheStats?.hits, 3)
    assert.equal(read.manifest.summary.cacheStats?.misses, 1)
    assert.equal(read.manifest.reports.fixPlan, "reports/fix-plan.md")
    assert.equal(read.manifest.reports.fixResult, "reports/fix-result.md")
    assert.equal(read.manifest.reports.postFixRegression, "reports/post-fix-regression.md")
  })
})

test("readManifest rejects manifest without schemaVersion", () => {
  withTempDir((dir) => {
    mkdirSync(resolve(dir, "reports"), { recursive: true })
    writeFileSync(resolve(dir, "reports/summary.json"), "{}", "utf8")

    const legacy = {
      runId: "legacy-run",
      target: { type: "web", name: "web.local" },
      profile: "nightly",
      git: { branch: "main", commit: "def456", dirty: true },
      timing: {
        startedAt: "2026-02-21T00:00:00.000Z",
        finishedAt: "2026-02-21T00:00:20.000Z",
        durationMs: 20000,
      },
      states: [],
      reports: { report: "reports/summary.json" },
      summary: {
        consoleError: 0,
        pageError: 0,
        http5xx: 0,
        cacheStats: { hits: 4, misses: 1, hitRate: 0.8 },
      },
      gateResults: {
        status: "failed",
        checks: [
          {
            id: "console.error",
            expected: 0,
            actual: 1,
            severity: "BLOCKER",
            status: "failed",
            evidencePath: "reports/summary.json",
          },
        ],
      },
      toolchain: { node: process.version },
    }

    const path = resolve(dir, "manifest.json")
    writeFileSync(path, JSON.stringify(legacy, null, 2), "utf8")

    assert.throws(() => readManifest(path), /legacy manifest schema is no longer supported/)
  })
})

test("writeManifest rejects unsafe evidence paths containing parent traversal", () => {
  withTempDir((dir) => {
    const manifest = createManifest({
      evidenceIndex: [
        {
          id: "state.bad.log",
          source: "state",
          kind: "log",
          path: "../outside.log",
        },
      ],
    })
    assert.throws(
      () => writeManifest(dir, manifest),
      /evidenceIndex\[0\]\.path must not contain '\.\.'/
    )
  })
})

test("readManifest rejects run directory path when manifest lacks schemaVersion", () => {
  withTempDir((dir) => {
    mkdirSync(resolve(dir, "reports"), { recursive: true })
    mkdirSync(resolve(dir, "logs"), { recursive: true })
    writeFileSync(resolve(dir, "reports/summary.json"), "{}", "utf8")
    writeFileSync(resolve(dir, "logs/existing.log"), "ok", "utf8")

    const legacy = {
      runId: "legacy-run-dir",
      target: { type: "web", name: "web.local" },
      profile: "nightly",
      git: { branch: "main", commit: "def456", dirty: false },
      timing: {
        startedAt: "2026-02-21T00:00:00.000Z",
        finishedAt: "2026-02-21T00:00:20.000Z",
        durationMs: 20000,
      },
      states: [
        {
          id: "home",
          artifacts: {
            log: "logs/existing.log",
            duplicateLog: "logs/existing.log",
            screenshot: "screens/home.png",
          },
        },
      ],
      reports: { report: "reports/summary.json" },
      summary: {
        consoleError: 0,
        pageError: 1,
        http5xx: 0,
      },
      gateResults: {
        status: "unexpected_status",
        checks: [
          {
            id: "console.error",
            expected: 0,
            actual: 0,
            severity: "BLOCKER",
            status: "passed",
            evidencePath: "logs/existing.log",
          },
          {
            id: "page.error",
            expected: 0,
            actual: 1,
            severity: "BLOCKER",
            status: "unexpected_status",
            evidencePath: "reports/missing.json",
          },
        ],
      },
      toolchain: { node: process.version },
    }

    writeFileSync(resolve(dir, "manifest.json"), JSON.stringify(legacy, null, 2), "utf8")

    assert.throws(() => readManifest(dir), /legacy manifest schema is no longer supported/)
  })
})

test("readManifest infers evidence kinds and skips invalid entries for v1.1 manifests", () => {
  withTempDir((dir) => {
    const files = [
      "artifacts/home.jpeg",
      "artifacts/dom.html",
      "artifacts/trace.zip",
      "artifacts/network.har",
      "artifacts/videos/session.mp4",
      "artifacts/reports/result.txt",
      "artifacts/metrics/stats.txt",
      "artifacts/other.bin",
      "reports/summary.json",
      "reports/dom.html",
      "logs/state.log",
      "gate/check.har",
    ]
    for (const relativePath of files) {
      mkdirSync(resolve(dir, relativePath, ".."), { recursive: true })
      writeFileSync(resolve(dir, relativePath), "ok", "utf8")
    }

    const legacy = {
      schemaVersion: "1.1",
      runId: "legacy-kinds",
      target: { type: "web", name: "web.local" },
      profile: "nightly",
      git: { branch: "main", commit: "kind123", dirty: false },
      timing: {
        startedAt: "2026-02-21T00:00:00.000Z",
        finishedAt: "2026-02-21T00:00:20.000Z",
        durationMs: 20000,
      },
      states: [
        {
          id: "kinds",
          artifacts: {
            jpeg: "artifacts/home.jpeg",
            dom: "artifacts/dom.html",
            trace: "artifacts/trace.zip",
            network: "artifacts/network.har",
            video: "artifacts/videos/session.mp4",
            report: "artifacts/reports/result.txt",
            metric: "artifacts/metrics/stats.txt",
            other: "artifacts/other.bin",
            blank: "   ",
            badValue: 42,
          },
        },
        {
          artifacts: {
            log: "logs/state.log",
          },
        },
      ],
      reports: {
        report: "reports/summary.json",
        html: "reports/dom.html",
        empty: "",
      },
      summary: {
        consoleError: 0,
        pageError: 0,
        http5xx: 0,
      },
      gateResults: {
        status: "failed",
        checks: [
          123,
          { status: "failed" },
          { id: "http.5xx", status: "failed", evidencePath: "gate/check.har" },
        ],
      },
      toolchain: { node: process.version },
    }

    writeFileSync(resolve(dir, "manifest.json"), JSON.stringify(legacy, null, 2), "utf8")
    const read = readManifest(dir)

    const kindByPath = new Map(read.manifest.evidenceIndex.map((item) => [item.path, item.kind]))
    assert.equal(kindByPath.get("artifacts/home.jpeg"), "screenshot")
    assert.equal(kindByPath.get("artifacts/dom.html"), "dom")
    assert.equal(kindByPath.get("artifacts/trace.zip"), "trace")
    assert.equal(kindByPath.get("artifacts/network.har"), "network")
    assert.equal(kindByPath.get("artifacts/videos/session.mp4"), "video")
    assert.equal(kindByPath.get("artifacts/reports/result.txt"), "report")
    assert.equal(kindByPath.get("artifacts/metrics/stats.txt"), "metric")
    assert.equal(kindByPath.get("artifacts/other.bin"), "other")
    assert.equal(kindByPath.get("logs/state.log"), "log")
    assert.equal(kindByPath.get("gate/check.har"), "network")
    assert.equal(
      read.manifest.evidenceIndex.some((item) => item.id.startsWith("gate.check_")),
      false
    )
    assert.equal(read.manifest.evidenceIndex.some((item) => item.path === ""), false)
    assert.equal(
      read.manifest.evidenceIndex.some((item) => item.id === "state.state_2.log"),
      true
    )
  })
})

test("readManifest normalizes diagnostics execution and optional summary fields", () => {
  withTempDir((dir) => {
    const legacy = {
      schemaVersion: "1.1",
      runId: "legacy-diagnostics",
      target: { type: "web", name: "web.local" },
      profile: "nightly",
      git: { branch: "main", commit: "diag123", dirty: false },
      timing: "invalid-timing",
      states: { bad: true },
      evidenceIndex: [{ id: "state.log", source: "state", kind: "log", path: "logs/state.log" }],
      reports: "invalid-report-map",
      summary: {
        consoleError: "4",
        pageError: -2,
        http5xx: "not-a-number",
        aiModel: "   ",
        promptVersion: 101,
        cacheStats: { hits: "2", misses: "1" },
        fixIterations: -3,
        fixConverged: "not-bool",
        computerUseSafetyConfirmations: "2",
        highVuln: 1,
        a11ySerious: 2,
        perfLcpMs: 3,
        perfFcpMs: 4,
        visualDiffPixels: 5,
        loadFailedRequests: 6,
        loadP95Ms: 7,
        loadRps: 8,
        dangerousActionHits: 9,
        aiReviewFindings: 10,
        aiReviewHighOrAbove: 11,
        blockedByMissingEngineCount: 12,
        engineAvailability: { gemini: false },
      },
      diagnostics: {
        execution: {
          maxParallelTasks: 5,
          stagesMs: { scan: 12 },
          criticalPath: ["scan", 99, "report"],
        },
      },
      proof: { source: "test" },
      gateResults: {
        status: "not-supported",
        checks: [
          null,
          {
            acId: " AC-1 ",
            id: 999,
            expected: true,
            actual: false,
            severity: "UNSUPPORTED",
            status: "invalid-status",
            reasonCode: "",
            evidencePath: null,
          },
        ],
      },
      toolchain: { node: process.version },
    }

    writeFileSync(resolve(dir, "manifest.json"), JSON.stringify(legacy, null, 2), "utf8")
    const read = readManifest(dir)

    assert.deepEqual(read.manifest.states, [])
    assert.deepEqual(read.manifest.reports, {})
    assert.equal(read.manifest.execution?.maxParallelTasks, 5)
    assert.deepEqual(read.manifest.execution?.stagesMs, { scan: 12 })
    assert.deepEqual(read.manifest.execution?.criticalPath, ["scan", "report"])
    assert.equal(read.manifest.summary.aiModel, "models/gemini-3.1-pro-preview")
    assert.equal(read.manifest.summary.promptVersion, "")
    assert.equal(read.manifest.summary.cacheStats?.hit, 2)
    assert.equal(read.manifest.summary.cacheStats?.miss, 1)
    assert.equal(read.manifest.summary.cacheStats?.hitRate, 0.6667)
    assert.equal(read.manifest.summary.consoleError, 4)
    assert.equal(read.manifest.summary.pageError, 0)
    assert.equal(read.manifest.summary.http5xx, 0)
    assert.equal(read.manifest.summary.fixIterations, 0)
    assert.equal(typeof read.manifest.summary.fixConverged, "undefined")
    assert.equal(read.manifest.summary.computerUseSafetyConfirmations, 2)
    assert.equal(read.manifest.summary.highVuln, 1)
    assert.equal(read.manifest.summary.a11ySerious, 2)
    assert.equal(read.manifest.summary.perfLcpMs, 3)
    assert.equal(read.manifest.summary.perfFcpMs, 4)
    assert.equal(read.manifest.summary.visualDiffPixels, 5)
    assert.equal(read.manifest.summary.loadFailedRequests, 6)
    assert.equal(read.manifest.summary.loadP95Ms, 7)
    assert.equal(read.manifest.summary.loadRps, 8)
    assert.equal(read.manifest.summary.dangerousActionHits, 9)
    assert.equal(read.manifest.summary.aiReviewFindings, 10)
    assert.equal(read.manifest.summary.aiReviewHighOrAbove, 11)
    assert.equal(read.manifest.summary.blockedByMissingEngineCount, 12)
    assert.deepEqual(read.manifest.summary.engineAvailability, { gemini: false })
    assert.equal(read.manifest.gateResults.status, "blocked")
    assert.equal(read.manifest.gateResults.checks.length, 2)
    assert.equal(read.manifest.gateResults.checks[1]?.id, "unknown.check")
    assert.equal(read.manifest.gateResults.checks[1]?.acId, "AC-1")
    assert.equal(read.manifest.gateResults.checks[1]?.severity, "BLOCKER")
    assert.equal(read.manifest.gateResults.checks[1]?.status, "blocked")
    assert.equal(
      read.manifest.gateResults.checks[1]?.reasonCode,
      "gate.unknown_check.blocked.unspecified"
    )
    assert.equal(read.manifest.gateResults.checks[1]?.evidencePath, "reports/summary.json")
    assert.equal(read.manifest.timing.startedAt, "1970-01-01T00:00:00.000Z")
    assert.equal(read.manifest.timing.finishedAt, "1970-01-01T00:00:00.000Z")
    assert.equal(read.manifest.timing.durationMs, 0)
    assert.deepEqual(read.manifest.proof, { source: "test" })
  })
})

test("writeManifest validates manifest invariants with explicit error branches", () => {
  withTempDir((dir) => {
    const base = createManifest({
      evidenceIndex: [{ id: "state.log", source: "state", kind: "log", path: "logs/state.log" }],
      gateResults: {
        status: "passed",
        checks: [
          {
            id: "console.error",
            expected: 0,
            actual: 0,
            severity: "BLOCKER",
            status: "passed",
            reasonCode: "gate.console_error.passed.ok",
            evidencePath: "logs/state.log",
          },
        ],
      },
      summary: {
        consoleError: 0,
        pageError: 0,
        http5xx: 0,
        aiModel: "models/gemini-3.1-pro-preview",
        promptVersion: "1.1.0",
        cacheStats: { hit: 1, miss: 0, hits: 1, misses: 0, hitRate: 1 },
        computerUseSafetyConfirmations: 0,
      },
      reports: {},
    })

    const cases: Array<{
      name: string
      mutate: (manifest: Record<string, any>) => void
      expected: RegExp
    }> = [
      {
        name: "runId empty",
        mutate: (manifest) => {
          manifest.runId = "   "
        },
        expected: /runId must be a non-empty string/,
      },
      {
        name: "evidence id must be string",
        mutate: (manifest) => {
          manifest.evidenceIndex[0].id = 1
        },
        expected: /evidenceIndex\[0\]\.id must be a string/,
      },
      {
        name: "evidence source must be string",
        mutate: (manifest) => {
          manifest.evidenceIndex[0].source = 1
        },
        expected: /evidenceIndex\[0\]\.source must be a string/,
      },
      {
        name: "evidence kind must be string",
        mutate: (manifest) => {
          manifest.evidenceIndex[0].kind = 1
        },
        expected: /evidenceIndex\[0\]\.kind must be a string/,
      },
      {
        name: "evidence path must not be empty",
        mutate: (manifest) => {
          manifest.evidenceIndex[0].path = "   "
        },
        expected: /must not be empty/,
      },
      {
        name: "evidence path must be relative",
        mutate: (manifest) => {
          manifest.evidenceIndex[0].path = "/tmp/state.log"
        },
        expected: /must be relative path/,
      },
      {
        name: "execution maxParallelTasks",
        mutate: (manifest) => {
          manifest.execution.maxParallelTasks = 0
        },
        expected: /execution\.maxParallelTasks must be >= 1/,
      },
      {
        name: "timing durationMs number",
        mutate: (manifest) => {
          manifest.timing.durationMs = Number.NaN
        },
        expected: /timing\.durationMs must be a number/,
      },
      {
        name: "reports fixPlan string",
        mutate: (manifest) => {
          manifest.reports.fixPlan = 1
        },
        expected: /reports\.fixPlan must be a string/,
      },
      {
        name: "reports fixResult string",
        mutate: (manifest) => {
          manifest.reports.fixResult = 1
        },
        expected: /reports\.fixResult must be a string/,
      },
      {
        name: "reports postFixRegression string",
        mutate: (manifest) => {
          manifest.reports.postFixRegression = 1
        },
        expected: /reports\.postFixRegression must be a string/,
      },
      {
        name: "gate check evidencePath relative",
        mutate: (manifest) => {
          manifest.gateResults.checks[0].evidencePath = "/tmp/absolute.log"
        },
        expected: /must be relative path/,
      },
      {
        name: "gate check evidencePath must not be empty",
        mutate: (manifest) => {
          manifest.gateResults.checks[0].evidencePath = "   "
        },
        expected: /must not be empty/,
      },
    ]

    for (const testCase of cases) {
      const manifest = cloneValue(base) as unknown as Record<string, any>
      testCase.mutate(manifest)
      assert.throws(
        () => writeManifest(dir, manifest as unknown as Manifest),
        testCase.expected,
        testCase.name
      )
    }
  })
})

test("readManifest normalizes minimal v1.1 manifest when optional sections are missing", () => {
  withTempDir((dir) => {
    const legacy = {
      schemaVersion: "1.1",
      runId: "legacy-minimal",
      target: { type: "web", name: "web.local" },
      profile: "nightly",
      git: { branch: "main", commit: "min123", dirty: false },
      toolchain: { node: process.version },
    }

    writeFileSync(resolve(dir, "manifest.json"), JSON.stringify(legacy, null, 2), "utf8")
    const read = readManifest(dir)

    assert.deepEqual(read.manifest.states, [])
    assert.deepEqual(read.manifest.evidenceIndex, [])
    assert.deepEqual(read.manifest.reports, {})
    assert.equal(read.manifest.gateResults.status, "blocked")
    assert.deepEqual(read.manifest.gateResults.checks, [])
    assert.equal(read.manifest.execution?.maxParallelTasks, 1)
    assert.deepEqual(read.manifest.execution?.stagesMs, {})
    assert.deepEqual(read.manifest.execution?.criticalPath, [])
    assert.equal(read.manifest.summary.consoleError, 0)
    assert.equal(read.manifest.summary.pageError, 0)
    assert.equal(read.manifest.summary.http5xx, 0)
    assert.equal(read.manifest.summary.aiModel, "models/gemini-3.1-pro-preview")
    assert.equal(read.manifest.summary.promptVersion, "")
    assert.equal(read.manifest.summary.cacheStats?.hit, 0)
    assert.equal(read.manifest.summary.cacheStats?.miss, 0)
    assert.equal(read.manifest.summary.cacheStats?.hitRate, 0)
  })
})

test("readManifest skips non-record states and non-record artifacts for v1.1 manifests", () => {
  withTempDir((dir) => {
    mkdirSync(resolve(dir, "reports"), { recursive: true })
    writeFileSync(resolve(dir, "reports/summary.json"), "{}", "utf8")

    const legacy = {
      schemaVersion: "1.1",
      runId: "legacy-non-record",
      target: { type: "web", name: "web.local" },
      profile: "nightly",
      git: { branch: "main", commit: "nr123", dirty: false },
      timing: {
        startedAt: "2026-02-21T00:00:00.000Z",
        finishedAt: "2026-02-21T00:00:20.000Z",
        durationMs: 20000,
      },
      states: [123, { id: "no-artifacts", artifacts: null }],
      reports: { report: "reports/summary.json" },
      summary: { consoleError: 0, pageError: 0, http5xx: 0 },
      gateResults: { status: "passed", checks: [] },
      toolchain: { node: process.version },
    }

    writeFileSync(resolve(dir, "manifest.json"), JSON.stringify(legacy, null, 2), "utf8")
    const read = readManifest(dir)
    assert.equal(read.manifest.evidenceIndex.length, 1)
    assert.equal(read.manifest.evidenceIndex[0]?.id, "report.report")
    assert.equal(read.manifest.evidenceIndex[0]?.kind, "other")
  })
})

test("writeManifest normalizes non-object and non-string gate check fields", () => {
  withTempDir((dir) => {
    const normalizedFromNonObject = createManifest({
      gateResults: { status: "passed", checks: ["not-an-object" as unknown as any] },
    })
    const nonObjectPath = writeManifest(dir, normalizedFromNonObject)
    const nonObjectRead = readManifest(nonObjectPath)
    assert.equal(nonObjectRead.manifest.gateResults.checks[0]?.id, "unknown.check")
    assert.equal(nonObjectRead.manifest.gateResults.checks[0]?.status, "blocked")

    const nonStringId = createManifest({
      gateResults: {
        status: "passed",
        checks: [
          {
            id: 123 as unknown as string,
            expected: 0,
            actual: 0,
            severity: "BLOCKER",
            status: "passed",
            reasonCode: "gate.console_error.passed.ok",
            evidencePath: "reports/summary.json",
          },
        ],
      },
    })
    const nonStringPath = writeManifest(dir, nonStringId)
    const nonStringRead = readManifest(nonStringPath)
    assert.equal(nonStringRead.manifest.gateResults.checks[0]?.id, "unknown.check")
  })
})

test("writeManifest normalizes invalid gate check severity/status values", () => {
  withTempDir((dir) => {
    const invalidSeverity = createManifest({
      gateResults: {
        status: "passed",
        checks: [
          {
            id: "console.error",
            expected: 0,
            actual: 0,
            severity: "CRITICAL" as unknown as "BLOCKER",
            status: "passed",
            reasonCode: "gate.console_error.passed.ok",
            evidencePath: "reports/summary.json",
          },
        ],
      },
    })
    const invalidSeverityPath = writeManifest(dir, invalidSeverity)
    const invalidSeverityRead = readManifest(invalidSeverityPath)
    assert.equal(invalidSeverityRead.manifest.gateResults.checks[0]?.severity, "BLOCKER")

    const invalidStatus = createManifest({
      gateResults: {
        status: "passed",
        checks: [
          {
            id: "console.error",
            expected: 0,
            actual: 0,
            severity: "BLOCKER",
            status: "unknown" as unknown as "passed",
            reasonCode: "gate.console_error.blocked.unspecified",
            evidencePath: "reports/summary.json",
          },
        ],
      },
    })
    const invalidStatusPath = writeManifest(dir, invalidStatus)
    const invalidStatusRead = readManifest(invalidStatusPath)
    assert.equal(invalidStatusRead.manifest.gateResults.checks[0]?.status, "blocked")
    assert.equal(
      invalidStatusRead.manifest.gateResults.checks[0]?.reasonCode,
      "gate.console_error.blocked.unspecified"
    )
  })
})

test("io helpers validate artifact paths, normalize reason codes and infer evidence kinds", () => {
  assert.doesNotThrow(() => assertRelativeArtifactPath("reports/summary.json", "report"))
  assert.throws(() => assertRelativeArtifactPath("../escape.txt", "report"), /must not contain '\.\.'/)
  assert.throws(() => assertRelativeArtifactPath("/tmp/abs.txt", "report"), /must be relative/)

  assert.equal(
    normalizeReasonCode("gate.console_error.failed.threshold_exceeded", "failed"),
    "gate.gate_console_error_failed_threshold_exceeded.failed.unspecified"
  )
  assert.match(normalizeReasonCode("  ", "blocked"), /blocked/)
  assert.equal(inferEvidenceKind("screenshots/home.jpeg"), "screenshot")
  assert.equal(inferEvidenceKind("traces/run.zip"), "trace")
  assert.equal(inferEvidenceKind("metrics/value.json"), "other")
  assert.equal(inferEvidenceKind("misc/file.bin"), "other")
})

test("io helpers dedupe and build manifest evidence index deterministically", () => {
  const deduped = dedupeEvidence([
    { id: "a", source: "state", kind: "log", path: "logs/a.log" },
    { id: "b", source: "state", kind: "log", path: "logs/a.log" },
    { id: "c", source: "report", kind: "report", path: "reports/x.json" },
  ])
  assert.deepEqual(
    deduped.map((item) => item.id),
    ["a", "c"]
  )

  const manifestEvidence = buildEvidenceIndexFromManifest({
    states: [
      {
        id: "home",
        artifacts: {
          screenshot: "screens/home.png",
          log: "logs/home.log",
          blank: "   ",
        },
      },
    ],
    reports: {
      report: "reports/summary.json",
      empty: "",
    },
    gateResults: {
      checks: [
        { id: "console.error", evidencePath: "logs/home.log" },
        { id: "http.5xx", evidencePath: "network/capture.har" },
      ],
    },
  } as never)

  assert.equal(
    manifestEvidence.some((item) => item.path === "screens/home.png" && item.kind === "screenshot"),
    true
  )
  assert.equal(
    manifestEvidence.some((item) => item.path === "reports/summary.json" && item.source === "report"),
    true
  )
  assert.equal(
    manifestEvidence.some((item) => item.path === "network/capture.har" && item.kind === "network"),
    true
  )
})

test("writeManifest covers remaining manifest validation guardrails", () => {
  withTempDir((_dir) => {
    const cases: Array<{ label: string; manifest: Manifest; pattern: RegExp }> = [
      {
        label: "schemaVersion",
        manifest: { ...(createManifest() as Manifest), schemaVersion: "legacy" as never },
        pattern: /schemaVersion must be 1\.1/,
      },
      {
        label: "runId",
        manifest: { ...(createManifest() as Manifest), runId: "   " },
        pattern: /runId must be a non-empty string/,
      },
      {
        label: "states",
        manifest: { ...(createManifest() as Manifest), states: {} as never },
        pattern: /states must be an array/,
      },
      {
        label: "evidenceIndex",
        manifest: { ...(createManifest() as Manifest), evidenceIndex: {} as never },
        pattern: /evidenceIndex must be an array/,
      },
      {
        label: "execution.stagesMs",
        manifest: {
          ...(createManifest() as Manifest),
          execution: { maxParallelTasks: 1, stagesMs: [] as never, criticalPath: [] },
        },
        pattern: /execution\.stagesMs must be an object/,
      },
      {
        label: "execution.criticalPath",
        manifest: {
          ...(createManifest() as Manifest),
          execution: { maxParallelTasks: 1, stagesMs: {}, criticalPath: {} as never },
        },
        pattern: /execution\.criticalPath must be an array/,
      },
      {
        label: "gateResults.status",
        manifest: {
          ...(createManifest() as Manifest),
          gateResults: { status: "weird" as never, checks: [] },
        },
        pattern: /gateResults\.status must be passed\|failed\|blocked/,
      },
      {
        label: "timing",
        manifest: { ...(createManifest() as Manifest), timing: {} as never },
        pattern: /timing\.startedAt\/finishedAt must be strings/,
      },
      {
        label: "summary.aiModel",
        manifest: {
          ...(createManifest() as Manifest),
          summary: { ...createManifest().summary, aiModel: "   " },
        },
        pattern: /summary\.aiModel must be a non-empty string/,
      },
      {
        label: "cacheStats.hitRate",
        manifest: {
          ...(createManifest() as Manifest),
          summary: {
            ...createManifest().summary,
            cacheStats: { hit: 1, miss: 2, hits: 1, misses: 2, hitRate: "bad" as never },
          },
        },
        pattern: /summary\.cacheStats\.hitRate must be a number/,
      },
      {
        label: "reports.fixPlan",
        manifest: {
          ...(createManifest() as Manifest),
          reports: { fixPlan: 1 as never },
        },
        pattern: /reports\.fixPlan must be a string/,
      },
      {
        label: "gate check status",
        manifest: {
          ...(createManifest() as Manifest),
          gateResults: {
            status: "passed",
            checks: [
              {
                id: "test.unit",
                expected: "passed",
                actual: "passed",
                severity: "BLOCKER",
                status: "mystery" as never,
                reasonCode: "x",
                evidencePath: "reports/summary.json",
              },
            ],
          },
        },
        pattern: /gateResults\.checks\[0\]\.status invalid/,
      },
    ]

    for (const { manifest, pattern } of cases) {
      assert.throws(() => assertManifest(manifest), pattern)
    }
  })
})

test("assertManifest hits remaining object/type guardrails", () => {
  const valid = createManifest()
  const cases: Array<{ manifest: Manifest; pattern: RegExp }> = [
    {
      manifest: (() => {
        const next = cloneValue(valid)
        delete (next as Partial<Manifest>).target
        return next as Manifest
      })(),
      pattern: /missing required key 'target'/,
    },
    {
      manifest: (() => {
        const next = cloneValue(valid)
        next.evidenceIndex = [42 as never]
        return next
      })(),
      pattern: /evidenceIndex\[0\] must be an object/,
    },
    {
      manifest: (() => {
        const next = cloneValue(valid)
        next.evidenceIndex = [{ id: 1 as never, source: "state", kind: "log", path: "logs/x.log" }]
        return next
      })(),
      pattern: /evidenceIndex\[0\]\.id must be a string/,
    },
    {
      manifest: (() => {
        const next = cloneValue(valid)
        next.execution = null as never
        return next
      })(),
      pattern: /execution must be an object/,
    },
    {
      manifest: (() => {
        const next = cloneValue(valid)
        next.gateResults = null as never
        return next
      })(),
      pattern: /gateResults must be an object/,
    },
    {
      manifest: (() => {
        const next = cloneValue(valid)
        next.gateResults.checks = null as never
        return next
      })(),
      pattern: /gateResults\.checks must be an array/,
    },
    {
      manifest: (() => {
        const next = cloneValue(valid)
        next.timing = null as never
        return next
      })(),
      pattern: /timing must be an object/,
    },
    {
      manifest: (() => {
        const next = cloneValue(valid)
        next.summary = null as never
        return next
      })(),
      pattern: /summary must be an object/,
    },
    {
      manifest: (() => {
        const next = cloneValue(valid)
        next.summary.consoleError = "bad" as never
        return next
      })(),
      pattern: /summary\.consoleError must be a number/,
    },
    {
      manifest: (() => {
        const next = cloneValue(valid)
        next.summary.promptVersion = 1 as never
        return next
      })(),
      pattern: /summary\.promptVersion must be a string/,
    },
    {
      manifest: (() => {
        const next = cloneValue(valid)
        next.summary.cacheStats = null as never
        return next
      })(),
      pattern: /summary\.cacheStats must be an object/,
    },
    {
      manifest: (() => {
        const next = cloneValue(valid)
        next.summary.cacheStats!.hit = "bad" as never
        return next
      })(),
      pattern: /summary\.cacheStats\.hit must be a number/,
    },
    {
      manifest: (() => {
        const next = cloneValue(valid)
        next.summary.cacheStats!.miss = "bad" as never
        return next
      })(),
      pattern: /summary\.cacheStats\.miss must be a number/,
    },
    {
      manifest: (() => {
        const next = cloneValue(valid)
        next.summary.cacheStats!.hits = "bad" as never
        return next
      })(),
      pattern: /summary\.cacheStats\.hits must be a number/,
    },
    {
      manifest: (() => {
        const next = cloneValue(valid)
        next.summary.cacheStats!.misses = "bad" as never
        return next
      })(),
      pattern: /summary\.cacheStats\.misses must be a number/,
    },
    {
      manifest: (() => {
        const next = cloneValue(valid)
        next.summary.computerUseSafetyConfirmations = "bad" as never
        return next
      })(),
      pattern: /summary\.computerUseSafetyConfirmations must be a number/,
    },
    {
      manifest: (() => {
        const next = cloneValue(valid)
        next.summary.fixIterations = "bad" as never
        return next
      })(),
      pattern: /summary\.fixIterations must be a number/,
    },
    {
      manifest: (() => {
        const next = cloneValue(valid)
        next.summary.fixConverged = "bad" as never
        return next
      })(),
      pattern: /summary\.fixConverged must be a boolean/,
    },
    {
      manifest: (() => {
        const next = cloneValue(valid)
        next.reports.fixResult = 1 as never
        return next
      })(),
      pattern: /reports\.fixResult must be a string/,
    },
    {
      manifest: (() => {
        const next = cloneValue(valid)
        next.reports.postFixRegression = 1 as never
        return next
      })(),
      pattern: /reports\.postFixRegression must be a string/,
    },
    {
      manifest: (() => {
        const next = cloneValue(valid)
        next.gateResults.checks = [42 as never]
        return next
      })(),
      pattern: /gateResults\.checks\[0\] must be an object/,
    },
    {
      manifest: (() => {
        const next = cloneValue(valid)
        next.gateResults.checks = [
          {
            id: "x",
            expected: "",
            actual: "",
            severity: "BLOCKER",
            status: "passed",
            reasonCode: 1 as never,
            evidencePath: "reports/summary.json",
          },
        ]
        return next
      })(),
      pattern: /gateResults\.checks\[0\]\.reasonCode must be a string/,
    },
    {
      manifest: (() => {
        const next = cloneValue(valid)
        next.gateResults.checks = [
          {
            id: "x",
            expected: "",
            actual: "",
            severity: "BLOCKER",
            status: "passed",
            reasonCode: "ok",
            evidencePath: "../bad.json",
          },
        ]
        return next
      })(),
      pattern: /gateResults\.checks\[0\]\.evidencePath must not contain '\.\.'/,
    },
  ]

  for (const { manifest, pattern } of cases) {
    assert.throws(() => assertManifest(manifest), pattern)
  }
})

test("assertManifest covers cache stats and gate check raw guardrails", () => {
  const base = createManifest({
    summary: {
      ...createManifest().summary,
      cacheStats: { hit: 1, miss: 0, hits: 1, misses: 0, hitRate: 1 },
      computerUseSafetyConfirmations: 0,
      fixIterations: 1,
      fixConverged: true,
    },
    gateResults: {
      status: "passed",
      checks: [
        {
          id: "console.error",
          expected: 0,
          actual: 0,
          severity: "BLOCKER",
          status: "passed",
          reasonCode: "gate.console_error.passed.ok",
          evidencePath: "reports/summary.json",
        },
      ],
    },
  })

  const cases: Array<{
    name: string
    mutate: (manifest: Record<string, any>) => void
    expected: RegExp
  }> = [
    {
      name: "summary field number type",
      mutate: (manifest) => {
        manifest.summary.pageError = "0"
      },
      expected: /summary\.pageError must be a number/,
    },
    {
      name: "promptVersion type",
      mutate: (manifest) => {
        manifest.summary.promptVersion = 101
      },
      expected: /summary\.promptVersion must be a string/,
    },
    {
      name: "cacheStats object type",
      mutate: (manifest) => {
        manifest.summary.cacheStats = null
      },
      expected: /summary\.cacheStats must be an object/,
    },
    {
      name: "cacheStats.misses type",
      mutate: (manifest) => {
        manifest.summary.cacheStats.misses = "0"
      },
      expected: /summary\.cacheStats\.misses must be a number/,
    },
    {
      name: "cacheStats.hit raw type",
      mutate: (manifest) => {
        manifest.summary.cacheStats.hit = null
      },
      expected: /summary\.cacheStats\.hit must be a number/,
    },
    {
      name: "cacheStats.miss raw type",
      mutate: (manifest) => {
        manifest.summary.cacheStats.miss = null
      },
      expected: /summary\.cacheStats\.miss must be a number/,
    },
    {
      name: "cacheStats.hits raw type",
      mutate: (manifest) => {
        manifest.summary.cacheStats.hits = null
      },
      expected: /summary\.cacheStats\.hits must be a number/,
    },
    {
      name: "computerUseSafetyConfirmations type",
      mutate: (manifest) => {
        manifest.summary.computerUseSafetyConfirmations = "0"
      },
      expected: /summary\.computerUseSafetyConfirmations must be a number/,
    },
    {
      name: "fixIterations type",
      mutate: (manifest) => {
        manifest.summary.fixIterations = "1"
      },
      expected: /summary\.fixIterations must be a number/,
    },
    {
      name: "fixConverged type",
      mutate: (manifest) => {
        manifest.summary.fixConverged = "true"
      },
      expected: /summary\.fixConverged must be a boolean/,
    },
    {
      name: "gate check object shape",
      mutate: (manifest) => {
        manifest.gateResults.checks[0] = null
      },
      expected: /gateResults\.checks\[0\] must be an object/,
    },
    {
      name: "gate check required field type",
      mutate: (manifest) => {
        manifest.gateResults.checks[0].reasonCode = 123
      },
      expected: /gateResults\.checks\[0\]\.reasonCode must be a string/,
    },
    {
      name: "gate check severity enum",
      mutate: (manifest) => {
        manifest.gateResults.checks[0].severity = "CRITICAL"
      },
      expected: /gateResults\.checks\[0\]\.severity invalid/,
    },
  ]

  for (const testCase of cases) {
    const manifest = cloneValue(base) as unknown as Record<string, any>
    testCase.mutate(manifest)
    assert.throws(
      () => assertManifest(manifest as unknown as Manifest),
      testCase.expected,
      testCase.name
    )
  }
})
