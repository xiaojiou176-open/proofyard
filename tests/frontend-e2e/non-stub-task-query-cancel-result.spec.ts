import { expect, test as pwTest } from "@playwright/test"
import {
  CONSOLE_TAB_QUICK_LAUNCH_TEST_ID,
  CONSOLE_TAB_TASK_CENTER_TEST_ID,
  TASK_CENTER_COMMAND_RUNS_REFRESH_TEST_ID,
} from "../../apps/web/src/constants/testIds"

type TaskStatus = "queued" | "running" | "success" | "failed" | "cancelled"
type CommandInfo = { command_id: string; title?: string }
type TaskRecord = { task_id: string; command_id: string; status: TaskStatus }

const backendPort = process.env.BACKEND_PORT?.trim() || "17380"
const apiOrigin = process.env.BACKEND_BASE_URL?.trim() || `http://127.0.0.1:${backendPort}`
const automationClientId = process.env.VITE_DEFAULT_AUTOMATION_CLIENT_ID?.trim() || "client-frontend-e2e"
const automationToken =
  process.env.AUTOMATION_API_TOKEN?.trim() || process.env.VITE_DEFAULT_AUTOMATION_TOKEN?.trim() || ""
const authHeaders = automationToken
  ? {
      "x-automation-token": automationToken,
      "x-automation-client-id": automationClientId,
    }
  : { "x-automation-client-id": automationClientId }
const isCI = process.env.CI === "true"

async function getBackendUnavailableReason(): Promise<string | null> {
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

async function pickCommandForRun(): Promise<CommandInfo> {
  const response = await fetch(`${apiOrigin}/api/automation/commands`, { headers: authHeaders })
  if (!response.ok) {
    throw new Error(`GET /api/automation/commands returned ${response.status}`)
  }
  const payload = (await response.json()) as { commands?: CommandInfo[] }
  const commands = Array.isArray(payload.commands) ? payload.commands : []
  const preferredIds = ["run-ui", "run-ui-midscene", "automation-test", "backend-test"]
  for (const preferredId of preferredIds) {
    const preferred = commands.find((item) => item.command_id === preferredId)
    if (preferred) return preferred
  }
  if (commands[0]) return commands[0]
  throw new Error("commands list is empty")
}

async function latestTaskByCommand(commandId: string): Promise<TaskRecord | null> {
  const query = new URLSearchParams({ command_id: commandId, limit: "20" })
  const response = await fetch(`${apiOrigin}/api/automation/tasks?${query.toString()}`, {
    headers: authHeaders,
  })
  if (!response.ok) return null
  const payload = (await response.json()) as { tasks?: TaskRecord[] }
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : []
  return tasks[0] ?? null
}

let skipReason: string | null = null

function exitIfBackendUnavailable(): boolean {
  if (!skipReason) return false
  pwTest.info().annotations.push({
    type: "local-backend-unavailable",
    description: `[frontend-e2e-nonstub] ${skipReason}`,
  })
  return true
}

pwTest.beforeAll(async () => {
  const unavailableReason = await getBackendUnavailableReason()
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
  "@frontend-nonstub-main @frontend-nonstub @nonstub real task query/cancel/result-read works over live ui and api",
  async ({ page }) => {
    if (exitIfBackendUnavailable()) return

    const command = await pickCommandForRun()

    const observedTaskRequests: string[] = []
    page.on("request", (request) => {
      if (request.method() !== "GET") return
      if (!request.url().includes("/api/automation/tasks?")) return
      observedTaskRequests.push(request.url())
    })

    await page.goto("/")
    await expect(page.getByRole("heading", { level: 1, name: "Webaudit" })).toBeVisible()

    const quickLaunchTab = page.getByTestId(CONSOLE_TAB_QUICK_LAUNCH_TEST_ID)
    await expect(quickLaunchTab).toHaveAttribute("aria-selected", "true")

    const commandCard = page.locator(".command-card").filter({ hasText: command.command_id }).first()
    await expect(commandCard).toBeVisible()
    await commandCard.getByRole("button", { name: /Run|Dangerous run/ }).click()

    const confirmButton = page.getByRole("button", { name: "Confirm dangerous command" })
    if ((await confirmButton.count()) > 0) {
      await confirmButton.click()
    }

    await expect(page.locator("body")).toContainText("Submitted", { timeout: 20_000 })

    const taskCenterTab = page.getByTestId(CONSOLE_TAB_TASK_CENTER_TEST_ID)
    await taskCenterTab.click()
    await expect(taskCenterTab).toHaveAttribute("aria-selected", "true")

    await page.getByLabel("Filter tasks by status").selectOption("all")
    await page.getByLabel("Filter run records by command ID").fill(command.command_id)
    await page.getByLabel("Run count limit").selectOption("20")
    await page.getByTestId(TASK_CENTER_COMMAND_RUNS_REFRESH_TEST_ID).click()

    await expect.poll(() => observedTaskRequests.length, { timeout: 20_000 }).toBeGreaterThan(0)
    await expect
      .poll(() => {
        const requestUrl = observedTaskRequests[observedTaskRequests.length - 1]
        if (!requestUrl) return ""
        return new URL(requestUrl).searchParams.get("command_id") ?? ""
      })
      .toBe(command.command_id)

    await expect
      .poll(
        async () => {
          const latestTask = await latestTaskByCommand(command.command_id)
          return latestTask?.task_id ?? ""
        },
        { timeout: 30_000, intervals: [500, 1000, 2000] }
      )
      .not.toBe("")

    const latestTask = await latestTaskByCommand(command.command_id)
    const taskId = latestTask?.task_id ?? ""
    expect(taskId.length).toBeGreaterThan(0)

    const taskRow = page.locator(".task-list li").filter({ hasText: taskId.slice(0, 8) }).first()
    await expect(taskRow).toBeVisible({ timeout: 20_000 })

    const cancelButton = taskRow.getByRole("button", { name: "Cancel" })
    await expect(cancelButton).toBeVisible({ timeout: 20_000 })
    await cancelButton.click()

    let cancelAttempts = 1
    let lastCancelAt = Date.now()
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${apiOrigin}/api/automation/tasks/${encodeURIComponent(taskId)}`,
            { headers: authHeaders }
          )
          if (response.status() !== 200) return ""
          const payload = (await response.json()) as { status?: TaskStatus }
          const status = payload.status ?? ""
          if (
            (status === "queued" || status === "running") &&
            cancelAttempts < 3 &&
            Date.now() - lastCancelAt >= 5000
          ) {
            const retryCancelResponse = await page.request.post(
              `${apiOrigin}/api/automation/tasks/${encodeURIComponent(taskId)}/cancel`,
              { headers: authHeaders }
            )
            expect([200, 202, 409]).toContain(retryCancelResponse.status())
            cancelAttempts += 1
            lastCancelAt = Date.now()
          }
          if (status === "failed" || status === "success") {
            throw new Error(
              `cancelled flow must settle as cancelled; got terminal status ${status}`
            )
          }
          return status
        },
        { timeout: 45_000, intervals: [500, 1000, 2000, 3000] }
      )
      .toBe("cancelled")

    const finalTaskResponse = await page.request.get(
      `${apiOrigin}/api/automation/tasks/${encodeURIComponent(taskId)}`,
      { headers: authHeaders }
    )
    expect(finalTaskResponse.status()).toBe(200)
    const finalTaskPayload = (await finalTaskResponse.json()) as { status?: TaskStatus }
    const finalStatus = finalTaskPayload.status ?? ""
    expect(finalStatus, "cancelled flow must not end as failed").not.toBe("failed")
    expect(
      finalStatus,
      `cancelled flow must settle as cancelled; got ${finalStatus || "unknown"}`
    ).toBe("cancelled")

    await taskRow.locator(".task-item-info").click()
    await expect(page.locator(".task-detail-column")).toContainText("命令编号（命令 ID）")
    await expect(page.locator(".task-detail-column")).toContainText(command.command_id)
    await expect(page.getByLabel("当前任务输出")).toBeVisible()
  }
)
