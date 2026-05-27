// @ts-nocheck
import { defineConfig } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function readPort(defaultPort: number): number {
  const raw = process.env.UIQ_FRONTEND_E2E_PORT
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultPort
}

const port = readPort(43173)
const baseURL = `http://127.0.0.1:${port}`
const thisDir = path.dirname(fileURLToPath(import.meta.url))
const frontendDir = path.resolve(thisDir, '../../apps/web')
const repoRoot = path.resolve(thisDir, '../..')
const defaultWorkers = process.env.CI ? '4' : '50%'

function resolveWorkers(): number | string {
  const raw = process.env.UIQ_FRONTEND_E2E_WORKERS ?? process.env.UIQ_PLAYWRIGHT_WORKERS ?? defaultWorkers
  if (/^\d+%$/.test(raw)) return raw
  const parsed = Number(raw)
  if (Number.isInteger(parsed) && parsed > 0) return parsed
  throw new Error(`Invalid Playwright workers value '${raw}'. Use positive integer or percentage like '50%'.`)
}

function resolveRetries(): number {
  const raw = process.env.UIQ_FRONTEND_E2E_RETRIES ?? process.env.UIQ_PLAYWRIGHT_RETRIES ?? '1'
  const parsed = Number.parseInt(raw, 10)
  if (Number.isInteger(parsed) && parsed >= 0) return parsed
  throw new Error(`Invalid Playwright retries value '${raw}'. Use a non-negative integer.`)
}

function resolveOptionalRegex(envName: string): RegExp | undefined {
  const raw = process.env[envName]?.trim()
  if (!raw) return undefined
  try {
    return new RegExp(raw)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid regex in ${envName}: ${message}`)
  }
}

const grep = resolveOptionalRegex('UIQ_FRONTEND_E2E_GREP')
const grepInvert = resolveOptionalRegex('UIQ_FRONTEND_E2E_GREP_INVERT')
const automationToken = process.env.VITE_DEFAULT_AUTOMATION_TOKEN?.trim() || ''
const automationClientId = process.env.VITE_DEFAULT_AUTOMATION_CLIENT_ID?.trim() || 'client-frontend-e2e'

export default defineConfig({
  testDir: '.',
  timeout: 45_000,
  forbidOnly: Boolean(process.env.CI),
  retries: resolveRetries(),
  workers: resolveWorkers(),
  outputDir: path.resolve(repoRoot, '.runtime-cache/artifacts/test-results/frontend-e2e'),
  grep,
  grepInvert,
  reporter: [['list']],
  webServer: {
    command: `pnpm --dir "${frontendDir}" dev --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI && !process.env.BACKEND_PORT,
    timeout: 60_000,
    env: {
      BACKEND_PORT: process.env.BACKEND_PORT ?? '65535',
      VITE_DEFAULT_AUTOMATION_TOKEN: process.env.VITE_DEFAULT_AUTOMATION_TOKEN ?? '',
      VITE_DEFAULT_AUTOMATION_CLIENT_ID:
        process.env.VITE_DEFAULT_AUTOMATION_CLIENT_ID ?? 'client-frontend-e2e',
    },
  },
  use: {
    baseURL,
    headless: true,
    extraHTTPHeaders: automationToken
      ? {
          "x-automation-token": automationToken,
          "x-automation-client-id": automationClientId,
        }
      : {
          "x-automation-client-id": automationClientId,
        },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
})
