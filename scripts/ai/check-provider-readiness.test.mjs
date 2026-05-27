import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { fileURLToPath } from "node:url"

const scriptPath = fileURLToPath(new URL("./check-provider-readiness.mjs", import.meta.url))

function createBaseEnv() {
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    VIDEO_ANALYZER_PROVIDER: "gemini",
    GEMINI_API_KEY: "test-gemini-key",
    GEMINI_MODEL_PRIMARY: "gemini-3.1-pro-preview",
    GEMINI_MODEL_FLASH: "gemini-3-flash-preview",
    GEMINI_EMBED_MODEL: "gemini-embedding-001",
    GEMINI_THINKING_LEVEL: "high",
    GEMINI_TOOL_MODE: "validated",
    GEMINI_INCLUDE_THOUGHTS: "true",
    GEMINI_CONTEXT_CACHE_MODE: "memory",
    GEMINI_CONTEXT_CACHE_TTL_SECONDS: "3600",
  }
  for (const key of Object.keys(process.env)) {
    if (!key.startsWith("OPENAI_")) continue
    delete env[key]
  }
  return env
}

function runReadiness(overrides = {}) {
  return spawnSync(process.execPath, [scriptPath], {
    env: { ...createBaseEnv(), ...overrides },
    encoding: "utf8",
  })
}

test("ai readiness passes for controlled Gemini role contract", () => {
  const result = runReadiness()
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Strict provider readiness passed/)
})

test("ai readiness fails when primary model is outside controlled role list", () => {
  const result = runReadiness({ GEMINI_MODEL_PRIMARY: "gemini-2.5-pro" })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /outside controlled allowlist/)
})

test("ai readiness fails when context cache mode is invalid", () => {
  const result = runReadiness({ GEMINI_CONTEXT_CACHE_MODE: "redis" })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /GEMINI_CONTEXT_CACHE_MODE must be one of/)
})

test("ai readiness fails when GEMINI_API_KEY is missing", () => {
  const result = runReadiness({
    GEMINI_API_KEY: "",
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /GEMINI_API_KEY is required in strict mode/)
})
