import { expect, test } from '@playwright/test'
import { bootstrapButtonBehaviorApp } from './support/button-behavior-harness'

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

async function getBackendUnavailableReason(): Promise<string | null> {
  try {
    const healthResponse = await fetch(`${apiOrigin}/health/`)
    if (!healthResponse.ok) {
      return `GET /health/ returned ${healthResponse.status}`
    }
    const commandsResponse = await fetch(`${apiOrigin}/api/automation/commands`, { headers: authHeaders })
    if (commandsResponse.status === 401 || commandsResponse.status === 403) {
      if (!automationToken) {
        return 'backend requires auth token; set AUTOMATION_API_TOKEN or VITE_DEFAULT_AUTOMATION_TOKEN'
      }
      return `GET /api/automation/commands rejected with ${commandsResponse.status} even with token`
    }
    if (!commandsResponse.ok) {
      return `GET /api/automation/commands returned ${commandsResponse.status}`
    }
    const payload = (await commandsResponse.json()) as { commands?: unknown[] }
    if (!Array.isArray(payload.commands) || payload.commands.length === 0) {
      return 'GET /api/automation/commands returned no commands'
    }
    return null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `backend smoke canary failed: ${message}`
  }
}

test('@frontend-e2e-side-effect @frontend-smoke-stub command run mutates task state', async ({ page }) => {
  const harness = await bootstrapButtonBehaviorApp(page)
  const commandCard = page.locator('article.command-card', { hasText: 'Run pipeline task' })

  await commandCard.getByRole('button', { name: 'Run' }).click()

  await expect.poll(() => harness.calls.runCommand).toBe(1)
  await expect(page.getByText('Submitted Run pipeline task')).toBeVisible()
})

test('@frontend-nonstub @nonstub @frontend-smoke-live @frontend-smoke-canary real backend smoke canary is reachable', async ({ page }) => {
  const unavailableReason = await getBackendUnavailableReason()
  if (unavailableReason && isCI) {
    throw new Error(`[frontend-e2e-smoke-canary] backend unavailable at ${apiOrigin}: ${unavailableReason}`)
  }
  if (unavailableReason) {
    test.info().annotations.push({
      type: 'local-backend-unavailable',
      description: `[frontend-e2e-smoke-canary] ${unavailableReason}`,
    })
    return
  }

  const healthResponse = await page.request.get(`${apiOrigin}/health/`)
  expect(healthResponse.status()).toBe(200)

  const commandsResponse = await page.request.get(`${apiOrigin}/api/automation/commands`, {
    headers: authHeaders,
  })
  expect(commandsResponse.status()).toBe(200)
  const commandsPayload = (await commandsResponse.json()) as { commands?: unknown[] }
  expect(Array.isArray(commandsPayload.commands)).toBe(true)
  expect((commandsPayload.commands ?? []).length).toBeGreaterThan(0)
})
