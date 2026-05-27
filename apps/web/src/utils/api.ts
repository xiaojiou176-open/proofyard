function normalizeDetail(raw: unknown): string {
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    return trimmed || "unknown error"
  }
  if (raw && typeof raw === "object") {
    try {
      return JSON.stringify(raw)
    } catch {
      return "[unserializable detail]"
    }
  }
  return "unknown error"
}

export async function readErrorDetail(
  response: Response
): Promise<{ status: number; detail: string; requestId: string | null }> {
  const cloned = typeof response.clone === "function" ? response.clone() : null
  const payload = (await response.json().catch(() => null)) as { detail?: unknown } | null
  const fallbackText = cloned
    ? await cloned
        .text()
        .then((text) => text.trim())
        .catch(() => "")
    : ""
  const detail =
    payload?.detail !== undefined
      ? normalizeDetail(payload.detail)
      : fallbackText || response.statusText || "unknown error"
  const requestId = response.headers.get("x-request-id")
  return { status: response.status, detail, requestId }
}

export function formatApiError(
  action: string,
  error: { status: number; detail: string; requestId: string | null }
): string {
  const req = error.requestId ? `，request_id=${error.requestId}` : ""
  return `${action}：HTTP ${error.status} - ${error.detail}${req}`
}
