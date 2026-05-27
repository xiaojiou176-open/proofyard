import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { CORE_ACTION_SCHEMA_PATH } from "../../../packages/core/index.js"

export type SelectorCandidate = {
  kind: "role" | "css" | "id" | "name"
  value: string
  score: number
}

export type CandidateStep = {
  step_id: string
  action: "navigate" | "click" | "type" | "manual_gate" | "assert" | "wait_for" | "extract"
  url?: string
  value_ref?: string
  target?: {
    selectors: SelectorCandidate[]
  }
  confidence: number
  source_engine: string
  evidence_ref: string
  unsupported_reason?: string
}

export type ModelAnalysis = {
  detectedSignals: string[]
  candidateSteps: CandidateStep[]
  modelName?: string
  analysisMeta?: {
    modelName: string
    thinking: string
    toolMode: string
    mediaResolutionApplied: {
      default: string
      perPart: Record<string, string>
    }
    thoughtSummaryPresent: boolean
  }
  thoughtSignatures?: {
    status: "present" | "missing" | "parse_failed"
    reasonCode: string
    signatures: string[]
  }
}

export type ProviderName = "gemini"
export type ThinkingLevelName = "minimal" | "low" | "medium" | "high"
export type GeminiThinkingLevel = ThinkingLevelName
export type GeminiToolMode = "none" | "auto" | "any" | "validated"
export type GeminiQualityProfile = "pro" | "fast"
export type GeminiMediaResolution = "low" | "medium" | "high"

export type GeminiRuntimeOptions = {
  modelName: string
  thinkingLevel: GeminiThinkingLevel
  includeThoughts: boolean
  toolMode: GeminiToolMode
  qualityProfile: GeminiQualityProfile
  mediaResolution: GeminiMediaResolution
}

export type AnalysisMeta = NonNullable<ModelAnalysis["analysisMeta"]>

export type ModelAttempt = {
  provider: ProviderName
  status: "success" | "unavailable" | "failed"
  reasonCode: string
  modelName?: string
  detail?: string
  analysis?: ModelAnalysis
  cacheHit?: boolean
  cacheKey?: string
  cachePath?: string
  thoughtSignatureStatus?: "present" | "missing" | "parse_failed"
  thoughtSignatureReasonCode?: string
  thoughtSignatureCount?: number
}

export type ModelContextCache = {
  hit: boolean
  key: string | null
  path: string | null
  modelName: string | null
}

export type ModelResolution = {
  selectedProvider: ProviderName | "none"
  reasonCode: string
  fallbackUsed: boolean
  attempts: ModelAttempt[]
  analysis: ModelAnalysis | null
  contextCache: ModelContextCache
  thoughtSignatures: {
    includeThoughtsEnabled: boolean
    status: "present" | "missing" | "parse_failed"
    reasonCode: string
    signatures: string[]
  }
}

export type AnalyzeOptions = {
  cacheDir: string
  runtime?: Partial<GeminiRuntimeOptions>
}

export type AnalyzeWithModelOptions = {
  cacheDir?: string
  runtime?: Partial<GeminiRuntimeOptions>
  provider?: string
  analyzers?: {
    analyzeWithGeminiHelper?: (
      contextPayload: Record<string, unknown>,
      runtime: GeminiRuntimeOptions
    ) => Promise<ModelAnalysis | null>
  }
}

export type ProviderPolicy = {
  sourcePath: string
  provider: string
  primary: string
  fallback: string
  fallbackMode: string
  strictNoFallback: boolean
}

export type NormalizedModelSteps = {
  steps: CandidateStep[]
  invalidAction?: string
}

export const RUNTIME_ROOT = path.resolve(process.cwd(), "..", "..", ".runtime-cache", "automation")
export const DEFAULT_GEMINI_MODEL = "gemini-3.1-pro-preview"
export const FAST_GEMINI_MODEL = "gemini-3-flash-preview"
export const DEFAULT_PROVIDER_POLICY = {
  provider: "gemini",
  primary: "gemini",
  fallback: "none",
  fallbackMode: "strict",
}
export const INVALID_ACTION_SCHEMA_REASON = "ai.gemini.invalid_action_schema"

const ACTION_SCHEMA_PATH = fileURLToPath(CORE_ACTION_SCHEMA_PATH)

type ActionSchema = {
  actions: string[]
}

function loadActionSchemaActions(): string[] {
  const raw = readFileSync(ACTION_SCHEMA_PATH, "utf-8")
  const parsed = JSON.parse(raw) as ActionSchema
  if (
    !Array.isArray(parsed.actions) ||
    parsed.actions.some((action) => typeof action !== "string")
  ) {
    throw new Error(`invalid action schema at ${ACTION_SCHEMA_PATH}`)
  }
  return parsed.actions
}

export const ACTION_SCHEMA_ACTIONS = loadActionSchemaActions()
export const ACTION_SCHEMA_SET = new Set(ACTION_SCHEMA_ACTIONS)

export const MODEL_RESPONSE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["detectedSignals", "candidateSteps"],
  properties: {
    detectedSignals: {
      type: "array",
      items: { type: "string" },
    },
    candidateSteps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["step_id", "action", "confidence", "source_engine", "evidence_ref"],
        properties: {
          step_id: { type: "string" },
          action: { type: "string", enum: ACTION_SCHEMA_ACTIONS },
          url: { type: "string" },
          value_ref: { type: "string" },
          target: {
            type: "object",
            additionalProperties: false,
            required: ["selectors"],
            properties: {
              selectors: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["kind", "value", "score"],
                  properties: {
                    kind: { type: "string", enum: ["role", "css", "id", "name"] },
                    value: { type: "string" },
                    score: { type: "number" },
                  },
                },
              },
            },
          },
          confidence: { type: "number" },
          source_engine: { type: "string" },
          evidence_ref: { type: "string" },
          unsupported_reason: { type: "string" },
        },
      },
    },
  },
} as const
