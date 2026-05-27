import path from "node:path"
import { GoogleGenAI, ThinkingLevel } from "@google/genai"
import {
  createContextCacheKey,
  readContextCache,
  writeContextCache,
} from "./lib/ai-input-pack.js"
import { tryParseJson, normalizeModelSteps } from "./extract-video-flow.event-log.js"
import { resolveGeminiRuntimeOptions } from "./extract-video-flow.runtime.js"
import {
  ACTION_SCHEMA_ACTIONS,
  DEFAULT_GEMINI_MODEL,
  FAST_GEMINI_MODEL,
  INVALID_ACTION_SCHEMA_REASON,
  MODEL_RESPONSE_JSON_SCHEMA,
  type AnalysisMeta,
  type AnalyzeOptions,
  type AnalyzeWithModelOptions,
  type CandidateStep,
  type ModelAnalysis,
  type ModelAttempt,
  type ModelResolution,
  RUNTIME_ROOT,
  type ThinkingLevelName,
} from "./extract-video-flow.shared.js"

function classifyGeminiUnavailableStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 408 || status === 429 || status >= 500
}

function toGeminiThinkingLevel(level: ThinkingLevelName): ThinkingLevel {
  if (level === "minimal") return ThinkingLevel.MINIMAL
  if (level === "low") return ThinkingLevel.LOW
  if (level === "medium") return ThinkingLevel.MEDIUM
  return ThinkingLevel.HIGH
}

function isSpeedModeEnabled(): boolean {
  const value = (process.env.AI_SPEED_MODE ?? "").trim().toLowerCase()
  return value === "1" || value === "true" || value === "yes" || value === "on"
}

function extractThoughtSignatures(response: unknown): {
  status: "present" | "missing" | "parse_failed"
  reasonCode: string
  signatures: string[]
} {
  try {
    const root = response as {
      candidates?: Array<{
        content?: {
          parts?: Array<Record<string, unknown>>
        }
      }>
    }
    const candidates = Array.isArray(root?.candidates) ? root.candidates : []
    const signatures = new Set<string>()
    let malformed = false
    for (const candidate of candidates) {
      const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []
      for (const part of parts) {
        const directValues = [
          part.thoughtSignature,
          part.thought_signature,
          part.signature,
          part.thought_signature_text,
        ]
        for (const value of directValues) {
          if (value === undefined || value === null) continue
          if (typeof value === "string" && value.trim()) signatures.add(value.trim())
          else malformed = true
        }
        const thought = part.thought
        if (thought && typeof thought === "object") {
          const thoughtRecord = thought as Record<string, unknown>
          for (const value of [
            thoughtRecord.thoughtSignature,
            thoughtRecord.thought_signature,
            thoughtRecord.signature,
          ]) {
            if (value === undefined || value === null) continue
            if (typeof value === "string" && value.trim()) signatures.add(value.trim())
            else malformed = true
          }
        }
      }
    }
    if (signatures.size > 0) {
      return {
        status: "present",
        reasonCode: "ai.gemini.thought_signature.present",
        signatures: [...signatures],
      }
    }
    if (malformed) {
      return {
        status: "parse_failed",
        reasonCode: "ai.gemini.thought_signature.parse_failed",
        signatures: [],
      }
    }
    return {
      status: "missing",
      reasonCode: "ai.gemini.thought_signature.missing",
      signatures: [],
    }
  } catch {
    return {
      status: "parse_failed",
      reasonCode: "ai.gemini.thought_signature.parse_failed",
      signatures: [],
    }
  }
}

function resolveGeminiModels(explicitPrimaryModel?: string): {
  models: string[]
  primaryModel: string
  flashModel: string | null
  speedMode: boolean
} {
  const primaryModel =
    explicitPrimaryModel?.trim() ||
    (process.env.GEMINI_MODEL_PRIMARY ?? "").trim() ||
    `models/${DEFAULT_GEMINI_MODEL}`
  const speedMode = isSpeedModeEnabled()
  const flashModel = speedMode
    ? (process.env.GEMINI_MODEL_FLASH ?? "").trim() || `models/${FAST_GEMINI_MODEL}`
    : null
  const models = [
    ...new Set([flashModel, primaryModel].filter((model): model is string => Boolean(model))),
  ]
  return { models, primaryModel, flashModel, speedMode }
}

function resolveGeminiSuccessReasonCode(params: {
  speedMode: boolean
  flashModel: string | null
  primaryModel: string
  model: string
  index: number
  cacheHit: boolean
}): string {
  const base = (() => {
    if (params.speedMode && params.flashModel && params.model === params.flashModel) {
      return "ai.gemini.success.flash"
    }
    if (params.speedMode && params.model === params.primaryModel && params.index > 0) {
      return "ai.gemini.success.flash_fallback_primary"
    }
    return "ai.gemini.success.primary"
  })()
  return params.cacheHit ? `${base}.cache_hit` : base
}

async function analyzeWithGemini(
  contextPayload: Record<string, unknown>,
  options: AnalyzeOptions
): Promise<ModelResolution> {
  const apiKey = process.env.GEMINI_API_KEY
  const runtime = resolveGeminiRuntimeOptions(options.runtime)
  const { models, primaryModel, flashModel, speedMode } = resolveGeminiModels(runtime.modelName)
  const thinkingLevelName = runtime.thinkingLevel
  const thinkingLevel = toGeminiThinkingLevel(thinkingLevelName)
  const includeThoughts = runtime.includeThoughts
  const prompt = [
    "Return JSON only. No markdown.",
    'Schema: {"detectedSignals": string[], "candidateSteps": CandidateStep[]}',
    `CandidateStep action values: ${ACTION_SCHEMA_ACTIONS.join("|")}.`,
    `Thinking level: ${thinkingLevelName}.`,
    JSON.stringify(contextPayload),
  ].join("\n")

  const attempts: ModelAttempt[] = []
  const modelCacheKeys = models.map((model) =>
    createContextCacheKey({
      namespace: "video-flow.gemini.analysis.v1",
      provider: "gemini",
      model,
      input: contextPayload,
      extras: { thinkingLevel: thinkingLevelName },
    })
  )

  for (const [index, model] of models.entries()) {
    const cacheKey = modelCacheKeys[index]!
    const cachePath = path.join(options.cacheDir, `${cacheKey.key}.json`)
    const cached = await readContextCache<ModelAnalysis>(options.cacheDir, cacheKey)
    if (!cached) continue
    const analysis: ModelAnalysis = {
      detectedSignals: Array.isArray(cached.detectedSignals) ? cached.detectedSignals : [],
      candidateSteps: Array.isArray(cached.candidateSteps) ? cached.candidateSteps : [],
      modelName: cached.modelName ?? model,
    }
    const reasonCode = resolveGeminiSuccessReasonCode({
      speedMode,
      flashModel,
      primaryModel,
      model,
      index,
      cacheHit: true,
    })
    attempts.push({
      provider: "gemini",
      status: "success",
      reasonCode,
      modelName: model,
      analysis,
      cacheHit: true,
      cacheKey: cacheKey.key,
      cachePath,
    })
    return {
      selectedProvider: "gemini",
      reasonCode,
      fallbackUsed: speedMode && model === primaryModel && index > 0,
      attempts,
      analysis,
      contextCache: {
        hit: true,
        key: cacheKey.key,
        path: cachePath,
        modelName: model,
      },
      thoughtSignatures: {
        includeThoughtsEnabled: includeThoughts,
        status: analysis.thoughtSignatures?.status ?? "missing",
        reasonCode: analysis.thoughtSignatures?.reasonCode ?? "ai.gemini.thought_signature.missing",
        signatures: analysis.thoughtSignatures?.signatures ?? [],
      },
    }
  }

  if (!apiKey) {
    return {
      selectedProvider: "none",
      reasonCode: "ai.gemini.unavailable.no_api_key",
      fallbackUsed: false,
      attempts: [
        ...attempts,
        {
          provider: "gemini",
          status: "unavailable",
          reasonCode: "ai.gemini.unavailable.no_api_key",
          detail: "GEMINI_API_KEY is required",
        },
      ],
      analysis: null,
      contextCache: {
        hit: false,
        key: null,
        path: null,
        modelName: null,
      },
      thoughtSignatures: {
        includeThoughtsEnabled: includeThoughts,
        status: "missing",
        reasonCode: "ai.gemini.thought_signature.missing.no_api_key",
        signatures: [],
      },
    }
  }

  const client = new GoogleGenAI({ apiKey })
  for (const [index, model] of models.entries()) {
    const cacheKey = modelCacheKeys[index]!
    const cachePath = path.join(options.cacheDir, `${cacheKey.key}.json`)
    try {
      const response = await client.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: MODEL_RESPONSE_JSON_SCHEMA,
          thinkingConfig: {
            thinkingLevel,
            includeThoughts,
          },
          temperature: 0.1,
        },
      })
      const thoughtSignatures = extractThoughtSignatures(response)
      const text = response.text?.trim() ?? ""
      const json = tryParseJson(text)
      if (!json || typeof json !== "object") {
        attempts.push({
          provider: "gemini",
          status: "failed",
          reasonCode: "ai.gemini.failed.invalid_payload",
          modelName: model,
          detail: "model response is not a valid JSON object",
        })
        continue
      }
      const record = json as Record<string, unknown>
      if (
        !Array.isArray(record.detectedSignals) ||
        record.detectedSignals.some((item) => typeof item !== "string") ||
        !Array.isArray(record.candidateSteps)
      ) {
        attempts.push({
          provider: "gemini",
          status: "failed",
          reasonCode: "ai.gemini.failed.invalid_payload",
          modelName: model,
          detail: "model response does not satisfy required schema fields",
        })
        continue
      }
      const normalizedModelSteps = normalizeModelSteps(record.candidateSteps, "gemini-video")
      if (normalizedModelSteps.invalidAction) {
        attempts.push({
          provider: "gemini",
          status: "failed",
          reasonCode: INVALID_ACTION_SCHEMA_REASON,
          modelName: model,
          detail: `invalid action from model: ${normalizedModelSteps.invalidAction}`,
        })
        continue
      }
      const candidateSteps = normalizedModelSteps.steps
      if (record.candidateSteps.length > 0 && candidateSteps.length === 0) {
        attempts.push({
          provider: "gemini",
          status: "failed",
          reasonCode: "ai.gemini.failed.invalid_payload",
          modelName: model,
          detail: "candidateSteps exists but no valid step could be parsed",
        })
        continue
      }
      const analysis: ModelAnalysis = {
        detectedSignals: [
          ...new Set(
            record.detectedSignals.map((item) => item.trim()).filter((item) => item.length > 0)
          ),
        ],
        candidateSteps,
        modelName: model,
        thoughtSignatures,
      }
      let persistedPath: string | null = null
      try {
        persistedPath = await writeContextCache(options.cacheDir, cacheKey, analysis)
      } catch {
        persistedPath = null
      }
      const reasonCode = resolveGeminiSuccessReasonCode({
        speedMode,
        flashModel,
        primaryModel,
        model,
        index,
        cacheHit: false,
      })
      attempts.push({
        provider: "gemini",
        status: "success",
        reasonCode,
        modelName: model,
        analysis,
        cacheHit: false,
        cacheKey: cacheKey.key,
        cachePath: persistedPath ?? cachePath,
        thoughtSignatureStatus: thoughtSignatures.status,
        thoughtSignatureReasonCode: thoughtSignatures.reasonCode,
        thoughtSignatureCount: thoughtSignatures.signatures.length,
      })
      return {
        selectedProvider: "gemini",
        reasonCode,
        fallbackUsed: speedMode && model === primaryModel && index > 0,
        attempts,
        analysis,
        contextCache: {
          hit: false,
          key: cacheKey.key,
          path: persistedPath ?? cachePath,
          modelName: model,
        },
        thoughtSignatures: {
          includeThoughtsEnabled: includeThoughts,
          status: thoughtSignatures.status,
          reasonCode: thoughtSignatures.reasonCode,
          signatures: thoughtSignatures.signatures,
        },
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      const status = (() => {
        if (!error || typeof error !== "object") return Number.NaN
        const value = (error as { status?: unknown }).status
        return typeof value === "number" ? value : Number.NaN
      })()
      const unavailable = Number.isFinite(status) && classifyGeminiUnavailableStatus(status)
      attempts.push({
        provider: "gemini",
        status: unavailable ? "unavailable" : "failed",
        reasonCode: unavailable
          ? "ai.gemini.unavailable.request_failed"
          : "ai.gemini.failed.request_failed",
        modelName: model,
        detail: Number.isFinite(status) ? `status=${status}` : detail,
        cacheHit: false,
        cacheKey: cacheKey.key,
        cachePath,
      })
    }
  }

  const hasUnavailable = attempts.some((attempt) => attempt.status === "unavailable")
  return {
    selectedProvider: "none",
    reasonCode: hasUnavailable
      ? "ai.gemini.unavailable.all_models_failed"
      : "ai.gemini.failed.all_models_failed",
    fallbackUsed: attempts.length > 1,
    attempts,
    analysis: null,
    contextCache: {
      hit: false,
      key: null,
      path: null,
      modelName: null,
    },
    thoughtSignatures: {
      includeThoughtsEnabled: includeThoughts,
      status: "missing",
      reasonCode: hasUnavailable
        ? "ai.gemini.thought_signature.missing.unavailable"
        : "ai.gemini.thought_signature.missing",
      signatures: [],
    },
  }
}

export async function analyzeWithModelResolution(
  contextPayload: Record<string, unknown>,
  options: AnalyzeOptions
): Promise<ModelResolution> {
  return analyzeWithGemini(contextPayload, options)
}

export async function analyzeWithModel(
  contextPayload: Record<string, unknown>,
  options: AnalyzeWithModelOptions = {}
): Promise<ModelAnalysis | null> {
  const runtime = resolveGeminiRuntimeOptions(options.runtime)
  const helper = options.analyzers?.analyzeWithGeminiHelper
  if (helper) {
    return helper(contextPayload, runtime)
  }
  const cacheDir = options.cacheDir ?? path.join(RUNTIME_ROOT, ".context-cache", "video-flow")
  const resolution = await analyzeWithModelResolution(contextPayload, {
    cacheDir,
    runtime: options.runtime,
  })
  return resolution.analysis
}

export function resolveAnalysisResult(
  llm: ModelAnalysis | null,
  fallbackSteps: CandidateStep[]
): {
  analysisPath: "llm" | "event-log-fallback"
  analysisEngine: string
  candidateSteps: CandidateStep[]
  analysisMeta: AnalysisMeta
} {
  const hasLlmSteps = Boolean(llm && llm.candidateSteps.length > 0)
  const candidateSteps = hasLlmSteps ? llm!.candidateSteps : fallbackSteps
  const defaultMeta: AnalysisMeta = {
    modelName: hasLlmSteps ? (llm?.modelName ?? "gemini") : "event-log-fallback",
    thinking: "high",
    toolMode: "auto",
    mediaResolutionApplied: {
      default: "high",
      perPart: {},
    },
    thoughtSummaryPresent: false,
  }
  return {
    analysisPath: hasLlmSteps ? "llm" : "event-log-fallback",
    analysisEngine: hasLlmSteps ? (llm?.modelName ?? "gemini") : "event-log-fallback",
    candidateSteps,
    analysisMeta: llm?.analysisMeta ?? defaultMeta,
  }
}
