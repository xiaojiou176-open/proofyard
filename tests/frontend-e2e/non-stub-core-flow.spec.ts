import { expect, test as pwTest } from "@playwright/test"
import {
  annotateBackendUnavailable,
  buildBackendContext,
  getBackendUnavailableReason,
  pickCommandForRun,
} from "./support/backend-availability.js"

type TaskStatus = "queued" | "running" | "success" | "failed" | "cancelled"
type TaskRecord = { task_id: string; status: TaskStatus }

const { apiOrigin, authHeaders, automationToken, isCI } = buildBackendContext()
let skipReason: string | null = null

pwTest.beforeAll(async () => {
  const unavailableReason = await getBackendUnavailableReason(apiOrigin, authHeaders, automationToken)
  if (unavailableReason) {
    const reason = `backend unavailable at ${apiOrigin}: ${unavailableReason}`
    if (isCI) {
      throw new Error(`[frontend-e2e-nonstub] ${reason}; CI must fail instead of skipping.`)
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

pwTest(
  "@frontend-nonstub-main @frontend-nonstub @nonstub @counterfactual run and cancel chain over live local api",
  async ({ page }) => {
    if (annotateBackendUnavailable(pwTest, skipReason)) return

    await page.goto("/")

    await expect(page.getByRole("heading", { level: 1, name: "Webaudit" })).toBeVisible()
    const commandId = await pickCommandForRun(apiOrigin, authHeaders)

    const runResponse = await page.request.post(`${apiOrigin}/api/automation/run`, {
      headers: authHeaders,
      data: { command: commandId, params: {} },
    })
    expect(runResponse.status()).toBe(200)
    const runPayload = (await runResponse.json()) as { task?: { task_id?: string } }
    const createdTaskId = runPayload.task?.task_id ?? ""
    expect(createdTaskId.length).toBeGreaterThan(0)

    const cancelResponse = await page.request.post(
      `${apiOrigin}/api/automation/tasks/${encodeURIComponent(createdTaskId)}/cancel`,
      { headers: authHeaders }
    )
    expect([200, 202]).toContain(cancelResponse.status())

    let terminalStatus: TaskStatus | "" = ""
    let cancelAttempts = 1
    let lastCancelAt = Date.now()
    await expect
      .poll(
        async () => {
          const taskResponse = await page.request.get(
            `${apiOrigin}/api/automation/tasks/${encodeURIComponent(createdTaskId)}`,
            { headers: authHeaders }
          )
          if (taskResponse.status() !== 200) return ""
          const taskPayload = (await taskResponse.json()) as TaskRecord
          terminalStatus = taskPayload.status
          if (
            (terminalStatus === "queued" || terminalStatus === "running") &&
            cancelAttempts < 3 &&
            Date.now() - lastCancelAt >= 5000
          ) {
            const retryCancelResponse = await page.request.post(
              `${apiOrigin}/api/automation/tasks/${encodeURIComponent(createdTaskId)}/cancel`,
              { headers: authHeaders }
            )
            expect([200, 202, 409]).toContain(retryCancelResponse.status())
            cancelAttempts += 1
            lastCancelAt = Date.now()
          }
          if (terminalStatus === "failed" || terminalStatus === "success") {
            throw new Error(
              `cancel flow must settle as cancelled; got terminal status ${terminalStatus}`
            )
          }
          return taskPayload.status
        },
        { timeout: 45000, intervals: [500, 1000, 2000, 3000] }
      )
      .toBe("cancelled")

    expect(terminalStatus, "cancel flow must not end as failed").not.toBe("failed")
    expect(
      terminalStatus,
      `cancel flow must settle as cancelled; got ${terminalStatus || "unknown"}`
    ).toBe("cancelled")
  }
)
