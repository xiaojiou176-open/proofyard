import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"
import type { Manifest } from "../../core/src/manifest/types.js"
import { buildAiReviewInput } from "./build-input.js"
import {
  AiReviewGenerationError,
  generateAiReviewReport,
  isSeverityAtOrAbove,
  renderAiReviewMarkdown,
  writeAiReviewReportArtifacts,
} from "./generate-findings.js"

function baseManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    schemaVersion: "1.1",
    runId: "run-ai-review",
    target: { type: "web", name: "web.local" },
    profile: "nightly",
    git: { branch: "main", commit: "abc123", dirty: false },
    timing: {
      startedAt: "2026-02-21T00:00:00.000Z",
      finishedAt: "2026-02-21T00:00:10.000Z",
      durationMs: 10000,
    },
    execution: { maxParallelTasks: 2, stagesMs: {}, criticalPath: [] },
    states: [],
    evidenceIndex: [],
    reports: {},
    summary: { consoleError: 0, pageError: 0, http5xx: 0 },
    gateResults: { status: "passed", checks: [] },
    toolchain: { node: process.version },
    ...overrides,
  }
}

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(resolve(tmpdir(), "uiq-ai-review-"))
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("ai-review blocks when no candidate artifacts exist", () => {
  const manifest = baseManifest()
  const input = buildAiReviewInput(manifest, { maxArtifacts: 40 })
  const report = generateAiReviewReport(input, { severityThreshold: "high" })
  assert.equal(report.gate.status, "blocked")
  assert.equal(report.gate.reasonCode, "gate.ai_review.blocked.no_candidate_artifacts")
})

test("ai-review fails when high-severity findings exist", () => {
  const manifest = baseManifest({
    reports: { report: "reports/summary.json" },
    gateResults: {
      status: "failed",
      checks: [
        {
          id: "page.error",
          expected: 0,
          actual: 1,
          severity: "BLOCKER",
          status: "failed",
          reasonCode: "gate.page_error.failed.threshold_exceeded",
          evidencePath: "logs/page-error.log",
        },
      ],
    },
  })
  const input = buildAiReviewInput(manifest, { maxArtifacts: 40 })
  const report = generateAiReviewReport(input, { severityThreshold: "high" })
  assert.equal(report.gate.status, "failed")
  assert.equal(report.gate.reasonCode, "gate.ai_review.failed.high_severity_findings")
  assert.equal(report.generation.mode, "llm")
  assert.equal(report.generation.promptId, "ai_review.findings_summary")
  assert.equal(report.generation.promptVersion, "1.1.0")
  assert.ok(report.summary.highOrAbove >= 1)
  assert.match(report.findings[0]?.reason_code ?? "", /^(gate\.ai_review\.|ai\.gemini\.)/)
  assert.ok((report.findings[0]?.file_path ?? "").length > 0)
  assert.ok((report.findings[0]?.patch_hint ?? "").length > 0)
  assert.ok((report.findings[0]?.acceptance_check ?? "").length > 0)
  assert.ok(["critical", "high", "medium", "low"].includes(report.findings[0]?.risk_level ?? ""))
})

test("ai-review findings order is deterministic", () => {
  const manifest = baseManifest({
    reports: { report: "reports/summary.json" },
    gateResults: {
      status: "failed",
      checks: [
        {
          id: "visual.diff_pixels_max",
          expected: 0,
          actual: 10,
          severity: "MAJOR",
          status: "failed",
          reasonCode: "gate.visual_diff_pixels_max.failed.threshold_exceeded",
          evidencePath: "visual/report.json",
        },
        {
          id: "security.high_vuln",
          expected: 0,
          actual: 2,
          severity: "BLOCKER",
          status: "failed",
          reasonCode: "gate.security_high_vuln.failed.threshold_exceeded",
          evidencePath: "security/report.json",
        },
      ],
    },
  })
  const input = buildAiReviewInput(manifest, { maxArtifacts: 40 })
  const reportA = generateAiReviewReport(input, { severityThreshold: "high" })
  const reportB = generateAiReviewReport(input, { severityThreshold: "high" })
  assert.deepEqual(
    reportA.findings.map((item) => item.issue_id),
    reportB.findings.map((item) => item.issue_id)
  )
  assert.equal(isSeverityAtOrAbove("critical", "high"), true)
  assert.equal(isSeverityAtOrAbove("low", "high"), false)
})

test("ai-review supports explicit rule_fallback mode", () => {
  const manifest = baseManifest({
    reports: { report: "reports/summary.json" },
    gateResults: {
      status: "failed",
      checks: [
        {
          id: "page.error",
          expected: 0,
          actual: 1,
          severity: "BLOCKER",
          status: "failed",
          reasonCode: "gate.page_error.failed.threshold_exceeded",
          evidencePath: "logs/page-error.log",
        },
      ],
    },
  })
  const input = buildAiReviewInput(manifest, { maxArtifacts: 40 })
  const report = generateAiReviewReport(input, { severityThreshold: "high", mode: "rule_fallback" })
  assert.equal(report.generation.mode, "rule_fallback")
  assert.equal(report.generation.model, "rule-fallback-v1")
  assert.equal(report.findings.length, 1)
  assert.match(report.findings[0]?.reason_code ?? "", /^gate\.ai_review\./)
})

test("ai-review fails fast when llm output violates prompt schema", () => {
  const manifest = baseManifest({
    reports: { report: "reports/summary.json" },
    gateResults: {
      status: "failed",
      checks: [
        {
          id: "page.error",
          expected: 0,
          actual: 1,
          severity: "BLOCKER",
          status: "failed",
          reasonCode: "gate.page_error.failed.threshold_exceeded",
          evidencePath: "logs/page-error.log",
        },
      ],
    },
  })
  const input = buildAiReviewInput(manifest, { maxArtifacts: 40 })
  assert.throws(
    () =>
      generateAiReviewReport(input, {
        severityThreshold: "high",
        llmGenerate: () => ({
          model: "bad-model",
          output: {
            summary: "bad",
            findings: [{ issue_id: "AI-001-page-error", severity: "high", impact: "oops" }],
          },
        }),
      }),
    (error: unknown) => {
      assert.ok(error instanceof AiReviewGenerationError)
      assert.equal(error.reasonCode, "gate.ai_review.failed.llm_output_schema_invalid")
      return true
    }
  )
})

test("ai-review fails fast when llm severity is unsupported", () => {
  const manifest = baseManifest({
    reports: { report: "reports/summary.json" },
    gateResults: {
      status: "failed",
      checks: [
        {
          id: "page.error",
          expected: 0,
          actual: 1,
          severity: "BLOCKER",
          status: "failed",
          reasonCode: "gate.page_error.failed.threshold_exceeded",
          evidencePath: "logs/page-error.log",
        },
      ],
    },
  })
  const input = buildAiReviewInput(manifest, { maxArtifacts: 40 })
  assert.throws(
    () =>
      generateAiReviewReport(input, {
        severityThreshold: "high",
        llmGenerate: () => ({
          model: "bad-model",
          output: {
            summary: "bad",
            findings: [
              {
                issue_id: "AI-001-page-error",
                severity: "urgent",
                impact: "oops",
                recommendation: "fix",
              },
            ],
          },
        }),
      }),
    (error: unknown) => {
      assert.ok(error instanceof AiReviewGenerationError)
      assert.equal(error.reasonCode, "gate.ai_review.failed.llm_output_schema_invalid")
      return true
    }
  )
})

test("ai-review passes when findings are below configured severity threshold", () => {
  const manifest = baseManifest({
    reports: { report: "reports/summary.json" },
    gateResults: {
      status: "failed",
      checks: [
        {
          id: "custom.low_signal",
          expected: "ok",
          actual: "failed",
          severity: "MINOR",
          status: "failed",
          reasonCode: "gate.custom_low_signal.failed.threshold_exceeded",
          evidencePath: "reports/summary.json",
        },
      ],
    },
  })
  const input = buildAiReviewInput(manifest, { maxArtifacts: 40 })
  const report = generateAiReviewReport(input, { severityThreshold: "high", mode: "rule_fallback" })
  assert.equal(report.findings.length, 1)
  assert.equal(report.findings[0]?.severity, "low")
  assert.equal(report.gate.status, "passed")
  assert.equal(report.gate.reasonCode, "gate.ai_review.passed.threshold_met")
  assert.equal(report.summary.highOrAbove, 0)
})

test("ai-review normalizes llm reason_code and file_path when values are invalid", () => {
  const manifest = baseManifest({
    reports: { report: "reports/summary.json" },
    gateResults: {
      status: "failed",
      checks: [
        {
          id: "page.error",
          expected: 0,
          actual: 1,
          severity: "BLOCKER",
          status: "failed",
          reasonCode: "gate.page_error.failed.threshold_exceeded",
          evidencePath: "logs/page-error.log",
        },
      ],
    },
  })
  const input = buildAiReviewInput(manifest, { maxArtifacts: 40 })
  const report = generateAiReviewReport(input, {
    severityThreshold: "high",
    llmGenerate: () => ({
      model: "custom-model",
      output: {
        summary: "normalized output",
        findings: [
          {
            issue_id: "AI-001-page-error",
            severity: "high",
            impact: "Page errors exceed threshold.",
            recommendation: "Fix capture and console error path.",
            reason_code: "custom.invalid_prefix",
            file_path: "   ",
            patch_hint: "Adjust error handling in capture pipeline.",
            acceptance_check: "Re-run and ensure page.error check passes.",
            risk_level: "high",
          },
        ],
      },
    }),
  })
  assert.equal(report.findings[0]?.reason_code, "gate.ai_review.finding.page-error")
  assert.equal(report.findings[0]?.file_path, "reports/summary.json")
})

test("ai-review fails fast when llm output string is invalid JSON", () => {
  const manifest = baseManifest({
    reports: { report: "reports/summary.json" },
    gateResults: {
      status: "failed",
      checks: [
        {
          id: "page.error",
          expected: 0,
          actual: 1,
          severity: "BLOCKER",
          status: "failed",
          reasonCode: "gate.page_error.failed.threshold_exceeded",
          evidencePath: "logs/page-error.log",
        },
      ],
    },
  })
  const input = buildAiReviewInput(manifest, { maxArtifacts: 40 })
  assert.throws(
    () =>
      generateAiReviewReport(input, {
        severityThreshold: "high",
        llmGenerate: () => ({
          model: "bad-model",
          output: "{bad-json",
        }),
      }),
    (error: unknown) => {
      assert.ok(error instanceof AiReviewGenerationError)
      assert.equal(error.reasonCode, "gate.ai_review.failed.llm_output_json_invalid")
      return true
    }
  )
})

test("ai-review supports llm mode with zero failed checks and passes gate", () => {
  const manifest = baseManifest({
    reports: { report: "reports/summary.json" },
    gateResults: { status: "passed", checks: [] },
  })
  const input = buildAiReviewInput(manifest, { maxArtifacts: 40 })
  const report = generateAiReviewReport(input, { severityThreshold: "medium", mode: "llm" })
  assert.equal(report.generation.mode, "llm")
  assert.equal(report.generation.model, "rule-llm-synth-v1")
  assert.equal(report.summary.totalFindings, 0)
  assert.equal(report.gate.status, "passed")
  assert.equal(report.gate.reasonCode, "gate.ai_review.passed.threshold_met")
})

test("ai-review uses gemini fallback reason code when issue mapping is missing", () => {
  const manifest = baseManifest({
    reports: { report: "reports/summary.json" },
    gateResults: {
      status: "failed",
      checks: [
        {
          id: "test.flaky_rate",
          expected: 0,
          actual: 1,
          severity: "MAJOR",
          status: "failed",
          reasonCode: "gate.test_flaky_rate.failed.threshold_exceeded",
          evidencePath: "reports/flaky.json",
        },
      ],
    },
  })
  const input = buildAiReviewInput(manifest, { maxArtifacts: 40 })
  const report = generateAiReviewReport(input, {
    severityThreshold: "low",
    llmGenerate: () => ({
      model: "custom-model",
      output: {
        summary: "unmapped issue id",
        findings: [
          {
            issue_id: "AI-999-unmapped",
            severity: "medium",
            impact: "Synthetic unmapped finding.",
            recommendation: "Stabilize flaky tests.",
            reason_code: "invalid.prefix.value",
            file_path: "reports/custom-path.json",
            patch_hint: "Fix deterministic retry policy.",
            acceptance_check: "Re-run flaky suite with strict mode.",
            risk_level: "medium",
          },
        ],
      },
    }),
  })
  assert.equal(report.findings[0]?.reason_code, "ai.gemini.review.finding.generated")
  assert.equal(report.findings[0]?.evidence[0], "reports/custom-path.json")
  assert.equal(report.findings[0]?.file_path, "reports/custom-path.json")
})

test("ai-review supports all severity mapping branches in rule_fallback mode", () => {
  const manifest = baseManifest({
    reports: { report: "reports/summary.json" },
    gateResults: {
      status: "failed",
      checks: [
        {
          id: "a11y.serious_count",
          expected: 0,
          actual: 3,
          severity: "MAJOR",
          status: "failed",
          reasonCode: "gate.a11y_serious_count.failed.threshold_exceeded",
          evidencePath: "reports/a11y.json",
        },
        {
          id: "perf.lcp_ms",
          expected: 2500,
          actual: 4100,
          severity: "MAJOR",
          status: "failed",
          reasonCode: "gate.perf_lcp_ms.failed.threshold_exceeded",
          evidencePath: "reports/perf.json",
        },
        {
          id: "test.flaky_rate",
          expected: 0,
          actual: 1,
          severity: "MAJOR",
          status: "failed",
          reasonCode: "gate.test_flaky_rate.failed.threshold_exceeded",
          evidencePath: "reports/flaky.json",
        },
        {
          id: "safety.dangerous_action_hits",
          expected: 0,
          actual: 1,
          severity: "MAJOR",
          status: "failed",
          reasonCode: "gate.safety_dangerous_action_hits.failed.threshold_exceeded",
          evidencePath: "reports/safety.json",
        },
        {
          id: "load.failed_requests",
          expected: 0,
          actual: 2,
          severity: "MAJOR",
          status: "failed",
          reasonCode: "gate.load_failed_requests.failed.threshold_exceeded",
          evidencePath: "reports/load.json",
        },
        {
          id: "___",
          expected: 0,
          actual: 1,
          severity: "MINOR",
          status: "failed",
          reasonCode: "gate.unknown.failed.threshold_exceeded",
          evidencePath: "reports/other.json",
        },
      ],
    },
  })
  const input = buildAiReviewInput(manifest, { maxArtifacts: 40 })
  const report = generateAiReviewReport(input, { severityThreshold: "low", mode: "rule_fallback" })
  const findingsById = new Map(report.findings.map((finding) => [finding.file_path, finding]))

  assert.equal(findingsById.get("reports/a11y.json")?.severity, "high")
  assert.equal(findingsById.get("reports/perf.json")?.severity, "high")
  assert.equal(findingsById.get("reports/flaky.json")?.severity, "high")
  assert.equal(findingsById.get("reports/safety.json")?.severity, "medium")
  assert.equal(findingsById.get("reports/load.json")?.severity, "medium")
  assert.equal(findingsById.get("reports/other.json")?.severity, "low")
  assert.ok(
    report.findings.some(
      (finding) =>
        finding.issue_id.endsWith("-finding") &&
        finding.reason_code === "gate.ai_review.finding.finding"
    )
  )
  assert.equal(isSeverityAtOrAbove("medium", "low"), true)
  assert.equal(isSeverityAtOrAbove("medium", "critical"), false)
})

test("ai-review fails when risk_level is unsupported after schema validation", () => {
  const manifest = baseManifest({
    reports: { report: "reports/summary.json" },
    gateResults: {
      status: "failed",
      checks: [
        {
          id: "page.error",
          expected: 0,
          actual: 1,
          severity: "BLOCKER",
          status: "failed",
          reasonCode: "gate.page_error.failed.threshold_exceeded",
          evidencePath: "logs/page-error.log",
        },
      ],
    },
  })
  const input = buildAiReviewInput(manifest, { maxArtifacts: 40 })
  assert.throws(
    () =>
      generateAiReviewReport(input, {
        severityThreshold: "high",
        llmGenerate: () => ({
          model: "bad-model",
          output: {
            summary: "bad-risk-level",
            findings: [
              {
                issue_id: "AI-001-page-error",
                severity: "high",
                impact: "Page errors exceed threshold.",
                recommendation: "Fix capture and console error path.",
                reason_code: "gate.ai_review.custom",
                file_path: "logs/page-error.log",
                patch_hint: "Adjust error handling in capture pipeline.",
                acceptance_check: "Re-run and ensure page.error check passes.",
                risk_level: "urgent",
              },
            ],
          },
        }),
      }),
    (error: unknown) => {
      assert.ok(error instanceof AiReviewGenerationError)
      assert.equal(error.reasonCode, "gate.ai_review.failed.llm_output_schema_invalid")
      return true
    }
  )
})

test("ai-review render/write artifacts emits markdown table and escaped pipes", () => {
  const manifest = baseManifest({
    reports: { report: "reports/summary.json" },
    gateResults: {
      status: "failed",
      checks: [
        {
          id: "page.error",
          expected: 0,
          actual: 1,
          severity: "BLOCKER",
          status: "failed",
          reasonCode: "gate.page_error.failed.threshold_exceeded",
          evidencePath: "logs/page-error.log",
        },
      ],
    },
  })
  const input = buildAiReviewInput(manifest, { maxArtifacts: 40 })
  const report = generateAiReviewReport(input, {
    severityThreshold: "high",
    llmGenerate: () => ({
      model: "custom-model",
      output: {
        summary: "markdown-check",
        findings: [
          {
            issue_id: "AI-001-page-error",
            severity: "high",
            impact: "impact|with|pipes",
            recommendation: "recommendation|with|pipes",
            reason_code: "gate.ai_review.custom",
            file_path: "logs/page-error.log",
            patch_hint: "patch",
            acceptance_check: "check|with|pipes",
            risk_level: "high",
          },
        ],
      },
    }),
  })
  const markdown = renderAiReviewMarkdown(report)
  assert.match(markdown, /impact\\\|with\\\|pipes/)
  assert.match(markdown, /recommendation\\\|with\\\|pipes/)
  assert.match(markdown, /\| issue_id \| severity \| risk_level \|/)

  withTempDir((dir) => {
    const paths = writeAiReviewReportArtifacts(
      dir,
      report,
      "reports/ai-review.json",
      "reports/ai-review.md"
    )
    assert.equal(paths.jsonPath, "reports/ai-review.json")
    assert.equal(paths.markdownPath, "reports/ai-review.md")
    const jsonBody = readFileSync(resolve(dir, paths.jsonPath), "utf8")
    const markdownBody = readFileSync(resolve(dir, paths.markdownPath), "utf8")
    assert.match(jsonBody, /"schemaVersion": "1.0"/)
    assert.match(markdownBody, /## UIQ AI Review/)
  })
})

test("ai-review render markdown prints empty-row when no findings exist", () => {
  const manifest = baseManifest({
    reports: { report: "reports/summary.json" },
    gateResults: { status: "passed", checks: [] },
  })
  const input = buildAiReviewInput(manifest, { maxArtifacts: 40 })
  const report = generateAiReviewReport(input, { severityThreshold: "high", mode: "llm" })
  const markdown = renderAiReviewMarkdown(report)
  assert.match(markdown, /\| none \| n\/a \| n\/a \| n\/a \| n\/a \| no findings \|/)
})
