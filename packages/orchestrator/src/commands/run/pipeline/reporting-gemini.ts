import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const DEFAULT_GEMINI_MODEL = "models/gemini-3.1-pro-preview"
const DEFAULT_UI_UX_GEMINI_REPORT_PATH = "reports/ui-ux-gemini-report.json"

type UiUxGeminiReportSummary = {
  total_findings?: number
  high_or_above?: number
  overall_score?: number
}

export type UiUxGeminiReport = {
  schemaVersion?: string
  reason_code?: string
  thought_signatures?: {
    include_thoughts_enabled?: boolean
    status?: string
    reason_code?: string
    signatures?: string[]
    signature_count?: number
  }
  summary?: UiUxGeminiReportSummary
}

type GeminiGateStatus = "passed" | "failed" | "blocked"

type GeminiGateReport = {
  checkId?: string
  status?: string
  reasonCode?: string
  metrics?: Record<string, unknown>
  thresholds?: Record<string, unknown>
}

type GeminiGateCheckArgs = {
  baseDir: string
  checkId: string
  expectedCheckId: string
  reportPath: string
  metricField: string
  thresholdField: string
  missingReasonCode: string
  parseErrorReasonCode: string
  invalidPayloadReasonCode: string
}

function asGeminiGateStatus(value: unknown): GeminiGateStatus | undefined {
  if (value === "passed" || value === "failed" || value === "blocked") return value
  return undefined
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  return Number(value.toFixed(6))
}

function buildGeminiGateActual(
  report: GeminiGateReport,
  metricField: string,
  thresholdField: string
): string {
  const metric = asFiniteNumber(report.metrics?.[metricField])
  const threshold = asFiniteNumber(report.thresholds?.[thresholdField])
  const sampleSize = asFiniteNumber(report.metrics?.sampleSize)
  const reportCheckId = typeof report.checkId === "string" ? report.checkId : "<missing>"
  return `check_id=${reportCheckId};metric=${metric ?? "n/a"};threshold=${threshold ?? "n/a"};sample_size=${sampleSize ?? "n/a"}`
}

export function resolveGeminiGateCheck(args: GeminiGateCheckArgs): {
  check: {
    id: string
    expected: string
    actual: string
    severity: "MAJOR"
    status: GeminiGateStatus
    reasonCode: string
    evidencePath: string
  }
  reportExists: boolean
} {
  const absoluteReportPath = resolve(args.baseDir, args.reportPath)
  if (!existsSync(absoluteReportPath)) {
    return {
      check: {
        id: args.checkId,
        expected: "report_present",
        actual: "missing",
        severity: "MAJOR",
        status: "blocked",
        reasonCode: args.missingReasonCode,
        evidencePath: args.reportPath,
      },
      reportExists: false,
    }
  }

  let report: GeminiGateReport
  try {
    report = JSON.parse(readFileSync(absoluteReportPath, "utf8")) as GeminiGateReport
  } catch {
    return {
      check: {
        id: args.checkId,
        expected: args.expectedCheckId,
        actual: "report_parse_error",
        severity: "MAJOR",
        status: "blocked",
        reasonCode: args.parseErrorReasonCode,
        evidencePath: args.reportPath,
      },
      reportExists: true,
    }
  }

  const status = asGeminiGateStatus(report.status)
  const reasonCode = typeof report.reasonCode === "string" ? report.reasonCode.trim() : ""
  const checkIdMatches =
    typeof report.checkId === "string" && report.checkId.trim() === args.expectedCheckId
  if (!status || !reasonCode || !checkIdMatches) {
    return {
      check: {
        id: args.checkId,
        expected: args.expectedCheckId,
        actual: buildGeminiGateActual(report, args.metricField, args.thresholdField),
        severity: "MAJOR",
        status: "blocked",
        reasonCode: args.invalidPayloadReasonCode,
        evidencePath: args.reportPath,
      },
      reportExists: true,
    }
  }

  return {
    check: {
      id: args.checkId,
      expected: args.expectedCheckId,
      actual: buildGeminiGateActual(report, args.metricField, args.thresholdField),
      severity: "MAJOR",
      status,
      reasonCode,
      evidencePath: args.reportPath,
    },
    reportExists: true,
  }
}

function pickFirstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim()
    if (trimmed) return trimmed
  }
  return undefined
}

export function resolveGeminiModelFromEnv(): string {
  const speedMode = (process.env.AI_SPEED_MODE ?? "").trim().toLowerCase() === "true"
  if (speedMode) {
    return (
      pickFirstNonEmpty(process.env.GEMINI_MODEL_FLASH, process.env.GEMINI_MODEL_PRIMARY) ??
      DEFAULT_GEMINI_MODEL
    )
  }
  return pickFirstNonEmpty(process.env.GEMINI_MODEL_PRIMARY) ?? DEFAULT_GEMINI_MODEL
}

export function resolveAiReviewModeFromEnv(): "llm" | "rule_fallback" {
  const mode = (process.env.AI_REVIEW_MODE ?? "").trim().toLowerCase()
  if (mode === "rule_fallback") return "rule_fallback"
  return "llm"
}

export function resolveAiReviewGeminiMultimodalFromEnv(): boolean {
  const raw = (process.env.AI_REVIEW_GEMINI_MULTIMODAL ?? "").trim().toLowerCase()
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on"
}

export function resolveAiReviewGeminiTopScreenshotsFromEnv(): number {
  const raw = (process.env.AI_REVIEW_GEMINI_TOP_SCREENSHOTS ?? "").trim()
  if (!raw) return 3
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
    throw new Error(
      `AI_REVIEW_GEMINI_TOP_SCREENSHOTS must be an integer in [1,10], received '${raw}'`
    )
  }
  return parsed
}

type UiUxGeminiReportDeps = {
  execFileSyncImpl?: (
    file: string,
    commandArgs: string[],
    options: {
      cwd: string
      env: NodeJS.ProcessEnv
      stdio: "pipe"
    }
  ) => void
  readFileSyncImpl?: (path: string, encoding: BufferEncoding) => string
}

export function runUiUxGeminiReport(
  args: { resolvedRunId: string; speedMode: boolean },
  deps: UiUxGeminiReportDeps = {}
): {
  reportPath: string
  report: UiUxGeminiReport
} {
  const execFileSyncImpl =
    deps.execFileSyncImpl ??
    ((file, commandArgs, options) => {
      execFileSync(file, commandArgs, options)
    })
  const readFileSyncImpl =
    deps.readFileSyncImpl ??
    ((path, encoding) => {
      return readFileSync(path, encoding)
    })
  const runsDir = resolve(process.cwd(), ".runtime-cache/artifacts/runs")
  const reportPath = DEFAULT_UI_UX_GEMINI_REPORT_PATH
  const scriptPath = resolve(process.cwd(), "apps/automation-runner/scripts/generate-ui-ux-gemini-report.ts")
  const commandArgs = [
    "--import",
    "tsx",
    scriptPath,
    `--runs_dir=${runsDir}`,
    `--run_id=${args.resolvedRunId}`,
    `--output=${reportPath}`,
    `--speed_mode=${args.speedMode ? "true" : "false"}`,
    `--top_screenshots=${resolveAiReviewGeminiTopScreenshotsFromEnv()}`,
  ]

  try {
    execFileSyncImpl(process.execPath, commandArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "pipe",
    })
  } catch (error) {
    const details =
      error instanceof Error && "stderr" in error
        ? String((error as { stderr?: string | Buffer }).stderr ?? "").trim()
        : error instanceof Error
          ? error.message
          : String(error)
    throw new Error(`Gemini multimodal UI/UX report generation failed: ${details}`)
  }

  const absoluteReportPath = resolve(runsDir, args.resolvedRunId, reportPath)
  const report = JSON.parse(readFileSyncImpl(absoluteReportPath, "utf8")) as UiUxGeminiReport
  return { reportPath, report }
}

export function resolveGeminiThoughtSignatureCheck(args: {
  report: UiUxGeminiReport
  evidencePath: string
}): {
  id: string
  expected: string
  actual: string
  severity: "MAJOR"
  status: "passed" | "failed" | "blocked"
  reasonCode: string
  evidencePath: string
} {
  const thought = args.report.thought_signatures
  if (!thought || typeof thought !== "object") {
    return {
      id: "ai_review.gemini_thought_signature",
      expected: "status=present",
      actual: "missing_payload",
      severity: "MAJOR",
      status: "blocked",
      reasonCode: "gate.ai_review.gemini_thought_signature.blocked.invalid_report_payload",
      evidencePath: args.evidencePath,
    }
  }
  const statusRaw = typeof thought.status === "string" ? thought.status.trim() : ""
  const reasonCodeRaw = typeof thought.reason_code === "string" ? thought.reason_code.trim() : ""
  const signatures = Array.isArray(thought.signatures)
    ? thought.signatures.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0
      )
    : []
  const signatureCount =
    typeof thought.signature_count === "number" && Number.isFinite(thought.signature_count)
      ? thought.signature_count
      : signatures.length

  if (!statusRaw || !reasonCodeRaw || !["present", "missing", "parse_failed"].includes(statusRaw)) {
    return {
      id: "ai_review.gemini_thought_signature",
      expected: "status=present",
      actual: `status=${statusRaw || "<missing>"};count=${signatureCount}`,
      severity: "MAJOR",
      status: "blocked",
      reasonCode: "gate.ai_review.gemini_thought_signature.blocked.invalid_report_payload",
      evidencePath: args.evidencePath,
    }
  }

  if (statusRaw === "present") {
    return {
      id: "ai_review.gemini_thought_signature",
      expected: "status=present",
      actual: `status=present;count=${signatureCount}`,
      severity: "MAJOR",
      status: signatureCount > 0 ? "passed" : "blocked",
      reasonCode:
        signatureCount > 0
          ? "gate.ai_review.gemini_thought_signature.passed.present"
          : "gate.ai_review.gemini_thought_signature.blocked.invalid_report_payload",
      evidencePath: args.evidencePath,
    }
  }

  if (statusRaw === "missing") {
    return {
      id: "ai_review.gemini_thought_signature",
      expected: "status=present",
      actual: "status=missing;count=0",
      severity: "MAJOR",
      status: "failed",
      reasonCode: reasonCodeRaw || "gate.ai_review.gemini_thought_signature.failed.missing",
      evidencePath: args.evidencePath,
    }
  }

  return {
    id: "ai_review.gemini_thought_signature",
    expected: "status=present",
    actual: `status=parse_failed;count=${signatureCount}`,
    severity: "MAJOR",
    status: "blocked",
    reasonCode: reasonCodeRaw || "gate.ai_review.gemini_thought_signature.blocked.parse_failed",
    evidencePath: args.evidencePath,
  }
}
