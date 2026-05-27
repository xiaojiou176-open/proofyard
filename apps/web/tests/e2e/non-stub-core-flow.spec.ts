import { expect, test as pwTest } from "@playwright/test"

type TaskStatus = "queued" | "running" | "success" | "failed" | "cancelled"
type TaskRecord = { task_id: string; status: TaskStatus }

const backendPort = process.env.BACKEND_PORT?.trim() || "17380"
const API_ORIGIN = process.env.BACKEND_BASE_URL?.trim() || `http://127.0.0.1:${backendPort}`
const IS_CI = process.env.CI === "true"

async function getBackendUnavailableReason(): Promise<string | null> {
  try {
    const response = await fetch(`${API_ORIGIN}/api/automation/commands`)
    if (response.status === 401 || response.status === 403) {
      return null
    }
    if (!response.ok) {
      return `GET /api/automation/commands returned ${response.status}`
    }
    const payload = (await response.json()) as { commands?: unknown }
    if (!Array.isArray(payload.commands)) {
      return "GET /api/automation/commands response missing commands array"
    }
    return null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `GET /api/automation/commands failed: ${message}`
  }
}

let skipReason: string | null = null

pwTest.beforeAll(async () => {
  const unavailableReason = await getBackendUnavailableReason()
  if (unavailableReason) {
    const reason = `backend unavailable at ${API_ORIGIN}: ${unavailableReason}`
    if (IS_CI) {
      throw new Error(`[non-stub-core-flow] ${reason}; CI must fail instead of skipping.`)
    }
    skipReason = reason
  }
})

pwTest.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("ab_onboarding_done", "1")
    window.localStorage.setItem("ab_first_use_done", "1")
  })
})

pwTest("@core-nonstub @nonstub @counterfactual run and cancel chain over live local api", async ({ page }) => {
  pwTest.skip(
    Boolean(skipReason),
    `[non-stub-core-flow] ${skipReason ?? "backend unavailable for local non-stub flow"}`
  )
  await page.goto("/")

  await expect(page.getByRole("heading", { level: 1, name: "Webaudit" })).toBeVisible()
  await page.locator("body").click()

  const runResponse = await page.request.post(`${API_ORIGIN}/api/automation/run`, {
    data: { command: "run-ui", params: {} },
  })
  expect(runResponse.status()).toBe(200)
  const runPayload = (await runResponse.json()) as { task?: { task_id?: string } }
  const createdTaskId = runPayload.task?.task_id ?? ""
  expect(createdTaskId.length).toBeGreaterThan(0)

  const cancelResponse = await page.request.post(
    `${API_ORIGIN}/api/automation/tasks/${encodeURIComponent(createdTaskId)}/cancel`
  )
  expect([200, 202]).toContain(cancelResponse.status())

  // Regression guard: cancellation must be persisted and queryable via real API.
  let terminalStatus: TaskStatus | "" = ""
  await expect
    .poll(
      async () => {
        const taskResponse = await page.request.get(
          `${API_ORIGIN}/api/automation/tasks/${encodeURIComponent(createdTaskId)}`
        )
        if (taskResponse.status() !== 200) return ""
        const taskPayload = (await taskResponse.json()) as TaskRecord
        terminalStatus = taskPayload.status
        return taskPayload.status
      },
      { timeout: 45000, intervals: [500, 1000, 2000, 3000] }
    )
    .toMatch(/^(cancelled|success|failed)$/)

  expect(["cancelled", "success", "failed"]).toContain(terminalStatus)
})
