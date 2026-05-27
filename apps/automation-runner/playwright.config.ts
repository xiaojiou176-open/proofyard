import { URL } from "node:url"
import path from "node:path"
import { defineConfig } from "@playwright/test"

function parseBaseUrl(value: string | undefined): URL | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
    return parsed
  } catch {
    return null
  }
}

const envBaseUrl = parseBaseUrl(process.env.UIQ_BASE_URL)
const backendPort = Number(
  envBaseUrl?.port || process.env.AUTOMATION_BACKEND_PORT || "17480"
)
const backendBaseUrl = envBaseUrl?.origin ?? `http://127.0.0.1:${backendPort}`
const defaultWorkers = process.env.CI ? "4" : "50%"
const automationToken = process.env.AUTOMATION_API_TOKEN?.trim() || ""
const automationClientId = "playwright-automation"
const repoRuntimeRoot = path.resolve(process.cwd(), "../../.runtime-cache")
const projectPythonEnv =
  process.env.PROJECT_PYTHON_ENV ??
  process.env.UV_PROJECT_ENVIRONMENT ??
  path.join(repoRuntimeRoot, "toolchains/python/.venv")
const uvicornBin = path.join(projectPythonEnv, "bin", "uvicorn")

function resolveExtraHttpHeaders(): Record<string, string> | undefined {
  if (!automationToken) return undefined
  return {
    "x-automation-token": automationToken,
    "x-automation-client-id": automationClientId,
  }
}

function resolveWorkers(): number | string {
  const raw =
    process.env.UIQ_AUTOMATION_WORKERS ?? process.env.UIQ_PLAYWRIGHT_WORKERS ?? defaultWorkers
  if (/^\d+%$/.test(raw)) return raw
  const parsed = Number(raw)
  if (Number.isInteger(parsed) && parsed > 0) return parsed
  throw new Error(
    `Invalid Playwright workers value '${raw}'. Use positive integer or percentage like '50%'.`
  )
}

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  workers: resolveWorkers(),
  outputDir: path.join(repoRuntimeRoot, "artifacts/test-results/automation-runner"),
  webServer: {
    command: `AUTOMATION_ALLOW_LOCAL_NO_TOKEN=true APP_ENV=test PROJECT_PYTHON_ENV="${projectPythonEnv}" UV_PROJECT_ENVIRONMENT="${projectPythonEnv}" "${uvicornBin}" apps.api.app.main:app --host 127.0.0.1 --port ${backendPort}`,
    url: `${backendBaseUrl}/health/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  use: {
    baseURL: backendBaseUrl,
    extraHTTPHeaders: resolveExtraHttpHeaders(),
    headless: true,
  },
  reporter: [["list"]],
})
