import { expect, test as pwTest } from "@playwright/test"

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

type TaskStatus = "queued" | "running" | "success" | "failed" | "cancelled"
type CommandInfo = { command_id: string; title?: string }
type TaskRecord = { task_id: string; command_id: string; status: TaskStatus }

let skipReason: string | null = null

function exitIfBackendUnavailable(): boolean {
  if (!skipReason) return false
  pwTest.info().annotations.push({
    type: "local-backend-unavailable",
    description: `[frontend-e2e-nonstub] ${skipReason}`,
  })
  return true
}

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
    const payload = (await response.json()) as { commands?: unknown[] }
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

pwTest("@frontend-nonstub @nonstub live command catalog is rendered through the real UI", async ({ page }) => {
  if (exitIfBackendUnavailable()) return

  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1, name: "Webaudit" })).toBeVisible()
  const commandCards = page.locator(".command-card")
  await expect.poll(() => commandCards.count()).toBeGreaterThan(0)
  await expect
    .poll(async () => {
      const texts = await commandCards.allTextContents()
      return texts.some((text) =>
        /Initialize|Open homepage|Run frontend end-to-end tests|Maintenance/.test(text)
      )
    })
    .toBe(true)
  await expect(page.getByRole("button", { name: "Run" }).first()).toBeVisible()
})

pwTest("@frontend-nonstub @nonstub live task filtering works from the real UI", async ({ page }) => {
  if (exitIfBackendUnavailable()) return

  const command = await pickCommandForRun()
  await page.goto("/")
  const commandCard = page.locator(".command-card").filter({ hasText: command.command_id }).first()
  await expect(commandCard).toBeVisible()
  await commandCard.getByRole("button", { name: /Run|Dangerous run/ }).click()
  const confirmButton = page.getByRole("button", { name: "Confirm dangerous command" })
  if ((await confirmButton.count()) > 0) {
    await confirmButton.click()
  }
  await expect(page.locator("body")).toContainText("Submitted", { timeout: 20_000 })

  const seededTask = await expect
    .poll(
      async () => {
        const latestTask = await latestTaskByCommand(command.command_id)
        if (!latestTask) return null
        if (latestTask.status === "failed") {
          throw new Error(`seeded task should not fail before filter validation: ${latestTask.task_id}`)
        }
        return latestTask
      },
      { timeout: 30_000, intervals: [500, 1000, 2000] }
    )
    .not.toBeNull()

  const latestTask = (await latestTaskByCommand(command.command_id)) as TaskRecord
  await page.getByRole("tab", { name: "Task Center" }).click()
  await page.getByLabel("Filter tasks by status").selectOption(latestTask.status)
  await page.getByLabel("Filter run records by command ID").fill(command.command_id)
  await page.getByLabel("Run count limit").selectOption("20")
  await page.locator(".task-list-column").getByRole("button", { name: "Refresh" }).first().click()
  const taskList = page.getByRole("list", { name: "Run records list (command)" })
  const taskItems = taskList.locator("li")
  await expect(taskList).toBeVisible()
  await expect
    .poll(async () => (await taskItems.allTextContents()).join(" | "))
    .toContain(command.command_id)
  await expect
    .poll(async () => (await taskItems.allTextContents()).join(" | "))
    .toContain(latestTask.task_id.slice(0, 8))
})

pwTest("@frontend-nonstub @nonstub real command execution requires an explicit success outcome", async ({ page }) => {
  if (exitIfBackendUnavailable()) return

  const command = await pickCommandForRun()
  await page.goto("/")
  const commandCard = page.locator(".command-card").filter({ hasText: command.command_id }).first()
  await expect(commandCard).toBeVisible()
  await commandCard.getByRole("button", { name: /Run|Dangerous run/ }).click()
  const confirmButton = page.getByRole("button", { name: "Confirm dangerous command" })
  if ((await confirmButton.count()) > 0) {
    await confirmButton.click()
  }
  await expect(page.locator("body")).toContainText("Submitted", { timeout: 20_000 })

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
  expect(latestTask?.status).not.toBe("failed")

  await page.getByRole("tab", { name: "Task Center" }).click()
  await page.getByLabel("Filter tasks by status").selectOption("all")
  await page.getByLabel("Filter run records by command ID").fill(command.command_id)
  await page.locator(".task-list-column").getByRole("button", { name: "Refresh" }).first().click()
  const taskRow = page.locator(".task-list li").filter({ hasText: latestTask?.task_id.slice(0, 8) ?? "" }).first()
  await expect(taskRow).toBeVisible({ timeout: 20_000 })
  await expect(taskRow).toContainText(command.command_id)
})

pwTest("@frontend-nonstub @nonstub diagnostics and alerts endpoints stay queryable", async ({ page }) => {
  if (exitIfBackendUnavailable()) return

  const diagnosticsResponse = await page.request.get(`${apiOrigin}/health/diagnostics`)
  expect(diagnosticsResponse.status()).toBe(200)
  const diagnostics = (await diagnosticsResponse.json()) as {
    uptime_seconds?: unknown
    task_counts?: unknown
    metrics?: unknown
  }
  expect(typeof diagnostics.uptime_seconds).toBe("number")
  expect(typeof diagnostics.task_counts).toBe("object")
  expect(typeof diagnostics.metrics).toBe("object")

  const alertsResponse = await page.request.get(`${apiOrigin}/health/alerts`)
  expect(alertsResponse.status()).toBe(200)
  const alerts = (await alertsResponse.json()) as {
    state?: unknown
    failure_rate?: unknown
    threshold?: unknown
  }
  expect(["ok", "degraded"]).toContain(String(alerts.state))
  expect(typeof alerts.failure_rate).toBe("number")
  expect(typeof alerts.threshold).toBe("number")
})
