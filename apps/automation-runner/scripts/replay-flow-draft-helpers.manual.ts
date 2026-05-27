import { spawnSync } from "node:child_process"
import path from "node:path"

import type { Frame, Page } from "playwright"

import { AUTOMATION_ENV } from "./lib/env.js"
import type { FlowStep, StripeFieldKey, SelectorAttempt } from "./lib/replay-flow-types.js"
import { REPO_ROOT } from "./lib/replay-flow-types.js"

type OtpFetchAttempt = { code: string } | { code: null; transient: boolean; reason: string }
type StructuredRef = { scope: "params" | "secrets"; key: string }

function readLegacyFlowInput(): string {
  const raw = AUTOMATION_ENV.FLOW_INPUT ?? ""
  const trimmed = raw.trim()
  if (!trimmed) {
    return ""
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return ""
  }
  return raw
}

function parseParamsPayload(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {}
    }
    const params: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") {
        params[key] = value
      } else if (value == null) {
        params[key] = ""
      } else {
        params[key] = String(value)
      }
    }
    return params
  } catch {
    return {}
  }
}

function readParamsFromEnv(): Record<string, string> {
  const preferred = (AUTOMATION_ENV.FLOW_PARAMS_JSON ?? "").trim()
  if (preferred) {
    return parseParamsPayload(preferred)
  }
  const fallback = (AUTOMATION_ENV.FLOW_INPUT ?? "").trim()
  if (fallback.startsWith("{") && fallback.endsWith("}")) {
    return parseParamsPayload(fallback)
  }
  return {}
}

function parseStructuredRef(valueRef: string): StructuredRef | null {
  const matched = valueRef.trim().match(/^\$\{(params|secrets)\.([A-Za-z0-9_.-]+)\}$/)
  if (!matched) {
    return null
  }
  const scope = matched[1]
  const key = matched[2]
  if ((scope !== "params" && scope !== "secrets") || !key) {
    return null
  }
  return { scope, key }
}

function resolveRequiredSecretInput(): string {
  const secret = (AUTOMATION_ENV.FLOW_SECRET_INPUT ?? AUTOMATION_ENV.REGISTER_PASSWORD ?? "").trim()
  if (!secret) {
    throw new Error("missing secret input: set FLOW_SECRET_INPUT or REGISTER_PASSWORD")
  }
  return secret
}

function firstNonEmptyEnv(keys: string[]): string {
  for (const key of keys) {
    const value = (process.env[key] ?? "").trim()
    if (value) return value
  }
  return ""
}

function parseEnvJsonMap(envKey: string): Record<string, string> {
  const raw = (process.env[envKey] ?? "").trim()
  if (!raw) {
    return {}
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {}
    }
    const normalized: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        normalized[key] = value
      }
    }
    return normalized
  } catch {
    return {}
  }
}

function extractParamKey(valueRef: string): string | null {
  const match = valueRef.match(/^\$\{(?:params|secrets)\.([^}]+)\}$/)
  if (!match) return null
  const key = match[1]?.trim()
  return key ? key : null
}

export function detectStripeField(step: FlowStep): StripeFieldKey | null {
  const valueRef = (step.value_ref ?? "").toLowerCase()
  const selectors = (step.target?.selectors ?? []).map((item) => item.value.toLowerCase()).join(" ")
  const text = `${valueRef} ${selectors}`
  if (/(card.?number|cc-number|pan)/.test(text)) return "card_number"
  if (/(exp.?month|cc-exp-month)/.test(text)) return "exp_month"
  if (/(exp.?year|cc-exp-year)/.test(text)) return "exp_year"
  if (/(exp|expiry|expiration|cc-exp)/.test(text)) return "exp"
  if (/(cvc|cvv|security.?code|cc-csc)/.test(text)) return "cvc"
  if (/(postal|zip|post.?code|postal.?code)/.test(text)) return "postal_code"
  if (/(cardholder|name.?on.?card|cc-name)/.test(text)) return "name"
  return null
}

function resolveStripeValue(field: StripeFieldKey): string {
  if (field === "card_number") {
    const value = firstNonEmptyEnv([
      "FLOW_STRIPE_CARD_NUMBER",
      "STRIPE_CARD_NUMBER",
      "FLOW_CARD_NUMBER",
    ])
    if (!value) throw new Error("missing Stripe env: FLOW_STRIPE_CARD_NUMBER")
    return value
  }
  if (field === "exp_month") {
    const value = firstNonEmptyEnv(["FLOW_STRIPE_EXP_MONTH", "STRIPE_EXP_MONTH"])
    if (!value) throw new Error("missing Stripe env: FLOW_STRIPE_EXP_MONTH")
    return value
  }
  if (field === "exp_year") {
    const value = firstNonEmptyEnv(["FLOW_STRIPE_EXP_YEAR", "STRIPE_EXP_YEAR"])
    if (!value) throw new Error("missing Stripe env: FLOW_STRIPE_EXP_YEAR")
    return value
  }
  if (field === "exp") {
    const direct = firstNonEmptyEnv(["FLOW_STRIPE_EXP", "STRIPE_EXP"])
    if (direct) return direct
    const month = firstNonEmptyEnv(["FLOW_STRIPE_EXP_MONTH", "STRIPE_EXP_MONTH"])
    const year = firstNonEmptyEnv(["FLOW_STRIPE_EXP_YEAR", "STRIPE_EXP_YEAR"])
    if (!month || !year) {
      throw new Error(
        "missing Stripe env: FLOW_STRIPE_EXP or FLOW_STRIPE_EXP_MONTH + FLOW_STRIPE_EXP_YEAR"
      )
    }
    return `${month}/${year}`
  }
  if (field === "cvc") {
    const value = firstNonEmptyEnv(["FLOW_STRIPE_CVC", "STRIPE_CVC", "FLOW_CVC"])
    if (!value) throw new Error("missing Stripe env: FLOW_STRIPE_CVC")
    return value
  }
  if (field === "postal_code") {
    const value = firstNonEmptyEnv([
      "FLOW_STRIPE_POSTAL_CODE",
      "STRIPE_POSTAL_CODE",
      "FLOW_POSTAL_CODE",
    ])
    if (!value) throw new Error("missing Stripe env: FLOW_STRIPE_POSTAL_CODE")
    return value
  }
  const value = firstNonEmptyEnv(["FLOW_STRIPE_NAME", "STRIPE_NAME", "FLOW_CARDHOLDER_NAME"])
  if (!value) throw new Error("missing Stripe env: FLOW_STRIPE_NAME")
  return value
}

function stripeFrameSelectors(field: StripeFieldKey): string[] {
  if (field === "card_number")
    return ["input[name='cardnumber']", "input[autocomplete='cc-number']"]
  if (field === "exp") return ["input[name='exp-date']", "input[autocomplete='cc-exp']"]
  if (field === "exp_month") return ["input[name='exp-date']", "input[autocomplete='cc-exp-month']"]
  if (field === "exp_year") return ["input[name='exp-date']", "input[autocomplete='cc-exp-year']"]
  if (field === "cvc") return ["input[name='cvc']", "input[autocomplete='cc-csc']"]
  if (field === "postal_code") {
    return ["input[name='postal']", "input[name='postalCode']", "input[autocomplete='postal-code']"]
  }
  return ["input[name='cardholder-name']", "input[autocomplete='cc-name']"]
}

function rankFrames(frames: Frame[]): Frame[] {
  return [...frames].sort((a, b) => {
    const aScore = /stripe|3ds|challenge/i.test(`${a.url()} ${a.name() ?? ""}`) ? 0 : 1
    const bScore = /stripe|3ds|challenge/i.test(`${b.url()} ${b.name() ?? ""}`) ? 0 : 1
    return aScore - bScore
  })
}

export async function fillStripeViaFrames(
  page: Page,
  field: StripeFieldKey,
  value: string
): Promise<{ selector: string | null; trail: SelectorAttempt[] }> {
  const selectors = stripeFrameSelectors(field)
  const trail: SelectorAttempt[] = []
  for (const frame of rankFrames(page.frames())) {
    for (const selector of selectors) {
      try {
        await frame.locator(selector).first().waitFor({ state: "visible", timeout: 1_500 })
        await frame.locator(selector).first().fill(value, { timeout: 5_000 })
        trail.push({
          selector_index: -1,
          kind: "css",
          value: selector,
          normalized: selector,
          success: true,
          error: null,
        })
        return { selector: `frame:${frame.name() || frame.url()} >> ${selector}`, trail }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        trail.push({
          selector_index: -1,
          kind: "css",
          value: selector,
          normalized: selector,
          success: false,
          error: message,
        })
      }
    }
  }
  return { selector: null, trail }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isTransientOtpError(reason: string): boolean {
  return /(timeout|timed out|temporary|try again|rate.?limit|429|5\d\d|network|econn|eai_|enotfound|unavailable)/i.test(
    reason
  )
}

function fetchOtpFromProviderOnce(): OtpFetchAttempt {
  const provider = (AUTOMATION_ENV.FLOW_OTP_PROVIDER ?? process.env.FLOW_OTP_PROVIDER ?? "gmail")
    .trim()
    .toLowerCase()
  const regex = AUTOMATION_ENV.FLOW_OTP_REGEX ?? process.env.FLOW_OTP_REGEX ?? "\\b(\\d{6})\\b"
  const senderFilter =
    AUTOMATION_ENV.FLOW_OTP_SENDER_FILTER ?? process.env.FLOW_OTP_SENDER_FILTER ?? ""
  const subjectFilter =
    AUTOMATION_ENV.FLOW_OTP_SUBJECT_FILTER ?? process.env.FLOW_OTP_SUBJECT_FILTER ?? ""
  const pythonBin =
    AUTOMATION_ENV.PYTHON_BIN ??
    process.env.PYTHON_BIN ??
    process.env.PROJECT_PYTHON_ENV ??
    process.env.UV_PROJECT_ENVIRONMENT ??
    path.join(REPO_ROOT, ".runtime-cache", "toolchains", "python", ".venv", "bin", "python")
  const timeoutMs = Math.max(
    1_000,
    Number(
      AUTOMATION_ENV.FLOW_OTP_PROVIDER_TIMEOUT_MS ??
        process.env.FLOW_OTP_PROVIDER_TIMEOUT_MS ??
        "8000"
    )
  )
  const script = `
from apps.api.app.services.otp_providers import OtpFetchRequest, resolve_otp_code
provider = ${JSON.stringify(provider)}
regex = ${JSON.stringify(regex)}
sender_filter = ${JSON.stringify(senderFilter)} or None
subject_filter = ${JSON.stringify(subjectFilter)} or None
code = resolve_otp_code(OtpFetchRequest(provider=provider, regex=regex, sender_filter=sender_filter, subject_filter=subject_filter))
print(code or "")
`.trim()
  const result = spawnSync(pythonBin, ["-c", script], {
    cwd: REPO_ROOT,
    env: AUTOMATION_ENV,
    encoding: "utf-8",
    timeout: timeoutMs,
  })
  if (result.error) {
    const reason = result.error.message || result.error.name
    return {
      code: null,
      transient: true,
      reason: `otp provider subprocess error (${provider}): ${reason}`,
    }
  }
  if (result.status !== 0) {
    const reason = result.stderr?.trim() || result.stdout?.trim() || `exit=${result.status}`
    return {
      code: null,
      transient: isTransientOtpError(reason),
      reason: `otp provider failed (${provider}): ${reason}`,
    }
  }
  const code = (result.stdout ?? "").trim()
  if (code) {
    return { code }
  }
  return { code: null, transient: true, reason: "otp not available yet" }
}

function resolveRequiredSecretValue(paramKey: string | null): string {
  if (paramKey) {
    const normalizedKey = paramKey.toUpperCase().replace(/[^A-Z0-9]+/g, "_")
    const envKey = `FLOW_SECRET_${normalizedKey}`
    const value = firstNonEmptyEnv([envKey, "FLOW_SECRET_INPUT", "REGISTER_PASSWORD"])
    if (value) return value
    throw new Error(
      `missing secret input for ${paramKey}; set FLOW_SECRET_INPUT_JSON.${paramKey} or ${envKey} or FLOW_SECRET_INPUT`
    )
  }
  const fallback = firstNonEmptyEnv(["FLOW_SECRET_INPUT", "REGISTER_PASSWORD"])
  if (fallback) return fallback
  throw new Error(
    "missing secret input; set FLOW_SECRET_INPUT (or REGISTER_PASSWORD for legacy callers)"
  )
}

async function resolveOtpValue(): Promise<string> {
  const direct = (AUTOMATION_ENV.FLOW_OTP_CODE ?? "").trim()
  if (direct) return direct
  const timeoutSeconds = Math.max(5, Number(AUTOMATION_ENV.FLOW_OTP_TIMEOUT_SECONDS ?? "180"))
  const intervalSeconds = Math.max(1, Number(AUTOMATION_ENV.FLOW_OTP_POLL_INTERVAL_SECONDS ?? "5"))
  const deadline = Date.now() + timeoutSeconds * 1000
  let lastTransientReason = "otp not available yet"
  while (Date.now() <= deadline) {
    const attempt = fetchOtpFromProviderOnce()
    if (attempt.code !== null) return attempt.code
    if (!attempt.transient) {
      throw new Error(attempt.reason)
    }
    lastTransientReason = attempt.reason
    await sleep(intervalSeconds * 1000)
  }
  throw new Error(`OTP not found within ${timeoutSeconds}s (${lastTransientReason})`)
}

export async function resolveTypeValue(step: FlowStep): Promise<string> {
  const flowParams = readParamsFromEnv()
  const legacyFlowInput = readLegacyFlowInput()
  const valueRef = (step.value_ref ?? "").trim()
  const structuredRef = parseStructuredRef(valueRef)
  const stripeField = detectStripeField(step)
  if (stripeField) {
    return resolveStripeValue(stripeField)
  }
  const paramKey = extractParamKey(valueRef)
  const inputMap = parseEnvJsonMap("FLOW_INPUT_JSON")
  const secretMap = parseEnvJsonMap("FLOW_SECRET_INPUT_JSON")
  if (structuredRef) {
    const fromParams = flowParams[structuredRef.key]
    if (typeof fromParams === "string") {
      if (structuredRef.key.toLowerCase().includes("otp") && fromParams.trim()) {
        return fromParams.trim()
      }
      return fromParams
    }
    if (structuredRef.key.toLowerCase().includes("otp")) {
      return await resolveOtpValue()
    }
    if (structuredRef.scope === "secrets") {
      if (secretMap[structuredRef.key]) {
        return secretMap[structuredRef.key]
      }
      return resolveRequiredSecretInput()
    }
    if (legacyFlowInput) {
      return legacyFlowInput
    }
    return ""
  }
  if (isOtpStep(step) || valueRef.toLowerCase().includes("otp")) {
    return await resolveOtpValue()
  }
  if (valueRef.includes("secrets")) {
    if (paramKey && secretMap[paramKey]) {
      return secretMap[paramKey]
    }
    return resolveRequiredSecretValue(paramKey)
  }
  if (paramKey && inputMap[paramKey]) {
    return inputMap[paramKey]
  }
  if (legacyFlowInput) {
    return legacyFlowInput
  }
  return `demo-${Date.now()}`
}

function hasOtpHint(text: string): boolean {
  return /(otp|mfa|2fa|two[-_\s]?factor|one[-_\s]?time|verification(?:[-_\s]?code)?|auth(?:entication)?[-_\s]?code)/i.test(
    text
  )
}

export async function detect3DSManualGate(
  page: Page
): Promise<{ required: boolean; signals: string[] }> {
  const signals = new Set<string>()
  const allFrames = page.frames()
  const allUrls = allFrames.map((frame) => frame.url())
  const hasStrong3dsUrl = allUrls.some((url) =>
    /(3d[_-]?secure|three[_-]?d[_-]?secure|3ds2|cardinalcommerce|securecode|acs|\/v1\/challenge|\/challenge\/3ds)/i.test(
      url
    )
  )
  if (hasStrong3dsUrl) {
    signals.add("3ds-frame-url-strong")
  }
  let hasStrong3dsText = false
  for (const frame of allFrames) {
    try {
      const text = await frame.locator("body").innerText({ timeout: 1_000 })
      if (
        /(3d secure|three[- ]d secure|authenticate your payment|issuer authentication|bank card authentication|challenge window)/i.test(
          text
        )
      ) {
        signals.add("3ds-text-strong")
        hasStrong3dsText = true
        break
      }
    } catch {
      // ignore frame read failures; detection remains conservative.
    }
  }
  const required = hasStrong3dsUrl || hasStrong3dsText
  return { required, signals: [...signals] }
}

export function isOtpStep(step: FlowStep): boolean {
  const ref = (step.value_ref ?? "").toLowerCase()
  if (hasOtpHint(ref)) {
    return true
  }
  const selectorBlob = (step.target?.selectors ?? [])
    .map((item) => `${item.kind}:${item.value}`.toLowerCase())
    .join(" ")
  return (
    hasOtpHint(selectorBlob) ||
    /\bname=['"]?(otp|mfa|verification|verification_code|authcode)/i.test(selectorBlob) ||
    /\btype=['"]?(tel|number|one-time-code)/i.test(selectorBlob)
  )
}

function isSensitiveTypeStep(step: FlowStep): boolean {
  if (step.action !== "type") return false
  if (detectStripeField(step)) return true
  const ref = (step.value_ref ?? "").toLowerCase()
  const selectors = (step.target?.selectors ?? []).map((item) => item.value.toLowerCase()).join(" ")
  const text = `${ref} ${selectors}`
  return /(secret|password|passwd|token|otp|verification|code|cvc|cvv|card|cc-|exp|postal|zip|stripe)/i.test(
    text
  )
}

export function shouldCaptureScreenshotsForStep(step: FlowStep): boolean {
  const screenshotsEnabled = process.env.FLOW_CAPTURE_SCREENSHOTS !== "false"
  if (!screenshotsEnabled) return false
  if (!isSensitiveTypeStep(step)) return true
  return process.env.FLOW_CAPTURE_SENSITIVE_SCREENSHOTS === "true"
}
