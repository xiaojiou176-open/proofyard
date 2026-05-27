import { expect, test as pwTest } from '@playwright/test'
import {
  annotateBackendUnavailable,
  buildBackendContext,
  getBackendUnavailableReason,
} from './support/backend-availability'

const { apiOrigin, authHeaders, automationToken, isCI } = buildBackendContext()

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
  const reason = await getBackendUnavailableReason(apiOrigin, authHeaders, automationToken)
  if (reason) {
    const fullReason = `backend unavailable at ${apiOrigin}: ${reason}`
    if (isCI) {
      throw new Error(`[frontend-e2e-nonstub] ${fullReason}; CI must fail instead of skipping.`)
    }
    skipReason = fullReason
  }
})

pwTest('@frontend-nonstub @nonstub health endpoints return live diagnostics', async ({ page }) => {
  if (annotateBackendUnavailable(pwTest, skipReason)) return

  const healthResponse = await page.request.get(`${apiOrigin}/health/`, { headers: authHeaders })
  expect(healthResponse.status()).toBe(200)

  const diagnosticsResponse = await page.request.get(`${apiOrigin}/health/diagnostics`, {
    headers: authHeaders,
  })
  expect(diagnosticsResponse.status()).toBe(200)
  const payload = (await diagnosticsResponse.json()) as {
    uptime_seconds?: unknown
    task_counts?: unknown
    metrics?: unknown
  }

  expect(typeof payload.uptime_seconds).toBe('number')
  expect(typeof payload.task_counts).toBe('object')
  expect(typeof payload.metrics).toBe('object')
})
