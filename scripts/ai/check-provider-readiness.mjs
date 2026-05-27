#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import path from "node:path"

const DEFAULT_PRIMARY_MODEL = "gemini-3.1-pro-preview"
const DEFAULT_FAST_MODEL = "gemini-3-flash-preview"
const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-001"

const CONTROLLED_MODEL_ROLES = Object.freeze({
  primary: new Set([DEFAULT_PRIMARY_MODEL]),
  fast: new Set([DEFAULT_FAST_MODEL]),
  embedding: new Set([DEFAULT_EMBEDDING_MODEL]),
})

const ALLOWED_THINKING_LEVELS = new Set(["minimal", "low", "medium", "high"])
const ALLOWED_TOOL_MODES = new Set(["none", "auto", "any", "validated"])
const ALLOWED_CONTEXT_CACHE_MODES = new Set(["memory", "api"])
const ALLOWED_MEDIA_RESOLUTIONS = new Set(["low", "medium", "high", "native"])

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0
}

function sanitizeModel(value) {
  return String(value)
    .trim()
    .replace(/^models\//, "")
}

function readProvider() {
  const raw = process.env.VIDEO_ANALYZER_PROVIDER
  if (!hasValue(raw)) return "gemini"
  return String(raw).trim().toLowerCase()
}

function collectOpenAiEnvVars() {
  return Object.keys(process.env)
    .filter((key) => key.startsWith("OPENAI_"))
    .sort()
}

function readGeminiKey() {
  if (hasValue(process.env.GEMINI_API_KEY)) {
    return String(process.env.GEMINI_API_KEY).trim()
  }
  return ""
}

function normalizeBool(value) {
  if (!hasValue(value)) return null
  const normalized = String(value).trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) return true
  if (["0", "false", "no", "off"].includes(normalized)) return false
  return null
}

function normalizeNonNegativeInteger(value) {
  if (!hasValue(value)) return null
  if (!/^\d+$/.test(String(value).trim())) return null
  return Number.parseInt(String(value).trim(), 10)
}

function readModelByRole(role) {
  if (role === "primary") {
    if (hasValue(process.env.GEMINI_MODEL_PRIMARY))
      return sanitizeModel(process.env.GEMINI_MODEL_PRIMARY)
    return DEFAULT_PRIMARY_MODEL
  }
  if (role === "fast") {
    if (hasValue(process.env.GEMINI_MODEL_FLASH))
      return sanitizeModel(process.env.GEMINI_MODEL_FLASH)
    return DEFAULT_FAST_MODEL
  }
  if (hasValue(process.env.GEMINI_EMBED_MODEL)) return sanitizeModel(process.env.GEMINI_EMBED_MODEL)
  return DEFAULT_EMBEDDING_MODEL
}

function fail(message) {
  console.error(`[ai:check] ERROR: ${message}`)
  process.exit(1)
}

function validateControlledModels() {
  const primaryModel = readModelByRole("primary")
  const fastModel = readModelByRole("fast")
  const embeddingModel = readModelByRole("embedding")
  const roleModelMap = { primary: primaryModel, fast: fastModel, embedding: embeddingModel }

  for (const [role, model] of Object.entries(roleModelMap)) {
    const controlled = CONTROLLED_MODEL_ROLES[role]
    if (!controlled.has(model)) {
      fail(
        `${role} model '${model}' is outside controlled allowlist (${Array.from(controlled).join(", ")}).`
      )
    }
  }

  const signature = `${primaryModel}|${fastModel}|${embeddingModel}`
  if (new Set(Object.values(roleModelMap)).size !== 3) {
    fail(`Gemini model role signature must be unique per role, got '${signature}'.`)
  }

  return { primaryModel, fastModel, embeddingModel, signature }
}

function validateThinkingAndCacheConfig() {
  const thinkingLevel = hasValue(process.env.GEMINI_THINKING_LEVEL)
    ? String(process.env.GEMINI_THINKING_LEVEL).trim().toLowerCase()
    : "high"
  if (!ALLOWED_THINKING_LEVELS.has(thinkingLevel)) {
    fail(
      `GEMINI_THINKING_LEVEL must be one of ${Array.from(ALLOWED_THINKING_LEVELS).join(", ")}, got '${thinkingLevel}'.`
    )
  }

  const toolMode = hasValue(process.env.GEMINI_TOOL_MODE)
    ? String(process.env.GEMINI_TOOL_MODE).trim().toLowerCase()
    : "auto"
  if (!ALLOWED_TOOL_MODES.has(toolMode)) {
    fail(
      `GEMINI_TOOL_MODE must be one of ${Array.from(ALLOWED_TOOL_MODES).join(", ")}, got '${toolMode}'.`
    )
  }

  const includeThoughtsRaw = hasValue(process.env.GEMINI_INCLUDE_THOUGHTS)
    ? String(process.env.GEMINI_INCLUDE_THOUGHTS)
    : "true"
  const includeThoughts = normalizeBool(includeThoughtsRaw)
  if (includeThoughts === null) {
    fail(`GEMINI_INCLUDE_THOUGHTS must be a boolean-like value, got '${includeThoughtsRaw}'.`)
  }
  if (includeThoughts !== true) {
    fail("GEMINI_INCLUDE_THOUGHTS must be true in strict unified mode.")
  }

  const cacheMode = hasValue(process.env.GEMINI_CONTEXT_CACHE_MODE)
    ? String(process.env.GEMINI_CONTEXT_CACHE_MODE).trim().toLowerCase()
    : "memory"
  if (!ALLOWED_CONTEXT_CACHE_MODES.has(cacheMode)) {
    fail(
      `GEMINI_CONTEXT_CACHE_MODE must be one of ${Array.from(ALLOWED_CONTEXT_CACHE_MODES).join(", ")}, got '${cacheMode}'.`
    )
  }

  const cacheTtlRaw = hasValue(process.env.GEMINI_CONTEXT_CACHE_TTL_SECONDS)
    ? String(process.env.GEMINI_CONTEXT_CACHE_TTL_SECONDS)
    : "3600"
  const cacheTtl = normalizeNonNegativeInteger(cacheTtlRaw)
  if (cacheTtl === null) {
    fail(`GEMINI_CONTEXT_CACHE_TTL_SECONDS must be a non-negative integer, got '${cacheTtlRaw}'.`)
  }
  if (cacheTtl < 60) {
    fail(`GEMINI_CONTEXT_CACHE_TTL_SECONDS must be >= 60, got '${cacheTtl}'.`)
  }
  if (cacheTtl > 86400) {
    fail(`GEMINI_CONTEXT_CACHE_TTL_SECONDS must be <= 86400, got '${cacheTtl}'.`)
  }

  const mediaResolutionDefault = hasValue(process.env.GEMINI_MEDIA_RESOLUTION_DEFAULT)
    ? String(process.env.GEMINI_MEDIA_RESOLUTION_DEFAULT).trim().toLowerCase()
    : "high"
  if (!ALLOWED_MEDIA_RESOLUTIONS.has(mediaResolutionDefault)) {
    fail(
      `GEMINI_MEDIA_RESOLUTION_DEFAULT must be one of ${Array.from(ALLOWED_MEDIA_RESOLUTIONS).join(", ")}, got '${mediaResolutionDefault}'.`
    )
  }
  if (mediaResolutionDefault !== "high") {
    fail(
      `GEMINI_MEDIA_RESOLUTION_DEFAULT must be 'high' in strict unified mode, got '${mediaResolutionDefault}'.`
    )
  }

  if (hasValue(process.env.GEMINI_MEDIA_RESOLUTION)) {
    const mediaResolution = String(process.env.GEMINI_MEDIA_RESOLUTION).trim().toLowerCase()
    if (!ALLOWED_MEDIA_RESOLUTIONS.has(mediaResolution)) {
      fail(
        `GEMINI_MEDIA_RESOLUTION must be one of ${Array.from(ALLOWED_MEDIA_RESOLUTIONS).join(", ")}, got '${mediaResolution}'.`
      )
    }
  }

  return { thinkingLevel, toolMode, cacheMode, cacheTtl, mediaResolutionDefault }
}

function runGeminiUnifiedAdvancedGate() {
  const scriptPath = path.resolve(process.cwd(), "scripts/ci/check-gemini-advanced-unification.mjs")
  const result = spawnSync(process.execPath, [scriptPath], {
    env: process.env,
    encoding: "utf8",
  })
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "unknown gate failure").trim()
    fail(`Gemini advanced unification gate failed: ${detail}`)
  }
}

function checkProviderReadiness() {
  const provider = readProvider()
  const openAiVars = collectOpenAiEnvVars()
  const geminiKey = readGeminiKey()

  if (provider !== "gemini") {
    fail(`VIDEO_ANALYZER_PROVIDER must be 'gemini', got '${provider}'.`)
  }

  if (openAiVars.length > 0) {
    fail(`OpenAI env vars are forbidden in strict mode: ${openAiVars.join(", ")}`)
  }

  if (!geminiKey) {
    fail("GEMINI_API_KEY is required in strict mode.")
  }

  const modelGuard = validateControlledModels()
  const configGuard = validateThinkingAndCacheConfig()
  runGeminiUnifiedAdvancedGate()
  console.log(
    `[ai:check] Strict provider readiness passed: Gemini roles (${modelGuard.primaryModel}/${modelGuard.fastModel}/${modelGuard.embeddingModel}) with signature ${modelGuard.signature}; thinking=${configGuard.thinkingLevel}, tool=${configGuard.toolMode}, cache=${configGuard.cacheMode}:${configGuard.cacheTtl}s, mediaDefault=${configGuard.mediaResolutionDefault}.`
  )
}

checkProviderReadiness()
