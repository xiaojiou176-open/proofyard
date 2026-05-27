import { resolve } from "node:path"
import { loadYamlFile, loadYamlFileUnderRoot } from "../../../../core/src/config/loadYaml.js"
import type { DangerActionPolicy } from "../explore.js"
import type {
  BaseUrlPolicyResult,
  ProfileConfig,
  TargetConfig,
} from "./config.js"

export const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "::1"])
export const SAFE_SLUG_PATTERN = /^[A-Za-z0-9._-]+$/
export const PROFILE_CONFIG_ROOT = resolve("configs", "profiles")
export const TARGET_CONFIG_ROOT = resolve("configs", "targets")

function assertSafeSlug(value: string, fieldName: "profileName" | "targetName"): void {
  if (!SAFE_SLUG_PATTERN.test(value)) {
    throw new Error(`Invalid ${fieldName} '${value}'; only [A-Za-z0-9._-] are allowed`)
  }
}

export function loadProfileConfig(profileName: string): ProfileConfig {
  assertSafeSlug(profileName, "profileName")
  return loadYamlFileUnderRoot<ProfileConfig>(PROFILE_CONFIG_ROOT, `${profileName}.yaml`)
}

export function loadTargetConfig(targetName: string): TargetConfig {
  assertSafeSlug(targetName, "targetName")
  return loadYamlFileUnderRoot<TargetConfig>(TARGET_CONFIG_ROOT, `${targetName}.yaml`)
}

function normalizeDangerPolicyField(
  value: unknown,
  field: keyof DangerActionPolicy,
  policyFile: string
): string[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new Error(
      `Invalid danger action policy '${policyFile}': '${field}' must be an array of strings`
    )
  }
  return value
    .map((item, index) => {
      if (typeof item !== "string") {
        throw new Error(
          `Invalid danger action policy '${policyFile}': '${field}[${index}]' must be a string`
        )
      }
      return item.trim()
    })
    .filter((item) => item.length > 0)
}

export function loadDangerActionPolicy(pathFromRepoRoot: string): DangerActionPolicy {
  try {
    const loaded =
      loadYamlFile<Partial<Record<keyof DangerActionPolicy, unknown>>>(pathFromRepoRoot)
    return {
      lexical: normalizeDangerPolicyField(loaded.lexical, "lexical", pathFromRepoRoot),
      roles: normalizeDangerPolicyField(loaded.roles, "roles", pathFromRepoRoot),
      selectors: normalizeDangerPolicyField(loaded.selectors, "selectors", pathFromRepoRoot),
      urlPatterns: normalizeDangerPolicyField(loaded.urlPatterns, "urlPatterns", pathFromRepoRoot),
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to load danger action policy '${pathFromRepoRoot}': ${detail}`)
  }
}

function normalizeScopeOrigins(domains: string[] | undefined, targetName: string): string[] {
  if (!domains || domains.length === 0) return []
  const origins: string[] = []
  for (const rawDomain of domains) {
    const domain = rawDomain.trim()
    if (domain.length === 0) continue
    let parsedDomain: URL
    try {
      parsedDomain = new URL(domain)
    } catch {
      throw new Error(`Invalid scope domain '${rawDomain}' for target '${targetName}'`)
    }
    if (parsedDomain.protocol !== "http:" && parsedDomain.protocol !== "https:") {
      throw new Error(
        `Invalid scope domain '${rawDomain}' for target '${targetName}'; only http/https are supported`
      )
    }
    origins.push(parsedDomain.origin)
  }
  return Array.from(new Set(origins))
}

function isLocalhostHost(hostname: string): boolean {
  return LOCALHOST_HOSTS.has(hostname.toLowerCase())
}

export function normalizeBaseUrl(rawBaseUrl: string, targetName: string): string {
  let parsed: URL
  try {
    parsed = new URL(rawBaseUrl)
  } catch {
    throw new Error(`Invalid --base-url '${rawBaseUrl}' for target '${targetName}'`)
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Invalid --base-url protocol '${parsed.protocol}' for target '${targetName}'; only http/https are supported`
    )
  }
  const pathname = parsed.pathname.replace(/\/+$/, "")
  const normalizedPath = pathname.length > 0 ? pathname : ""
  return `${parsed.origin}${normalizedPath}${parsed.search}`
}

export function assertBaseUrlAllowed(
  target: TargetConfig,
  baseUrl: string,
  allowAllUrls = false
): BaseUrlPolicyResult {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl, target.name)
  const parsedUrl = new URL(normalizedBaseUrl)
  const requestedOrigin = parsedUrl.origin
  if (target.type !== "web") {
    return {
      enabled: false,
      requestedUrl: normalizedBaseUrl,
      requestedOrigin,
      allowedOrigins: [],
      matched: true,
      reason: "non_web_target",
    }
  }

  const allowedOrigins = normalizeScopeOrigins(target.scope?.domains, target.name)
  if (allowAllUrls) {
    return {
      enabled: true,
      requestedUrl: normalizedBaseUrl,
      requestedOrigin,
      allowedOrigins: allowedOrigins.length > 0 ? allowedOrigins : ["*"],
      matched: true,
      reason: "allow_all_urls",
    }
  }

  if (target.scope?.allowLocalhostAnyPort === true) {
    if (!isLocalhostHost(parsedUrl.hostname)) {
      throw new Error(
        `Invalid --base-url hostname '${parsedUrl.hostname}' for target '${target.name}'; only localhost/127.0.0.1/::1 are allowed`
      )
    }
    return {
      enabled: true,
      requestedUrl: normalizedBaseUrl,
      requestedOrigin,
      allowedOrigins: [
        "http://localhost:*",
        "http://127.0.0.1:*",
        "http://[::1]:*",
        "https://localhost:*",
        "https://127.0.0.1:*",
        "https://[::1]:*",
      ],
      matched: true,
      reason: "localhost_origin_allowed",
    }
  }

  if (allowedOrigins.length === 0) {
    throw new Error(
      `Target '${target.name}' must configure scope.domains or set scope.allowLocalhostAnyPort=true for web baseUrl policy (or pass --allow-all-urls).`
    )
  }

  const matched = allowedOrigins.includes(requestedOrigin)
  if (!matched) {
    throw new Error(
      `Invalid --base-url origin '${requestedOrigin}' for target '${target.name}'; allowed origins: ${allowedOrigins.join(", ")}`
    )
  }

  return {
    enabled: true,
    requestedUrl: normalizedBaseUrl,
    requestedOrigin,
    allowedOrigins,
    matched: true,
    reason: "origin_allowed",
  }
}
