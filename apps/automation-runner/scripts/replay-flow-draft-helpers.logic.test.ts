import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"

import {
  applyWithFallback,
  detectStripeField,
  detect3DSManualGate,
  fillStripeViaFrames,
  isOtpStep,
  loadResumeContext,
  parseProtectedProviderDomains,
  persistResumeContext,
  resolveTypeValue,
  resolveFromStepIndex,
  resolveProviderDomainForStep,
  shouldCaptureScreenshotsForStep,
  waitPrecondition,
  type FlowDraft,
  type FlowStep,
} from "./replay-flow-draft-helpers.js"

function baseStep(overrides: Partial<FlowStep> = {}): FlowStep {
  return {
    step_id: "s1",
    action: "type",
    value_ref: "${secrets.password}",
    selected_selector_index: 0,
    target: {
      selectors: [{ kind: "css", value: "input[name='password']", score: 90 }],
    },
    ...overrides,
  }
}

async function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const previous: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    await fn()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test("parseProtectedProviderDomains normalizes and falls back to defaults", () => {
  assert.deepEqual(parseProtectedProviderDomains(undefined), ["stripe.com", "js.stripe.com"])
  assert.deepEqual(parseProtectedProviderDomains(" https://Stripe.com/path, js.stripe.com "), [
    "stripe.com",
    "js.stripe.com",
  ])
})

test("resolveProviderDomainForStep prefers step url, current url, then stripe gate hint", () => {
  const protectedDomains = ["stripe.com", "paypal.com"]
  assert.equal(
    resolveProviderDomainForStep(
      baseStep({ url: "https://checkout.stripe.com/pay" }),
      "https://example.test",
      protectedDomains
    ),
    "stripe.com"
  )
  assert.equal(
    resolveProviderDomainForStep(baseStep({ url: "notaurl" }), "https://checkout.paypal.com", protectedDomains),
    "paypal.com"
  )
  assert.equal(
    resolveProviderDomainForStep(
      baseStep({
        gate_reason: "provider_protected_payment_step",
        value_ref: "${params.stripe_cvc}",
      }),
      "https://example.test",
      protectedDomains
    ),
    "stripe.com"
  )
  assert.equal(
    resolveProviderDomainForStep(baseStep({ gate_reason: "other_reason" }), "https://example.test", protectedDomains),
    null
  )
})

test("detectStripeField, isOtpStep and screenshot capture branches behave as expected", () => {
  assert.equal(
    detectStripeField(
      baseStep({
        value_ref: "${params.card_number}",
        target: { selectors: [{ kind: "css", value: "input[name='cardnumber']", score: 90 }] },
      })
    ),
    "card_number"
  )
  assert.equal(
    detectStripeField(
      baseStep({
        value_ref: "${params.exp}",
        target: { selectors: [{ kind: "css", value: "input[autocomplete='cc-exp']", score: 90 }] },
      })
    ),
    "exp"
  )
  assert.equal(
    isOtpStep(
      baseStep({
        value_ref: "${params.otp}",
        target: { selectors: [{ kind: "name", value: "verification_code", score: 90 }] },
      })
    ),
    true
  )

  const previousSensitive = process.env.FLOW_CAPTURE_SENSITIVE_SCREENSHOTS
  const previousEnabled = process.env.FLOW_CAPTURE_SCREENSHOTS
  process.env.FLOW_CAPTURE_SCREENSHOTS = "true"
  process.env.FLOW_CAPTURE_SENSITIVE_SCREENSHOTS = "false"
  try {
    assert.equal(shouldCaptureScreenshotsForStep(baseStep()), false)
    assert.equal(
      shouldCaptureScreenshotsForStep(
        baseStep({ action: "click", value_ref: undefined, target: { selectors: [] } })
      ),
      true
    )
    process.env.FLOW_CAPTURE_SENSITIVE_SCREENSHOTS = "true"
    assert.equal(shouldCaptureScreenshotsForStep(baseStep()), true)
  } finally {
    if (previousSensitive === undefined) delete process.env.FLOW_CAPTURE_SENSITIVE_SCREENSHOTS
    else process.env.FLOW_CAPTURE_SENSITIVE_SCREENSHOTS = previousSensitive
    if (previousEnabled === undefined) delete process.env.FLOW_CAPTURE_SCREENSHOTS
    else process.env.FLOW_CAPTURE_SCREENSHOTS = previousEnabled
  }
})

test("resolveTypeValue covers params, secrets, otp and fallback branches", async () => {
  await withEnv(
    {
      FLOW_PARAMS_JSON: JSON.stringify({ username: "demo-user" }),
      FLOW_INPUT_JSON: JSON.stringify({ username: "demo-user" }),
      FLOW_SECRET_INPUT_JSON: JSON.stringify({ password: "secret-json" }),
      FLOW_OTP_CODE: "654321",
      FLOW_INPUT: "legacy-input",
      FLOW_SECRET_INPUT: "legacy-secret",
    },
    async () => {
      assert.equal(
        await resolveTypeValue(
          baseStep({ value_ref: "${params.username}", target: { selectors: [] } })
        ),
        "demo-user"
      )
      assert.equal(
        await resolveTypeValue(
          baseStep({ value_ref: "${secrets.password}", target: { selectors: [] } })
        ),
        "secret-json"
      )
      assert.equal(
        await resolveTypeValue(
          baseStep({
            value_ref: "${params.otp}",
            target: { selectors: [{ kind: "name", value: "otp_code", score: 90 }] },
          })
        ),
        "654321"
      )
      assert.equal(
        await resolveTypeValue(baseStep({ value_ref: "${params.unknown}", target: { selectors: [] } })),
        "legacy-input"
      )
      assert.equal(
        await resolveTypeValue(baseStep({ value_ref: "plain-value", target: { selectors: [] } })),
        "legacy-input"
      )
    }
  )
})

test("resolveTypeValue fails with explicit missing secret and detects 3DS challenge branches", async () => {
  await withEnv(
    {
      FLOW_INPUT_JSON: undefined,
      FLOW_SECRET_INPUT_JSON: undefined,
      FLOW_OTP_CODE: undefined,
      FLOW_PARAMS_JSON: undefined,
      FLOW_INPUT: undefined,
      FLOW_SECRET_INPUT: undefined,
      REGISTER_PASSWORD: undefined,
    },
    async () => {
      await assert.rejects(
        () => resolveTypeValue(baseStep({ value_ref: "${secrets.password}", target: { selectors: [] } })),
        /missing secret input/
      )
    }
  )

  const challenge = await detect3DSManualGate(
    {
      frames: () => [
        {
          url: () => "https://issuer.example/challenge/3ds",
          name: () => "issuer-frame",
          locator: () => ({
            innerText: async () => "Authenticate your payment to continue",
          }),
        },
      ],
    } as never
  )
  assert.equal(challenge.required, true)
  assert.equal(challenge.signals.includes("3ds-frame-url-strong"), true)

  const noChallenge = await detect3DSManualGate(
    {
      frames: () => [
        {
          url: () => "https://example.test/frame",
          name: () => "safe-frame",
          locator: () => ({
            innerText: async () => "plain content",
          }),
        },
      ],
    } as never
  )
  assert.equal(noChallenge.required, false)
})

test("resolveFromStepIndex honors explicit step ids and throws on unknown ids", () => {
  const flow: FlowDraft = {
    flow_id: "flow-1",
    session_id: "session-1",
    start_url: "https://example.test",
    steps: [
      { step_id: "s1", action: "navigate", url: "https://example.test" },
      { step_id: "s2", action: "click", target: { selectors: [] } },
    ],
  }
  const previous = process.env.FLOW_FROM_STEP_ID
  try {
    delete process.env.FLOW_FROM_STEP_ID
    assert.equal(resolveFromStepIndex(flow), 0)
    process.env.FLOW_FROM_STEP_ID = "s2"
    assert.equal(resolveFromStepIndex(flow), 1)
    process.env.FLOW_FROM_STEP_ID = "missing"
    assert.throws(() => resolveFromStepIndex(flow), /FLOW_FROM_STEP_ID not found/)
  } finally {
    if (previous === undefined) delete process.env.FLOW_FROM_STEP_ID
    else process.env.FLOW_FROM_STEP_ID = previous
  }
})

test("applyWithFallback and waitPrecondition record successful and failed selector trails", async () => {
  const successStep = baseStep({
    target: {
      selectors: [
        { kind: "name", value: "email", score: 80 },
        { kind: "css", value: "input[type='email']", score: 70 },
      ],
    },
  })

  const attempts: string[] = []
  const applied = await applyWithFallback({} as never, successStep, async (selector) => {
    attempts.push(selector)
    if (selector.startsWith("[name=")) throw new Error("first selector failed")
  })
  assert.equal(applied.ok, true)
  assert.equal(applied.selector_index, 1)
  assert.equal(applied.fallback_trail.length, 2)
  assert.equal(attempts.length, 2)

  const failing = await applyWithFallback(
    {} as never,
    baseStep({ target: { selectors: [{ kind: "role" as never, value: "Continue", score: 90 }] } }),
    async () => {
      throw new Error("unreachable")
    }
  )
  assert.equal(failing.ok, false)
  assert.equal(failing.detail, "all selector attempts failed")

  const waited = await waitPrecondition(
    {
      locator: (selector: string) => ({
        first: () => ({
          waitFor: async () => {
            if (selector.includes("email")) return
            throw new Error("not visible")
          },
        }),
      }),
    } as never,
    successStep
  )
  assert.equal(waited.ok, true)
  assert.equal(waited.detail, "precondition wait passed")

  const waitedFail = await waitPrecondition(
    {
      locator: () => ({
        first: () => ({
          waitFor: async () => {
            throw new Error("still hidden")
          },
        }),
      }),
    } as never,
    baseStep({ target: { selectors: [{ kind: "css", value: ".missing", score: 80 }] } })
  )
  assert.equal(waitedFail.ok, false)
  assert.equal(waitedFail.detail, "all selector attempts failed")
})

test("persistResumeContext/loadResumeContext and fillStripeViaFrames cover storage/frame branches", async () => {
  const sessionDir = mkdtempSync(resolve(tmpdir(), "uiq-replay-resume-"))
  try {
    await persistResumeContext(
      {
        storageState: async ({ path }: { path: string }) => {
          await import("node:fs/promises").then(({ writeFile }) => writeFile(path, '{"cookies":[]}', "utf8"))
        },
      } as never,
      { url: () => "https://example.test/checkout" } as never,
      sessionDir,
      "manual_gate",
      "step-9"
    )
    const loaded = await loadResumeContext(sessionDir)
    assert.equal(loaded.storageStatePath?.endsWith("replay-resume-storage-state.json"), true)
    assert.equal(loaded.snapshot?.last_step_id, "step-9")
    assert.equal(loaded.snapshot?.status, "manual_gate")

    const filled = await fillStripeViaFrames(
      {
        frames: () => [
          {
            name: () => "plain-frame",
            url: () => "https://example.test/frame",
            locator: () => ({
              first: () => ({
                waitFor: async () => {
                  throw new Error("not here")
                },
                fill: async () => undefined,
              }),
            }),
          },
          {
            name: () => "stripe-frame",
            url: () => "https://js.stripe.com/v3",
            locator: (selector: string) => ({
              first: () => ({
                waitFor: async () => {
                  if (selector.includes("cardnumber")) return
                  throw new Error("skip")
                },
                fill: async () => undefined,
              }),
            }),
          },
        ],
      } as never,
      "card_number",
      "4242424242424242"
    )
    assert.equal(typeof filled.selector, "string")
    assert.equal(filled.trail.some((item) => item.success), true)
  } finally {
    rmSync(sessionDir, { recursive: true, force: true })
  }
})
