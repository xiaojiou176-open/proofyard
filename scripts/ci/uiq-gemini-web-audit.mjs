#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const DEFAULT_OUT_DIR = resolve(REPO_ROOT, ".runtime-cache/artifacts/ci")
const DEFAULT_LIVE_SMOKE_SCRIPT = resolve(REPO_ROOT, "scripts/ci/uiq-gemini-live-smoke-gate.mjs")
const DEFAULT_UIUX_AUDIT_SCRIPT = resolve(REPO_ROOT, "scripts/ci/uiq-gemini-uiux-audit.mjs")
const DEFAULT_WEB_UI_BASE_URL = `http://127.0.0.1:${process.env.UIQ_FRONTEND_E2E_PORT || process.env.UIQ_WEB_PORT || "43173"}`
const DOWNSTREAM_REASON_CODE_BASE = "gate.uiux.gemini.web_audit.downstream"
const DOWNSTREAM_JSON_FAILURE_REASON_CODE =
  "gate.uiux.gemini.web_audit.failed.downstream_json_unreadable"

function downstreamSourceSegment(source) {
  if (source === "liveSmoke") return "live_smoke_report"
  if (source === "uiAudit") return "ui_audit_report"
  return "unknown_report"
}

function downstreamReadReasonCode(source, failureType) {
  return `${DOWNSTREAM_REASON_CODE_BASE}.${downstreamSourceSegment(source)}.${failureType}`
}

export function parseStrict(argv) {
  const strictIndex = argv.indexOf("--strict")
  if (strictIndex >= 0) {
    return String(argv[strictIndex + 1] ?? "false").trim() === "true"
  }
  return true
}

export function resolveRuntimePaths(env = process.env) {
  const outDir = env.UIQ_GEMINI_WEB_AUDIT_OUT_DIR
    ? resolve(REPO_ROOT, env.UIQ_GEMINI_WEB_AUDIT_OUT_DIR)
    : DEFAULT_OUT_DIR
  const liveSmokeScript = env.UIQ_GEMINI_WEB_AUDIT_LIVE_SMOKE_SCRIPT
    ? resolve(REPO_ROOT, env.UIQ_GEMINI_WEB_AUDIT_LIVE_SMOKE_SCRIPT)
    : DEFAULT_LIVE_SMOKE_SCRIPT
  const uiuxAuditScript = env.UIQ_GEMINI_WEB_AUDIT_UIUX_AUDIT_SCRIPT
    ? resolve(REPO_ROOT, env.UIQ_GEMINI_WEB_AUDIT_UIUX_AUDIT_SCRIPT)
    : DEFAULT_UIUX_AUDIT_SCRIPT
  return {
    outDir,
    liveSmokeScript,
    uiuxAuditScript,
    liveSmokeArtifactPath: resolve(outDir, "uiq-gemini-live-smoke-gate.json"),
    uiuxAuditArtifactPath: resolve(outDir, "uiq-gemini-uiux-audit.json"),
  }
}

function runScript(scriptPath, args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      UIQ_BASE_URL: process.env.UIQ_BASE_URL || DEFAULT_WEB_UI_BASE_URL,
    },
    encoding: "utf8",
  })
}

export function readJsonReport(jsonPath, source) {
  try {
    return { ok: true, report: JSON.parse(readFileSync(jsonPath, "utf8")) }
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error))
    const errorCode =
      normalizedError && typeof normalizedError === "object" && "code" in normalizedError
        ? String(normalizedError.code || "")
        : ""
    let failureType = "read_error"
    if (errorCode === "ENOENT") {
      failureType = "missing_file"
    } else if (normalizedError instanceof SyntaxError) {
      failureType = "invalid_json"
    }
    return {
      ok: false,
      source,
      path: jsonPath,
      failureType,
      reasonCode: downstreamReadReasonCode(source, failureType),
      errorMessage: normalizedError.message,
    }
  }
}

export function buildDownstreamJsonFailureReport({ strict, liveSmokeResult, uiAuditResult }) {
  const downstreamErrors = [liveSmokeResult, uiAuditResult]
    .filter((result) => !result.ok)
    .map((result) => ({
      source: result.source,
      path: result.path,
      reasonCode: result.reasonCode,
      errorMessage: result.errorMessage,
    }))

  return {
    checkId: "uiq_gemini_web_audit",
    strict,
    status: "failed",
    reasonCode: DOWNSTREAM_JSON_FAILURE_REASON_CODE,
    message: "Gemini web audit failed because downstream audit reports are unreadable.",
    liveSmoke: {
      status: liveSmokeResult.ok ? liveSmokeResult.report.status : "failed",
      reasonCode: liveSmokeResult.ok
        ? liveSmokeResult.report.reasonCode
        : liveSmokeResult.reasonCode,
    },
    uiAudit: {
      status: uiAuditResult.ok ? uiAuditResult.report.status : "failed",
      reasonCode: uiAuditResult.ok ? uiAuditResult.report.reasonCode : uiAuditResult.reasonCode,
      fileCount: uiAuditResult.ok ? uiAuditResult.report.fileCount ?? 0 : 0,
    },
    downstreamErrors,
  }
}

function writeArtifacts(report, outDir) {
  mkdirSync(outDir, { recursive: true })
  const jsonPath = resolve(outDir, "uiq-gemini-web-audit.json")
  const mdPath = resolve(outDir, "uiq-gemini-web-audit.md")
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  const markdown = [
    "# Gemini Web Audit",
    "",
    `- status: ${report.status}`,
    `- strict: ${report.strict}`,
    `- liveSmokeStatus: ${report.liveSmoke.status}`,
    `- liveSmokeReason: ${report.liveSmoke.reasonCode}`,
    `- uiAuditStatus: ${report.uiAudit.status}`,
    `- uiAuditReason: ${report.uiAudit.reasonCode}`,
    "",
    "## Notes",
    "",
    `- ${report.message}`,
  ].join("\n")
  writeFileSync(mdPath, `${markdown}\n`, "utf8")
  return { jsonPath, mdPath }
}

export function main() {
  const runtimePaths = resolveRuntimePaths()
  const strict = parseStrict(process.argv.slice(2))
  const sharedArgs = ["--strict", strict ? "true" : "false"]

  const liveSmokeRun = runScript(runtimePaths.liveSmokeScript, [...sharedArgs, "--required", "true"])
  const uiAuditRun = runScript(runtimePaths.uiuxAuditScript, sharedArgs)
  const liveSmokeResult = readJsonReport(runtimePaths.liveSmokeArtifactPath, "liveSmoke")
  const uiAuditResult = readJsonReport(runtimePaths.uiuxAuditArtifactPath, "uiAudit")

  if (!liveSmokeResult.ok || !uiAuditResult.ok) {
    const downstreamFailureReport = buildDownstreamJsonFailureReport({
      strict,
      liveSmokeResult,
      uiAuditResult,
    })
    const artifacts = writeArtifacts(downstreamFailureReport, runtimePaths.outDir)
    process.stdout.write(
      `[uiq-gemini-web-audit] ${downstreamFailureReport.message}\nartifact=${artifacts.jsonPath}\nartifact_md=${artifacts.mdPath}\n`
    )
    if (strict) process.exit(1)
    return
  }

  const liveSmokeReport = liveSmokeResult.report
  const uiAuditReport = uiAuditResult.report

  const liveSmokePassed = liveSmokeReport.status === "passed"
  const uiAuditPassed = uiAuditReport.status === "passed"
  const failed =
    (liveSmokeRun.status ?? 0) !== 0 ||
    (uiAuditRun.status ?? 0) !== 0 ||
    !liveSmokePassed ||
    !uiAuditPassed
  const report = {
    checkId: "uiq_gemini_web_audit",
    strict,
    status: failed ? "failed" : "passed",
    reasonCode: failed ? "gate.uiux.gemini.web_audit.failed" : "gate.uiux.gemini.web_audit.passed",
    message: failed
      ? "Gemini web audit failed. All nested checks must be passed."
      : "Gemini web audit passed with live smoke and UI audit artifacts.",
    liveSmoke: {
      status: liveSmokeReport.status,
      reasonCode: liveSmokeReport.reasonCode,
    },
    uiAudit: {
      status: uiAuditReport.status,
      reasonCode: uiAuditReport.reasonCode,
      fileCount: uiAuditReport.fileCount ?? 0,
    },
  }

  const artifacts = writeArtifacts(report, runtimePaths.outDir)
  process.stdout.write(
    `[uiq-gemini-web-audit] ${report.message}\nartifact=${artifacts.jsonPath}\nartifact_md=${artifacts.mdPath}\n`
  )
  if (failed && strict) process.exit(1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
