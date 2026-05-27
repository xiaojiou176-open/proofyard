import { expect, test as pwTest } from '@playwright/test'

const backendPort = process.env.BACKEND_PORT?.trim() || '17380'
const apiOrigin = process.env.BACKEND_BASE_URL?.trim() || `http://127.0.0.1:${backendPort}`
const automationClientId = process.env.VITE_DEFAULT_AUTOMATION_CLIENT_ID?.trim() || 'client-frontend-e2e'
const automationToken =
  process.env.AUTOMATION_API_TOKEN?.trim() || process.env.VITE_DEFAULT_AUTOMATION_TOKEN?.trim() || ''
const authHeaders = automationToken
  ? {
      'x-automation-token': automationToken,
      'x-automation-client-id': automationClientId,
    }
  : { 'x-automation-client-id': automationClientId }
const isCI = process.env.CI === 'true'

let skipReason: string | null = null

function exitIfBackendUnavailable(): boolean {
  if (!skipReason) return false
  pwTest.info().annotations.push({
    type: 'local-backend-unavailable',
    description: `[frontend-e2e-nonstub] ${skipReason}`,
  })
  return true
}

pwTest.beforeAll(async () => {
  try {
    const response = await fetch(`${apiOrigin}/api/automation/commands`, { headers: authHeaders })
    if (response.status === 401 || response.status === 403) {
      if (!automationToken) {
        throw new Error('backend requires auth token; set AUTOMATION_API_TOKEN or VITE_DEFAULT_AUTOMATION_TOKEN')
      }
      throw new Error(`GET /api/automation/commands rejected with ${response.status} even with token`)
    }
    if (!response.ok) {
      throw new Error(`GET /api/automation/commands returned ${response.status}`)
    }
    const payload = (await response.json()) as { commands?: unknown }
    if (!Array.isArray(payload.commands)) {
      throw new Error('GET /api/automation/commands response missing commands array')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const reason = `backend unavailable at ${apiOrigin}: ${message}`
    if (isCI) {
      throw new Error(`[frontend-e2e-nonstub] ${reason}; CI must fail instead of skipping.`)
    }
    skipReason = reason
  }
})

pwTest('@frontend-nonstub @nonstub commands endpoint keeps contract on live local api', async ({ page }) => {
  if (exitIfBackendUnavailable()) return

  const response = await page.request.get(`${apiOrigin}/api/automation/commands`)
  expect(response.status()).toBe(200)
  const payload = (await response.json()) as { commands?: unknown[] }
  expect(Array.isArray(payload.commands)).toBe(true)
})
