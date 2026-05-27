import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

import {
  detect3DSManualGate,
  isOtpStep,
  runStep,
  shouldCaptureScreenshotsForStep,
  waitPrecondition,
} from "./replay-flow-execute.js"
import type { FlowStep } from "./replay-flow-types.js"
import {
  maybeReadJson,
  parseProtectedProviderDomains,
  readJson,
  resolveFromStepIndex,
  resolveProviderDomainForStep,
} from "./replay-flow-parse.js"
import { loadResumeContext, persistResumeContext } from "./replay-flow-resume.js"

function withEnv<T>(
  env: Record<string, string | undefined>,
  fn: () => Promise<T> | T
): Promise<T> {
  const previous: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  try {
    const result = fn()
    if (result && typeof (result as Promise<T>).then === "function") {
      return (result as Promise<T>).finally(restore)
    }
    restore()
    return Promise.resolve(result as T)
  } catch (error) {
    restore()
    throw error
  }
}

function step(overrides: Partial<FlowStep> = {}): FlowStep {
  return {
    step_id: "s1",
    action: "type",
    value_ref: "${params.email}",
    selected_selector_index: 0,
    target: {
      selectors: [
        { kind: "css", value: ".first", score: 80 },
        { kind: "css", value: ".second", score: 70 },
      ],
    },
    ...overrides,
  }
}

test("replay-flow-parse handles json helpers and provider domain resolution", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "uiq-replay-lib-parse-"))
  const okPath = join(dir, "ok.json")
  const badPath = join(dir, "bad.json")
  const missPath = join(dir, "missing.json")
  writeFileSync(okPath, JSON.stringify({ ok: true }), "utf8")
  writeFileSync(badPath, "{ not-json", "utf8")

  assert.deepEqual(parseProtectedProviderDomains(undefined), ["stripe.com", "js.stripe.com"])
  assert.deepEqual(parseProtectedProviderDomains(" https://Stripe.com/x, js.stripe.com "), [
    "stripe.com",
    "js.stripe.com",
  ])

  const provider = resolveProviderDomainForStep(
    step({ url: "https://checkout.stripe.com/pay" }),
    "https://example.test",
    ["stripe.com", "paypal.com"]
  )
  assert.equal(provider, "stripe.com")

  const flow = {
    flow_id: "f1",
    session_id: "s1",
    start_url: "https://example.test",
    steps: [{ step_id: "a", action: "navigate", url: "https://example.test" }],
  }
  await withEnv({ FLOW_FROM_STEP_ID: "a" }, async () => {
    assert.equal(resolveFromStepIndex(flow), 0)
  })
  await withEnv({ FLOW_FROM_STEP_ID: "missing" }, async () => {
    assert.throws(() => resolveFromStepIndex(flow), /FLOW_FROM_STEP_ID not found/)
  })

  const parsed = await readJson<{ ok: boolean }>(okPath)
  assert.equal(parsed.ok, true)
  assert.deepEqual(await maybeReadJson<{ ok: boolean }>(okPath), parsed)
  assert.equal(await maybeReadJson(missPath), null)
  await assert.rejects(() => readJson(badPath))

  rmSync(dir, { recursive: true, force: true })
})

test("replay-flow-resume persists and reloads context state", async () => {
  const sessionDir = mkdtempSync(resolve(tmpdir(), "uiq-replay-lib-resume-"))
  const fakeContext = {
    storageState: async ({ path }: { path: string }) => {
      writeFileSync(path, '{"cookies":[]}', "utf8")
    },
  }
  const fakePage = { url: () => "https://example.test/checkpoint" }

  await persistResumeContext(fakeContext as never, fakePage as never, sessionDir, "manual_gate", "s9")
  const loaded = await loadResumeContext(sessionDir)
  assert.equal(loaded.storageStatePath?.endsWith("replay-resume-storage-state.json"), true)
  assert.equal(loaded.snapshot?.status, "manual_gate")
  assert.equal(loaded.snapshot?.last_step_id, "s9")

  rmSync(sessionDir, { recursive: true, force: true })
})

test("replay-flow-execute covers detection, precondition fallback, and runStep branches", async () => {
  assert.equal(
    isOtpStep(step({ value_ref: "${params.otp}", target: { selectors: [{ kind: "name", value: "otp_code", score: 90 }] } })),
    true
  )

  await withEnv({ FLOW_CAPTURE_SCREENSHOTS: "true", FLOW_CAPTURE_SENSITIVE_SCREENSHOTS: "false" }, async () => {
    assert.equal(shouldCaptureScreenshotsForStep(step({ value_ref: "${secrets.password}" })), false)
    assert.equal(
      shouldCaptureScreenshotsForStep(step({ action: "click", value_ref: undefined, target: { selectors: [] } })),
      true
    )
  })

  const gateDetection = await detect3DSManualGate(
    {
      frames: () => [
        {
          url: () => "https://acs.challenge.example/v1/challenge/3ds",
          locator: () => ({
            innerText: async () => "authenticate your payment",
          }),
        },
      ],
    } as never
  )
  assert.equal(gateDetection.required, true)
  assert.equal(gateDetection.signals.length >= 1, true)

  const waitPage = {
    locator: (selector: string) => ({
      first: () => ({
        waitFor: async () => {
          if (selector === ".second") return
          throw new Error("hidden")
        },
      }),
    }),
  }
  const waitResult = await waitPrecondition(waitPage as never, step())
  assert.equal(waitResult.ok, true)
  assert.equal(waitResult.fallback_trail.length, 2)

  const runPage = {
    currentUrl: "https://example.test",
    url() {
      return this.currentUrl
    },
    async goto(url: string) {
      this.currentUrl = url
    },
    locator(selector: string) {
      return {
        first: () => ({
          click: async () => {
            if (selector !== ".second") throw new Error("click failed")
          },
          fill: async () => {
            if (selector.includes("otp_code")) return
            // Force stripe frame fallback branch for card type.
            throw new Error("fill failed")
          },
        }),
      }
    },
    frames() {
      return [
        {
          name: () => "stripe-frame",
          url: () => "https://js.stripe.com/v3",
          locator: (selector: string) => ({
            first: () => ({
              waitFor: async () => {
                if (!selector.includes("cardnumber")) throw new Error("not visible")
              },
              fill: async () => undefined,
            }),
          }),
        },
      ]
    },
  }

  const forceManual = await runStep(
    runPage as never,
    step({ action: "type", gate_policy: "force_manual", gate_reason: "provider_protected_payment_step" }),
    ["stripe.com"]
  )
  assert.equal(forceManual.manual_gate_required, true)
  assert.equal(forceManual.gate_required_by_policy, true)

  const manualOtp = await withEnv({ FLOW_OTP_CODE: "123456" }, async () =>
    runStep(
      runPage as never,
      step({
        action: "manual_gate",
        value_ref: "${params.otp}",
        target: { selectors: [{ kind: "name", value: "otp_code", score: 90 }] },
      }),
      ["stripe.com"]
    )
  )
  assert.equal(manualOtp.ok, true)
  assert.equal(manualOtp.action, "type")

  const missingUrl = await runStep(runPage as never, step({ action: "navigate", url: "" }), ["stripe.com"])
  assert.equal(missingUrl.ok, false)
  assert.equal(missingUrl.detail, "missing url")

  const navOk = await runStep(
    runPage as never,
    step({ action: "navigate", url: "https://checkout.stripe.com/pay" }),
    ["stripe.com"]
  )
  assert.equal(navOk.ok, true)
  assert.equal(navOk.provider_domain, "stripe.com")

  const clickOk = await runStep(
    runPage as never,
    step({ action: "click", target: { selectors: [{ kind: "css", value: ".first", score: 80 }, { kind: "css", value: ".second", score: 70 }] } }),
    ["stripe.com"]
  )
  assert.equal(clickOk.ok, true)
  assert.equal(clickOk.selector_index, 1)

  const stripeType = await withEnv({ FLOW_STRIPE_CARD_NUMBER: "4242424242424242" }, async () =>
    runStep(
      runPage as never,
      step({
        action: "type",
        value_ref: "${params.card_number}",
        target: { selectors: [{ kind: "css", value: "input[name='cardnumber']", score: 90 }] },
      }),
      ["stripe.com"]
    )
  )
  assert.equal(stripeType.ok, true)
  assert.equal(stripeType.selector_index, -1)
  assert.equal(stripeType.detail.includes("frame:"), true)

  await assert.rejects(
    () => runStep(runPage as never, step({ action: "unsupported_action" }), ["stripe.com"]),
    /unsupported action/
  )
})

test("replay-flow-execute escapes selector values before locator usage", async () => {
  const calls: string[] = []
  const page = {
    locator: (selector: string) => {
      calls.push(selector)
      return {
        first: () => ({
          waitFor: async () => undefined,
        }),
      }
    },
  }

  const result = await waitPrecondition(
    page as never,
    step({
      target: {
        selectors: [{ kind: "name", value: String.raw`na'me\field`, score: 90 }],
      },
    })
  )

  assert.equal(result.ok, true)
  assert.deepEqual(calls, [String.raw`[name='na\'me\\field']`])
})

test("replay-flow-resume returns null snapshot and storage when files are absent", async () => {
  const sessionDir = mkdtempSync(resolve(tmpdir(), "uiq-replay-lib-resume-empty-"))
  try {
    const loaded = await loadResumeContext(sessionDir)
    assert.equal(loaded.storageStatePath, null)
    assert.equal(loaded.snapshot, null)
  } finally {
    rmSync(sessionDir, { recursive: true, force: true })
  }
})

test("persistResumeContext writes expected snapshot JSON payload", async () => {
  const sessionDir = mkdtempSync(resolve(tmpdir(), "uiq-replay-lib-resume-json-"))
  try {
    const fakeContext = {
      storageState: async ({ path }: { path: string }) => {
        writeFileSync(path, '{"cookies":[]}', "utf8")
      },
    }
    const fakePage = { url: () => "https://example.test/final" }
    await persistResumeContext(fakeContext as never, fakePage as never, sessionDir, "success", "s10")
    const snapshotPath = join(sessionDir, "replay-resume-session.json")
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
      current_url: string
      status: string
      last_step_id: string
    }
    assert.equal(snapshot.current_url, "https://example.test/final")
    assert.equal(snapshot.status, "success")
    assert.equal(snapshot.last_step_id, "s10")
  } finally {
    rmSync(sessionDir, { recursive: true, force: true })
  }
})

test("replay-flow-execute covers manual gate fallback, click failure and type failure branches", async () => {
  const page = {
    url: () => "https://example.test/form",
    goto: async () => undefined,
    locator: (selector: string) => ({
      first: () => ({
        click: async () => {
          throw new Error(`click failed for ${selector}`)
        },
        fill: async () => {
          throw new Error(`fill failed for ${selector}`)
        },
        waitFor: async () => {
          throw new Error(`hidden ${selector}`)
        },
      }),
    }),
    frames: () => [],
  }

  const manualGate = await runStep(
    page as never,
    step({ action: "manual_gate", value_ref: "${params.email}" }),
    ["stripe.com"]
  )
  assert.equal(manualGate.ok, false)
  assert.equal(manualGate.manual_gate_required, true)
  assert.match(manualGate.detail, /manual gate required by flow step/)

  const clickFailed = await runStep(
    page as never,
    step({
      action: "click",
      target: { selectors: [{ kind: "css", value: ".missing", score: 90 }] },
    }),
    ["stripe.com"]
  )
  assert.equal(clickFailed.ok, false)
  assert.equal(clickFailed.matched_selector, null)
  assert.equal(clickFailed.fallback_trail.length, 1)

  const typeFailed = await withEnv(
    {
      FLOW_INPUT_JSON: JSON.stringify({ email: "person@example.test" }),
      FLOW_SECRET_INPUT: undefined,
      REGISTER_PASSWORD: undefined,
      FLOW_STRIPE_CARD_NUMBER: undefined,
    },
    async () =>
      runStep(
        page as never,
        step({
          action: "type",
          value_ref: "${params.email}",
          target: { selectors: [{ kind: "css", value: ".missing", score: 90 }] },
        }),
        ["stripe.com"]
      )
  )
  assert.equal(typeFailed.ok, false)
  assert.match(typeFailed.detail, /all selector attempts failed/)
})

test("replay-flow-execute covers benign challenge detection and screenshot env branches", async () => {
  const noChallenge = await detect3DSManualGate(
    {
      frames: () => [
        {
          url: () => "https://example.test/checkout",
          locator: () => ({
            innerText: async () => "continue shopping",
          }),
        },
      ],
    } as never
  )
  assert.equal(noChallenge.required, false)
  assert.deepEqual(noChallenge.signals, [])

  await withEnv(
    { FLOW_CAPTURE_SCREENSHOTS: "false", FLOW_CAPTURE_SENSITIVE_SCREENSHOTS: "true" },
    async () => {
      assert.equal(shouldCaptureScreenshotsForStep(step({ action: "click" })), false)
      assert.equal(
        shouldCaptureScreenshotsForStep(
          step({
            action: "type",
            value_ref: "${secrets.password}",
          })
        ),
        false
      )
    }
  )
})

test("replay-flow-execute covers empty selector and manual-gate without otp-selector branches", async () => {
  const page = {
    url: () => "https://example.test/form",
    goto: async () => undefined,
    locator: () => ({
      first: () => ({
        click: async () => undefined,
        fill: async () => undefined,
        waitFor: async () => undefined,
      }),
    }),
    frames: () => [],
  }

  const clickNoSelectors = await runStep(
    page as never,
    step({ action: "click", target: { selectors: [] } }),
    ["stripe.com"]
  )
  assert.equal(clickNoSelectors.ok, false)
  assert.match(clickNoSelectors.detail, /no selector candidates/)

  const manualGateNoOtpSelector = await runStep(
    page as never,
    step({
      action: "manual_gate",
      value_ref: "${params.input}",
      target: { selectors: [] },
    }),
    ["stripe.com"]
  )
  assert.equal(manualGateNoOtpSelector.ok, false)
  assert.equal(manualGateNoOtpSelector.manual_gate_required, true)
  assert.match(manualGateNoOtpSelector.detail, /manual gate required by flow step/)
})
