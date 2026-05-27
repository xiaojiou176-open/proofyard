import assert from "node:assert/strict"
import test from "node:test"
import {
  callGeminiWithRetries,
  classifyRequestFailure,
  MAX_RETRIES,
  parseArgs,
} from "./uiq-gemini-live-smoke-gate.mjs"

function withEnv(overrides, fn) {
  const keys = Object.keys(overrides)
  const snapshot = new Map(keys.map((key) => [key, process.env[key]]))
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = String(value)
    }
  }
  try {
    return fn()
  } finally {
    for (const [key, value] of snapshot.entries()) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

test("parseArgs enables required by default in CI, and can be required locally", () => {
  withEnv(
    {
      CI: "true",
      UIQ_GEMINI_LIVE_SMOKE_REQUIRED: undefined,
    },
    () => {
      const options = parseArgs([])
      assert.equal(options.required, true)
    }
  )

  withEnv(
    {
      CI: "false",
      UIQ_GEMINI_LIVE_SMOKE_REQUIRED: "true",
    },
    () => {
      const options = parseArgs([])
      assert.equal(options.required, true)
    }
  )
})

test("parseArgs clamps retries to <= 2", () => {
  withEnv(
    {
      UIQ_GEMINI_LIVE_SMOKE_RETRIES: "99",
    },
    () => {
      const options = parseArgs([])
      assert.equal(options.retries, MAX_RETRIES)
    }
  )

  withEnv({}, () => {
    const options = parseArgs(["--retries", "5"])
    assert.equal(options.retries, MAX_RETRIES)
  })
})

test("classifyRequestFailure maps retryable errors", () => {
  const abortError = new Error("request was aborted")
  abortError.name = "AbortError"
  const timeout = classifyRequestFailure(abortError)
  assert.equal(timeout.reason, "request_timeout")
  assert.equal(timeout.retryable, true)

  const network = classifyRequestFailure(new Error("ECONNRESET fetch failed"))
  assert.equal(network.reason, "request_network_error")
  assert.equal(network.retryable, true)

  const generic = classifyRequestFailure(new Error("boom"))
  assert.equal(generic.reason, "request_exception")
  assert.equal(generic.retryable, false)
})

test("callGeminiWithRetries retries retryable failures and reports attempts", async () => {
  let called = 0
  const fakeCallGemini = async () => {
    called += 1
    if (called < 3) {
      return {
        ok: false,
        httpStatus: 503,
        rawText: "",
        json: null,
        durationMs: 1,
      }
    }
    return {
      ok: true,
      httpStatus: 200,
      rawText: '{"candidates":[{"content":{"parts":[{"text":"OK"}]}}]}',
      json: { candidates: [{ content: { parts: [{ text: "OK" }] } }] },
      durationMs: 1,
    }
  }

  const result = await callGeminiWithRetries(
    {
      endpoint: "https://example.com",
      model: "gemini-3-flash-preview",
      apiKey: "test-key",
      prompt: "Return exactly: OK",
      timeoutMs: 1000,
      retries: 2,
    },
    fakeCallGemini
  )

  assert.equal(result.ok, true)
  assert.equal(result.attemptCount, 3)
  assert.equal(result.attempts.length, 3)
})

test("callGeminiWithRetries stops at max retries with classified reason", async () => {
  const abortError = new Error("aborted")
  abortError.name = "AbortError"
  let called = 0
  const alwaysAbort = async () => {
    called += 1
    throw abortError
  }
  const result = await callGeminiWithRetries(
    {
      endpoint: "https://example.com",
      model: "gemini-3-flash-preview",
      apiKey: "test-key",
      prompt: "Return exactly: OK",
      timeoutMs: 1000,
      retries: 2,
    },
    alwaysAbort
  )

  assert.equal(result.ok, false)
  assert.equal(result.attemptCount, 3)
  assert.equal(result.failureReason, "request_timeout")
  assert.equal(called, 3)
})
