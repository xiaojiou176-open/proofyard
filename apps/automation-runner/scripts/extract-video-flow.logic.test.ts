import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  buildSelectors,
  deriveStepsFromEventLog,
  detectSignals,
  loadProviderPolicy,
  parsePolicyValue,
  resolveProviderPolicyCandidates,
  tryParseJson,
  valueRefForEvent,
  type CandidateStep,
} from "./extract-video-flow.js"

type EventLike = {
  ts: string
  type: "navigate" | "click" | "type" | "change"
  url: string
  target: {
    tag: string
    id: string | null
    name: string | null
    type: string | null
    role: string | null
    text: string | null
    classes: string[]
    cssPath: string
  }
  value?: string
}

function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const previous: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  try {
    const result = fn()
    if (result && typeof (result as Promise<void>).then === "function") {
      return (result as Promise<void>).finally(restore)
    }
    restore()
  } catch (error) {
    restore()
    throw error
  }
}

function event(overrides: Partial<EventLike> = {}): EventLike {
  return {
    ts: "2026-03-09T00:00:00.000Z",
    type: "click",
    url: "https://example.test/register",
    target: {
      tag: "button",
      id: "submit",
      name: null,
      type: "submit",
      role: "button",
      text: "Continue",
      classes: ["btn"],
      cssPath: "form > button[type='submit']",
    },
    ...overrides,
  }
}

test("extract-video-flow provider policy helpers cover yaml parsing and fallback resolution", async () => {
  assert.deepEqual(parsePolicyValue("# comment\nprovider: gemini\nfallbackMode: permissive\n"), {
    provider: "gemini",
    fallbackMode: "permissive",
  })

  const sandbox = mkdtempSync(path.join(tmpdir(), "uiq-provider-policy-"))
  const policyPath = path.join(sandbox, "provider-policy.yaml")
  writeFileSync(
    policyPath,
    ["provider: gemini", "primary: gemini", "fallback: event_log", "fallbackMode: permissive"].join("\n"),
    "utf8"
  )
  try {
    await withEnv({ PROVIDER_POLICY_PATH: policyPath }, async () => {
      const candidates = resolveProviderPolicyCandidates()
      assert.equal(candidates[0], policyPath)
      const policy = await loadProviderPolicy()
      assert.equal(policy.provider, "gemini")
      assert.equal(policy.fallback, "event_log")
      assert.equal(policy.fallbackMode, "permissive")
      assert.equal(policy.strictNoFallback, false)
    })
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test("extract-video-flow event-log helpers cover selectors, value refs and step derivation", () => {
  const navigate = event({ type: "navigate", url: "https://example.test/start" })
  const click = event()
  const typeEmail = event({
    type: "type",
    target: {
      ...event().target,
      tag: "input",
      id: "email",
      name: "email",
      type: "email",
      role: "textbox",
      text: null,
      cssPath: "form > input[name='email']",
    },
    value: "user@example.test",
  })
  const typePassword = event({
    type: "type",
    target: {
      ...event().target,
      tag: "input",
      id: "password",
      name: "password",
      type: "password",
      role: "textbox",
      text: null,
      cssPath: "form > input[name='password']",
    },
    value: "secret",
  })

  const selectors = buildSelectors(click as never)
  assert.equal(selectors.some((item) => item.kind === "role"), true)
  assert.equal(selectors.some((item) => item.kind === "id"), true)
  assert.equal(selectors.some((item) => item.kind === "css"), true)

  assert.equal(valueRefForEvent(typeEmail as never), "${params.email}")
  assert.equal(valueRefForEvent(typePassword as never), "${secrets.input}")

  const steps = deriveStepsFromEventLog([navigate as never, click as never, typeEmail as never, typePassword as never]) as CandidateStep[]
  assert.equal(steps[0]?.action, "navigate")
  assert.equal(steps.some((step) => step.action === "click"), true)
  assert.equal(steps.some((step) => step.value_ref === "${params.email}"), true)
  assert.equal(steps.some((step) => step.value_ref === "${secrets.input}"), true)
})

test("extract-video-flow signal and JSON parsing helpers cover fallback branches", () => {
  assert.deepEqual(detectSignals("Cloudflare turnstile + OTP verification code"), ["cloudflare", "otp"])
  assert.deepEqual(detectSignals("hcaptcha challenge"), ["captcha"])
  assert.deepEqual(tryParseJson('{"ok":true}'), { ok: true })
  assert.deepEqual(tryParseJson('prefix {"ok":true} suffix'), { ok: true })
  assert.equal(tryParseJson("not-json"), null)
})
