import { readFile } from "node:fs/promises"
import path from "node:path"
import { automationBool, automationEnv } from "./lib/env.js"
import {
  DEFAULT_GEMINI_MODEL,
  FAST_GEMINI_MODEL,
  type GeminiMediaResolution,
  type GeminiQualityProfile,
  type GeminiRuntimeOptions,
  type GeminiThinkingLevel,
  type GeminiToolMode,
  RUNTIME_ROOT,
} from "./extract-video-flow.shared.js"

export function getArg(name: string): string | null {
  const prefix = `--${name}=`
  const found = process.argv.find((arg) => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : null
}

function parseBoolOption(value: string | null | undefined, fallback: boolean): boolean {
  if (typeof value !== "string") return fallback
  const normalized = value.trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) return true
  if (["0", "false", "no", "off"].includes(normalized)) return false
  return fallback
}

function parseThinkingLevel(
  value: string | null | undefined,
  fallback: GeminiThinkingLevel = "high"
): GeminiThinkingLevel {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
  if (["minimal", "low", "medium", "high"].includes(normalized))
    return normalized as GeminiThinkingLevel
  return fallback
}

function parseToolMode(
  value: string | null | undefined,
  fallback: GeminiToolMode = "auto"
): GeminiToolMode {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
  if (["none", "auto", "any", "validated"].includes(normalized)) return normalized as GeminiToolMode
  return fallback
}

function parseQualityProfile(
  value: string | null | undefined,
  fallback: GeminiQualityProfile = "pro"
): GeminiQualityProfile {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
  return normalized === "fast" ? "fast" : fallback
}

function parseMediaResolution(
  value: string | null | undefined,
  fallback: GeminiMediaResolution = "high"
): GeminiMediaResolution {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
  if (["low", "medium", "high"].includes(normalized)) return normalized as GeminiMediaResolution
  return fallback
}

export function resolveGeminiRuntimeOptions(
  runtime: Partial<GeminiRuntimeOptions> = {}
): GeminiRuntimeOptions {
  const envModel = automationEnv("GEMINI_MODEL_PRIMARY", "").trim()
  const argModel = getArg("geminiModel")
  const explicitModel = runtime.modelName?.trim() || argModel?.trim() || envModel

  const qualityProfile =
    runtime.qualityProfile ??
    parseQualityProfile(
      getArg("geminiQuality"),
      parseQualityProfile(automationEnv("GEMINI_QUALITY_PROFILE", ""), "pro")
    )
  const modelName =
    explicitModel || (qualityProfile === "fast" ? FAST_GEMINI_MODEL : DEFAULT_GEMINI_MODEL)

  const thinkingLevel =
    runtime.thinkingLevel ??
    parseThinkingLevel(
      getArg("geminiThinkingLevel"),
      parseThinkingLevel(automationEnv("GEMINI_THINKING_LEVEL", ""), "high")
    )
  const includeThoughts =
    runtime.includeThoughts ??
    parseBoolOption(
      getArg("geminiIncludeThoughts"),
      automationBool("GEMINI_INCLUDE_THOUGHTS", true)
    )
  const toolMode =
    runtime.toolMode ??
    parseToolMode(
      getArg("geminiToolMode"),
      parseToolMode(automationEnv("GEMINI_TOOL_MODE", ""), "auto")
    )
  const mediaResolution =
    runtime.mediaResolution ??
    parseMediaResolution(
      getArg("geminiMediaResolution"),
      parseMediaResolution(
        automationEnv("GEMINI_MEDIA_RESOLUTION", "") ||
          automationEnv("GEMINI_MEDIA_RESOLUTION_DEFAULT", ""),
        "high"
      )
    )

  return {
    modelName,
    thinkingLevel,
    includeThoughts,
    toolMode,
    qualityProfile,
    mediaResolution,
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf-8")
  return JSON.parse(raw) as T
}

export async function readJsonOrDefault<T>(filePath: string, defaultValue: T): Promise<T> {
  try {
    return await readJson<T>(filePath)
  } catch {
    return defaultValue
  }
}

export async function readTextOrDefault(filePath: string, fallback: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8")
  } catch {
    return fallback
  }
}

export async function resolveSessionDir(): Promise<string> {
  const arg = getArg("sessionDir")
  if (arg) return path.resolve(process.cwd(), arg)
  const latest = await readJson<{ sessionDir: string }>(
    path.join(RUNTIME_ROOT, "latest-session.json")
  )
  return latest.sessionDir
}
