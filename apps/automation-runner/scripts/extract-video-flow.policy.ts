import { readFile } from "node:fs/promises"
import path from "node:path"
import { DEFAULT_PROVIDER_POLICY, type ProviderPolicy } from "./extract-video-flow.shared.js"

export function parsePolicyValue(raw: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const separator = trimmed.indexOf(":")
    if (separator < 0) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/gu, "")
    if (key) values[key] = value
  }
  return values
}

export function resolveProviderPolicyCandidates(): string[] {
  const envPath = process.env.PROVIDER_POLICY_PATH?.trim()
  if (envPath) return [path.resolve(process.cwd(), envPath)]
  return [
    path.resolve(process.cwd(), "configs/ai/provider-policy.yaml"),
    path.resolve(process.cwd(), "../configs/ai/provider-policy.yaml"),
  ]
}

export async function loadProviderPolicy(): Promise<ProviderPolicy> {
  const candidates = resolveProviderPolicyCandidates()
  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate, "utf-8")
      const parsed = parsePolicyValue(raw)
      const provider =
        (parsed.provider || DEFAULT_PROVIDER_POLICY.provider).trim().toLowerCase() ||
        DEFAULT_PROVIDER_POLICY.provider
      const primary =
        (parsed.primary || provider || DEFAULT_PROVIDER_POLICY.primary).trim().toLowerCase() ||
        DEFAULT_PROVIDER_POLICY.primary
      const fallback =
        (parsed.fallback || DEFAULT_PROVIDER_POLICY.fallback).trim().toLowerCase() ||
        DEFAULT_PROVIDER_POLICY.fallback
      const fallbackMode =
        (parsed.fallbackMode || DEFAULT_PROVIDER_POLICY.fallbackMode).trim().toLowerCase() ||
        DEFAULT_PROVIDER_POLICY.fallbackMode
      return {
        sourcePath: candidate,
        provider,
        primary,
        fallback,
        fallbackMode,
        strictNoFallback: fallbackMode === "strict" && fallback === "none",
      }
    } catch {
      // continue to next path candidate
    }
  }
  return {
    sourcePath: candidates[0] ?? "configs/ai/provider-policy.yaml",
    provider: DEFAULT_PROVIDER_POLICY.provider,
    primary: DEFAULT_PROVIDER_POLICY.primary,
    fallback: DEFAULT_PROVIDER_POLICY.fallback,
    fallbackMode: DEFAULT_PROVIDER_POLICY.fallbackMode,
    strictNoFallback: true,
  }
}
