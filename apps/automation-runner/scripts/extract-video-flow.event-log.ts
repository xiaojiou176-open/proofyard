import type { CapturedEvent } from "./lib/ai-input-pack.js"
import {
  ACTION_SCHEMA_SET,
  type CandidateStep,
  INVALID_ACTION_SCHEMA_REASON,
  type NormalizedModelSteps,
  type SelectorCandidate,
} from "./extract-video-flow.shared.js"

export function buildSelectors(event: CapturedEvent): SelectorCandidate[] {
  const selectors: SelectorCandidate[] = []
  if (event.target.role && event.target.text) {
    selectors.push({
      kind: "role",
      value: `${event.target.role}[name='${event.target.text}']`,
      score: 90,
    })
  }
  if (event.target.id) selectors.push({ kind: "id", value: `#${event.target.id}`, score: 82 })
  if (event.target.name) {
    selectors.push({ kind: "name", value: `[name='${event.target.name}']`, score: 79 })
  }
  if (event.target.cssPath && event.target.cssPath !== "unknown") {
    selectors.push({ kind: "css", value: event.target.cssPath, score: 68 })
  }
  return selectors
}

export function valueRefForEvent(event: CapturedEvent): string {
  const name = (event.target.name ?? "").toLowerCase()
  const type = (event.target.type ?? "").toLowerCase()
  if (type === "password" || /(password|secret|token|otp|code)/.test(name)) {
    return "${secrets.input}"
  }
  if (/(email|user|login)/.test(name)) return "${params.email}"
  return "${params.input}"
}

export function deriveStepsFromEventLog(events: CapturedEvent[]): CandidateStep[] {
  if (events.length === 0) return []
  const steps: CandidateStep[] = []
  const firstUrl = events.find((event) => event.url)?.url
  if (firstUrl) {
    steps.push({
      step_id: "s1",
      action: "navigate",
      url: firstUrl,
      confidence: 0.9,
      source_engine: "event-log",
      evidence_ref: "event-log:navigate",
    })
  }
  const seenTypeTargets = new Set<string>()
  let counter = steps.length + 1
  for (const event of events) {
    if (event.type === "click") {
      steps.push({
        step_id: `s${counter++}`,
        action: "click",
        target: { selectors: buildSelectors(event) },
        confidence: 0.84,
        source_engine: "event-log",
        evidence_ref: `event-log:${event.ts}:click`,
      })
      continue
    }
    if ((event.type === "type" || event.type === "change") && event.value !== undefined) {
      const key = `${event.target.cssPath}|${event.target.name ?? ""}|${event.target.id ?? ""}`
      if (seenTypeTargets.has(key)) continue
      seenTypeTargets.add(key)
      steps.push({
        step_id: `s${counter++}`,
        action: "type",
        value_ref: valueRefForEvent(event),
        target: { selectors: buildSelectors(event) },
        confidence: 0.86,
        source_engine: "event-log",
        evidence_ref: `event-log:${event.ts}:type`,
      })
    }
  }
  return steps
}

export function detectSignals(combined: string): string[] {
  const patterns: Array<[string, RegExp]> = [
    ["cloudflare", /cloudflare|cf_clearance|__cf_bm|turnstile/i],
    ["captcha", /captcha|hcaptcha|recaptcha/i],
    ["otp", /otp|verification code|one[-_ ]time|mfa/i],
  ]
  return patterns.filter(([, pattern]) => pattern.test(combined)).map(([name]) => name)
}

export function tryParseJson(text: string): unknown {
  const direct = text.trim()
  try {
    return JSON.parse(direct)
  } catch {
    const start = direct.indexOf("{")
    const end = direct.lastIndexOf("}")
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(direct.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

function looksLikeOtpManualGate(record: Record<string, unknown>): boolean {
  const joined = [
    record.unsupported_reason,
    record.evidence_ref,
    record.value_ref,
    record.action,
    record.url,
  ]
    .map((item) => (typeof item === "string" ? item : ""))
    .join(" ")
    .toLowerCase()
  return /(otp|verification.?code|one[-_ ]time|mfa|2fa|two[-_ ]factor)/i.test(joined)
}

export function normalizeModelSteps(input: unknown, engine: string): NormalizedModelSteps {
  if (!Array.isArray(input)) return { steps: [] }
  const steps: CandidateStep[] = []
  let idx = 1
  for (const item of input) {
    if (!item || typeof item !== "object") continue
    const record = item as Record<string, unknown>
    let action = String(record.action ?? "").toLowerCase()
    if (!ACTION_SCHEMA_SET.has(action)) {
      return {
        steps: [],
        invalidAction: action || "<empty>",
      }
    }
    const selectorsRaw = Array.isArray(
      (record.target as { selectors?: unknown[] } | undefined)?.selectors
    )
      ? (((record.target as { selectors: unknown[] }).selectors ?? []) as unknown[])
      : []
    const selectors: SelectorCandidate[] = selectorsRaw
      .filter((candidate) => candidate && typeof candidate === "object")
      .map((candidate) => candidate as Record<string, unknown>)
      .map((candidate) => ({
        kind: String(candidate.kind ?? "css") as SelectorCandidate["kind"],
        value: String(candidate.value ?? ""),
        score: Number(candidate.score ?? 70),
      }))
      .filter((selector) => Boolean(selector.value))
    if (action === "manual_gate" && selectors.length > 0 && looksLikeOtpManualGate(record)) {
      action = "type"
      if (typeof record.value_ref !== "string" || !record.value_ref.toLowerCase().includes("otp")) {
        record.value_ref = "${params.otp}"
      }
    }
    steps.push({
      step_id: String(record.step_id ?? `s${idx++}`),
      action: action as CandidateStep["action"],
      url: typeof record.url === "string" ? record.url : undefined,
      value_ref: typeof record.value_ref === "string" ? record.value_ref : undefined,
      target: selectors.length > 0 ? { selectors } : undefined,
      confidence: Math.max(0, Math.min(1, Number(record.confidence ?? 0.75))),
      source_engine: engine,
      evidence_ref: typeof record.evidence_ref === "string" ? record.evidence_ref : `llm:${engine}`,
      unsupported_reason:
        typeof record.unsupported_reason === "string" ? record.unsupported_reason : undefined,
    })
  }
  return { steps }
}

export { INVALID_ACTION_SCHEMA_REASON }
