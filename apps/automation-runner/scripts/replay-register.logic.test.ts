import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import {
  ensureSafeSpecPath,
  firstStringToken,
  inferBodyMode,
  isPathInsideRoot,
  normalizePayload,
  redactPayload,
  resolveRelativeOrAbsolute,
  resolveSpecPath,
  sanitizeResponseBody,
} from "./replay-register.js"

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

test("replay-register helpers cover token discovery and URL resolution branches", () => {
  assert.equal(resolveRelativeOrAbsolute("https://example.test", "/api/register"), "https://example.test/api/register")
  assert.equal(resolveRelativeOrAbsolute("", "/api/register"), "/api/register")
  assert.equal(resolveRelativeOrAbsolute("https://example.test", "https://api.example.test/x"), "https://api.example.test/x")

  assert.equal(firstStringToken("token-1"), "token-1")
  assert.equal(firstStringToken([{ foo: "" }, { csrf_token: "abc123" }]), "abc123")
  assert.equal(firstStringToken({ nested: { nonce_value: "nonce-1" } }), "nonce-1")
  assert.equal(firstStringToken([{ ignored: "" }, ["", { tokenValue: "nested-token" }]]), "nested-token")
  assert.equal(firstStringToken({ ignore: 1 }), null)
})

test("replay-register helpers cover body mode and redaction branches", () => {
  assert.equal(
    inferBodyMode(
      { baseUrl: "https://example.test", replayHints: { bodyMode: "form" } },
      { method: "POST", path: "/x", contentType: "application/json" }
    ),
    "form"
  )
  assert.equal(
    inferBodyMode(
      { baseUrl: "https://example.test", replayHints: { contentType: "application/x-www-form-urlencoded" } },
      { method: "POST", path: "/x" }
    ),
    "form"
  )
  assert.equal(
    inferBodyMode({ baseUrl: "https://example.test" }, { method: "POST", path: "/x", contentType: "text/plain" }),
    "raw"
  )
  assert.equal(
    inferBodyMode({ baseUrl: "https://example.test" }, { method: "POST", path: "/x", contentType: null }),
    "json"
  )
  assert.equal(
    inferBodyMode(
      { baseUrl: "https://example.test", replayHints: { bodyMode: "none" } },
      { method: "POST", path: "/x", contentType: "application/json" }
    ),
    "none"
  )

  const redacted = redactPayload({
    email: "user@example.test",
    password: "secret",
    csrfToken: "abc123",
    note: "safe",
  })
  assert.equal(redacted.password, "***REDACTED***")
  assert.equal(redacted.csrfToken, "***REDACTED***")
  assert.equal(redacted.note, "safe")

  const sanitized = sanitizeResponseBody('authorization: bearer abcdef csrf_token="xyz987" code=4444')
  assert.match(sanitized, /\*\*\*REDACTED\*\*\*/)
})

test("replay-register helpers cover payload normalization and safe spec resolution", async () => {
  await withEnv(
    {
      REPLAY_PASSWORD: "pw-123",
      REPLAY_TOKEN: "token-123",
    },
    async () => {
      const normalized = normalizePayload({
        password: "***REDACTED***",
        csrfToken: "***REDACTED***",
        username: "old-user",
        nickname: "keep-me",
      })
      assert.equal(normalized.password, "pw-123")
      assert.equal(normalized.csrfToken, "token-123")
      assert.match(String(normalized.username), /replay\+/)
      assert.match(String(normalized.email), /replay\+/)
      assert.equal(normalized.nickname, "keep-me")
    }
  )

  const runtimeRoot = path.resolve(process.cwd(), "..", ".runtime-cache")
  const inside = path.resolve(runtimeRoot, "replay/spec.json")
  const outside = path.resolve(process.cwd(), "..", "spec.json")
  assert.equal(isPathInsideRoot(inside, runtimeRoot), true)
  assert.equal(isPathInsideRoot(outside, runtimeRoot), false)
  assert.equal(ensureSafeSpecPath(inside), inside)
  assert.throws(() => ensureSafeSpecPath(outside), /unsafe --spec path/)

  const sandboxRoot = path.resolve(process.cwd(), "..", ".runtime-cache", "automation")
  const sandbox = mkdtempSync(path.join(sandboxRoot, "uiq-replay-register-logic-"))
  const specPath = path.join(sandbox, "flow_request.spec.json")
  const pointerPath = path.join(sandbox, "latest-spec.json")
  writeFileSync(specPath, JSON.stringify({ baseUrl: "https://example.test", actionEndpoint: { method: "POST", path: "/register" } }), "utf8")
  writeFileSync(pointerPath, JSON.stringify({ specPath }), "utf8")

  try {
    await withEnv(
      { UIQ_AUTOMATION_LATEST_SPEC_PATH: pointerPath },
      async () => {
        const resolved = await resolveSpecPath()
        assert.equal(resolved, specPath)
      }
    )
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})
