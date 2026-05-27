import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { relative, resolve } from "node:path"

export const DEFAULT_ENDPOINT = "https://generativelanguage.googleapis.com"
export const DEFAULT_MODEL = "gemini-3.0-flash"
export const DEFAULT_TIMEOUT_MS = 15000
export const DEFAULT_MAX_FILES = 0
export const DEFAULT_MAX_FILE_CHARS = 1800
export const OUTPUT_DIR = ".runtime-cache/artifacts/ci"
const ARTIFACT_BASENAME = "uiq-gemini-uiux-audit"
const DEFAULT_PRODUCT_UI_SCAN_PATHS = [
  "apps/web/src/components",
  "apps/web/src/views",
  "apps/web/src/styles.css",
]
export const DEFAULT_RUNS_DIR = ".runtime-cache/artifacts/runs"
export const GENERATED_RUN_REPORT_REL_PATH = "reports/ui-ux-gemini-report.json"
const FOUNDATION_COMPONENTS_CONFIG = "apps/web/components.json"
const FOUNDATION_STYLE_FILES = ["apps/web/src/styles.css", "apps/web/src/styles.css"]
const FOUNDATION_REQUIRED_TOKENS = [
  "--background",
  "--foreground",
  "--primary",
  "--ring",
  "--motion-duration-fast",
  "--motion-duration-emphasized",
  "--ui-control-size",
]
const DEFAULT_UI_SCAN_PATHS = [
  ...DEFAULT_PRODUCT_UI_SCAN_PATHS,
  "apps/web/src/components",
  "apps/web/src/pages",
  "apps/web/src/styles.css",
]

function parseBoolean(raw, key) {
  if (raw === "true") return true
  if (raw === "false") return false
  throw new Error(`invalid ${key}, expected true|false`)
}

export function parseArgs(argv) {
  const options = {
    strict: false,
    model: process.env.UIQ_GEMINI_UIUX_MODEL || DEFAULT_MODEL,
    endpoint: process.env.UIQ_GEMINI_UIUX_ENDPOINT || DEFAULT_ENDPOINT,
    timeoutMs: Number(process.env.UIQ_GEMINI_UIUX_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    maxFiles: Number(process.env.UIQ_GEMINI_UIUX_MAX_FILES || DEFAULT_MAX_FILES),
    maxFileChars: Number(process.env.UIQ_GEMINI_UIUX_MAX_FILE_CHARS || DEFAULT_MAX_FILE_CHARS),
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    const next = argv[i + 1]
    if (token === "--strict" && next) options.strict = parseBoolean(next, "--strict")
    if (token === "--model" && next) options.model = String(next).trim()
    if (token === "--endpoint" && next) options.endpoint = String(next).trim()
    if (token === "--timeout-ms" && next) options.timeoutMs = Number(next)
    if (token === "--max-files" && next) options.maxFiles = Number(next)
    if (token === "--max-file-chars" && next) options.maxFileChars = Number(next)
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1) {
    throw new Error("invalid timeout, expected integer >= 1")
  }
  if (!Number.isFinite(options.maxFiles) || options.maxFiles < 0) {
    throw new Error("invalid max-files, expected integer >= 0")
  }
  if (!Number.isFinite(options.maxFileChars) || options.maxFileChars < 100) {
    throw new Error("invalid max-file-chars, expected integer >= 100")
  }

  return options
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0
}

function readEnvFileVariables(envFilePath) {
  if (!existsSync(envFilePath)) return {}
  const out = {}
  const raw = readFileSync(envFilePath, "utf8")
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const exportMatch = trimmed.match(/^export\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    const plainMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    const match = exportMatch || plainMatch
    if (!match) continue
    const key = match[1]
    let value = match[2] ?? ""
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

export function resolveGeminiApiKey() {
  if (hasValue(process.env.GEMINI_API_KEY)) {
    return { key: process.env.GEMINI_API_KEY.trim(), source: "process.env.GEMINI_API_KEY" }
  }
  if (hasValue(process.env.LIVE_GEMINI_API_KEY)) {
    return {
      key: process.env.LIVE_GEMINI_API_KEY.trim(),
      source: "process.env.LIVE_GEMINI_API_KEY",
    }
  }
  const envVars = readEnvFileVariables(resolve(process.cwd(), ".env"))
  if (hasValue(envVars.GEMINI_API_KEY)) {
    return { key: envVars.GEMINI_API_KEY.trim(), source: ".env:GEMINI_API_KEY" }
  }
  if (hasValue(envVars.LIVE_GEMINI_API_KEY)) {
    return { key: envVars.LIVE_GEMINI_API_KEY.trim(), source: ".env:LIVE_GEMINI_API_KEY" }
  }
  return { key: "", source: "missing" }
}

function isUiFile(filePath) {
  return /\.(css|scss|sass|less|ts|tsx|js|jsx|html)$/i.test(filePath)
}

function isTestLikeFile(filePath) {
  return /\.(test|spec)\.[cm]?[jt]sx?$/i.test(filePath)
}

export function discoverUiFiles(scanPaths = DEFAULT_UI_SCAN_PATHS) {
  const selected = []
  for (const input of scanPaths) {
    const absPath = resolve(process.cwd(), input)
    if (!existsSync(absPath)) continue
    const info = statSync(absPath)
    if (info.isFile()) {
      if (isUiFile(absPath) && !isTestLikeFile(absPath)) {
        selected.push(relative(process.cwd(), absPath).replaceAll("\\", "/"))
      }
      continue
    }
    const stack = [absPath]
    while (stack.length > 0) {
      const current = stack.pop()
      if (!current) continue
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const nextPath = resolve(current, entry.name)
        if (entry.isDirectory()) {
          stack.push(nextPath)
          continue
        }
        if (!entry.isFile()) continue
        if (!isUiFile(nextPath) || isTestLikeFile(nextPath)) continue
        selected.push(relative(process.cwd(), nextPath).replaceAll("\\", "/"))
      }
    }
  }
  return Array.from(new Set(selected)).sort()
}

function buildFoundationIssue(file, severity, category, message, suggestion) {
  return { file, line: 1, severity, category, message, suggestion }
}

export function evaluateUiFoundation({
  cwd = process.cwd(),
  uiFiles = [],
} = {}) {
  const checks = []
  const issues = []
  const componentConfigPath = resolve(cwd, FOUNDATION_COMPONENTS_CONFIG)

  if (!existsSync(componentConfigPath)) {
    checks.push({
      id: "components_config_exists",
      status: "failed",
      detail: `${FOUNDATION_COMPONENTS_CONFIG} is missing`,
    })
    issues.push(
      buildFoundationIssue(
        FOUNDATION_COMPONENTS_CONFIG,
        "error",
        "maintainability",
        "shadcn components config is missing in frontend",
        "Restore apps/web/components.json and keep it aligned with @uiq/ui source of truth."
      )
    )
  } else {
    let parsed = null
    try {
      parsed = JSON.parse(readFileSync(componentConfigPath, "utf8"))
    } catch {
      parsed = null
    }
    if (!parsed) {
      checks.push({
        id: "components_config_json",
        status: "failed",
        detail: `${FOUNDATION_COMPONENTS_CONFIG} is not valid JSON`,
      })
      issues.push(
        buildFoundationIssue(
          FOUNDATION_COMPONENTS_CONFIG,
          "error",
          "maintainability",
          "shadcn components config is invalid JSON",
          "Fix apps/web/components.json JSON format and keep shadcn schema-compliant fields."
        )
      )
    } else {
      const styleOk = parsed.style === "new-york"
      const cssVariablesOk = parsed?.tailwind?.cssVariables === true
      const aliasesUi = String(parsed?.aliases?.ui || "")
      const aliasesComponents = String(parsed?.aliases?.components || "")
      const aliasOk =
        aliasesUi.includes("packages/ui/src") && aliasesComponents.includes("packages/ui/src")
      checks.push({
        id: "components_config_contract",
        status: styleOk && cssVariablesOk && aliasOk ? "passed" : "failed",
        detail: `style=${String(parsed.style || "")}, cssVariables=${String(parsed?.tailwind?.cssVariables)}, aliases.ui=${aliasesUi}`,
      })
      if (!styleOk) {
        issues.push(
          buildFoundationIssue(
            FOUNDATION_COMPONENTS_CONFIG,
            "error",
            "token",
            "components.json style must stay on new-york to match shadcn baseline",
            'Set apps/web/components.json style to "new-york".'
          )
        )
      }
      if (!cssVariablesOk) {
        issues.push(
          buildFoundationIssue(
            FOUNDATION_COMPONENTS_CONFIG,
            "error",
            "token",
            "components.json requires cssVariables=true for tokenized theming",
            "Enable tailwind.cssVariables in apps/web/components.json."
          )
        )
      }
      if (!aliasOk) {
        issues.push(
          buildFoundationIssue(
            FOUNDATION_COMPONENTS_CONFIG,
            "error",
            "maintainability",
            "components.json aliases are detached from @uiq/ui source package",
            "Point aliases.ui/components to packages/ui/src so consumers stay on one design system."
          )
        )
      }
    }
  }

  for (const stylePath of FOUNDATION_STYLE_FILES) {
    const absStylePath = resolve(cwd, stylePath)
    if (!existsSync(absStylePath)) {
      checks.push({
        id: `style_exists:${stylePath}`,
        status: "failed",
        detail: "missing style file",
      })
      issues.push(
        buildFoundationIssue(
          stylePath,
          "error",
          "token",
          "UI style foundation file is missing",
          "Restore the style entry file and keep design tokens centralized."
        )
      )
      continue
    }
    const text = readFileSync(absStylePath, "utf8")
    const missingTokens = FOUNDATION_REQUIRED_TOKENS.filter((token) => !text.includes(token))
    const hasReducedMotion = /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(text)
    checks.push({
      id: `style_token_contract:${stylePath}`,
      status: missingTokens.length === 0 ? "passed" : "failed",
      detail:
        missingTokens.length === 0
          ? "all required tokens present"
          : `missing tokens: ${missingTokens.join(", ")}`,
    })
    checks.push({
      id: `style_reduced_motion:${stylePath}`,
      status: hasReducedMotion ? "passed" : "failed",
      detail: hasReducedMotion
        ? "reduced-motion media query present"
        : "missing reduced-motion media query",
    })
    if (missingTokens.length > 0) {
      issues.push(
        buildFoundationIssue(
          stylePath,
          "error",
          "token",
          "design token contract is incomplete",
          `Define missing tokens in ${stylePath}: ${missingTokens.join(", ")}.`
        )
      )
    }
    if (!hasReducedMotion) {
      issues.push(
        buildFoundationIssue(
          stylePath,
          "error",
          "a11y",
          "reduced-motion fallback is missing",
          `Add @media (prefers-reduced-motion: reduce) guard in ${stylePath}.`
        )
      )
    }
  }

  const sourceFiles = (uiFiles.length > 0 ? uiFiles : discoverUiFiles()).filter((file) =>
    /\.(?:[cm]?[jt]sx?)$/i.test(file)
  )
  const frontendUiImportFiles = new Set()
  const appsWebUiImportFiles = new Set()
  for (const file of sourceFiles) {
    const absPath = resolve(cwd, file)
    if (!existsSync(absPath)) continue
    const text = readFileSync(absPath, "utf8")
    if (!/from\s+["']@uiq\/ui["']/.test(text)) continue
    if (file.startsWith("apps/web/")) frontendUiImportFiles.add(file)
    if (file.startsWith("apps/web/")) appsWebUiImportFiles.add(file)
  }

  const frontendImportOk = frontendUiImportFiles.size >= 5
  const appsWebImportOk = appsWebUiImportFiles.size >= 3
  checks.push({
    id: "ui_import_coverage",
    status: frontendImportOk && appsWebImportOk ? "passed" : "warning",
    detail: `frontend=@uiq/ui imports in ${frontendUiImportFiles.size} file(s), apps/web in ${appsWebUiImportFiles.size} file(s)`,
  })
  if (!frontendImportOk || !appsWebImportOk) {
    issues.push(
      buildFoundationIssue(
        "apps/web/src",
        "warning",
        "maintainability",
        "UI composition has low @uiq/ui primitive adoption",
        "Favor @uiq/ui primitives in feature components to keep one shadcn-aligned design system."
      )
    )
  }

  const passed = !issues.some((issue) => issue.severity === "error")
  const summary = passed
    ? `UI foundation checks passed (${checks.filter((item) => item.status === "passed").length}/${checks.length}).`
    : `UI foundation checks found ${issues.filter((item) => item.severity === "error").length} blocking issue(s).`

  return {
    passed,
    summary,
    checks,
    issues,
    evidence: {
      frontendUiImportFiles: Array.from(frontendUiImportFiles).sort(),
      appsWebUiImportFiles: Array.from(appsWebUiImportFiles).sort(),
    },
  }
}

export function buildInputChunks(files, maxFiles, maxCharsPerFile) {
  const selectionLimit = maxFiles > 0 ? maxFiles : files.length
  const selected = files.slice(0, selectionLimit)
  const chunks = []
  const skipped = []
  const truncated = []
  for (const file of selected) {
    const absPath = resolve(process.cwd(), file)
    if (!existsSync(absPath)) continue
    let payload = ""
    try {
      payload = execFileSync("git", ["diff", "--cached", "--unified=3", "--", file], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
    } catch {
      payload = ""
    }
    if (!payload.trim()) {
      payload = readFileSync(absPath, "utf8")
    }
    if (payload.length > maxCharsPerFile) {
      truncated.push({
        file,
        reason: "max_file_chars",
        original_chars: payload.length,
        retained_chars: maxCharsPerFile,
      })
    }
    const sliced = payload.slice(0, maxCharsPerFile)
    chunks.push(`### FILE: ${file}\n\`\`\`\n${sliced}\n\`\`\``)
  }
  for (const file of files.slice(selected.length)) {
    skipped.push({ file, reason: "selection_limit" })
  }
  return { selected, chunks, skipped, truncated }
}

export function classifyStrictFailure(options, code) {
  if (options.strict) {
    return {
      status: "failed",
      reasonCode: `gate.uiux.gemini.failed.${code}`,
    }
  }
  return {
    status: "blocked",
    reasonCode: `gate.uiux.gemini.blocked.${code}`,
  }
}

export function validateAuditPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: "invalid_response" }
  }
  if (typeof payload.passed !== "boolean") {
    return { ok: false, reason: "schema_mismatch" }
  }
  if (typeof payload.summary !== "string") {
    return { ok: false, reason: "schema_mismatch" }
  }
  if (!Array.isArray(payload.issues)) {
    return { ok: false, reason: "schema_mismatch" }
  }
  for (const issue of payload.issues) {
    if (!issue || typeof issue !== "object") {
      return { ok: false, reason: "schema_mismatch" }
    }
    if (typeof issue.file !== "string") return { ok: false, reason: "schema_mismatch" }
    if (typeof issue.line !== "number") return { ok: false, reason: "schema_mismatch" }
    if (!["error", "warning"].includes(String(issue.severity))) {
      return { ok: false, reason: "schema_mismatch" }
    }
  }
  return { ok: true }
}

export function extractJsonObject(rawText) {
  const text = String(rawText || "").trim()
  if (!text) return null
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) return null
  const candidate = text.slice(start, end + 1)
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

export function normalizeModel(rawModel) {
  return String(rawModel || "")
    .trim()
    .replace(/^models\//, "")
}

async function callGemini({ endpoint, model, apiKey, prompt, timeoutMs }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()
  try {
    const url = `${endpoint.replace(/\/$/, "")}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          topP: 0.8,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            required: ["passed", "summary", "issues"],
            properties: {
              passed: { type: "boolean" },
              summary: { type: "string", maxLength: 180 },
              issues: {
                type: "array",
                maxItems: 3,
                items: {
                  type: "object",
                  required: ["file", "line", "severity", "category", "message", "suggestion"],
                  properties: {
                    file: { type: "string", maxLength: 160 },
                    line: { type: "number" },
                    severity: { type: "string", enum: ["error", "warning"] },
                    category: {
                      type: "string",
                      enum: ["a11y", "token", "layout", "ux", "maintainability"],
                    },
                    message: { type: "string", maxLength: 140 },
                    suggestion: { type: "string", maxLength: 140 },
                  },
                },
              },
            },
          },
        },
      }),
      signal: controller.signal,
    })
    const rawText = await response.text()
    let json = null
    try {
      json = rawText ? JSON.parse(rawText) : null
    } catch {
      json = null
    }
    return {
      ok: response.ok,
      httpStatus: response.status,
      durationMs: Date.now() - startedAt,
      rawText,
      json,
    }
  } finally {
    clearTimeout(timer)
  }
}

function buildModelCandidates(primaryModel) {
  const requested = normalizeModel(primaryModel || DEFAULT_MODEL)
  const candidates = [requested]
  if (requested === "gemini-3.0-flash") {
    candidates.push("gemini-3-flash-preview")
  }
  return [...new Set(candidates)]
}

export async function callGeminiWithFallback({ endpoint, model, apiKey, prompt, timeoutMs }) {
  const candidates = buildModelCandidates(model)
  const attempts = []
  for (const candidate of candidates) {
    const result = await callGemini({
      endpoint,
      model: candidate,
      apiKey,
      prompt,
      timeoutMs,
    })
    attempts.push({ model: candidate, httpStatus: result.httpStatus, ok: result.ok })
    if (result.ok || result.httpStatus !== 404) {
      return { ...result, resolvedModel: candidate, attempts }
    }
  }
  const last = attempts.at(-1)
  return {
    ok: false,
    httpStatus: last?.httpStatus ?? null,
    durationMs: null,
    rawText: "",
    json: null,
    resolvedModel: candidates.at(-1) || model,
    attempts,
  }
}

export function writeArtifacts(report, outDir = OUTPUT_DIR) {
  const resolvedOutDir = resolve(process.cwd(), outDir)
  mkdirSync(resolvedOutDir, { recursive: true })
  const jsonPath = resolve(resolvedOutDir, `${ARTIFACT_BASENAME}.json`)
  const mdPath = resolve(resolvedOutDir, `${ARTIFACT_BASENAME}.md`)
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  const markdown = [
    "# Gemini UI/UX Audit",
    "",
    `- status: ${report.status}`,
    `- reasonCode: ${report.reasonCode}`,
    `- model: ${report.model || "n/a"}`,
    `- apiKeySource: ${report.apiKeySource || "missing"}`,
    `- discoveredFiles: ${report.coverage?.discovered_files ?? 0}`,
    `- analyzedFiles: ${report.coverage?.analyzed_files ?? 0}`,
    `- skippedFiles: ${report.coverage?.skipped_files ?? 0}`,
    `- foundationStatus: ${report.foundation?.passed === false ? "failed" : "passed"}`,
    `- foundationIssues: ${Array.isArray(report.foundation?.issues) ? report.foundation.issues.length : 0}`,
    `- httpStatus: ${report.httpStatus ?? "n/a"}`,
    `- durationMs: ${report.durationMs ?? "n/a"}`,
    "",
    "## Summary",
    "",
    report.message || "n/a",
    "",
    "## Skipped",
    "",
    ...(Array.isArray(report.coverage?.skipped_reasons) && report.coverage.skipped_reasons.length > 0
      ? report.coverage.skipped_reasons.map((item) => `- ${item.file}: ${item.reason}`)
      : ["- none"]),
    "",
    "## Issues",
    "",
    ...(Array.isArray(report.issues) && report.issues.length > 0
      ? report.issues.map((issue) => {
          const location = `${issue.file || "unknown"}:${issue.line || 0}`
          return `- ${location} [${issue.severity || "warning"}] ${issue.message || "issue"}`
        })
      : ["- none"]),
  ].join("\n")
  writeFileSync(mdPath, `${markdown}\n`, "utf8")
  return { jsonPath, mdPath }
}
