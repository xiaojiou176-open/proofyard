import type { UniversalRun } from "../types"

export function buildApiUrl(baseUrl: string, path: string): string {
  const rawPath = path.trim()
  if (!rawPath) return path
  if (/^https?:\/\//i.test(rawPath)) return rawPath
  const normalizedPath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`

  const rawBaseUrl = baseUrl.trim()
  if (!rawBaseUrl) return normalizedPath

  if (rawBaseUrl.startsWith("/")) {
    const normalizedPrefix = rawBaseUrl === "/" ? "" : rawBaseUrl.replace(/\/+$/, "")
    return `${normalizedPrefix}${normalizedPath}`
  }

  try {
    const parsedBaseUrl = new URL(rawBaseUrl)
    if (parsedBaseUrl.protocol !== "http:" && parsedBaseUrl.protocol !== "https:")
      return normalizedPath
    return new URL(normalizedPath, parsedBaseUrl).toString()
  } catch {
    return normalizedPath
  }
}

export function normalizeTransportErrorMessage(message: string): string {
  const normalized = message.trim()
  if (!normalized) return "Backend service is temporarily unreachable."
  if (/failed to fetch|networkerror|load failed|econnrefused|fetch failed/i.test(normalized)) {
    return "Backend service connection failed."
  }
  return normalized
}

export function unwrapRunPayload(payload: unknown): UniversalRun | null {
  if (!payload || typeof payload !== "object") return null
  const candidate = payload as { run?: unknown; run_id?: unknown }
  if (candidate.run && typeof candidate.run === "object") {
    return candidate.run as UniversalRun
  }
  if (typeof candidate.run_id === "string") {
    return payload as UniversalRun
  }
  return null
}

export function formatActionableApiError(
  message: string,
  action = "Correct the current input and retry.",
  entry = "Check the task-center run logs and the browser developer-tools network panel."
): string {
  const normalized = normalizeTransportErrorMessage(message)
  if (!normalized) return ""
  if (
    normalized.includes("Issue:") &&
    normalized.includes("Suggested action:") &&
    normalized.includes("Troubleshooting:")
  ) {
    return normalized
  }
  if (
    normalized.includes("Issue:") &&
    normalized.includes("Suggested action:") &&
    normalized.includes("Troubleshooting:")
  ) {
    return normalized
  }
  return [`Issue: ${normalized}`, `Suggested action: ${action}`, `Troubleshooting: ${entry}`].join("\n")
}
