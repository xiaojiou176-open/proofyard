import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"
import { deriveCacheStatsFromReports } from "../run-reporting.js"
import { AiReviewGenerationError } from "../../../../../ai-review/src/generate-findings.js"
import { resolveAiFixAllowlistFromEnv, resolveAiFixModeFromEnv } from "./fix-executor.js"
import {
  finalizePipelineReporting,
  resolveAiReviewGeminiMultimodalFromEnv,
  resolveAiReviewGeminiTopScreenshotsFromEnv,
  resolveAiReviewModeFromEnv,
  resolveGateResultsStatus,
  resolveGeminiGateCheck,
  resolveGeminiModelFromEnv,
  resolveGeminiThoughtSignatureCheck,
  runUiUxGeminiReport,
} from "./reporting.js"
import { createInitialPipelineStageState } from "./stage-execution.js"

const NO_BASE_URL_POLICY: import("../run-types.js").BaseUrlPolicyResult = {
  enabled: false,
  requestedUrl: "",
  requestedOrigin: "",
  allowedOrigins: [],
  matched: false,
  reason: "non_web_target",
}

function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(env)) {
    prev[key] = process.env[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  try {
    fn()
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test("resolveGeminiModelFromEnv uses primary model when speed mode is disabled", () => {
  withEnv(
    {
      AI_SPEED_MODE: "false",
      GEMINI_MODEL_PRIMARY: "models/gemini-3.1-pro-preview",
      GEMINI_MODEL_FLASH: "models/gemini-3-flash-preview",
    },
    () => {
      assert.equal(resolveGeminiModelFromEnv(), "models/gemini-3.1-pro-preview")
    }
  )
})

test("resolveGeminiModelFromEnv uses flash model when speed mode is enabled", () => {
  withEnv(
    {
      AI_SPEED_MODE: "true",
      GEMINI_MODEL_PRIMARY: "models/gemini-3.1-pro-preview",
      GEMINI_MODEL_FLASH: "models/gemini-3-flash-preview",
    },
    () => {
      assert.equal(resolveGeminiModelFromEnv(), "models/gemini-3-flash-preview")
    }
  )
})

test("resolveGeminiModelFromEnv falls back to primary when flash model is missing in speed mode", () => {
  withEnv(
    {
      AI_SPEED_MODE: "true",
      GEMINI_MODEL_PRIMARY: "models/gemini-3.1-pro-preview",
      GEMINI_MODEL_FLASH: "   ",
    },
    () => {
      assert.equal(resolveGeminiModelFromEnv(), "models/gemini-3.1-pro-preview")
    }
  )
})

test("resolveGeminiModelFromEnv falls back to default model when no model env is set", () => {
  withEnv(
    {
      AI_SPEED_MODE: "false",
      GEMINI_MODEL_PRIMARY: " ",
      GEMINI_MODEL_FLASH: undefined,
    },
    () => {
      assert.equal(resolveGeminiModelFromEnv(), "models/gemini-3.1-pro-preview")
    }
  )
})

test("resolveGeminiModelFromEnv uses default model when speed mode is enabled and both model envs are blank", () => {
  withEnv(
    {
      AI_SPEED_MODE: "true",
      GEMINI_MODEL_PRIMARY: " ",
      GEMINI_MODEL_FLASH: " ",
    },
    () => {
      assert.equal(resolveGeminiModelFromEnv(), "models/gemini-3.1-pro-preview")
    }
  )
})

test("resolveAiReviewModeFromEnv defaults to llm", () => {
  withEnv(
    {
      AI_REVIEW_MODE: undefined,
    },
    () => {
      assert.equal(resolveAiReviewModeFromEnv(), "llm")
    }
  )
})

test("resolveAiReviewModeFromEnv supports rule_fallback override", () => {
  withEnv(
    {
      AI_REVIEW_MODE: "rule_fallback",
    },
    () => {
      assert.equal(resolveAiReviewModeFromEnv(), "rule_fallback")
    }
  )
})

test("resolveAiReviewModeFromEnv falls back to llm for unknown values", () => {
  withEnv(
    {
      AI_REVIEW_MODE: "experimental",
    },
    () => {
      assert.equal(resolveAiReviewModeFromEnv(), "llm")
    }
  )
})

test("resolveAiReviewGeminiMultimodalFromEnv defaults to disabled", () => {
  withEnv({ AI_REVIEW_GEMINI_MULTIMODAL: undefined }, () => {
    assert.equal(resolveAiReviewGeminiMultimodalFromEnv(), false)
  })
})

test("resolveAiReviewGeminiMultimodalFromEnv parses truthy values", () => {
  withEnv({ AI_REVIEW_GEMINI_MULTIMODAL: "true" }, () => {
    assert.equal(resolveAiReviewGeminiMultimodalFromEnv(), true)
  })
})

test("resolveAiReviewGeminiMultimodalFromEnv accepts all documented truthy aliases", () => {
  for (const value of ["1", "yes", "on", "TRUE"]) {
    withEnv({ AI_REVIEW_GEMINI_MULTIMODAL: value }, () => {
      assert.equal(resolveAiReviewGeminiMultimodalFromEnv(), true)
    })
  }
})

test("resolveAiReviewGeminiMultimodalFromEnv keeps false for unknown aliases", () => {
  withEnv({ AI_REVIEW_GEMINI_MULTIMODAL: "enabled" }, () => {
    assert.equal(resolveAiReviewGeminiMultimodalFromEnv(), false)
  })
})

test("resolveAiReviewGeminiTopScreenshotsFromEnv defaults to 3", () => {
  withEnv({ AI_REVIEW_GEMINI_TOP_SCREENSHOTS: undefined }, () => {
    assert.equal(resolveAiReviewGeminiTopScreenshotsFromEnv(), 3)
  })
})

test("resolveAiReviewGeminiTopScreenshotsFromEnv rejects invalid values", () => {
  withEnv({ AI_REVIEW_GEMINI_TOP_SCREENSHOTS: "0" }, () => {
    assert.throws(
      () => resolveAiReviewGeminiTopScreenshotsFromEnv(),
      /must be an integer in \[1,10\]/
    )
  })
})

test("resolveAiReviewGeminiTopScreenshotsFromEnv accepts upper-bound values", () => {
  withEnv({ AI_REVIEW_GEMINI_TOP_SCREENSHOTS: "10" }, () => {
    assert.equal(resolveAiReviewGeminiTopScreenshotsFromEnv(), 10)
  })
})

test("resolveGeminiGateCheck returns blocked with explicit missing reason code when artifact is absent", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-gemini-gate-missing-"))
  try {
    const result = resolveGeminiGateCheck({
      baseDir,
      checkId: "ai_review.gemini_accuracy",
      expectedCheckId: "gemini_accuracy_min",
      reportPath: "reports/uiq-gemini-accuracy-gate-pr.json",
      metricField: "accuracy",
      thresholdField: "accuracyMin",
      missingReasonCode: "gate.ai_review.gemini_accuracy.blocked.report_missing",
      parseErrorReasonCode: "gate.ai_review.gemini_accuracy.blocked.report_parse_error",
      invalidPayloadReasonCode: "gate.ai_review.gemini_accuracy.blocked.invalid_report_payload",
    })
    assert.equal(result.reportExists, false)
    assert.equal(result.check.status, "blocked")
    assert.equal(result.check.reasonCode, "gate.ai_review.gemini_accuracy.blocked.report_missing")
    assert.equal(result.check.evidencePath, "reports/uiq-gemini-accuracy-gate-pr.json")
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("resolveGeminiGateCheck propagates status and reasonCode from valid gate report", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-gemini-gate-valid-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    writeFileSync(
      resolve(baseDir, "reports/uiq-gemini-concurrency-gate-pr.json"),
      JSON.stringify(
        {
          checkId: "gemini_parallel_consistency_min",
          status: "passed",
          reasonCode: "gate.gemini_parallel_consistency_min.passed.threshold_met",
          metrics: { parallelConsistency: 0.97, sampleSize: 12 },
          thresholds: { parallelConsistencyMin: 0.95, sampleSizeMin: 10 },
        },
        null,
        2
      ),
      "utf8"
    )
    const result = resolveGeminiGateCheck({
      baseDir,
      checkId: "ai_review.gemini_concurrency",
      expectedCheckId: "gemini_parallel_consistency_min",
      reportPath: "reports/uiq-gemini-concurrency-gate-pr.json",
      metricField: "parallelConsistency",
      thresholdField: "parallelConsistencyMin",
      missingReasonCode: "gate.ai_review.gemini_concurrency.blocked.report_missing",
      parseErrorReasonCode: "gate.ai_review.gemini_concurrency.blocked.report_parse_error",
      invalidPayloadReasonCode: "gate.ai_review.gemini_concurrency.blocked.invalid_report_payload",
    })
    assert.equal(result.reportExists, true)
    assert.equal(result.check.status, "passed")
    assert.equal(
      result.check.reasonCode,
      "gate.gemini_parallel_consistency_min.passed.threshold_met"
    )
    assert.equal(result.check.evidencePath, "reports/uiq-gemini-concurrency-gate-pr.json")
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("resolveGeminiGateCheck keeps failed status when report payload is valid", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-gemini-gate-failed-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    writeFileSync(
      resolve(baseDir, "reports/uiq-gemini-accuracy-gate-pr.json"),
      JSON.stringify(
        {
          checkId: "gemini_accuracy_min",
          status: "failed",
          reasonCode: "gate.gemini_accuracy_min.failed.threshold_not_met",
          metrics: { accuracy: 0.82, sampleSize: 10 },
          thresholds: { accuracyMin: 0.9 },
        },
        null,
        2
      ),
      "utf8"
    )
    const result = resolveGeminiGateCheck({
      baseDir,
      checkId: "ai_review.gemini_accuracy",
      expectedCheckId: "gemini_accuracy_min",
      reportPath: "reports/uiq-gemini-accuracy-gate-pr.json",
      metricField: "accuracy",
      thresholdField: "accuracyMin",
      missingReasonCode: "gate.ai_review.gemini_accuracy.blocked.report_missing",
      parseErrorReasonCode: "gate.ai_review.gemini_accuracy.blocked.report_parse_error",
      invalidPayloadReasonCode: "gate.ai_review.gemini_accuracy.blocked.invalid_report_payload",
    })
    assert.equal(result.reportExists, true)
    assert.equal(result.check.status, "failed")
    assert.equal(result.check.reasonCode, "gate.gemini_accuracy_min.failed.threshold_not_met")
    assert.equal(result.check.actual, "check_id=gemini_accuracy_min;metric=0.82;threshold=0.9;sample_size=10")
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("resolveGeminiGateCheck keeps blocked status when report payload is valid", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-gemini-gate-blocked-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    writeFileSync(
      resolve(baseDir, "reports/uiq-gemini-concurrency-gate-pr.json"),
      JSON.stringify(
        {
          checkId: "gemini_parallel_consistency_min",
          status: "blocked",
          reasonCode: "gate.gemini_parallel_consistency_min.blocked.insufficient_samples",
          metrics: { parallelConsistency: 0.88, sampleSize: 3 },
          thresholds: { parallelConsistencyMin: 0.9, sampleSizeMin: 10 },
        },
        null,
        2
      ),
      "utf8"
    )
    const result = resolveGeminiGateCheck({
      baseDir,
      checkId: "ai_review.gemini_concurrency",
      expectedCheckId: "gemini_parallel_consistency_min",
      reportPath: "reports/uiq-gemini-concurrency-gate-pr.json",
      metricField: "parallelConsistency",
      thresholdField: "parallelConsistencyMin",
      missingReasonCode: "gate.ai_review.gemini_concurrency.blocked.report_missing",
      parseErrorReasonCode: "gate.ai_review.gemini_concurrency.blocked.report_parse_error",
      invalidPayloadReasonCode: "gate.ai_review.gemini_concurrency.blocked.invalid_report_payload",
    })
    assert.equal(result.reportExists, true)
    assert.equal(result.check.status, "blocked")
    assert.equal(
      result.check.reasonCode,
      "gate.gemini_parallel_consistency_min.blocked.insufficient_samples"
    )
    assert.equal(
      result.check.actual,
      "check_id=gemini_parallel_consistency_min;metric=0.88;threshold=0.9;sample_size=3"
    )
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("resolveGeminiGateCheck returns parse-error reason when gate report is invalid JSON", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-gemini-gate-parse-error-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    writeFileSync(
      resolve(baseDir, "reports/uiq-gemini-accuracy-gate-pr.json"),
      "{invalid-json",
      "utf8"
    )
    const result = resolveGeminiGateCheck({
      baseDir,
      checkId: "ai_review.gemini_accuracy",
      expectedCheckId: "gemini_accuracy_min",
      reportPath: "reports/uiq-gemini-accuracy-gate-pr.json",
      metricField: "accuracy",
      thresholdField: "accuracyMin",
      missingReasonCode: "gate.ai_review.gemini_accuracy.blocked.report_missing",
      parseErrorReasonCode: "gate.ai_review.gemini_accuracy.blocked.report_parse_error",
      invalidPayloadReasonCode: "gate.ai_review.gemini_accuracy.blocked.invalid_report_payload",
    })
    assert.equal(result.reportExists, true)
    assert.equal(result.check.status, "blocked")
    assert.equal(result.check.actual, "report_parse_error")
    assert.equal(
      result.check.reasonCode,
      "gate.ai_review.gemini_accuracy.blocked.report_parse_error"
    )
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("resolveGeminiGateCheck returns invalid-payload reason when check payload mismatches", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-gemini-gate-invalid-payload-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    writeFileSync(
      resolve(baseDir, "reports/uiq-gemini-concurrency-gate-pr.json"),
      JSON.stringify(
        {
          checkId: "unexpected_check_id",
          status: "passed",
          reasonCode: "gate.some_unexpected_check.passed.threshold_met",
          metrics: { parallelConsistency: 0.9, sampleSize: "bad-value" },
          thresholds: { parallelConsistencyMin: 0.95 },
        },
        null,
        2
      ),
      "utf8"
    )
    const result = resolveGeminiGateCheck({
      baseDir,
      checkId: "ai_review.gemini_concurrency",
      expectedCheckId: "gemini_parallel_consistency_min",
      reportPath: "reports/uiq-gemini-concurrency-gate-pr.json",
      metricField: "parallelConsistency",
      thresholdField: "parallelConsistencyMin",
      missingReasonCode: "gate.ai_review.gemini_concurrency.blocked.report_missing",
      parseErrorReasonCode: "gate.ai_review.gemini_concurrency.blocked.report_parse_error",
      invalidPayloadReasonCode: "gate.ai_review.gemini_concurrency.blocked.invalid_report_payload",
    })
    assert.equal(result.reportExists, true)
    assert.equal(result.check.status, "blocked")
    assert.equal(
      result.check.actual,
      "check_id=unexpected_check_id;metric=0.9;threshold=0.95;sample_size=n/a"
    )
    assert.equal(
      result.check.reasonCode,
      "gate.ai_review.gemini_concurrency.blocked.invalid_report_payload"
    )
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("resolveGeminiGateCheck blocks when report status is not one of passed/failed/blocked", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-gemini-gate-invalid-status-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    writeFileSync(
      resolve(baseDir, "reports/uiq-gemini-concurrency-gate-pr.json"),
      JSON.stringify(
        {
          checkId: "gemini_parallel_consistency_min",
          status: "ok",
          reasonCode: "gate.some_check.passed.threshold_met",
          metrics: { parallelConsistency: 0.96, sampleSize: 12 },
          thresholds: { parallelConsistencyMin: 0.95 },
        },
        null,
        2
      ),
      "utf8"
    )
    const result = resolveGeminiGateCheck({
      baseDir,
      checkId: "ai_review.gemini_concurrency",
      expectedCheckId: "gemini_parallel_consistency_min",
      reportPath: "reports/uiq-gemini-concurrency-gate-pr.json",
      metricField: "parallelConsistency",
      thresholdField: "parallelConsistencyMin",
      missingReasonCode: "gate.ai_review.gemini_concurrency.blocked.report_missing",
      parseErrorReasonCode: "gate.ai_review.gemini_concurrency.blocked.report_parse_error",
      invalidPayloadReasonCode: "gate.ai_review.gemini_concurrency.blocked.invalid_report_payload",
    })
    assert.equal(result.reportExists, true)
    assert.equal(result.check.status, "blocked")
    assert.equal(
      result.check.reasonCode,
      "gate.ai_review.gemini_concurrency.blocked.invalid_report_payload"
    )
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("resolveGeminiGateCheck emits <missing>/n-a details when payload fields are non-string", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-gemini-gate-missing-fields-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    writeFileSync(
      resolve(baseDir, "reports/uiq-gemini-accuracy-gate-pr.json"),
      JSON.stringify(
        {
          checkId: 123,
          status: "passed",
          reasonCode: 456,
          metrics: {},
          thresholds: {},
        },
        null,
        2
      ),
      "utf8"
    )
    const result = resolveGeminiGateCheck({
      baseDir,
      checkId: "ai_review.gemini_accuracy",
      expectedCheckId: "gemini_accuracy_min",
      reportPath: "reports/uiq-gemini-accuracy-gate-pr.json",
      metricField: "accuracy",
      thresholdField: "accuracyMin",
      missingReasonCode: "gate.ai_review.gemini_accuracy.blocked.report_missing",
      parseErrorReasonCode: "gate.ai_review.gemini_accuracy.blocked.report_parse_error",
      invalidPayloadReasonCode: "gate.ai_review.gemini_accuracy.blocked.invalid_report_payload",
    })
    assert.equal(result.check.status, "blocked")
    assert.equal(
      result.check.actual,
      "check_id=<missing>;metric=n/a;threshold=n/a;sample_size=n/a"
    )
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("resolveGeminiThoughtSignatureCheck passes when signature exists", () => {
  const check = resolveGeminiThoughtSignatureCheck({
    report: {
      thought_signatures: {
        status: "present",
        reason_code: "ai.gemini.thought_signature.present",
        signatures: ["sig-1"],
        signature_count: 1,
      },
    },
    evidencePath: "reports/ui-ux-gemini-report.json",
  })
  assert.equal(check.status, "passed")
  assert.equal(check.reasonCode, "gate.ai_review.gemini_thought_signature.passed.present")
})

test("resolveGeminiThoughtSignatureCheck fails with explicit reason when signature is missing", () => {
  const check = resolveGeminiThoughtSignatureCheck({
    report: {
      thought_signatures: {
        status: "missing",
        reason_code: "ai.gemini.thought_signature.missing",
        signatures: [],
        signature_count: 0,
      },
    },
    evidencePath: "reports/ui-ux-gemini-report.json",
  })
  assert.equal(check.status, "failed")
  assert.equal(check.reasonCode, "ai.gemini.thought_signature.missing")
})

test("resolveGeminiThoughtSignatureCheck blocks missing status reason as invalid payload", () => {
  const check = resolveGeminiThoughtSignatureCheck({
    report: {
      thought_signatures: {
        status: "missing",
        reason_code: "   ",
        signatures: [],
        signature_count: 0,
      },
    },
    evidencePath: "reports/ui-ux-gemini-report.json",
  })
  assert.equal(check.status, "blocked")
  assert.equal(
    check.reasonCode,
    "gate.ai_review.gemini_thought_signature.blocked.invalid_report_payload"
  )
})

test("resolveGeminiThoughtSignatureCheck blocks on parse failure", () => {
  const check = resolveGeminiThoughtSignatureCheck({
    report: {
      thought_signatures: {
        status: "parse_failed",
        reason_code: "ai.gemini.thought_signature.parse_failed",
        signatures: [],
        signature_count: 0,
      },
    },
    evidencePath: "reports/ui-ux-gemini-report.json",
  })
  assert.equal(check.status, "blocked")
  assert.equal(check.reasonCode, "ai.gemini.thought_signature.parse_failed")
})

test("resolveGeminiThoughtSignatureCheck blocks parse_failed without reason as invalid payload", () => {
  const check = resolveGeminiThoughtSignatureCheck({
    report: {
      thought_signatures: {
        status: "parse_failed",
        reason_code: "  ",
        signatures: [],
        signature_count: 0,
      },
    },
    evidencePath: "reports/ui-ux-gemini-report.json",
  })
  assert.equal(check.status, "blocked")
  assert.equal(
    check.reasonCode,
    "gate.ai_review.gemini_thought_signature.blocked.invalid_report_payload"
  )
})

test("resolveGeminiThoughtSignatureCheck blocks invalid payload instead of crashing", () => {
  const check = resolveGeminiThoughtSignatureCheck({
    report: {},
    evidencePath: "reports/ui-ux-gemini-report.json",
  })
  assert.equal(check.status, "blocked")
  assert.equal(
    check.reasonCode,
    "gate.ai_review.gemini_thought_signature.blocked.invalid_report_payload"
  )
})

test("resolveGeminiThoughtSignatureCheck blocks when status is present but signature count is zero", () => {
  const check = resolveGeminiThoughtSignatureCheck({
    report: {
      thought_signatures: {
        status: "present",
        reason_code: "ai.gemini.thought_signature.present",
        signatures: [],
        signature_count: 0,
      },
    },
    evidencePath: "reports/ui-ux-gemini-report.json",
  })
  assert.equal(check.status, "blocked")
  assert.equal(
    check.reasonCode,
    "gate.ai_review.gemini_thought_signature.blocked.invalid_report_payload"
  )
})

test("resolveGeminiThoughtSignatureCheck infers signature_count when omitted", () => {
  const check = resolveGeminiThoughtSignatureCheck({
    report: {
      thought_signatures: {
        status: "present",
        reason_code: "ai.gemini.thought_signature.present",
        signatures: ["sig-a", "sig-b"],
      },
    },
    evidencePath: "reports/ui-ux-gemini-report.json",
  })
  assert.equal(check.status, "passed")
  assert.equal(check.actual, "status=present;count=2")
})

test("resolveGeminiThoughtSignatureCheck filters invalid signatures before counting", () => {
  const check = resolveGeminiThoughtSignatureCheck({
    report: {
      thought_signatures: {
        status: "present",
        reason_code: "ai.gemini.thought_signature.present",
        signatures: ["sig-a", " ", 42 as never],
      },
    },
    evidencePath: "reports/ui-ux-gemini-report.json",
  })
  assert.equal(check.status, "passed")
  assert.equal(check.actual, "status=present;count=1")
})

test("resolveGeminiThoughtSignatureCheck handles missing signatures array", () => {
  const check = resolveGeminiThoughtSignatureCheck({
    report: {
      thought_signatures: {
        status: "present",
        reason_code: "ai.gemini.thought_signature.present",
        signature_count: 1,
      },
    },
    evidencePath: "reports/ui-ux-gemini-report.json",
  })
  assert.equal(check.status, "passed")
  assert.equal(check.actual, "status=present;count=1")
})

test("resolveGeminiThoughtSignatureCheck treats non-string status/reason as missing payload fields", () => {
  const check = resolveGeminiThoughtSignatureCheck({
    report: {
      thought_signatures: {
        status: 1 as never,
        reason_code: 2 as never,
      },
    },
    evidencePath: "reports/ui-ux-gemini-report.json",
  })
  assert.equal(check.status, "blocked")
  assert.equal(check.actual, "status=<missing>;count=0")
  assert.equal(
    check.reasonCode,
    "gate.ai_review.gemini_thought_signature.blocked.invalid_report_payload"
  )
})

test("runUiUxGeminiReport wraps child-process stderr when gemini report generation fails", () => {
  const previousApiKey = process.env.GEMINI_API_KEY
  const previousPrimary = process.env.GEMINI_MODEL_PRIMARY
  const runRoot = resolve(process.cwd(), ".runtime-cache/artifacts/runs", "reporting-test-run")
  mkdirSync(runRoot, { recursive: true })
  try {
    writeFileSync(
      resolve(runRoot, "manifest.json"),
      JSON.stringify({
        runId: "reporting-test-run",
        profile: "pr",
        target: { type: "web", name: "web.local", baseUrl: "http://127.0.0.1:4173" },
        summary: {},
        evidenceIndex: [{ id: "s1", source: "state", kind: "screenshot", path: "screenshots/home.png" }],
      }),
      "utf8"
    )
    mkdirSync(resolve(runRoot, "screenshots"), { recursive: true })
    writeFileSync(resolve(runRoot, "screenshots/home.png"), "png", "utf8")
    delete process.env.GEMINI_API_KEY
    process.env.GEMINI_MODEL_PRIMARY = "models/gemini-3.1-pro-preview"

    assert.throws(
      () => runUiUxGeminiReport({ resolvedRunId: "reporting-test-run", speedMode: false }),
      /Gemini multimodal UI\/UX report generation failed: .*GEMINI_API_KEY is required/
    )
  } finally {
    rmSync(runRoot, { recursive: true, force: true })
    if (previousApiKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = previousApiKey
    if (previousPrimary === undefined) delete process.env.GEMINI_MODEL_PRIMARY
    else process.env.GEMINI_MODEL_PRIMARY = previousPrimary
  }
})

test("runUiUxGeminiReport returns parsed report when command and report reader are injected", () => {
  let receivedCommandArgs: string[] | undefined
  withEnv({ AI_REVIEW_GEMINI_TOP_SCREENSHOTS: "4" }, () => {
    const result = runUiUxGeminiReport(
      { resolvedRunId: "run-injected-success", speedMode: true },
      {
        execFileSyncImpl: (_file, commandArgs) => {
          receivedCommandArgs = commandArgs
        },
        readFileSyncImpl: (path) => {
          assert.ok(path.includes("run-injected-success"))
          assert.ok(path.endsWith("reports/ui-ux-gemini-report.json"))
          return JSON.stringify({
            reason_code: "ai.gemini.ui_ux.report.generated",
            summary: {
              total_findings: 3,
              high_or_above: 1,
              overall_score: 72,
            },
          })
        },
      }
    )
    assert.equal(result.reportPath, "reports/ui-ux-gemini-report.json")
    assert.equal(result.report.summary?.total_findings, 3)
    assert.equal(result.report.summary?.high_or_above, 1)
    assert.ok(receivedCommandArgs)
    assert.ok(receivedCommandArgs?.includes("--speed_mode=true"))
    assert.ok(receivedCommandArgs?.includes("--top_screenshots=4"))
  })
})

test("runUiUxGeminiReport falls back to Error.message when stderr is unavailable", () => {
  assert.throws(
    () =>
      runUiUxGeminiReport(
        { resolvedRunId: "run-error-message", speedMode: false },
        {
          execFileSyncImpl: () => {
            throw new Error("child process exited with code 2")
          },
          readFileSyncImpl: () => JSON.stringify({ summary: {} }),
        }
      ),
    /Gemini multimodal UI\/UX report generation failed: child process exited with code 2/
  )
})

test("runUiUxGeminiReport stringifies non-Error throws from command execution", () => {
  assert.throws(
    () =>
      runUiUxGeminiReport(
        { resolvedRunId: "run-non-error-throw", speedMode: false },
        {
          execFileSyncImpl: () => {
            throw "non-error-throw"
          },
          readFileSyncImpl: () => JSON.stringify({ summary: {} }),
        }
      ),
    /Gemini multimodal UI\/UX report generation failed: non-error-throw/
  )
})

test("runUiUxGeminiReport tolerates missing stderr field value when error object exposes stderr key", () => {
  assert.throws(
    () =>
      runUiUxGeminiReport(
        { resolvedRunId: "run-stderr-missing-value", speedMode: false },
        {
          execFileSyncImpl: () => {
            throw Object.assign(new Error("child process failed"), { stderr: undefined })
          },
          readFileSyncImpl: () => JSON.stringify({ summary: {} }),
        }
      ),
    /^Error: Gemini multimodal UI\/UX report generation failed:\s*$/
  )
})

test("runUiUxGeminiReport uses default file reader when readFileSyncImpl is not injected", () => {
  const runId = `run-default-reader-${Date.now()}`
  const runRoot = resolve(process.cwd(), ".runtime-cache/artifacts/runs", runId)
  const reportPath = resolve(runRoot, "reports/ui-ux-gemini-report.json")
  mkdirSync(resolve(reportPath, ".."), { recursive: true })
  try {
    writeFileSync(
      reportPath,
      JSON.stringify({
        reason_code: "ai.gemini.ui_ux.report.generated",
        summary: { total_findings: 0 },
      }),
      "utf8"
    )
    const result = runUiUxGeminiReport(
      { resolvedRunId: runId, speedMode: false },
      { execFileSyncImpl: () => undefined }
    )
    assert.equal(result.report.summary?.total_findings, 0)
  } finally {
    rmSync(runRoot, { recursive: true, force: true })
  }
})

test("finalizePipelineReporting covers ai-review multimodal/fix auto fallback branches", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-reporting-ai-review-fallbacks-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    writeFileSync(resolve(baseDir, "reports/runtime.json"), JSON.stringify({ started: false }), "utf8")
    const stage = createInitialPipelineStageState("reports/runtime.json")
    stage.effectiveAiReviewConfig = { enabled: true, maxArtifacts: 5, severityThreshold: "high" } as never
    stage.contractTestResult = { status: "passed", reportPath: "reports/contract.json" } as never
    stage.computerUseResult = {
      status: "failed",
      reason: "ai.gemini.computer_use.failed",
      reportPath: "reports/computer-use.json",
    } as never
    stage.postFixRegression = {
      status: "failed",
      reasonCode: "gate.post_fix.failed.remaining_failed_suites",
      iterationsExecuted: 1,
      converged: false,
      remainingFailedSuites: [],
    } as never
    stage.exploreEngineBlockedReasonCode = "gate.explore.blocked.backstop_not_available"
    stage.visualEngineBlockedReasonCode = "gate.visual.blocked.backstop_not_available"
    stage.a11yReportPath = "reports/a11y.json"
    stage.perfReportPath = "reports/perf.json"
    stage.visualReportPath = "reports/visual.json"
    stage.securityReportPath = "reports/security.json"
    stage.securityFailed = true
    stage.securityFailedReason = "scanner crashed"
    stage.loadReportPath = "reports/load.json"
    stage.loadSummary = {
      totalRequests: 1,
      failedRequests: 0,
      http5xx: 0,
      requestsPerSecond: 1,
      latencyP95Ms: 1,
      latencyP99Ms: 1,
      errorBudgetRate: 0,
      stageFailedCount: 0,
      engineReady: false,
      engines: [{ status: "blocked", detail: "k6_not_available" }],
    } as never
    stage.aiReviewReportMarkdownPath = "reports/preexisting-ai-review.md"

    let result: { manifestPath: string } | undefined
    withEnv(
      {
        AI_REVIEW_GEMINI_MULTIMODAL: "true",
        AI_SPEED_MODE: "true",
        UIQ_AI_FIX_MODE: "auto",
        GEMINI_MODEL_PRIMARY: "models/gemini-3.1-pro-preview",
        GEMINI_MODEL_FLASH: "models/gemini-3-flash-preview",
      },
      () => {
        result = finalizePipelineReporting(
          {
            baseDir,
            resolvedRunId: "run-ai-review-fallbacks",
            startedAt: "2026-03-09T00:00:00.000Z",
            profile: { name: "pr", steps: ["computer_use"], gates: {} } as never,
            target: {
              type: "web",
              name: "web.local",
              driver: "web-playwright",
              baseUrl: "http://127.0.0.1:4173",
            },
            effectiveBaseUrl: "http://127.0.0.1:4173",
            effectiveApp: undefined,
            effectiveBundleId: undefined,
            stateModel: { configuredRoutes: [], configuredStories: [], configuredTotal: 0 } as never,
            runtimeStart: {
              started: false,
              autostart: false,
              healthcheckPassed: false,
              reportPath: "reports/runtime.json",
            } as never,
            driverContract: {
              driverId: "web-playwright",
              targetTypes: ["web"],
              capabilities: { navigate: true, interact: true, capture: true, logs: true, network: true, trace: true },
            } as never,
            blockedStepReasons: [],
            blockedStepDetails: [],
            effectiveDiagnosticsConfig: { maxItems: 5 },
            maxParallelTasks: 1,
            stageDurationsMs: { "test.e2e": 5 },
            baseUrlPolicy: {
              enabled: true,
              requestedUrl: "http://127.0.0.1:4173",
              requestedOrigin: "http://127.0.0.1:4173",
              allowedOrigins: ["http://127.0.0.1:4173"],
              matched: true,
              reason: "origin_allowed",
            },
            state: stage,
          },
          {
            generateAiReviewReportImpl: () =>
              ({
                schemaVersion: "1.0",
                generatedAt: "2026-03-09T00:00:00.000Z",
                runId: "run-ai-review-fallbacks",
                profile: "pr",
                target: { type: "web", name: "web.local", baseUrl: "http://127.0.0.1:4173", app: "", bundleId: "" },
                severityThreshold: "high",
                candidates: [],
                findings: [],
                summary: { totalFindings: 0, highOrAbove: 0, candidateArtifacts: 0 },
                gate: { status: "passed", reasonCode: "gate.ai_review.passed.no_high_severity_findings" },
                generation: {
                  mode: "llm",
                  promptId: "ai-review.test.prompt",
                  promptVersion: "test-v1",
                  model: "rule-llm-synth-v1",
                },
              }) as never,
            writeAiReviewReportArtifactsImpl: () =>
              ({
                jsonPath: "reports/ai-review.json",
                markdownPath: "reports/ai-review.md",
              }) as never,
            runUiUxGeminiReportImpl: () =>
              ({
                reportPath: "reports/ui-ux-gemini-report.json",
                report: {
                  reason_code: "ai.gemini.ui_ux.report.generated.custom",
                  thought_signatures: {
                    status: "present",
                    reason_code: "ai.gemini.thought_signature.present",
                    signatures: ["sig-1"],
                    signature_count: 1,
                  },
                  summary: {},
                },
              }) as never,
            resolveGeminiGateCheckImpl: ({ checkId, reportPath }) =>
              ({
                check: {
                  id: checkId,
                  expected: "mock",
                  actual: "mock",
                  severity: "MAJOR",
                  status: "passed",
                  reasonCode: "gate.mock.passed",
                  evidencePath: reportPath,
                },
                reportExists: true,
              }) as never,
            executeFixExecutorImpl: () =>
              ({
                mode: "auto",
                reportPath: "reports/fix-result.json",
                summary: { totalTasks: 2, applied: 2, failed: 0, planned: 2 },
                gate: {
                  status: "passed",
                  reasonCode: "gate.ai_fix.execution.passed.auto",
                },
              }) as never,
          }
        )
      }
    )

    const manifest = JSON.parse(readFileSync(resolve(baseDir, result!.manifestPath), "utf8")) as {
      gateResults: {
        checks: Array<{ id: string; expected: string; actual: string; status: string; evidencePath: string }>
      }
      diagnostics: { security?: { executionStatus: string } }
      reports: Record<string, string>
    }
    const checks = new Map(manifest.gateResults.checks.map((check) => [check.id, check]))
    assert.equal(checks.get("ai_fix.execution")?.expected, "all_eligible_fixes_applied")
    assert.equal(checks.get("scenario.computer_use")?.evidencePath, "reports/computer-use.json")
    assert.equal(checks.get("post_fix.regression")?.actual, "iterations=1;remaining=none")
    assert.equal(checks.get("explore.engine")?.expected, "builtin")
    assert.equal(checks.get("visual.engine")?.expected, "builtin")
    assert.equal(manifest.diagnostics.security?.executionStatus, "failed")
    assert.equal(manifest.reports.a11y, "reports/a11y.json")
    assert.equal(manifest.reports.perf, "reports/perf.json")
    assert.equal(manifest.reports.visual, "reports/visual.json")
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("deriveCacheStatsFromReports aggregates cache stats from report files", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-cache-stats-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    writeFileSync(
      resolve(baseDir, "reports/a.json"),
      JSON.stringify({ summary: { cacheStats: { hits: 3, misses: 1, hitRate: 0.75 } } }),
      "utf8"
    )
    writeFileSync(
      resolve(baseDir, "reports/b.json"),
      JSON.stringify({ diagnostics: { cache: { hit: 2, miss: 2 } } }),
      "utf8"
    )

    const resolved = deriveCacheStatsFromReports(baseDir, ["reports/a.json", "reports/b.json"])
    assert.equal(resolved.hits, 5)
    assert.equal(resolved.misses, 3)
    assert.equal(resolved.hitRate, 0.625)
    assert.equal(resolved.reason, "derived_from_report_cache_fields")
    assert.equal(resolved.sourceCount, 2)
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("deriveCacheStatsFromReports reports no-field reason when cache stats are unavailable", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-cache-stats-empty-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    writeFileSync(
      resolve(baseDir, "reports/a.json"),
      JSON.stringify({ summary: { ok: true } }),
      "utf8"
    )
    const resolved = deriveCacheStatsFromReports(baseDir, [
      "reports/a.json",
      "reports/missing.json",
    ])
    assert.equal(resolved.hits, 0)
    assert.equal(resolved.misses, 0)
    assert.equal(resolved.hitRate, 0)
    assert.equal(resolved.reason, "cache_stats_unavailable_no_report_fields")
    assert.equal(resolved.missingReports, 1)
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("deriveCacheStatsFromReports reports parse-error reason when report JSON is invalid", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-cache-stats-invalid-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    writeFileSync(resolve(baseDir, "reports/a.json"), "{", "utf8")
    const resolved = deriveCacheStatsFromReports(baseDir, ["reports/a.json"])
    assert.equal(resolved.hits, 0)
    assert.equal(resolved.misses, 0)
    assert.equal(resolved.reason, "cache_stats_unavailable_parse_error")
    assert.equal(resolved.parseErrors, 1)
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("resolveAiFixModeFromEnv defaults to report_only", () => {
  withEnv(
    {
      UIQ_AI_FIX_MODE: undefined,
    },
    () => {
      assert.equal(resolveAiFixModeFromEnv(), "report_only")
    }
  )
})

test("resolveAiFixModeFromEnv supports auto override", () => {
  withEnv(
    {
      UIQ_AI_FIX_MODE: "auto",
    },
    () => {
      assert.equal(resolveAiFixModeFromEnv(), "auto")
    }
  )
})

test("resolveAiFixAllowlistFromEnv falls back to defaults and parses custom values", () => {
  withEnv(
    {
      UIQ_AI_FIX_ALLOWLIST: undefined,
    },
    () => {
      assert.ok(resolveAiFixAllowlistFromEnv().length > 0)
    }
  )
  withEnv(
    {
      UIQ_AI_FIX_ALLOWLIST: "packages, apps ,packages",
    },
    () => {
      assert.deepEqual(resolveAiFixAllowlistFromEnv(), ["packages", "apps"])
    }
  )
})

test("resolveGateResultsStatus prioritizes failed over blocked over passed", () => {
  assert.equal(resolveGateResultsStatus([{ status: "passed" }]), "passed")
  assert.equal(resolveGateResultsStatus([{ status: "blocked" }, { status: "passed" }]), "blocked")
  assert.equal(
    resolveGateResultsStatus([{ status: "failed" }, { status: "blocked" }, { status: "passed" }]),
    "failed"
  )
})

test("finalizePipelineReporting marks failed computer_use with reason code and persisted diagnostics", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-reporting-computer-use-fail-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    writeFileSync(
      resolve(baseDir, "reports/runtime.json"),
      JSON.stringify({ started: false }),
      "utf8"
    )
    writeFileSync(
      resolve(baseDir, "reports/computer-use.json"),
      JSON.stringify({ status: "failed", reason: "ai.gemini.computer_use.max_steps_exceeded" }),
      "utf8"
    )
    const stageState = createInitialPipelineStageState("reports/runtime.json")
    stageState.computerUseResult = {
      status: "failed",
      reason: "ai.gemini.computer_use.max_steps_exceeded",
      exitCode: 2,
      command: "python3",
      args: ["scripts/computer-use/gemini-computer-use.py", "task"],
      scriptPath: "scripts/computer-use/gemini-computer-use.py",
      stdoutTail: "",
      stderrTail: "max steps exceeded",
      computerUseSafetyConfirmations: 1,
      safetyConfirmationEvidence: { events: [{ kind: "confirm", label: "safe-click" }] },
      error: "max steps exceeded",
    }
    stageState.computerUseSafetyConfirmations = 1
    stageState.computerUseSafetyConfirmationEvidence = {
      events: [{ kind: "confirm", label: "safe-click" }],
    }
    stageState.generatedReports.computerUse = "reports/computer-use.json"

    const result = finalizePipelineReporting({
      baseDir,
      resolvedRunId: "run-computer-use-failed",
      startedAt: "2026-02-22T10:00:00.000Z",
      profile: {
        name: "pr",
        steps: ["computer_use"],
        gates: {
          consoleErrorMax: 0,
          pageErrorMax: 0,
          http5xxMax: 0,
        },
      },
      target: {
        name: "web.ci",
        type: "web",
        driver: "web-playwright",
        baseUrl: "http://127.0.0.1:4173",
      },
      effectiveBaseUrl: "http://127.0.0.1:4173",
      effectiveApp: undefined,
      effectiveBundleId: undefined,
      stateModel: {
        configuredRoutes: [],
        configuredStories: [],
        configuredTotal: 0,
      } as never,
      runtimeStart: {
        autostart: false,
        started: false,
        healthcheckPassed: false,
        healthcheckUrl: "http://127.0.0.1:4173/health",
        processes: [],
        reportPath: "reports/runtime.json",
        teardown: () => undefined,
      },
      driverContract: {
        driverId: "web-playwright",
        targetTypes: ["web"],
        capabilities: {
          navigate: true,
          interact: true,
          capture: true,
          logs: true,
          network: true,
          trace: true,
          lifecycle: false,
        },
      },
      blockedStepReasons: [],
      blockedStepDetails: [],
      effectiveDiagnosticsConfig: {
        maxItems: 10,
      },
      maxParallelTasks: 1,
      stageDurationsMs: {
        "scenario.computer_use": 1200,
      },
      baseUrlPolicy: {
        enabled: true,
        requestedUrl: "http://127.0.0.1:4173",
        requestedOrigin: "http://127.0.0.1:4173",
        allowedOrigins: ["http://127.0.0.1:4173"],
        matched: true,
        reason: "origin_allowed",
      },
      state: stageState,
    })

    const manifest = JSON.parse(readFileSync(resolve(baseDir, result.manifestPath), "utf8")) as {
      gateResults: {
        status: string
        checks: Array<{ id: string; status: string; reasonCode: string }>
      }
      summary: {
        computerUseSafetyConfirmations: number
      }
      diagnostics: {
        computerUse?: {
          reason: string
          status: string
        }
      }
    }

    const computerUseCheck = manifest.gateResults.checks.find(
      (check) => check.id === "scenario.computer_use"
    )
    assert.ok(computerUseCheck)
    assert.equal(computerUseCheck?.status, "failed")
    assert.equal(computerUseCheck?.reasonCode, "ai.gemini.computer_use.max_steps_exceeded")
    assert.equal(manifest.gateResults.status, "failed")
    assert.equal(manifest.summary.computerUseSafetyConfirmations, 1)
    assert.equal(manifest.diagnostics.computerUse?.status, "failed")
    assert.equal(
      manifest.diagnostics.computerUse?.reason,
      "ai.gemini.computer_use.max_steps_exceeded"
    )
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("finalizePipelineReporting prioritizes failed when failed and blocked checks coexist", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-reporting-status-priority-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    writeFileSync(
      resolve(baseDir, "reports/runtime.json"),
      JSON.stringify({ started: false }),
      "utf8"
    )
    writeFileSync(
      resolve(baseDir, "reports/computer-use.json"),
      JSON.stringify({ status: "failed", reason: "ai.gemini.computer_use.max_steps_exceeded" }),
      "utf8"
    )

    const stageState = createInitialPipelineStageState("reports/runtime.json")
    stageState.computerUseResult = {
      status: "failed",
      reason: "ai.gemini.computer_use.max_steps_exceeded",
      exitCode: 2,
      command: "python3",
      args: ["scripts/computer-use/gemini-computer-use.py", "task"],
      scriptPath: "scripts/computer-use/gemini-computer-use.py",
      stdoutTail: "",
      stderrTail: "max steps exceeded",
      computerUseSafetyConfirmations: 0,
      safetyConfirmationEvidence: { events: [] },
      error: "max steps exceeded",
    }
    stageState.generatedReports.computerUse = "reports/computer-use.json"

    const result = finalizePipelineReporting({
      baseDir,
      resolvedRunId: "run-status-priority",
      startedAt: "2026-02-22T10:00:00.000Z",
      profile: {
        name: "pr",
        steps: ["computer_use"],
        gates: {
          consoleErrorMax: 0,
          pageErrorMax: 0,
          http5xxMax: 0,
        },
      },
      target: {
        name: "web.ci",
        type: "web",
        driver: "web-playwright",
        baseUrl: "http://127.0.0.1:4173",
      },
      effectiveBaseUrl: "http://127.0.0.1:4173",
      effectiveApp: undefined,
      effectiveBundleId: undefined,
      stateModel: {
        configuredRoutes: [],
        configuredStories: [],
        configuredTotal: 0,
      } as never,
      runtimeStart: {
        autostart: false,
        started: false,
        healthcheckPassed: false,
        healthcheckUrl: "http://127.0.0.1:4173/health",
        processes: [],
        reportPath: "reports/runtime.json",
        teardown: () => undefined,
      },
      driverContract: {
        driverId: "web-playwright",
        targetTypes: ["web"],
        capabilities: {
          navigate: true,
          interact: true,
          capture: true,
          logs: true,
          network: true,
          trace: true,
          lifecycle: false,
        },
      },
      blockedStepReasons: ["desktop.smoke unsupported by driver"],
      blockedStepDetails: [],
      effectiveDiagnosticsConfig: {
        maxItems: 10,
      },
      maxParallelTasks: 1,
      stageDurationsMs: {
        "scenario.computer_use": 1200,
      },
      baseUrlPolicy: {
        enabled: true,
        requestedUrl: "http://127.0.0.1:4173",
        requestedOrigin: "http://127.0.0.1:4173",
        allowedOrigins: ["http://127.0.0.1:4173"],
        matched: true,
        reason: "origin_allowed",
      },
      state: stageState,
    })

    const manifest = JSON.parse(readFileSync(resolve(baseDir, result.manifestPath), "utf8")) as {
      gateResults: {
        status: string
        checks: Array<{ id: string; status: string }>
      }
    }

    const failedCheck = manifest.gateResults.checks.find(
      (check) => check.id === "scenario.computer_use"
    )
    const blockedCheck = manifest.gateResults.checks.find(
      (check) => check.id === "driver.capability"
    )
    assert.equal(failedCheck?.status, "failed")
    assert.equal(blockedCheck?.status, "blocked")
    assert.equal(manifest.gateResults.status, "failed")
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("finalizePipelineReporting assembles gate, diagnostics and engine policy branches", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-reporting-branch-coverage-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    writeFileSync(
      resolve(baseDir, "reports/runtime.json"),
      JSON.stringify({ started: true, healthcheckPassed: false }),
      "utf8"
    )
    writeFileSync(
      resolve(baseDir, "reports/cache-summary.json"),
      JSON.stringify({ summary: { cacheStats: { hits: 6, misses: 2, hitRate: 0.75 } } }),
      "utf8"
    )
    writeFileSync(resolve(baseDir, "reports/security.json"), JSON.stringify({ ok: false }), "utf8")
    writeFileSync(resolve(baseDir, "reports/security-tickets.json"), JSON.stringify([]), "utf8")
    writeFileSync(resolve(baseDir, "reports/load.json"), JSON.stringify({ ok: false }), "utf8")

    const stageState = createInitialPipelineStageState("reports/runtime.json")
    stageState.states = [
      { id: "home", source: "routes", artifacts: { screenshot: "states/home.png" } } as never,
      { id: "discover", source: "discovery", artifacts: {} } as never,
    ]
    stageState.captureSummary = { consoleError: 1, pageError: 1, http5xx: 1 }
    stageState.captureDiagnostics = {
      consoleErrors: ["capture:console"],
      pageErrors: ["capture:page"],
      http5xxUrls: ["https://capture.example/500"],
    }
    stageState.exploreDiagnostics = {
      consoleErrors: ["explore:console"],
      pageErrors: ["explore:page"],
      http5xxUrls: ["https://explore.example/500"],
    }
    stageState.chaosDiagnostics = {
      consoleErrors: ["chaos:console"],
      pageErrors: ["chaos:page"],
      http5xxUrls: ["https://chaos.example/500"],
    }
    stageState.consoleErrorFromExplore = 2
    stageState.pageErrorFromExplore = 1
    stageState.http5xxFromExplore = 1
    stageState.pageErrorFromChaos = 3
    stageState.http5xxFromChaos = 2
    stageState.dangerousActionHitsFromExplore = 1
    stageState.dangerousActionHitsFromChaos = 2
    stageState.exploreResultData = { engineUsed: "crawlee" } as never
    stageState.exploreEngineBlockedReasonCode = "gate.explore.blocked.crawlee_not_available"
    stageState.visualEngineBlockedReasonCode = "gate.visual.blocked.lostpixel_not_available"
    stageState.effectiveExploreConfig = { engine: "crawlee" } as never
    stageState.effectiveVisualConfig = { engine: "lostpixel" } as never
    stageState.effectiveSecurityConfig = { engine: "semgrep" } as never
    stageState.effectiveLoadConfig = { engines: ["builtin", "k6"] } as never
    stageState.effectiveA11yConfig = { engine: "axe" } as never
    stageState.effectivePerfConfig = { engine: "lhci" } as never
    stageState.a11ySummary = { serious: 3, total: 9 }
    stageState.perfSummary = { lcpMs: 3000, fcpMs: 1600 }
    stageState.visualSummary = { diffPixels: 14, baselineCreated: false }
    stageState.a11yResultData = {
      engine: "axe",
      standard: "wcag2.2aa",
      counts: { total: 9, critical: 1, serious: 2 },
    } as never
    stageState.perfResultData = {
      engine: "lhci",
      preset: "mobile",
      metrics: { largestContentfulPaintMs: 3000, firstContentfulPaintMs: 1600 },
    } as never
    stageState.visualResultData = {
      engine: "lostpixel",
      engineUsed: "lostpixel",
      mode: "compare",
      baselineCreated: false,
      diffPixels: 14,
      totalPixels: 5000,
      diffRatio: 0.0028,
      baselinePath: "visual/baseline.png",
      currentPath: "visual/current.png",
      diffPath: "visual/diff.png",
    } as never
    stageState.loadSummary = {
      totalRequests: 120,
      failedRequests: 8,
      http5xx: 4,
      requestsPerSecond: 5.1,
      latencyP95Ms: 880,
      latencyP99Ms: 1250,
      errorBudgetRate: 0.0667,
      stageFailedCount: 1,
      engineReady: false,
      engines: [
        {
          engine: "k6",
          status: "blocked",
          detail: "k6_not_available",
          reasonCode: "gate.load.blocked.k6_not_available",
        },
      ],
    }
    stageState.securityBlocked = true
    stageState.securityBlockedReason = "gate.security.blocked.semgrep_not_available"
    stageState.securityReportPath = "reports/security.json"
    stageState.securityTicketsPath = "reports/security-tickets.json"
    stageState.securityResult = {
      totalIssueCount: 4,
      dedupedIssueCount: 3,
      tickets: [
        {
          ticketId: "SEC-1",
          severity: "high",
          impactScope: "auth",
          affectedFiles: ["apps/api/auth.py", "apps/web/login.tsx"],
        },
      ],
      clusters: { byRule: ["auth"], byComponent: ["backend"] },
    } as never
    stageState.loadReportPath = "reports/load.json"
    stageState.desktopReadinessPath = "reports/desktop-readiness.json"
    stageState.desktopReadinessResult = {
      status: "failed",
      reportPath: "reports/desktop-readiness.json",
    } as never
    stageState.desktopSmokePath = "reports/desktop-smoke.json"
    stageState.desktopSmokeResult = {
      status: "passed",
      reportPath: "reports/desktop-smoke.json",
    } as never
    stageState.desktopE2EPath = "reports/desktop-e2e.json"
    stageState.desktopE2EResult = {
      status: "failed",
      reportPath: "reports/desktop-e2e.json",
      checks: [{ status: "passed" }, { status: "failed" }],
    } as never
    stageState.desktopSoakPath = "reports/desktop-soak.json"
    stageState.desktopSoakResult = {
      status: "failed",
      reportPath: "reports/desktop-soak.json",
      crashCount: 2,
      rssGrowthMb: 48,
      cpuAvgPercent: 71,
    } as never
    stageState.unitTestResult = { status: "failed", reportPath: "reports/unit.json" } as never
    stageState.contractTestResult = { status: "failed", reportPath: "reports/contract.json" } as never
    stageState.ctTestResult = { status: "failed", reportPath: "reports/ct.json" } as never
    stageState.e2eTestResult = { status: "passed", reportPath: "reports/e2e.json" } as never
    stageState.postFixRegression = {
      status: "failed",
      reasonCode: "gate.post_fix.failed.remaining_failed_suites",
      iterationsExecuted: 2,
      converged: false,
      remainingFailedSuites: ["e2e"],
    } as never
    stageState.generatedReports.capture = "reports/cache-summary.json"

    const result = finalizePipelineReporting({
      baseDir,
      resolvedRunId: "run-branch-rich",
      startedAt: "2000-01-01T00:00:00.000Z",
      profile: {
        name: "pr",
        steps: ["computer_use", "desktop_business_regression"],
        gates: {
          consoleErrorMax: 0,
          pageErrorMax: 0,
          http5xxMax: 0,
          contractStatus: "passed",
        },
        enginePolicy: {
          required: ["crawlee", "lostpixel", "semgrep", "k6", "backstop"],
          failOnBlocked: true,
        },
      } as never,
      target: {
        name: "web.ci",
        type: "web",
        driver: "web-playwright",
        baseUrl: "http://127.0.0.1:4173",
      },
      effectiveBaseUrl: "http://127.0.0.1:4173",
      effectiveApp: undefined,
      effectiveBundleId: undefined,
      stateModel: {
        configuredRoutes: [{ id: "home" }],
        configuredStories: [{ id: "story-home" }],
        configuredTotal: 2,
      } as never,
      runtimeStart: {
        autostart: false,
        started: true,
        healthcheckPassed: false,
        healthcheckUrl: "http://127.0.0.1:4173/health",
        processes: [],
        reportPath: "reports/runtime.json",
        teardown: () => undefined,
      },
      driverContract: {
        driverId: "web-playwright",
        targetTypes: ["web"],
        capabilities: {
          navigate: true,
          interact: true,
          capture: true,
          logs: true,
          network: true,
          trace: true,
          lifecycle: false,
        },
      },
      blockedStepReasons: ["desktop_smoke unsupported by driver"],
      blockedStepDetails: [
        {
          stepId: "computer_use",
          detail: "blocked by guardrail",
          reasonCode: "gate.scenario.computer_use.blocked.unsupported_target_type",
          artifactPath: "reports/computer-use.json",
        } as never,
      ],
      effectiveDiagnosticsConfig: { maxItems: 5 },
      maxParallelTasks: 3,
      stageDurationsMs: {
        capture: 110,
        explore: 240,
        chaos: 95,
        load: 120,
        e2e: 320,
      },
      baseUrlPolicy: {
        enabled: true,
        requestedUrl: "http://127.0.0.1:4173",
        requestedOrigin: "http://127.0.0.1:4173",
        allowedOrigins: ["http://127.0.0.1:4173"],
        matched: true,
        reason: "origin_allowed",
      },
      state: stageState,
    })

    const manifest = JSON.parse(readFileSync(resolve(baseDir, result.manifestPath), "utf8")) as {
      summary: {
        blockedByMissingEngineCount: number
        crashCount: number
        rssGrowthMb: number
        keyGatePassRatio: number
        fixConverged?: boolean
      }
      diagnostics: {
        cacheStats: { hits: number; misses: number; reason: string }
        failureLocations: string[]
        explore: { engineUsed: string }
      }
      gateResults: {
        status: string
        checks: Array<{ id: string; status: string }>
      }
    }
    const checks = new Map(manifest.gateResults.checks.map((check) => [check.id, check.status]))
    assert.equal(manifest.gateResults.status, "failed")
    assert.equal(checks.get("engine.policy.required"), "failed")
    assert.equal(checks.get("runtime.healthcheck"), "blocked")
    assert.equal(checks.get("desktop.business_regression"), "blocked")
    assert.equal(checks.get("execution.pr_budget_ms"), "failed")
    assert.equal(checks.get("post_fix.regression"), "failed")
    assert.equal(manifest.summary.blockedByMissingEngineCount, 4)
    assert.equal(manifest.summary.fixConverged, false)
    assert.ok(
      typeof manifest.summary.keyGatePassRatio === "number" ||
        typeof manifest.summary.keyGatePassRatio === "undefined" ||
        manifest.summary.keyGatePassRatio === null
    )
    assert.equal(manifest.diagnostics.cacheStats.hits, 6)
    assert.equal(manifest.diagnostics.cacheStats.misses, 2)
    assert.equal(manifest.diagnostics.cacheStats.reason, "derived_from_report_cache_fields")
    assert.ok(manifest.diagnostics.failureLocations.length > 0)
    assert.equal(manifest.diagnostics.explore.engineUsed, "crawlee")
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("finalizePipelineReporting aggregates ai review and fix gate checks when ai review is enabled", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-reporting-ai-review-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    const runId = `run-ai-review-${Date.now()}`
    writeFileSync(
      resolve(baseDir, "reports/runtime.json"),
      JSON.stringify({ started: false }),
      "utf8"
    )

    const stageState = createInitialPipelineStageState("reports/runtime.json")
    stageState.e2eTestResult = { status: "failed", reportPath: "reports/e2e.json" } as never
    stageState.effectiveAiReviewConfig = {
      enabled: true,
      maxArtifacts: 20,
      severityThreshold: "high",
    } as never

    let result: { manifestPath: string } | undefined
    withEnv(
      {
        AI_REVIEW_GEMINI_MULTIMODAL: "false",
        UIQ_AI_FIX_MODE: "report_only",
        AI_SPEED_MODE: "false",
        GEMINI_MODEL_PRIMARY: "models/gemini-3.1-pro-preview",
      },
      () => {
        result = finalizePipelineReporting({
          baseDir,
          resolvedRunId: runId,
          startedAt: "2026-02-22T10:00:00.000Z",
          profile: {
            name: "nightly",
            steps: ["e2e"],
            gates: {
              consoleErrorMax: 0,
              pageErrorMax: 0,
              http5xxMax: 0,
            },
          } as never,
          target: {
            name: "web.nightly",
            type: "web",
            driver: "web-playwright",
            baseUrl: "http://127.0.0.1:4173",
          },
          effectiveBaseUrl: "http://127.0.0.1:4173",
          effectiveApp: undefined,
          effectiveBundleId: undefined,
          stateModel: {
            configuredRoutes: [],
            configuredStories: [],
            configuredTotal: 0,
          } as never,
          runtimeStart: {
            autostart: false,
            started: false,
            healthcheckPassed: false,
            healthcheckUrl: "http://127.0.0.1:4173/health",
            processes: [],
            reportPath: "reports/runtime.json",
            teardown: () => undefined,
          },
          driverContract: {
            driverId: "web-playwright",
            targetTypes: ["web"],
            capabilities: {
              navigate: true,
              interact: true,
              capture: true,
              logs: true,
              network: true,
              trace: true,
              lifecycle: false,
            },
          },
          blockedStepReasons: [],
          blockedStepDetails: [],
          effectiveDiagnosticsConfig: { maxItems: 10 },
          maxParallelTasks: 1,
          stageDurationsMs: { "test.e2e": 400 },
          baseUrlPolicy: {
            enabled: true,
            requestedUrl: "http://127.0.0.1:4173",
            requestedOrigin: "http://127.0.0.1:4173",
            allowedOrigins: ["http://127.0.0.1:4173"],
            matched: true,
            reason: "origin_allowed",
          },
          state: stageState,
        })
      }
    )

    const manifest = JSON.parse(readFileSync(resolve(baseDir, result!.manifestPath), "utf8")) as {
      gateResults: {
        checks: Array<{ id: string; status: string; reasonCode: string }>
      }
      reports: Record<string, string>
      diagnostics: {
        aiReview?: {
          findings: number
          highOrAbove: number
          reportPath: string
        }
      }
    }
    const checks = new Map(
      manifest.gateResults.checks.map((check) => [check.id, { status: check.status, reason: check.reasonCode }])
    )
    assert.equal(checks.get("ai_review.severity_threshold")?.status, "failed")
    assert.equal(checks.get("ai_review.severity_threshold")?.reason, "gate.ai_review.failed.high_severity_findings")
    assert.equal(checks.get("ai_fix.execution")?.status, "passed")
    assert.equal(manifest.reports.aiReview, "reports/ai-review.json")
    assert.equal(manifest.reports.aiReviewMarkdown, "reports/ai-review.md")
    assert.ok(manifest.diagnostics.aiReview)
    assert.equal(manifest.diagnostics.aiReview?.reportPath, "reports/ai-review.json")
    assert.ok((manifest.diagnostics.aiReview?.findings ?? 0) > 0)
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("finalizePipelineReporting blocks when computer_use report is missing", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-reporting-computer-use-missing-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    writeFileSync(
      resolve(baseDir, "reports/runtime.json"),
      JSON.stringify({ started: false, healthcheckPassed: false }),
      "utf8"
    )

    const stageState = createInitialPipelineStageState("reports/runtime.json")
    const result = finalizePipelineReporting({
      baseDir,
      resolvedRunId: "run-computer-use-missing",
      startedAt: "2026-02-22T10:00:00.000Z",
      profile: {
        name: "nightly",
        steps: ["computer_use"],
        gates: {
          consoleErrorMax: 0,
          pageErrorMax: 0,
          http5xxMax: 0,
        },
      } as never,
      target: {
        name: "web.smoke",
        type: "web",
        driver: "web-playwright",
        baseUrl: "http://127.0.0.1:4173",
      },
      effectiveBaseUrl: "http://127.0.0.1:4173",
      effectiveApp: undefined,
      effectiveBundleId: undefined,
      stateModel: {
        configuredRoutes: [{ id: "home" }],
        configuredStories: [],
        configuredTotal: 1,
      } as never,
      runtimeStart: {
        autostart: false,
        started: false,
        healthcheckPassed: false,
        healthcheckUrl: "http://127.0.0.1:4173/health",
        processes: [],
        reportPath: "reports/runtime.json",
        teardown: () => undefined,
      },
      driverContract: {
        driverId: "web-playwright",
        targetTypes: ["web"],
        capabilities: {
          navigate: true,
          interact: true,
          capture: true,
          logs: true,
          network: true,
          trace: true,
          lifecycle: false,
        },
      },
      blockedStepReasons: [],
      blockedStepDetails: [],
      effectiveDiagnosticsConfig: { maxItems: 5 },
      maxParallelTasks: 1,
      stageDurationsMs: { capture: 10 },
      baseUrlPolicy: {
        enabled: true,
        requestedUrl: "http://127.0.0.1:4173",
        requestedOrigin: "http://127.0.0.1:4173",
        allowedOrigins: ["http://127.0.0.1:4173"],
        matched: true,
        reason: "origin_allowed",
      },
      state: stageState,
    })

    const manifest = JSON.parse(readFileSync(resolve(baseDir, result.manifestPath), "utf8")) as {
      gateResults: {
        status: string
        checks: Array<{ id: string; status: string; reasonCode: string }>
      }
    }
    const checks = new Map(
      manifest.gateResults.checks.map((check) => [check.id, { status: check.status, reasonCode: check.reasonCode }])
    )
    assert.equal(manifest.gateResults.status, "blocked")
    assert.equal(checks.get("scenario.computer_use")?.status, "blocked")
    assert.equal(
      checks.get("scenario.computer_use")?.reasonCode,
      "gate.scenario_computer_use.blocked.report_missing"
    )
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("finalizePipelineReporting marks desktop_business_regression as passed when report exists", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-reporting-desktop-business-passed-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    writeFileSync(
      resolve(baseDir, "reports/runtime.json"),
      JSON.stringify({ started: false, healthcheckPassed: false }),
      "utf8"
    )
    const stageState = createInitialPipelineStageState("reports/runtime.json")
    stageState.desktopBusinessResult = {
      status: "passed",
      reportPath: "reports/desktop-business.json",
    } as never
    stageState.desktopBusinessPath = "reports/desktop-business.json"

    const result = finalizePipelineReporting({
      baseDir,
      resolvedRunId: "run-desktop-business-passed",
      startedAt: new Date(Date.now() - 1_000).toISOString(),
      profile: {
        name: "pr",
        steps: ["desktop_business_regression"],
        gates: {
          consoleErrorMax: 0,
          pageErrorMax: 0,
          http5xxMax: 0,
        },
      } as never,
      target: {
        name: "web.smoke",
        type: "web",
        driver: "web-playwright",
        baseUrl: "http://127.0.0.1:4173",
      },
      effectiveBaseUrl: "http://127.0.0.1:4173",
      effectiveApp: undefined,
      effectiveBundleId: undefined,
      stateModel: {
        configuredRoutes: [],
        configuredStories: [],
        configuredTotal: 0,
      } as never,
      runtimeStart: {
        autostart: false,
        started: false,
        healthcheckPassed: false,
        healthcheckUrl: "http://127.0.0.1:4173/health",
        processes: [],
        reportPath: "reports/runtime.json",
        teardown: () => undefined,
      },
      driverContract: {
        driverId: "web-playwright",
        targetTypes: ["web"],
        capabilities: {
          navigate: true,
          interact: true,
          capture: true,
          logs: true,
          network: true,
          trace: true,
          lifecycle: false,
        },
      },
      blockedStepReasons: [],
      blockedStepDetails: [],
      effectiveDiagnosticsConfig: { maxItems: 5 },
      maxParallelTasks: 1,
      stageDurationsMs: { desktop_business_regression: 10 },
      baseUrlPolicy: {
        enabled: true,
        requestedUrl: "http://127.0.0.1:4173",
        requestedOrigin: "http://127.0.0.1:4173",
        allowedOrigins: ["http://127.0.0.1:4173"],
        matched: true,
        reason: "origin_allowed",
      },
      state: stageState,
    })

    const manifest = JSON.parse(readFileSync(resolve(baseDir, result.manifestPath), "utf8")) as {
      gateResults: {
        checks: Array<{ id: string; status: string }>
      }
    }
    const checks = new Map(manifest.gateResults.checks.map((check) => [check.id, check.status]))
    assert.equal(checks.get("desktop.business_regression"), "passed")
    assert.equal(checks.get("execution.pr_budget_ms"), "passed")
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("finalizePipelineReporting records available engines and startup/interactions summary when checks pass", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-reporting-engine-available-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    const state = createInitialPipelineStageState("reports/runtime.json")
    state.effectiveExploreConfig = { engine: "crawlee" } as never
    state.effectiveVisualConfig = { engine: "backstop" } as never
    state.effectiveSecurityConfig = { engine: "semgrep" } as never
    state.loadSummary = {
      totalRequests: 10,
      failedRequests: 0,
      http5xx: 0,
      requestsPerSecond: 2,
      latencyP95Ms: 300,
      latencyP99Ms: 450,
      errorBudgetRate: 0,
      stageFailedCount: 0,
      engineReady: true,
      engines: [{ engine: "k6", status: "ok", detail: "ok" }],
    } as never
    state.desktopE2EResult = {
      status: "passed",
      reportPath: "reports/desktop-e2e.json",
      checks: [{ status: "passed" }, { status: "passed" }],
    } as never
    state.desktopBusinessResult = {
      status: "passed",
      reportPath: "reports/desktop-business.json",
      checks: [],
      screenshotPaths: [],
      replay: [],
      logPath: "logs/desktop-business.log",
    } as never
    state.securityResult = {
      totalIssueCount: 0,
      dedupedIssueCount: 0,
      tickets: [],
      clusters: { byRule: [], byComponent: [] },
    } as never
    state.securityReportPath = "security/report.json"
    state.desktopReadinessResult = {
      status: "passed",
      reportPath: "reports/desktop-readiness.json",
    } as never

    const result = finalizePipelineReporting({
      baseDir,
      resolvedRunId: "engine-available-run",
      startedAt: "2026-03-09T00:00:00.000Z",
      profile: {
        name: "nightly",
        steps: ["desktop_readiness", "desktop_e2e", "desktop_business_regression"],
        gates: {},
        enginePolicy: { required: ["crawlee", "backstop", "semgrep", "k6"], failOnBlocked: true },
      } as never,
      target: { type: "desktop", name: "tauri.macos", driver: "tauri-webdriver" } as never,
      effectiveBaseUrl: "",
      effectiveApp: "/Applications/Fake.app",
      effectiveBundleId: "com.example.fake",
      stateModel: { configuredRoutes: [], configuredStories: [], configuredTotal: 0 } as never,
      runtimeStart: {
        started: true,
        autostart: false,
        healthcheckPassed: true,
        reportPath: "reports/runtime.json",
      } as never,
      driverContract: {
        driverId: "tauri-webdriver",
        targetTypes: ["tauri"],
        capabilities: { navigate: true, interact: true, capture: true },
      } as never,
      blockedStepReasons: [],
      blockedStepDetails: [],
      effectiveDiagnosticsConfig: { maxItems: 5 },
      maxParallelTasks: 2,
      stageDurationsMs: { desktop_e2e: 20 },
      baseUrlPolicy: NO_BASE_URL_POLICY,
      state,
    })

    const manifest = JSON.parse(readFileSync(resolve(baseDir, result.manifestPath), "utf8")) as {
      summary: { engineAvailability?: Record<string, string> }
      gateResults: { checks: Array<{ id: string; status: string; actual: string }> }
      diagnostics: {
        security?: { clusters?: { byRule: unknown[]; byComponent: unknown[] } }
        crossTarget?: { startupAvailable?: number; interactionPassRatio?: number }
      }
    }
    const engineCheck = manifest.gateResults.checks.find((check) => check.id === "engine.policy.required")
    assert.equal(engineCheck?.status, "passed")
    assert.equal(engineCheck?.actual, "all_required_available")
    assert.equal(manifest.diagnostics.crossTarget?.startupAvailable, 1)
    assert.equal(manifest.diagnostics.crossTarget?.interactionPassRatio, 1)
    assert.equal(manifest.summary.engineAvailability?.crawlee, "available")
    assert.equal(manifest.summary.engineAvailability?.backstop, "available")
    assert.equal(manifest.summary.engineAvailability?.semgrep, "available")
    assert.equal(manifest.summary.engineAvailability?.k6, "available")
    assert.deepEqual(manifest.diagnostics.security?.clusters?.byRule, [])
    assert.deepEqual(manifest.diagnostics.security?.clusters?.byComponent, [])
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("finalizePipelineReporting wraps AiReviewGenerationError with reason code context", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-reporting-ai-review-error-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    writeFileSync(resolve(baseDir, "reports/runtime.json"), JSON.stringify({ started: false }), "utf8")
    const stageState = createInitialPipelineStageState("reports/runtime.json")
    stageState.e2eTestResult = { status: "failed", reportPath: "reports/e2e.json" } as never
    stageState.effectiveAiReviewConfig = {
      enabled: true,
      maxArtifacts: 20,
      severityThreshold: "high",
    } as never

    assert.throws(
      () =>
        finalizePipelineReporting(
          {
            baseDir,
            resolvedRunId: "run-ai-review-error",
            startedAt: "2026-02-22T10:00:00.000Z",
            profile: {
              name: "nightly",
              steps: ["e2e"],
              gates: { consoleErrorMax: 0, pageErrorMax: 0, http5xxMax: 0 },
            } as never,
            target: {
              name: "web.nightly",
              type: "web",
              driver: "web-playwright",
              baseUrl: "http://127.0.0.1:4173",
            },
            effectiveBaseUrl: "http://127.0.0.1:4173",
            effectiveApp: undefined,
            effectiveBundleId: undefined,
            stateModel: { configuredRoutes: [], configuredStories: [], configuredTotal: 0 } as never,
            runtimeStart: {
              autostart: false,
              started: false,
              healthcheckPassed: false,
              healthcheckUrl: "http://127.0.0.1:4173/health",
              processes: [],
              reportPath: "reports/runtime.json",
              teardown: () => undefined,
            },
            driverContract: {
              driverId: "web-playwright",
              targetTypes: ["web"],
              capabilities: {
                navigate: true,
                interact: true,
                capture: true,
                logs: true,
                network: true,
                trace: true,
                lifecycle: false,
              },
            },
            blockedStepReasons: [],
            blockedStepDetails: [],
            effectiveDiagnosticsConfig: { maxItems: 10 },
            maxParallelTasks: 1,
            stageDurationsMs: { "test.e2e": 100 },
            baseUrlPolicy: {
              enabled: true,
              requestedUrl: "http://127.0.0.1:4173",
              requestedOrigin: "http://127.0.0.1:4173",
              allowedOrigins: ["http://127.0.0.1:4173"],
              matched: true,
              reason: "origin_allowed",
            },
            state: stageState,
          },
          {
            generateAiReviewReportImpl: () => {
              throw new AiReviewGenerationError(
                "gate.ai_review.failed.llm_output_schema_invalid",
                "mock schema failure"
              )
            },
          }
        ),
      /AI review generation failed \(gate\.ai_review\.failed\.llm_output_schema_invalid\): mock schema failure/
    )
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("finalizePipelineReporting rethrows non-AiReview errors from ai review generation", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-reporting-ai-review-throw-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    writeFileSync(resolve(baseDir, "reports/runtime.json"), JSON.stringify({ started: false }), "utf8")
    const stageState = createInitialPipelineStageState("reports/runtime.json")
    stageState.e2eTestResult = { status: "failed", reportPath: "reports/e2e.json" } as never
    stageState.effectiveAiReviewConfig = {
      enabled: true,
      maxArtifacts: 20,
      severityThreshold: "high",
    } as never

    assert.throws(
      () =>
        finalizePipelineReporting(
          {
            baseDir,
            resolvedRunId: "run-ai-review-throw",
            startedAt: "2026-02-22T10:00:00.000Z",
            profile: {
              name: "nightly",
              steps: ["e2e"],
              gates: { consoleErrorMax: 0, pageErrorMax: 0, http5xxMax: 0 },
            } as never,
            target: {
              name: "web.nightly",
              type: "web",
              driver: "web-playwright",
              baseUrl: "http://127.0.0.1:4173",
            },
            effectiveBaseUrl: "http://127.0.0.1:4173",
            effectiveApp: undefined,
            effectiveBundleId: undefined,
            stateModel: { configuredRoutes: [], configuredStories: [], configuredTotal: 0 } as never,
            runtimeStart: {
              autostart: false,
              started: false,
              healthcheckPassed: false,
              healthcheckUrl: "http://127.0.0.1:4173/health",
              processes: [],
              reportPath: "reports/runtime.json",
              teardown: () => undefined,
            },
            driverContract: {
              driverId: "web-playwright",
              targetTypes: ["web"],
              capabilities: {
                navigate: true,
                interact: true,
                capture: true,
                logs: true,
                network: true,
                trace: true,
                lifecycle: false,
              },
            },
            blockedStepReasons: [],
            blockedStepDetails: [],
            effectiveDiagnosticsConfig: { maxItems: 10 },
            maxParallelTasks: 1,
            stageDurationsMs: { "test.e2e": 100 },
            baseUrlPolicy: {
              enabled: true,
              requestedUrl: "http://127.0.0.1:4173",
              requestedOrigin: "http://127.0.0.1:4173",
              allowedOrigins: ["http://127.0.0.1:4173"],
              matched: true,
              reason: "origin_allowed",
            },
            state: stageState,
          },
          {
            generateAiReviewReportImpl: () => {
              throw new TypeError("mock unknown ai-review failure")
            },
          }
        ),
      /mock unknown ai-review failure/
    )
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("finalizePipelineReporting handles multimodal ai-review gates and mixed report existence", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-reporting-ai-review-multimodal-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    writeFileSync(resolve(baseDir, "reports/runtime.json"), JSON.stringify({ started: false }), "utf8")
    const stageState = createInitialPipelineStageState("reports/runtime.json")
    stageState.e2eTestResult = { status: "failed", reportPath: "reports/e2e.json" } as never
    stageState.effectiveAiReviewConfig = {
      enabled: true,
      maxArtifacts: 20,
      severityThreshold: "high",
    } as never
    stageState.generatedReports.geminiAccuracy = "reports/legacy-accuracy-gate.json"
    let result: { manifestPath: string } | undefined

    withEnv(
      {
        AI_REVIEW_GEMINI_MULTIMODAL: "true",
        UIQ_AI_FIX_MODE: "report_only",
        AI_SPEED_MODE: "false",
        GEMINI_MODEL_PRIMARY: "models/gemini-3.1-pro-preview",
      },
      () => {
        result = finalizePipelineReporting(
          {
            baseDir,
            resolvedRunId: "run-ai-review-multimodal",
            startedAt: "2026-02-22T10:00:00.000Z",
            profile: {
              name: "nightly",
              steps: ["e2e"],
              gates: { consoleErrorMax: 0, pageErrorMax: 0, http5xxMax: 0 },
            } as never,
            target: {
              name: "web.nightly",
              type: "web",
              driver: "web-playwright",
              baseUrl: "http://127.0.0.1:4173",
            },
            effectiveBaseUrl: "http://127.0.0.1:4173",
            effectiveApp: undefined,
            effectiveBundleId: undefined,
            stateModel: { configuredRoutes: [], configuredStories: [], configuredTotal: 0 } as never,
            runtimeStart: {
              autostart: false,
              started: false,
              healthcheckPassed: false,
              healthcheckUrl: "http://127.0.0.1:4173/health",
              processes: [],
              reportPath: "reports/runtime.json",
              teardown: () => undefined,
            },
            driverContract: {
              driverId: "web-playwright",
              targetTypes: ["web"],
              capabilities: {
                navigate: true,
                interact: true,
                capture: true,
                logs: true,
                network: true,
                trace: true,
                lifecycle: false,
              },
            },
            blockedStepReasons: [],
            blockedStepDetails: [],
            effectiveDiagnosticsConfig: { maxItems: 10 },
            maxParallelTasks: 1,
            stageDurationsMs: { "test.e2e": 100 },
            baseUrlPolicy: {
              enabled: true,
              requestedUrl: "http://127.0.0.1:4173",
              requestedOrigin: "http://127.0.0.1:4173",
              allowedOrigins: ["http://127.0.0.1:4173"],
              matched: true,
              reason: "origin_allowed",
            },
            state: stageState,
          },
          {
            generateAiReviewReportImpl: () =>
              ({
                schemaVersion: "1.0",
                generatedAt: "2026-02-22T10:00:00.000Z",
                runId: "run-ai-review-multimodal",
                profile: "nightly",
                target: {
                  type: "web",
                  name: "web.nightly",
                  baseUrl: "http://127.0.0.1:4173",
                  app: "",
                  bundleId: "",
                },
                severityThreshold: "high",
                candidates: [],
                findings: [],
                summary: { totalFindings: 2, highOrAbove: 1, candidateArtifacts: 1 },
                gate: {
                  status: "failed",
                  reasonCode: "gate.ai_review.failed.high_severity_findings",
                },
                generation: {
                  mode: "llm",
                  promptId: "ai-review.test.prompt",
                  promptVersion: "test-v1",
                  model: "rule-llm-synth-v1",
                },
              }) as never,
            writeAiReviewReportArtifactsImpl: () =>
              ({
                jsonPath: "reports/ai-review.json",
                markdownPath: "reports/ai-review.md",
              }) as never,
            runUiUxGeminiReportImpl: () =>
              ({
                reportPath: "reports/ui-ux-gemini-report.json",
                report: {
                  reason_code: " ",
                  thought_signatures: {
                    status: "present",
                    reason_code: "ai.gemini.thought_signature.present",
                    signatures: ["signature-1"],
                    signature_count: 1,
                  },
                  summary: { total_findings: 6, high_or_above: 2, overall_score: 61 },
                },
              }) as never,
            resolveGeminiGateCheckImpl: ({ checkId, reportPath }) =>
              checkId === "ai_review.gemini_accuracy"
                ? ({
                    check: {
                      id: checkId,
                      expected: "gemini_accuracy_min",
                      actual: "metric=0.97",
                      severity: "MAJOR",
                      status: "passed",
                      reasonCode: "gate.gemini_accuracy_min.passed.threshold_met",
                      evidencePath: reportPath,
                    },
                    reportExists: true,
                  }) as never
                : ({
                    check: {
                      id: checkId,
                      expected: "gemini_parallel_consistency_min",
                      actual: "metric=0.81",
                      severity: "MAJOR",
                      status: "blocked",
                      reasonCode: "gate.ai_review.gemini_concurrency.blocked.report_missing",
                      evidencePath: reportPath,
                    },
                    reportExists: false,
                  }) as never,
            executeFixExecutorImpl: () =>
              ({
                mode: "report_only",
                reportPath: "reports/fix-result.json",
                summary: { totalTasks: 0, applied: 0, failed: 0, planned: 0 },
                gate: {
                  status: "passed",
                  reasonCode: "gate.ai_fix.execution.passed.report_only",
                },
              }) as never,
          }
        )
      }
    )

    const manifest = JSON.parse(readFileSync(resolve(baseDir, result!.manifestPath), "utf8")) as {
      reports: Record<string, string | undefined>
      gateResults: { checks: Array<{ id: string; status: string; reasonCode: string }> }
    }
    const checks = new Map(
      manifest.gateResults.checks.map((check) => [check.id, { status: check.status, reasonCode: check.reasonCode }])
    )
    assert.equal(checks.get("ai_review.gemini_multimodal")?.status, "failed")
    assert.equal(checks.get("ai_review.gemini_multimodal")?.reasonCode, "ai.gemini.ui_ux.report.generated")
    assert.equal(checks.get("ai_review.gemini_thought_signature")?.status, "passed")
    assert.equal(checks.get("ai_review.gemini_accuracy")?.status, "passed")
    assert.equal(checks.get("ai_review.gemini_concurrency")?.status, "blocked")
    assert.equal(manifest.reports.uiUxGemini, "reports/ui-ux-gemini-report.json")
    assert.equal(manifest.reports.geminiAccuracyGate, "reports/legacy-accuracy-gate.json")
    assert.equal(manifest.reports.geminiConcurrencyGate, undefined)
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("finalizePipelineReporting tracks lostpixel availability and security clusters fallback", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-reporting-lostpixel-available-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    writeFileSync(resolve(baseDir, "reports/runtime.json"), JSON.stringify({ started: true }), "utf8")
    const state = createInitialPipelineStageState("reports/runtime.json")
    state.effectiveVisualConfig = { engine: "lostpixel" } as never
    state.securityReportPath = "reports/security.json"
    state.loadSummary = {
      totalRequests: 1,
      failedRequests: 0,
      http5xx: 0,
      requestsPerSecond: 1,
      latencyP95Ms: 100,
      latencyP99Ms: 120,
      errorBudgetRate: 0,
      stageFailedCount: 0,
      engineReady: true,
      engines: [],
    } as never

    const result = finalizePipelineReporting({
      baseDir,
      resolvedRunId: "run-lostpixel-available",
      startedAt: "2026-03-09T00:00:00.000Z",
      profile: {
        name: "nightly",
        steps: [],
        gates: {},
        enginePolicy: { required: ["lostpixel"], failOnBlocked: true },
      } as never,
      target: { type: "desktop", name: "tauri.macos", driver: "tauri-webdriver" } as never,
      effectiveBaseUrl: "",
      effectiveApp: "/Applications/Fake.app",
      effectiveBundleId: "com.example.fake",
      stateModel: { configuredRoutes: [], configuredStories: [], configuredTotal: 0 } as never,
      runtimeStart: {
        started: true,
        autostart: false,
        healthcheckPassed: true,
        reportPath: "reports/runtime.json",
      } as never,
      driverContract: {
        driverId: "tauri-webdriver",
        targetTypes: ["tauri"],
        capabilities: { navigate: true, interact: true, capture: true },
      } as never,
      blockedStepReasons: [],
      blockedStepDetails: [],
      effectiveDiagnosticsConfig: { maxItems: 5 },
      maxParallelTasks: 1,
      stageDurationsMs: { capture: 5 },
      baseUrlPolicy: NO_BASE_URL_POLICY,
      state,
    })

    const manifest = JSON.parse(readFileSync(resolve(baseDir, result.manifestPath), "utf8")) as {
      summary: { engineAvailability?: Record<string, string> }
      diagnostics: { security?: { clusters?: unknown } }
    }
    assert.equal(manifest.summary.engineAvailability?.lostpixel, "available")
    assert.equal(manifest.diagnostics.security?.clusters, undefined)
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("finalizePipelineReporting covers passed and blocked reason-code branches for mixed desktop checks", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-reporting-mixed-branches-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    writeFileSync(resolve(baseDir, "reports/runtime.json"), JSON.stringify({ started: false }), "utf8")
    const state = createInitialPipelineStageState("reports/runtime.json")
    state.generatedReports.computerUse = "reports/computer-use.json"
    state.computerUseResult = {
      status: "ok",
      reason: "ok",
      reportPath: "reports/computer-use.json",
    } as never
    state.ctTestResult = { status: "passed", reportPath: "reports/ct.json" } as never
    state.desktopSmokeResult = { status: "failed", reportPath: "reports/desktop-smoke.json" } as never
    state.desktopBusinessResult = {
      status: "failed",
      reportPath: "reports/desktop-business.json",
    } as never
    state.desktopSoakResult = { status: "passed", reportPath: "reports/desktop-soak.json" } as never

    const result = finalizePipelineReporting({
      baseDir,
      resolvedRunId: "run-mixed-branches",
      startedAt: "2026-03-09T00:00:00.000Z",
      profile: {
        name: "nightly",
        steps: ["computer_use"],
        gates: {},
      } as never,
      target: { type: "desktop", name: "tauri.macos", driver: "tauri-webdriver" } as never,
      effectiveBaseUrl: "",
      effectiveApp: "/Applications/Fake.app",
      effectiveBundleId: "com.example.fake",
      stateModel: { configuredRoutes: [], configuredStories: [], configuredTotal: 0 } as never,
      runtimeStart: {
        started: false,
        autostart: false,
        healthcheckPassed: false,
        reportPath: "reports/runtime.json",
      } as never,
      driverContract: {
        driverId: "tauri-webdriver",
        targetTypes: ["tauri"],
        capabilities: { navigate: true, interact: true, capture: true },
      } as never,
      blockedStepReasons: [],
      blockedStepDetails: [],
      effectiveDiagnosticsConfig: { maxItems: 5 },
      maxParallelTasks: 1,
      stageDurationsMs: { capture: 5 },
      baseUrlPolicy: NO_BASE_URL_POLICY,
      state,
    })

    const manifest = JSON.parse(readFileSync(resolve(baseDir, result.manifestPath), "utf8")) as {
      gateResults: { checks: Array<{ id: string; status: string; reasonCode: string }> }
    }
    const checks = new Map(
      manifest.gateResults.checks.map((check) => [check.id, { status: check.status, reasonCode: check.reasonCode }])
    )
    assert.equal(checks.get("test.ct")?.status, "passed")
    assert.equal(checks.get("scenario.computer_use")?.status, "passed")
    assert.equal(checks.get("desktop.smoke")?.status, "blocked")
    assert.equal(checks.get("desktop.business_regression")?.status, "blocked")
    assert.equal(checks.get("desktop.soak")?.status, "passed")
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("finalizePipelineReporting covers passed unit/contract checks and explore-network evidence routing", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-reporting-evidence-routing-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    writeFileSync(resolve(baseDir, "reports/runtime.json"), JSON.stringify({ started: false }), "utf8")
    const state = createInitialPipelineStageState("reports/runtime.json")
    state.states = [{ id: "route-home", source: "routes", artifacts: {} }] as never
    state.http5xxFromExplore = 1
    state.pageErrorFromExplore = 0
    state.pageErrorFromChaos = 0
    state.unitTestResult = { status: "passed", reportPath: "reports/unit.json" } as never
    state.contractTestResult = { status: "passed", reportPath: "reports/contract.json" } as never

    const result = finalizePipelineReporting({
      baseDir,
      resolvedRunId: "run-evidence-routing",
      startedAt: "2026-03-09T00:00:00.000Z",
      profile: {
        name: "nightly",
        steps: [],
        gates: { contractStatus: "passed" },
      } as never,
      target: { type: "web", name: "web.local", driver: "web-playwright", baseUrl: "http://127.0.0.1:4173" },
      effectiveBaseUrl: "http://127.0.0.1:4173",
      effectiveApp: undefined,
      effectiveBundleId: undefined,
      stateModel: { configuredRoutes: [], configuredStories: [], configuredTotal: 0 } as never,
      runtimeStart: {
        started: false,
        autostart: false,
        healthcheckPassed: false,
        reportPath: "reports/runtime.json",
      } as never,
      driverContract: {
        driverId: "web-playwright",
        targetTypes: ["web"],
        capabilities: { navigate: true, interact: true, capture: true, logs: true, network: true, trace: true },
      } as never,
      blockedStepReasons: [],
      blockedStepDetails: [],
      effectiveDiagnosticsConfig: { maxItems: 5 },
      maxParallelTasks: 1,
      stageDurationsMs: { capture: 5 },
      baseUrlPolicy: {
        enabled: true,
        requestedUrl: "http://127.0.0.1:4173",
        requestedOrigin: "http://127.0.0.1:4173",
        allowedOrigins: ["http://127.0.0.1:4173"],
        matched: true,
        reason: "origin_allowed",
      },
      state,
    })

    const manifest = JSON.parse(readFileSync(resolve(baseDir, result.manifestPath), "utf8")) as {
      gateResults: { checks: Array<{ id: string; status: string; reasonCode: string; evidencePath: string }> }
    }
    const checks = new Map(manifest.gateResults.checks.map((check) => [check.id, check]))
    assert.equal(checks.get("test.unit")?.status, "passed")
    assert.equal(checks.get("test.contract")?.status, "passed")
    assert.equal(checks.get("http.5xx")?.evidencePath, "network/explore.har")
    assert.equal(checks.get("page.error")?.evidencePath, "logs/route-home.log")
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("finalizePipelineReporting applies ai-review/security defaults and emits optional quality report paths", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-reporting-default-quality-reports-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    writeFileSync(resolve(baseDir, "reports/runtime.json"), JSON.stringify({ started: true }), "utf8")
    const state = createInitialPipelineStageState("reports/runtime.json")
    state.aiReviewReportPath = "reports/ai-review.json"
    state.a11yReportPath = "reports/a11y.json"
    state.perfReportPath = "reports/perf.json"
    state.visualReportPath = "reports/visual.json"
    state.securityReportPath = "reports/security.json"
    state.securityBlocked = false
    state.securityFailed = false

    const result = finalizePipelineReporting({
      baseDir,
      resolvedRunId: "run-default-quality-reports",
      startedAt: "2026-03-09T00:00:00.000Z",
      profile: { name: "nightly", steps: [], gates: {} } as never,
      target: { type: "web", name: "web.local", driver: "web-playwright", baseUrl: "http://127.0.0.1:4173" },
      effectiveBaseUrl: "http://127.0.0.1:4173",
      effectiveApp: undefined,
      effectiveBundleId: undefined,
      stateModel: { configuredRoutes: [], configuredStories: [], configuredTotal: 0 } as never,
      runtimeStart: {
        started: true,
        autostart: false,
        healthcheckPassed: true,
        reportPath: "reports/runtime.json",
      } as never,
      driverContract: {
        driverId: "web-playwright",
        targetTypes: ["web"],
        capabilities: { navigate: true, interact: true, capture: true, logs: true, network: true, trace: true },
      } as never,
      blockedStepReasons: [],
      blockedStepDetails: [],
      effectiveDiagnosticsConfig: { maxItems: 5 },
      maxParallelTasks: 1,
      stageDurationsMs: { capture: 5 },
      baseUrlPolicy: {
        enabled: true,
        requestedUrl: "http://127.0.0.1:4173",
        requestedOrigin: "http://127.0.0.1:4173",
        allowedOrigins: ["http://127.0.0.1:4173"],
        matched: true,
        reason: "origin_allowed",
      },
      state,
    })

    const manifest = JSON.parse(readFileSync(resolve(baseDir, result.manifestPath), "utf8")) as {
      diagnostics: {
        aiReview?: {
          enabled: boolean
          maxArtifacts: number
          severityThreshold: string
          findings: number
          highOrAbove: number
        }
        security?: { executionStatus: string }
      }
      reports: Record<string, string>
    }

    assert.equal(manifest.diagnostics.aiReview?.enabled, false)
    assert.equal(manifest.diagnostics.aiReview?.maxArtifacts, 0)
    assert.equal(manifest.diagnostics.aiReview?.severityThreshold, "high")
    assert.equal(manifest.diagnostics.aiReview?.findings, 0)
    assert.equal(manifest.diagnostics.aiReview?.highOrAbove, 0)
    assert.equal(manifest.diagnostics.security?.executionStatus, "ok")
    assert.equal(manifest.reports.a11y, "reports/a11y.json")
    assert.equal(manifest.reports.perf, "reports/perf.json")
    assert.equal(manifest.reports.visual, "reports/visual.json")

    const diagnosticsIndex = JSON.parse(
      readFileSync(resolve(baseDir, manifest.reports.diagnosticsIndex), "utf8")
    ) as { reports: Record<string, string> }
    assert.equal(diagnosticsIndex.reports.a11y, "reports/a11y.json")
    assert.equal(diagnosticsIndex.reports.perf, "reports/perf.json")
    assert.equal(diagnosticsIndex.reports.visual, "reports/visual.json")
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("finalizePipelineReporting uses capture HAR fallback when no explore/chaos 5xx is present", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-reporting-capture-har-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    writeFileSync(resolve(baseDir, "reports/runtime.json"), JSON.stringify({ started: false }), "utf8")
    const state = createInitialPipelineStageState("reports/runtime.json")
    state.states = [{ id: "route-home", source: "routes", artifacts: {} }] as never
    state.http5xxFromExplore = 0
    state.http5xxFromChaos = 0

    const result = finalizePipelineReporting({
      baseDir,
      resolvedRunId: "run-capture-har",
      startedAt: "2026-03-09T00:00:00.000Z",
      profile: { name: "nightly", steps: [], gates: {} } as never,
      target: { type: "web", name: "web.local", driver: "web-playwright", baseUrl: "http://127.0.0.1:4173" },
      effectiveBaseUrl: "http://127.0.0.1:4173",
      effectiveApp: undefined,
      effectiveBundleId: undefined,
      stateModel: { configuredRoutes: [], configuredStories: [], configuredTotal: 0 } as never,
      runtimeStart: {
        started: false,
        autostart: false,
        healthcheckPassed: false,
        reportPath: "reports/runtime.json",
      } as never,
      driverContract: {
        driverId: "web-playwright",
        targetTypes: ["web"],
        capabilities: { navigate: true, interact: true, capture: true, logs: true, network: true, trace: true },
      } as never,
      blockedStepReasons: [],
      blockedStepDetails: [],
      effectiveDiagnosticsConfig: { maxItems: 5 },
      maxParallelTasks: 1,
      stageDurationsMs: { capture: 5 },
      baseUrlPolicy: {
        enabled: true,
        requestedUrl: "http://127.0.0.1:4173",
        requestedOrigin: "http://127.0.0.1:4173",
        allowedOrigins: ["http://127.0.0.1:4173"],
        matched: true,
        reason: "origin_allowed",
      },
      state,
    })

    const manifest = JSON.parse(readFileSync(resolve(baseDir, result.manifestPath), "utf8")) as {
      gateResults: { checks: Array<{ id: string; evidencePath: string }> }
    }
    const httpCheck = manifest.gateResults.checks.find((check) => check.id === "http.5xx")
    assert.equal(httpCheck?.evidencePath, "network/capture.har")
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("finalizePipelineReporting routes page error evidence to explore logs when explore captured errors", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-reporting-page-error-explore-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    writeFileSync(resolve(baseDir, "reports/runtime.json"), JSON.stringify({ started: false }), "utf8")
    const state = createInitialPipelineStageState("reports/runtime.json")
    state.pageErrorFromExplore = 1
    state.pageErrorFromChaos = 0
    state.states = [{ id: "route-home", source: "routes", artifacts: {} }] as never

    const result = finalizePipelineReporting({
      baseDir,
      resolvedRunId: "run-page-error-explore",
      startedAt: "2026-03-09T00:00:00.000Z",
      profile: { name: "nightly", steps: [], gates: {} } as never,
      target: { type: "web", name: "web.local", driver: "web-playwright", baseUrl: "http://127.0.0.1:4173" },
      effectiveBaseUrl: "http://127.0.0.1:4173",
      effectiveApp: undefined,
      effectiveBundleId: undefined,
      stateModel: { configuredRoutes: [], configuredStories: [], configuredTotal: 0 } as never,
      runtimeStart: {
        started: false,
        autostart: false,
        healthcheckPassed: false,
        reportPath: "reports/runtime.json",
      } as never,
      driverContract: {
        driverId: "web-playwright",
        targetTypes: ["web"],
        capabilities: { navigate: true, interact: true, capture: true, logs: true, network: true, trace: true },
      } as never,
      blockedStepReasons: [],
      blockedStepDetails: [],
      effectiveDiagnosticsConfig: { maxItems: 5 },
      maxParallelTasks: 1,
      stageDurationsMs: { capture: 5 },
      baseUrlPolicy: {
        enabled: true,
        requestedUrl: "http://127.0.0.1:4173",
        requestedOrigin: "http://127.0.0.1:4173",
        allowedOrigins: ["http://127.0.0.1:4173"],
        matched: true,
        reason: "origin_allowed",
      },
      state,
    })

    const manifest = JSON.parse(readFileSync(resolve(baseDir, result.manifestPath), "utf8")) as {
      gateResults: { checks: Array<{ id: string; evidencePath: string }> }
    }
    const pageErrorCheck = manifest.gateResults.checks.find((check) => check.id === "page.error")
    assert.equal(pageErrorCheck?.evidencePath, "logs/explore.log")
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("finalizePipelineReporting uses multimodal pass reason and default gemini accuracy path", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-reporting-ai-review-multimodal-pass-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    writeFileSync(resolve(baseDir, "reports/runtime.json"), JSON.stringify({ started: false }), "utf8")
    const state = createInitialPipelineStageState("reports/runtime.json")
    state.e2eTestResult = { status: "failed", reportPath: "reports/e2e.json" } as never
    state.effectiveAiReviewConfig = {
      enabled: true,
      maxArtifacts: 20,
      severityThreshold: "high",
    } as never
    let result: { manifestPath: string } | undefined

    withEnv(
      {
        AI_REVIEW_GEMINI_MULTIMODAL: "true",
        UIQ_AI_FIX_MODE: "report_only",
        AI_SPEED_MODE: "false",
        GEMINI_MODEL_PRIMARY: "models/gemini-3.1-pro-preview",
      },
      () => {
        result = finalizePipelineReporting(
          {
            baseDir,
            resolvedRunId: "run-ai-review-multimodal-pass",
            startedAt: "2026-02-22T10:00:00.000Z",
            profile: {
              name: "nightly",
              steps: ["e2e"],
              gates: { consoleErrorMax: 0, pageErrorMax: 0, http5xxMax: 0 },
            } as never,
            target: {
              name: "web.nightly",
              type: "web",
              driver: "web-playwright",
              baseUrl: "http://127.0.0.1:4173",
            },
            effectiveBaseUrl: "http://127.0.0.1:4173",
            effectiveApp: undefined,
            effectiveBundleId: undefined,
            stateModel: { configuredRoutes: [], configuredStories: [], configuredTotal: 0 } as never,
            runtimeStart: {
              autostart: false,
              started: false,
              healthcheckPassed: false,
              healthcheckUrl: "http://127.0.0.1:4173/health",
              processes: [],
              reportPath: "reports/runtime.json",
              teardown: () => undefined,
            },
            driverContract: {
              driverId: "web-playwright",
              targetTypes: ["web"],
              capabilities: {
                navigate: true,
                interact: true,
                capture: true,
                logs: true,
                network: true,
                trace: true,
                lifecycle: false,
              },
            },
            blockedStepReasons: [],
            blockedStepDetails: [],
            effectiveDiagnosticsConfig: { maxItems: 10 },
            maxParallelTasks: 1,
            stageDurationsMs: { "test.e2e": 100 },
            baseUrlPolicy: {
              enabled: true,
              requestedUrl: "http://127.0.0.1:4173",
              requestedOrigin: "http://127.0.0.1:4173",
              allowedOrigins: ["http://127.0.0.1:4173"],
              matched: true,
              reason: "origin_allowed",
            },
            state,
          },
          {
            generateAiReviewReportImpl: () =>
              ({
                schemaVersion: "1.0",
                generatedAt: "2026-02-22T10:00:00.000Z",
                runId: "run-ai-review-multimodal-pass",
                profile: "nightly",
                target: {
                  type: "web",
                  name: "web.nightly",
                  baseUrl: "http://127.0.0.1:4173",
                  app: "",
                  bundleId: "",
                },
                severityThreshold: "high",
                candidates: [],
                findings: [],
                summary: { totalFindings: 0, highOrAbove: 0, candidateArtifacts: 1 },
                gate: { status: "passed", reasonCode: "gate.ai_review.passed.ok" },
                generation: {
                  mode: "llm",
                  promptId: "ai-review.test.prompt",
                  promptVersion: "test-v1",
                  model: "rule-llm-synth-v1",
                },
              }) as never,
            writeAiReviewReportArtifactsImpl: () =>
              ({
                jsonPath: "reports/ai-review.json",
                markdownPath: "reports/ai-review.md",
              }) as never,
            runUiUxGeminiReportImpl: () =>
              ({
                reportPath: "reports/ui-ux-gemini-report.json",
                report: {
                  reason_code: "ai.gemini.ui_ux.report.generated",
                  thought_signatures: {
                    status: "present",
                    reason_code: "ai.gemini.thought_signature.present",
                    signatures: ["signature-1"],
                    signature_count: 1,
                  },
                  summary: { total_findings: 0, high_or_above: 0, overall_score: 99 },
                },
              }) as never,
            resolveGeminiGateCheckImpl: ({ checkId, reportPath }) =>
              ({
                check: {
                  id: checkId,
                  expected: "ok",
                  actual: "ok",
                  severity: "MAJOR",
                  status: "passed",
                  reasonCode: `gate.${checkId}.passed.ok`,
                  evidencePath: reportPath,
                },
                reportExists: true,
              }) as never,
            executeFixExecutorImpl: () =>
              ({
                mode: "report_only",
                reportPath: "reports/fix-result.json",
                summary: { totalTasks: 0, applied: 0, failed: 0, planned: 0 },
                gate: { status: "passed", reasonCode: "gate.ai_fix.execution.passed.report_only" },
              }) as never,
          }
        )
      }
    )

    const manifest = JSON.parse(readFileSync(resolve(baseDir, result!.manifestPath), "utf8")) as {
      reports: Record<string, string | undefined>
      gateResults: { checks: Array<{ id: string; status: string; reasonCode: string }> }
    }
    const checks = new Map(
      manifest.gateResults.checks.map((check) => [check.id, { status: check.status, reasonCode: check.reasonCode }])
    )
    assert.equal(checks.get("ai_review.gemini_multimodal")?.status, "passed")
    assert.equal(
      checks.get("ai_review.gemini_multimodal")?.reasonCode,
      "gate.ai_review.passed.gemini_multimodal_threshold_met"
    )
    assert.equal(manifest.reports.geminiAccuracyGate, "reports/uiq-gemini-accuracy-gate-nightly.json")
    assert.equal(manifest.reports.geminiConcurrencyGate, "reports/uiq-gemini-concurrency-gate-nightly.json")
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})
