import { isAbsolute } from "node:path"
import { loadYamlFile } from "../../../../core/src/config/loadYaml.js"
import { CONFIG_NAME_PATTERN } from "./run-schema.js"
import type { BaseUrlPolicyResult, ProfileConfig, TargetConfig } from "./run-types.js"
import { validateProfileConfig, validateTargetConfig } from "./run-validate.js"

function sanitizeConfigName(kind: "profile" | "target", input: string): string {
  const normalized = input.trim()
  if (!normalized) {
    throw new Error(`Invalid ${kind}: empty value`)
  }
  if (isAbsolute(normalized)) {
    throw new Error(`Invalid ${kind}: absolute path is not allowed`)
  }
  if (normalized.includes("/") || normalized.includes("\\") || normalized.includes("..")) {
    throw new Error(`Invalid ${kind}: path separators or '..' are not allowed`)
  }
  if (!CONFIG_NAME_PATTERN.test(normalized)) {
    throw new Error(`Invalid ${kind}: only [A-Za-z0-9._-] allowed`)
  }
  return normalized
}

export function loadProfileConfig(profileName: string): ProfileConfig {
  const safeProfileName = sanitizeConfigName("profile", profileName)
  const loaded = loadYamlFile<ProfileConfig>(`configs/profiles/${safeProfileName}.yaml`)
  return validateProfileConfig(loaded, safeProfileName)
}

export function loadTargetConfig(targetName: string): TargetConfig {
  const safeTargetName = sanitizeConfigName("target", targetName)
  const loaded = loadYamlFile<TargetConfig>(`configs/targets/${safeTargetName}.yaml`)
  return validateTargetConfig(loaded, safeTargetName)
}

function isLocalhostHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]"
}

export function assertBaseUrlAllowed(target: TargetConfig, baseUrl: string): BaseUrlPolicyResult {
  const requestedOrigin = new URL(baseUrl).origin
  const requestedUrl = new URL(baseUrl)
  if (target.type !== "web") {
    return {
      enabled: false,
      requestedUrl: baseUrl,
      requestedOrigin,
      allowedOrigins: [],
      matched: true,
      reason: "non_web_target",
    }
  }

  if (target.scope?.allowLocalhostAnyPort === true) {
    if (!isLocalhostHost(requestedUrl.hostname)) {
      throw new Error(
        `Blocked --base-url for target '${target.name}' | requestedUrl=${baseUrl} | requestedOrigin=${requestedOrigin} | reason=localhost_any_port_requires_localhost`
      )
    }
    return {
      enabled: true,
      requestedUrl: baseUrl,
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

  const allowDomains = target.scope?.domains ?? []
  if (allowDomains.length === 0) {
    return {
      enabled: false,
      requestedUrl: baseUrl,
      requestedOrigin,
      allowedOrigins: [],
      matched: true,
      reason: "no_scope_domains",
    }
  }

  const allowedOrigins = allowDomains.map((domain) => {
    try {
      return new URL(domain).origin
    } catch {
      throw new Error(`Invalid target scope domain '${domain}' in target '${target.name}'`)
    }
  })

  if (!allowedOrigins.includes(requestedOrigin)) {
    throw new Error(
      [
        `Blocked --base-url for target '${target.name}'`,
        `requestedUrl=${baseUrl}`,
        `requestedOrigin=${requestedOrigin}`,
        `allowedOrigins=[${allowedOrigins.join(", ")}]`,
        "reason=origin_not_in_scope_domains",
      ].join(" | ")
    )
  }

  return {
    enabled: true,
    requestedUrl: baseUrl,
    requestedOrigin,
    allowedOrigins,
    matched: true,
    reason: "origin_allowed",
  }
}
