#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { setDefaultResultOrder } from "node:dns"

const CHECK_ID = "gemini_live_smoke"
const DEFAULT_OUT_DIR = ".runtime-cache/artifacts/ci"
const DEFAULT_ENDPOINT = "https://generativelanguage.googleapis.com"
const DEFAULT_TIMEOUT_MS = 15000
const DEFAULT_BROWSER_TIMEOUT_MS = 20000
const DEFAULT_RETRIES = 1
const MAX_RETRIES = 2

setDefaultResultOrder("ipv4first")

function parseBoolean(raw, key) {
  if (raw === "true") return true
  if (raw === "false") return false
  throw new Error(`invalid ${key}, expected true|false`)
}

function parseArgs(argv) {
  const envRequired = process.env.UIQ_GEMINI_LIVE_SMOKE_REQUIRED
  const requiredDefault =
    envRequired === undefined ? process.env.CI === "true" : envRequired === "true"
  const options = {
    strict: false,
    required: requiredDefault,
    outDir: DEFAULT_OUT_DIR,
    endpoint: process.env.UIQ_GEMINI_LIVE_SMOKE_ENDPOINT || DEFAULT_ENDPOINT,
    model: process.env.UIQ_GEMINI_LIVE_SMOKE_MODEL || "gemini-3-flash-preview",
    prompt: process.env.UIQ_GEMINI_LIVE_SMOKE_PROMPT || "Return exactly: OK",
    timeoutMs: Number(process.env.UIQ_GEMINI_LIVE_SMOKE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    retries: Number(process.env.UIQ_GEMINI_LIVE_SMOKE_RETRIES || DEFAULT_RETRIES),
    browserTimeoutMs: Number(
      process.env.UIQ_GEMINI_LIVE_BROWSER_TIMEOUT_MS || DEFAULT_BROWSER_TIMEOUT_MS
    ),
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    const next = argv[i + 1]
    if (token === "--strict" && next) options.strict = parseBoolean(next, "--strict")
    if (token === "--required" && next) options.required = parseBoolean(next, "--required")
    if (token === "--out-dir" && next) options.outDir = next
    if (token === "--endpoint" && next) options.endpoint = next
    if (token === "--model" && next) options.model = next
    if (token === "--prompt" && next) options.prompt = next
    if (token === "--timeout-ms" && next) options.timeoutMs = Number(next)
    if (token === "--retries" && next) options.retries = Number(next)
    if (token === "--browser-timeout-ms" && next) options.browserTimeoutMs = Number(next)
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1) {
    throw new Error("invalid --timeout-ms, expected integer >= 1")
  }
  if (!Number.isFinite(options.browserTimeoutMs) || options.browserTimeoutMs < 1) {
    throw new Error("invalid --browser-timeout-ms, expected integer >= 1")
  }
  if (!Number.isFinite(options.retries) || options.retries < 0) {
    throw new Error("invalid --retries, expected integer >= 0")
  }
  options.retries = Math.min(Math.trunc(options.retries), MAX_RETRIES)
  return options
}

function buildReasonCode(status, reason) {
  return `gate.${CHECK_ID}.${status}.${reason}`
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0
}

function readEnvFileVariables(envFilePath) {
  if (!existsSync(envFilePath)) return {}
  const variables = {}
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
    variables[key] = value
  }
  return variables
}

function resolveGeminiApiKey() {
  if (hasValue(process.env.GEMINI_API_KEY)) {
    return { key: process.env.GEMINI_API_KEY.trim(), source: "process.env.GEMINI_API_KEY" }
  }
  if (hasValue(process.env.LIVE_GEMINI_API_KEY)) {
    return {
      key: process.env.LIVE_GEMINI_API_KEY.trim(),
      source: "process.env.LIVE_GEMINI_API_KEY",
    }
  }

  const envPath = resolve(process.cwd(), ".env")
  const envVars = readEnvFileVariables(envPath)
  if (hasValue(envVars.GEMINI_API_KEY)) {
    return { key: envVars.GEMINI_API_KEY.trim(), source: ".env:GEMINI_API_KEY" }
  }
  if (hasValue(envVars.LIVE_GEMINI_API_KEY)) {
    return { key: envVars.LIVE_GEMINI_API_KEY.trim(), source: ".env:LIVE_GEMINI_API_KEY" }
  }

  return { key: "", source: "missing" }
}

function normalizeModel(rawModel) {
  return String(rawModel || "")
    .trim()
    .replace(/^models\//, "")
}

function normalizeBaseUrl(rawUrl) {
  const value = String(rawUrl || "").trim()
  if (!value) return ""
  try {
    return new URL(value).toString()
  } catch {
    return ""
  }
}

function extractText(responseJson) {
  const candidates = Array.isArray(responseJson?.candidates) ? responseJson.candidates : []
  const texts = []
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []
    for (const part of parts) {
      if (typeof part?.text === "string" && part.text.trim()) {
        texts.push(part.text.trim())
      }
    }
  }
  return texts.join("\n").trim()
}

function truncate(value, max = 300) {
  const text = String(value || "")
  if (text.length <= max) return text
  return `${text.slice(0, max)}...`
}

function createTeardownEvidence() {
  return {
    summary: "not_executed",
    attempted: 0,
    succeeded: 0,
    failed: 0,
    steps: [],
  }
}

function recordTeardownStep(teardown, { step, status, detail = "" }) {
  teardown.attempted += 1
  if (status === "succeeded") teardown.succeeded += 1
  if (status === "failed") teardown.failed += 1
  teardown.steps.push({
    step,
    status,
    detail: truncate(detail || "", 180),
  })
}

function finalizeTeardownEvidence(teardown) {
  if (teardown.attempted === 0) {
    teardown.summary = "not_executed"
  } else if (teardown.failed === 0) {
    teardown.summary = "all_succeeded"
  } else if (teardown.succeeded === 0) {
    teardown.summary = "all_failed"
  } else {
    teardown.summary = "partial_failed"
  }
  return teardown
}

function writeArtifacts(outDir, report) {
  mkdirSync(outDir, { recursive: true })
  const jsonPath = resolve(outDir, "uiq-gemini-live-smoke-gate.json")
  const mdPath = resolve(outDir, "uiq-gemini-live-smoke-gate.md")

  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  const markdown = [
    "# Gemini Live Smoke Gate",
    "",
    `- status: ${report.status}`,
    `- reasonCode: ${report.reasonCode}`,
    `- required: ${report.required}`,
    `- strict: ${report.strict}`,
    `- model: ${report.request.model || "n/a"}`,
    `- endpoint: ${report.request.endpoint || "n/a"}`,
    `- durationMs: ${report.result.durationMs ?? "n/a"}`,
    `- responseTextLength: ${report.result.responseTextLength ?? "n/a"}`,
    `- httpStatus: ${report.result.httpStatus ?? "n/a"}`,
    `- attemptCount: ${report.result.attemptCount ?? "n/a"}`,
    `- retryUsed: ${report.result.retryUsed}`,
    `- failureReason: ${report.result.failureReason || "n/a"}`,
    `- browserChecked: ${report.result.browserChecked}`,
    `- browserStatus: ${report.result.browserStatus}`,
    `- browserFinalUrl: ${report.result.browserFinalUrl || "n/a"}`,
    `- browserTitlePreview: ${report.result.browserTitlePreview || "n/a"}`,
    `- teardownSummary: ${report.result.teardown.summary}`,
    `- teardownAttempted: ${report.result.teardown.attempted}`,
    `- teardownSucceeded: ${report.result.teardown.succeeded}`,
    `- teardownFailed: ${report.result.teardown.failed}`,
    "",
    "## Teardown Steps",
    "",
    ...(report.result.teardown.steps.length > 0
      ? report.result.teardown.steps.map(
          (step) => `- ${step.step}: ${step.status}${step.detail ? ` (${step.detail})` : ""}`
        )
      : ["- none"]),
    "",
    "## Notes",
    "",
    `- ${report.message}`,
  ].join("\n")
  writeFileSync(mdPath, `${markdown}\n`, "utf8")

  return { jsonPath, mdPath }
}

function resolveWithFallbacks(variableName, envVars) {
  if (hasValue(process.env[variableName])) {
    return {
      value: process.env[variableName].trim(),
      source: `process.env.${variableName}`,
    }
  }
  if (hasValue(envVars[variableName])) {
    return {
      value: envVars[variableName].trim(),
      source: `.env:${variableName}`,
    }
  }

  return { value: "", source: "missing" }
}

function resolveBaseUrl(envVars) {
  const resolved = resolveWithFallbacks("UIQ_BASE_URL", envVars)
  if (resolved.value) {
    return resolved
  }
  const port = process.env.UIQ_FRONTEND_E2E_PORT || process.env.UIQ_WEB_PORT || "43173"
  return {
    value: `http://127.0.0.1:${port}`,
    source: "default.local_frontend_runtime",
  }
}

async function verifyBrowserInteraction({ baseUrl, timeoutMs, teardown }) {
  const playwright = await import("playwright")
  const browser = await playwright.chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true })
    const page = await context.newPage()
    try {
      const response = await page.goto(baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      })
      await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs })
      const title = (await page.title()).trim()
      const finalUrl = page.url()
      const statusCode = response?.status?.() ?? null
      return {
        ok: true,
        finalUrl,
        title,
        statusCode,
        transport: "page",
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/ERR_ADDRESS_INVALID|EADDRNOTAVAIL/i.test(message)) {
        throw error
      }
      const requestContext = await playwright.request.newContext({ ignoreHTTPSErrors: true })
      try {
        const response = await requestContext.get(baseUrl, { timeout: timeoutMs })
        return {
          ok: true,
          finalUrl: baseUrl,
          title: "request-context-fallback",
          statusCode: response.status(),
          transport: "request-context",
        }
      } finally {
        await requestContext.dispose()
      }
    }
  } finally {
    try {
      await browser.close()
      recordTeardownStep(teardown, {
        step: "playwright.chromium.close",
        status: "succeeded",
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      recordTeardownStep(teardown, {
        step: "playwright.chromium.close",
        status: "failed",
        detail: message,
      })
      throw error
    }
  }
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
        generationConfig: { temperature: 0, maxOutputTokens: 16 },
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
      rawText,
      json,
      durationMs: Date.now() - startedAt,
    }
  } finally {
    clearTimeout(timer)
  }
}

function classifyRequestFailure(error) {
  const message = error instanceof Error ? error.message : String(error || "")
  if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
    return { reason: "request_timeout", retryable: true, message }
  }
  if (
    /timed?\s*out|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|fetch failed/i.test(message)
  ) {
    return { reason: "request_network_error", retryable: true, message }
  }
  return { reason: "request_exception", retryable: false, message }
}

function isRetryableHttpStatus(status) {
  return status === 429 || (status >= 500 && status <= 599)
}

async function callGeminiWithRetries(
  { endpoint, model, apiKey, prompt, timeoutMs, retries },
  callGeminiImpl = callGemini
) {
  const maxAttempts = retries + 1
  const attempts = []
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const callResult = await callGeminiImpl({ endpoint, model, apiKey, prompt, timeoutMs })
      attempts.push({ attempt, ok: callResult.ok, httpStatus: callResult.httpStatus })
      if (callResult.ok) {
        return { ok: true, callResult, attemptCount: attempt, attempts }
      }
      if (!isRetryableHttpStatus(callResult.httpStatus) || attempt === maxAttempts) {
        return {
          ok: false,
          callResult,
          attemptCount: attempt,
          attempts,
          failureReason: "request_http_error",
        }
      }
    } catch (error) {
      const classified = classifyRequestFailure(error)
      attempts.push({ attempt, ok: false, errorReason: classified.reason })
      if (!classified.retryable || attempt === maxAttempts) {
        return {
          ok: false,
          error,
          attemptCount: attempt,
          attempts,
          failureReason: classified.reason,
        }
      }
    }
  }
  return { ok: false, attemptCount: maxAttempts, attempts, failureReason: "request_exception" }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const model = normalizeModel(options.model)
  const envPath = resolve(process.cwd(), ".env")
  const envVars = readEnvFileVariables(envPath)
  const apiKeyResolved = resolveGeminiApiKey()
  const apiKey = apiKeyResolved.key
  const baseUrlResolved = resolveBaseUrl(envVars)
  const browserBaseUrl = normalizeBaseUrl(baseUrlResolved.value)
  const shouldRunBrowserCheck = options.required || hasValue(browserBaseUrl)

  const report = {
    checkId: CHECK_ID,
    status: "blocked",
    reasonCode: buildReasonCode("blocked", "not_required"),
    strict: options.strict,
    required: options.required,
    message: "live smoke is not required; request skipped",
    request: {
      endpoint: options.endpoint,
      model,
      timeoutMs: options.timeoutMs,
      retries: options.retries,
      browserTimeoutMs: options.browserTimeoutMs,
      apiKeySource: apiKeyResolved.source,
      browserBaseUrl,
      browserBaseUrlSource: baseUrlResolved.source,
    },
    result: {
      httpStatus: null,
      durationMs: null,
      responseTextLength: null,
      responsePreview: "",
      hasCandidate: false,
      attemptCount: 0,
      retryUsed: false,
      attempts: [],
      failureReason: "",
      browserChecked: shouldRunBrowserCheck,
      browserStatus: "skipped",
      browserFinalUrl: "",
      browserTitlePreview: "",
      browserHttpStatus: null,
      teardown: createTeardownEvidence(),
    },
    timestamp: new Date().toISOString(),
  }

  if (options.required) {
    if (!browserBaseUrl) {
      report.status = "failed"
      report.reasonCode = buildReasonCode("failed", "missing_browser_base_url")
      report.message = "UIQ_GEMINI_LIVE_SMOKE_REQUIRED=true requires a reachable WebUI runtime URL"
      report.result.browserStatus = "failed"
    } else {
      try {
        const browserResult = await verifyBrowserInteraction({
          baseUrl: browserBaseUrl,
          timeoutMs: options.browserTimeoutMs,
          teardown: report.result.teardown,
        })
        report.result.browserStatus = browserResult.ok ? "passed" : "failed"
        report.result.browserFinalUrl = browserResult.finalUrl
        report.result.browserTitlePreview = truncate(browserResult.title, 120)
        report.result.browserHttpStatus = browserResult.statusCode
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        report.status = "failed"
        report.reasonCode = buildReasonCode("failed", "browser_interaction_failed")
        report.message = `browser interaction failed for ${browserBaseUrl}: ${message}`
        report.result.browserStatus = "failed"
      }
    }

    if (!apiKey) {
      report.status = "failed"
      report.reasonCode = buildReasonCode("failed", "missing_api_key")
      report.message = "UIQ_GEMINI_LIVE_SMOKE_REQUIRED=true but GEMINI_API_KEY is missing"
    } else if (!model) {
      report.status = "failed"
      report.reasonCode = buildReasonCode("failed", "missing_model")
      report.message = "live smoke model is empty"
    } else {
      try {
        const callOutcome = await callGeminiWithRetries({
          endpoint: options.endpoint,
          model,
          apiKey,
          prompt: options.prompt,
          timeoutMs: options.timeoutMs,
          retries: options.retries,
        })

        report.result.attemptCount = callOutcome.attemptCount
        report.result.retryUsed = callOutcome.attemptCount > 1
        report.result.attempts = Array.isArray(callOutcome.attempts) ? callOutcome.attempts : []
        report.result.failureReason = callOutcome.failureReason || ""

        if (!callOutcome.ok && callOutcome.callResult) {
          report.result.httpStatus = callOutcome.callResult.httpStatus
          report.result.durationMs = callOutcome.callResult.durationMs
          report.status = "failed"
          report.reasonCode = buildReasonCode("failed", "request_http_error")
          report.message = `gemini request failed with http ${callOutcome.callResult.httpStatus} after ${callOutcome.attemptCount} attempt(s)`
        } else if (!callOutcome.ok && callOutcome.error) {
          const failureReason = callOutcome.failureReason || "request_exception"
          const errorMessage =
            callOutcome.error instanceof Error
              ? callOutcome.error.message
              : String(callOutcome.error)
          report.status = "failed"
          report.reasonCode = buildReasonCode("failed", failureReason)
          report.message = `gemini request failed (${failureReason}) after ${callOutcome.attemptCount} attempt(s): ${errorMessage}`
        } else if (!callOutcome.ok) {
          report.status = "failed"
          report.reasonCode = buildReasonCode(
            "failed",
            callOutcome.failureReason || "request_exception"
          )
          report.message = `gemini request failed after ${callOutcome.attemptCount} attempt(s)`
        } else {
          const responseText = extractText(callOutcome.callResult.json)
          const hasCandidate =
            Array.isArray(callOutcome.callResult.json?.candidates) &&
            callOutcome.callResult.json.candidates.length > 0
          report.result.httpStatus = callOutcome.callResult.httpStatus
          report.result.durationMs = callOutcome.callResult.durationMs
          report.result.responseTextLength = responseText.length
          report.result.responsePreview = truncate(responseText || callOutcome.callResult.rawText)
          report.result.hasCandidate = hasCandidate

          if (!responseText && !hasCandidate) {
            report.status = "failed"
            report.reasonCode = buildReasonCode("failed", "empty_response")
            report.message = "gemini response is empty"
          } else if (report.status === "failed") {
            report.message = `${report.message}; gemini API returned response but required browser gate already failed`
          } else if (report.result.browserStatus !== "passed") {
            report.status = "failed"
            report.reasonCode = buildReasonCode("failed", "browser_required_failed")
            report.message =
              "gemini live smoke API passed but required WebUI browser interaction did not pass"
          } else {
            report.status = "passed"
            report.reasonCode = buildReasonCode("passed", "response_received_with_browser_runtime")
            report.message = "gemini live smoke passed with required WebUI browser runtime interaction"
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        report.status = "failed"
        report.reasonCode = buildReasonCode("failed", "request_exception")
        report.message = `gemini request exception: ${message}`
      }
    }
  }

  report.result.teardown = finalizeTeardownEvidence(report.result.teardown)
  const artifacts = writeArtifacts(options.outDir, report)
  process.stdout.write(
    `${JSON.stringify(
      {
        checkId: CHECK_ID,
        status: report.status,
        reasonCode: report.reasonCode,
        required: report.required,
        strict: report.strict,
        artifacts,
      },
      null,
      2
    )}\n`
  )

  if (options.strict && report.status === "failed") {
    process.exit(1)
  }
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  process.argv[1].length > 0 &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[uiq-gemini-live-smoke-gate] ${message}\n`)
    process.exit(1)
  })
}

export { MAX_RETRIES, callGeminiWithRetries, classifyRequestFailure, parseArgs }
