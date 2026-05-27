import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { GoogleGenAI } from "@google/genai"

type ManifestEvidenceItem = {
  id: string
  source: "state" | "report" | "gate" | "diagnostic"
  kind: "screenshot" | "dom" | "trace" | "network" | "log" | "video" | "report" | "metric" | "other"
  path: string
}

type ManifestGateCheck = {
  id: string
  status: "passed" | "failed" | "blocked"
  reasonCode: string
  evidencePath: string
}

type RunManifest = {
  runId: string
  profile: string
  target: Record<string, unknown> & { type?: string; name?: string; baseUrl?: string }
  summary: {
    consoleError?: number
    pageError?: number
    http5xx?: number
  }
  diagnostics?: {
    capture?: { consoleErrors?: string[]; pageErrors?: string[]; http5xxUrls?: string[] }
    explore?: { consoleErrors?: string[]; pageErrors?: string[]; http5xxUrls?: string[] }
    chaos?: { consoleErrors?: string[]; pageErrors?: string[]; http5xxUrls?: string[] }
  }
  gateResults?: { checks?: ManifestGateCheck[] }
  evidenceIndex?: ManifestEvidenceItem[]
  states?: Array<{ artifacts?: Record<string, string> }>
}

type UiUxFinding = {
  id: string
  severity: "critical" | "high" | "medium" | "low"
  category: "ui" | "ux" | "functional" | "stability" | "performance" | "accessibility"
  reason_code: string
  title: string
  diagnosis: string
  recommendation: string
  evidence: string[]
}

type UiUxGeminiReport = {
  schemaVersion: "1.0"
  generatedAt: string
  runId: string
  profile: string
  target: {
    type: string
    name: string
    baseUrl: string
  }
  model: string
  speed_mode: boolean
  reason_code: string
  reason_codes: string[]
  thought_signatures: {
    include_thoughts_enabled: boolean
    status: "present" | "missing" | "parse_failed"
    reason_code: string
    signatures: string[]
    signature_count: number
  }
  summary: {
    verdict: "pass" | "needs_attention" | "critical_issues"
    overall_score: number
    total_findings: number
    high_or_above: number
  }
  input_context: {
    screenshots: string[]
    video: string
    errors: {
      console_error_count: number
      page_error_count: number
      http5xx_count: number
      sample_console_errors: string[]
      sample_page_errors: string[]
      sample_http5xx_urls: string[]
      failed_gate_checks: Array<{ id: string; reason_code: string; evidence_path: string }>
    }
  }
  findings: UiUxFinding[]
}

const RUNS_DIR_DEFAULT = ".runtime-cache/artifacts/runs"
const REPORT_PATH_DEFAULT = "reports/ui-ux-gemini-report.json"
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_VIDEO_BYTES = 20 * 1024 * 1024
const ALLOWED_REASON_CODE_PREFIXES = ["ai.gemini.ui_ux.", "gate.ai_review.", "gate.ai_fix."] as const
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..")

const RESPONSE_SCHEMA = {
  type: "object",
  required: ["reason_code", "reason_codes", "summary", "findings"],
  properties: {
    reason_code: { type: "string" },
    reason_codes: { type: "array", items: { type: "string" } },
    summary: {
      type: "object",
      required: ["verdict", "overall_score"],
      properties: {
        verdict: { type: "string", enum: ["pass", "needs_attention", "critical_issues"] },
        overall_score: { type: "number" },
      },
      additionalProperties: true,
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        required: [
          "id",
          "severity",
          "category",
          "reason_code",
          "title",
          "diagnosis",
          "recommendation",
          "evidence",
        ],
        properties: {
          id: { type: "string" },
          severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
          category: {
            type: "string",
            enum: ["ui", "ux", "functional", "stability", "performance", "accessibility"],
          },
          reason_code: { type: "string" },
          title: { type: "string" },
          diagnosis: { type: "string" },
          recommendation: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
        },
        additionalProperties: true,
      },
    },
  },
  additionalProperties: true,
} as const

function getArg(name: string): string | null {
  const token = `--${name}=`
  const hit = process.argv.find((value) => value.startsWith(token))
  return hit ? hit.slice(token.length) : null
}

export function parseBoolean(raw: string | null, fallback: boolean): boolean {
  if (raw === null) return fallback
  const value = raw.trim().toLowerCase()
  if (value === "true") return true
  if (value === "false") return false
  throw new Error(`[ai.gemini.invalid_argument] --speed_mode must be true|false`)
}

export function parseTopN(raw: string | null, fallback: number): number {
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw new Error(`[ai.gemini.invalid_argument] --top_screenshots must be integer in [1,10]`)
  }
  return value
}

export function resolveIncludeThoughts(speedMode: boolean): boolean {
  const raw = (process.env.AI_REVIEW_GEMINI_INCLUDE_THOUGHTS ?? "").trim().toLowerCase()
  if (raw === "true" || raw === "1" || raw === "yes" || raw === "on") return true
  if (raw === "false" || raw === "0" || raw === "no" || raw === "off") return false
  return !speedMode
}

type ThoughtSignatureResult = {
  status: "present" | "missing" | "parse_failed"
  reason_code: string
  signatures: string[]
}

export function extractThoughtSignatures(response: unknown): ThoughtSignatureResult {
  try {
    const root = response as {
      candidates?: Array<{
        content?: {
          parts?: Array<Record<string, unknown>>
        }
      }>
    }
    const candidates = Array.isArray(root?.candidates) ? root.candidates : []
    const signatures = new Set<string>()
    let malformed = false

    for (const candidate of candidates) {
      const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []
      for (const part of parts) {
        const directValues = [
          part.thoughtSignature,
          part.thought_signature,
          part.signature,
          part.thought_signature_text,
        ]
        for (const value of directValues) {
          if (value === undefined || value === null) continue
          if (typeof value === "string" && value.trim()) signatures.add(value.trim())
          else malformed = true
        }

        const thought = part.thought
        if (thought && typeof thought === "object") {
          const thoughtRecord = thought as Record<string, unknown>
          const nestedValues = [
            thoughtRecord.thoughtSignature,
            thoughtRecord.thought_signature,
            thoughtRecord.signature,
          ]
          for (const value of nestedValues) {
            if (value === undefined || value === null) continue
            if (typeof value === "string" && value.trim()) signatures.add(value.trim())
            else malformed = true
          }
        }
      }
    }

    if (signatures.size > 0) {
      return {
        status: "present",
        reason_code: "ai.gemini.thought_signature.present",
        signatures: [...signatures],
      }
    }
    if (malformed) {
      return {
        status: "parse_failed",
        reason_code: "ai.gemini.thought_signature.parse_failed",
        signatures: [],
      }
    }
    return {
      status: "missing",
      reason_code: "ai.gemini.thought_signature.missing",
      signatures: [],
    }
  } catch {
    return {
      status: "parse_failed",
      reason_code: "ai.gemini.thought_signature.parse_failed",
      signatures: [],
    }
  }
}

type EnvLike = NodeJS.ProcessEnv

export function resolveGeminiModelFromEnv(speedMode: boolean, env: EnvLike = process.env): string {
  if (speedMode) {
    const flashModel = (env.GEMINI_MODEL_FLASH ?? "").trim()
    if (!flashModel) {
      throw new Error(
        "[ai.gemini.unavailable.missing_env] GEMINI_MODEL_FLASH is required when --speed_mode=true"
      )
    }
    return flashModel
  }

  const primaryModel = (env.GEMINI_MODEL_PRIMARY ?? "").trim()
  if (!primaryModel) {
    throw new Error(
      "[ai.gemini.unavailable.missing_env] GEMINI_MODEL_PRIMARY is required when --speed_mode=false"
    )
  }
  return primaryModel
}

export function extToMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === ".png") return "image/png"
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  if (ext === ".webp") return "image/webp"
  if (ext === ".mp4") return "video/mp4"
  if (ext === ".webm") return "video/webm"
  throw new Error(
    `[ai.gemini.input.unsupported_media] unsupported media extension: ${ext || "<none>"}`
  )
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf-8")
  return JSON.parse(raw) as T
}

export async function findLatestRunDir(runsDir: string): Promise<string> {
  const entries = await readdir(runsDir, { withFileTypes: true })
  const dirs = entries.filter((entry) => entry.isDirectory())
  const withManifest: Array<{ dir: string; mtimeMs: number }> = []
  for (const dir of dirs) {
    const manifestPath = path.join(runsDir, dir.name, "manifest.json")
    try {
      const fileStat = await stat(manifestPath)
      withManifest.push({ dir: dir.name, mtimeMs: fileStat.mtimeMs })
    } catch {
      // ignore entries without manifest
    }
  }
  if (withManifest.length === 0) {
    throw new Error(`[ai.gemini.input.no_run_manifest] no run manifest found under ${runsDir}`)
  }
  withManifest.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return withManifest[0]!.dir
}

export async function pickArtifacts(
  manifest: RunManifest,
  runDir: string,
  topScreenshots: number
): Promise<{ screenshots: string[]; video: string | null }> {
  const evidence = manifest.evidenceIndex ?? []
  const screenshotsFromEvidence = evidence
    .filter((item) => item.kind === "screenshot")
    .map((item) => item.path)
  const screenshotsFromStates = (manifest.states ?? [])
    .map((state) => state.artifacts?.screenshot)
    .filter(
      (candidate): candidate is string =>
        typeof candidate === "string" && candidate.trim().length > 0
    )
  const screenshotDedupe = [...new Set([...screenshotsFromEvidence, ...screenshotsFromStates])]
  const screenshots = screenshotDedupe.slice(0, topScreenshots)
  let video = evidence.find((item) => item.kind === "video")?.path ?? ""

  if (!video) {
    const stateVideo = (manifest.states ?? [])
      .map((state) => state.artifacts?.video)
      .find((candidate) => typeof candidate === "string" && candidate.trim().length > 0)
    if (stateVideo) video = stateVideo
  }

  if (!video) {
    const videosDir = path.join(runDir, "videos")
    try {
      const media = await readdir(videosDir, { withFileTypes: true })
      const candidate = media
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .find((name) => [".mp4", ".webm"].includes(path.extname(name).toLowerCase()))
      if (candidate) video = path.posix.join("videos", candidate)
    } catch {
      // ignore videos dir fallback failure
    }
  }

  if (screenshots.length === 0) {
    throw new Error(
      `[ai.gemini.input.missing_screenshot] no screenshot evidence found in manifest.evidenceIndex`
    )
  }
  return { screenshots, video: video || null }
}

export function gatherErrorContext(
  manifest: RunManifest
): UiUxGeminiReport["input_context"]["errors"] {
  const capture = manifest.diagnostics?.capture ?? {}
  const explore = manifest.diagnostics?.explore ?? {}
  const chaos = manifest.diagnostics?.chaos ?? {}

  const consoleErrors = [
    ...(capture.consoleErrors ?? []),
    ...(explore.consoleErrors ?? []),
    ...(chaos.consoleErrors ?? []),
  ]
  const pageErrors = [
    ...(capture.pageErrors ?? []),
    ...(explore.pageErrors ?? []),
    ...(chaos.pageErrors ?? []),
  ]
  const http5xxUrls = [
    ...(capture.http5xxUrls ?? []),
    ...(explore.http5xxUrls ?? []),
    ...(chaos.http5xxUrls ?? []),
  ]

  const failedChecks = (manifest.gateResults?.checks ?? [])
    .filter((check) => check.status !== "passed")
    .map((check) => ({
      id: check.id,
      reason_code: check.reasonCode,
      evidence_path: check.evidencePath,
    }))

  return {
    console_error_count: Number(manifest.summary.consoleError ?? consoleErrors.length),
    page_error_count: Number(manifest.summary.pageError ?? pageErrors.length),
    http5xx_count: Number(manifest.summary.http5xx ?? http5xxUrls.length),
    sample_console_errors: consoleErrors.slice(0, 10),
    sample_page_errors: pageErrors.slice(0, 10),
    sample_http5xx_urls: http5xxUrls.slice(0, 10),
    failed_gate_checks: failedChecks.slice(0, 20),
  }
}

export function buildPrompt(context: {
  runId: string
  profile: string
  target: { type: string; name: string; baseUrl: string }
  screenshots: string[]
  video: string | null
  errors: UiUxGeminiReport["input_context"]["errors"]
}): string {
  return [
    "You are a senior QA analyst.",
    "Analyze the provided browser screenshots + video + error context.",
    "Return STRICT JSON only, no markdown.",
    "Every finding MUST include a machine-readable reason_code.",
    "Use reason_code prefixes: ai.gemini.ui_ux., gate.ai_review., gate.ai_fix.",
    "Focus on: UI correctness, UX friction, functional regressions, stability, performance, accessibility.",
    "Output schema fields required by response schema.",
    "",
    `Run ID: ${context.runId}`,
    `Profile: ${context.profile}`,
    `Target: ${context.target.type}/${context.target.name} (${context.target.baseUrl})`,
    `Screenshot artifacts: ${context.screenshots.join(", ")}`,
    `Video artifact: ${context.video ?? "<none>"}`,
    `Error context: ${JSON.stringify(context.errors)}`,
  ].join("\n")
}

export function validateReasonCodes(
  report: Pick<UiUxGeminiReport, "reason_code" | "reason_codes" | "findings">
): void {
  const hasAllowedPrefix = (reasonCode: string): boolean =>
    ALLOWED_REASON_CODE_PREFIXES.some((prefix) => reasonCode.startsWith(prefix))
  const assertPrefixContract = (reasonCode: string, fieldLabel: string): void => {
    if (!hasAllowedPrefix(reasonCode)) {
      throw new Error(
        `[ai.gemini.failed.invalid_reason_code_prefix] ${fieldLabel} must start with one of: ${ALLOWED_REASON_CODE_PREFIXES.join(
          ", "
        )}`
      )
    }
  }

  if (!report.reason_code || typeof report.reason_code !== "string") {
    throw new Error(
      "[ai.gemini.failed.invalid_response_reason_code] top-level reason_code is missing"
    )
  }
  assertPrefixContract(report.reason_code, "top-level reason_code")
  if (!Array.isArray(report.reason_codes) || report.reason_codes.length === 0) {
    throw new Error(
      "[ai.gemini.failed.invalid_response_reason_codes] top-level reason_codes is missing"
    )
  }
  for (const [index, reasonCode] of report.reason_codes.entries()) {
    if (!reasonCode || typeof reasonCode !== "string") {
      throw new Error(
        `[ai.gemini.failed.invalid_response_reason_codes] reason_codes[${index}] must be a non-empty string`
      )
    }
    assertPrefixContract(reasonCode, `reason_codes[${index}]`)
  }
  if (!report.reason_codes.includes(report.reason_code)) {
    throw new Error(
      "[ai.gemini.failed.invalid_response_reason_codes] reason_codes must include top-level reason_code"
    )
  }
  for (const finding of report.findings) {
    if (!finding.reason_code || typeof finding.reason_code !== "string") {
      throw new Error(
        "[ai.gemini.failed.invalid_finding_reason_code] finding reason_code is missing"
      )
    }
    assertPrefixContract(finding.reason_code, `finding[${finding.id || "<unknown>"}].reason_code`)
  }
}

export async function toInlineDataPart(
  filePath: string,
  maxBytes: number
): Promise<{ inlineData: { mimeType: string; data: string } }> {
  const raw = await readFile(filePath)
  if (raw.byteLength > maxBytes) {
    throw new Error(
      `[ai.gemini.input.media_too_large] ${path.basename(filePath)} exceeds ${maxBytes} bytes`
    )
  }
  return {
    inlineData: {
      mimeType: extToMime(filePath),
      data: raw.toString("base64"),
    },
  }
}

async function main(): Promise<void> {
  const runsDirRaw = getArg("runs_dir") ?? RUNS_DIR_DEFAULT
  const runsDir = path.isAbsolute(runsDirRaw) ? runsDirRaw : path.resolve(REPO_ROOT, runsDirRaw)
  const explicitRunId = getArg("run_id")
  const speedMode = parseBoolean(getArg("speed_mode"), false)
  const topScreenshots = parseTopN(getArg("top_screenshots"), 3)
  const includeThoughts = resolveIncludeThoughts(speedMode)
  const outputRaw = getArg("output") ?? REPORT_PATH_DEFAULT
  const model = resolveGeminiModelFromEnv(speedMode)
  const apiKey = (process.env.GEMINI_API_KEY ?? "").trim()
  if (!apiKey) {
    throw new Error("[ai.gemini.unavailable.no_api_key] GEMINI_API_KEY is required")
  }

  const runId = explicitRunId ? explicitRunId.trim() : await findLatestRunDir(runsDir)
  if (!runId) {
    throw new Error("[ai.gemini.input.invalid_run_id] resolved run id is empty")
  }

  const runDir = path.resolve(runsDir, runId)
  const manifestPath = path.join(runDir, "manifest.json")
  const manifest = await readJson<RunManifest>(manifestPath)
  const artifacts = await pickArtifacts(manifest, runDir, topScreenshots)
  const errors = gatherErrorContext(manifest)

  const screenshotAbsolutePaths = artifacts.screenshots.map((relPath) =>
    path.resolve(runDir, relPath)
  )
  const prompt = buildPrompt({
    runId: manifest.runId,
    profile: manifest.profile,
    target: {
      type: String(manifest.target.type ?? "unknown"),
      name: String(manifest.target.name ?? "unknown"),
      baseUrl: String(manifest.target.baseUrl ?? ""),
    },
    screenshots: artifacts.screenshots,
    video: artifacts.video,
    errors,
  })

  const contentsParts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [{ text: prompt }]
  for (const imagePath of screenshotAbsolutePaths) {
    contentsParts.push(await toInlineDataPart(imagePath, MAX_IMAGE_BYTES))
  }
  if (artifacts.video) {
    const videoAbsolutePath = path.resolve(runDir, artifacts.video)
    contentsParts.push(await toInlineDataPart(videoAbsolutePath, MAX_VIDEO_BYTES))
  }

  const client = new GoogleGenAI({ apiKey })
  const response = await client.models.generateContent({
    model,
    contents: [{ role: "user", parts: contentsParts }],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: RESPONSE_SCHEMA,
      temperature: 0.1,
      ...(includeThoughts ? { thinkingConfig: { includeThoughts: true } } : {}),
    },
  })
  const thoughtSignatures = extractThoughtSignatures(response)

  const responseText = response.text?.trim() ?? ""
  if (!responseText) {
    throw new Error("[ai.gemini.failed.empty_response] Gemini response is empty")
  }

  let parsed: {
    reason_code: string
    reason_codes: string[]
    summary: { verdict: "pass" | "needs_attention" | "critical_issues"; overall_score: number }
    findings: UiUxFinding[]
  }
  try {
    parsed = JSON.parse(responseText) as {
      reason_code: string
      reason_codes: string[]
      summary: { verdict: "pass" | "needs_attention" | "critical_issues"; overall_score: number }
      findings: UiUxFinding[]
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`[ai.gemini.failed.invalid_json] ${message}`)
  }

  const findings = Array.isArray(parsed.findings) ? parsed.findings : []
  const report: UiUxGeminiReport = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    runId: manifest.runId,
    profile: manifest.profile,
    target: {
      type: String(manifest.target.type ?? "unknown"),
      name: String(manifest.target.name ?? "unknown"),
      baseUrl: String(manifest.target.baseUrl ?? ""),
    },
    model,
    speed_mode: speedMode,
    reason_code: parsed.reason_code,
    reason_codes: parsed.reason_codes,
    thought_signatures: {
      include_thoughts_enabled: includeThoughts,
      status: thoughtSignatures.status,
      reason_code: thoughtSignatures.reason_code,
      signatures: thoughtSignatures.signatures,
      signature_count: thoughtSignatures.signatures.length,
    },
    summary: {
      verdict: parsed.summary?.verdict ?? "needs_attention",
      overall_score: Number(parsed.summary?.overall_score ?? 0),
      total_findings: findings.length,
      high_or_above: findings.filter(
        (item) => item.severity === "critical" || item.severity === "high"
      ).length,
    },
    input_context: {
      screenshots: artifacts.screenshots,
      video: artifacts.video ?? "",
      errors,
    },
    findings,
  }

  validateReasonCodes(report)

  const outputPath = path.isAbsolute(outputRaw) ? outputRaw : path.resolve(runDir, outputRaw)
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, JSON.stringify(report, null, 2), "utf-8")

  process.stdout.write(
    `${JSON.stringify(
      {
        runId: report.runId,
        model: report.model,
        speed_mode: report.speed_mode,
        reason_code: report.reason_code,
        reason_codes: report.reason_codes,
        findings: report.summary.total_findings,
        output: outputPath,
      },
      null,
      2
    )}\n`
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`generate-ui-ux-gemini-report failed: ${message}\n`)
    process.exitCode = 1
  })
}
