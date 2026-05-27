type CommandInfo = { command_id: string }

type BackendAvailabilityConfig = {
  backendPort?: string
  backendBaseUrl?: string
  automationClientId?: string
  automationToken?: string
  isCI?: boolean
}

const DEFAULT_BACKEND_PORT = "17380"
const DEFAULT_AUTOMATION_CLIENT_ID = "client-frontend-e2e"

export function resolveBackendAvailabilityConfig(
  env: NodeJS.ProcessEnv = process.env
): BackendAvailabilityConfig {
  return {
    backendPort: env.BACKEND_PORT?.trim() || DEFAULT_BACKEND_PORT,
    backendBaseUrl: env.BACKEND_BASE_URL?.trim(),
    automationClientId:
      env.VITE_DEFAULT_AUTOMATION_CLIENT_ID?.trim() || DEFAULT_AUTOMATION_CLIENT_ID,
    automationToken:
      env.AUTOMATION_API_TOKEN?.trim() || env.VITE_DEFAULT_AUTOMATION_TOKEN?.trim() || "",
    isCI: env.CI === "true",
  }
}

export function buildBackendContext(config = resolveBackendAvailabilityConfig()) {
  const backendPort = config.backendPort ?? DEFAULT_BACKEND_PORT
  const apiOrigin = config.backendBaseUrl?.trim() || `http://127.0.0.1:${backendPort}`
  const automationClientId = config.automationClientId?.trim() || DEFAULT_AUTOMATION_CLIENT_ID
  const automationToken = config.automationToken?.trim() || ""
  const authHeaders = automationToken
    ? {
        "x-automation-token": automationToken,
        "x-automation-client-id": automationClientId,
      }
    : { "x-automation-client-id": automationClientId }

  return {
    apiOrigin,
    automationToken,
    authHeaders,
    isCI: Boolean(config.isCI),
  }
}

export async function getBackendUnavailableReason(
  apiOrigin: string,
  authHeaders: Record<string, string>,
  automationToken: string
): Promise<string | null> {
  try {
    const response = await fetch(`${apiOrigin}/api/automation/commands`, { headers: authHeaders })
    if (response.status === 401 || response.status === 403) {
      if (!automationToken) {
        return "backend requires auth token; set AUTOMATION_API_TOKEN or VITE_DEFAULT_AUTOMATION_TOKEN"
      }
      return `GET /api/automation/commands rejected with ${response.status} even with token`
    }
    if (!response.ok) {
      return `GET /api/automation/commands returned ${response.status}`
    }
    const payload = (await response.json()) as { commands?: unknown[] }
    if (!Array.isArray(payload.commands) || payload.commands.length === 0) {
      return "GET /api/automation/commands returned no commands"
    }
    return null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `GET /api/automation/commands failed: ${message}`
  }
}

export function annotateBackendUnavailable(
  pwTest: { info(): { annotations: Array<{ type: string; description?: string }> } },
  skipReason: string | null
): boolean {
  if (!skipReason) return false
  pwTest.info().annotations.push({
    type: "local-backend-unavailable",
    description: `[frontend-e2e-nonstub] ${skipReason}`,
  })
  return true
}

export async function pickCommandForRun(
  apiOrigin: string,
  authHeaders: Record<string, string>
): Promise<string> {
  const response = await fetch(`${apiOrigin}/api/automation/commands`, { headers: authHeaders })
  if (!response.ok) {
    throw new Error(`GET /api/automation/commands returned ${response.status}`)
  }
  const payload = (await response.json()) as { commands?: CommandInfo[] }
  const commands = Array.isArray(payload.commands) ? payload.commands : []
  const preferredIds = ["run-ui", "run-ui-midscene", "automation-test", "backend-test"]
  for (const preferredId of preferredIds) {
    if (commands.some((item) => item.command_id === preferredId)) {
      return preferredId
    }
  }
  const fallback = commands[0]?.command_id ?? ""
  if (!fallback) {
    throw new Error("commands list is empty")
  }
  return fallback
}
