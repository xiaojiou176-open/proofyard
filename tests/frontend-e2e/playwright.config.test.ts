import assert from 'node:assert/strict'
import test from 'node:test'

const configModuleUrl = new URL('./playwright.config.ts', import.meta.url).href

async function loadConfigWithPort(port: string | undefined) {
  const previous = process.env.UIQ_FRONTEND_E2E_PORT
  if (port === undefined) {
    delete process.env.UIQ_FRONTEND_E2E_PORT
  } else {
    process.env.UIQ_FRONTEND_E2E_PORT = port
  }

  try {
    const cacheBuster = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const mod = await import(`${configModuleUrl}?v=${cacheBuster}`)
    return mod.default
  } finally {
    if (previous === undefined) {
      delete process.env.UIQ_FRONTEND_E2E_PORT
    } else {
      process.env.UIQ_FRONTEND_E2E_PORT = previous
    }
  }
}

test('playwright config uses default port 43173 when UIQ_FRONTEND_E2E_PORT is not provided', async () => {
  const config = await loadConfigWithPort(undefined)
  const baseURL = config.use?.baseURL
  const webServerURL = config.webServer?.url

  assert.equal(baseURL, 'http://127.0.0.1:43173')
  assert.equal(webServerURL, 'http://127.0.0.1:43173')
})

test('playwright config allows UIQ_FRONTEND_E2E_PORT override', async () => {
  const config = await loadConfigWithPort('50001')
  const baseURL = config.use?.baseURL
  const webServerURL = config.webServer?.url

  assert.equal(baseURL, 'http://127.0.0.1:50001')
  assert.equal(webServerURL, 'http://127.0.0.1:50001')
})
