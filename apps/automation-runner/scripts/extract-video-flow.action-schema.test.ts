import assert from "node:assert/strict"
import test from "node:test"

import { ACTION_SCHEMA_ACTIONS, normalizeModelSteps } from "./extract-video-flow.js"

test("action schema exposes expected canonical actions", () => {
  assert.deepEqual(ACTION_SCHEMA_ACTIONS, [
    "navigate",
    "click",
    "type",
    "manual_gate",
    "assert",
    "wait_for",
    "extract",
  ])
})

test("normalizeModelSteps fails fast on invalid action", () => {
  const normalized = normalizeModelSteps(
    [
      {
        step_id: "s1",
        action: "drag",
        confidence: 0.8,
        source_engine: "gemini-video",
        evidence_ref: "llm:test",
      },
    ],
    "gemini-video"
  )

  assert.equal(normalized.steps.length, 0)
  assert.equal(normalized.invalidAction, "drag")
})

test("normalizeModelSteps accepts existing valid actions", () => {
  const normalized = normalizeModelSteps(
    [
      {
        step_id: "s1",
        action: "click",
        confidence: 0.8,
        source_engine: "gemini-video",
        evidence_ref: "llm:test",
        target: { selectors: [{ kind: "css", value: "#submit", score: 80 }] },
      },
    ],
    "gemini-video"
  )

  assert.equal(normalized.invalidAction, undefined)
  assert.equal(normalized.steps.length, 1)
  assert.equal(normalized.steps[0]?.action, "click")
})

test("normalizeModelSteps rewrites OTP manual_gate into type action", () => {
  const normalized = normalizeModelSteps(
    [
      {
        step_id: "s-otp",
        action: "manual_gate",
        confidence: 0.9,
        source_engine: "gemini-video",
        evidence_ref: "llm:otp",
        unsupported_reason: "Enter OTP verification code from SMS",
        target: {
          selectors: [{ kind: "css", value: "input[name='otp']", score: 88 }],
        },
      },
    ],
    "gemini-video"
  )

  assert.equal(normalized.invalidAction, undefined)
  assert.equal(normalized.steps.length, 1)
  assert.equal(normalized.steps[0]?.action, "type")
  assert.equal(normalized.steps[0]?.value_ref, "${params.otp}")
})
