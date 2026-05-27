import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test as pwTest } from "@playwright/test"

type TaskStatus =
  | "queued"
  | "running"
  | "waiting_otp"
  | "waiting_user"
  | "success"
  | "failed"
  | "cancelled"

type SessionPayload = { session_id: string }
type FlowPayload = { flow_id: string }
type TemplatePayload = { template_id: string }
type RunEnvelope = { run: { run_id: string; status: TaskStatus } }
type BrowserSetupPayload = {
  sessionId: string
  runId: string
  runStatus: TaskStatus
}

const backendPort = process.env.BACKEND_PORT?.trim() || "17380"
const apiOrigin = process.env.BACKEND_BASE_URL?.trim() || `http://127.0.0.1:${backendPort}`
const automationClientId = process.env.VITE_DEFAULT_AUTOMATION_CLIENT_ID?.trim() || "client-frontend-e2e"
const automationToken =
  process.env.AUTOMATION_API_TOKEN?.trim() || process.env.VITE_DEFAULT_AUTOMATION_TOKEN?.trim() || ""
const thisDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(thisDir, "..", "..")
const authHeaders = automationToken
  ? {
      "x-automation-token": automationToken,
      "x-automation-client-id": automationClientId,
    }
  : { "x-automation-client-id": automationClientId }
const isCI = process.env.CI === "true"

let skipReason: string | null = null

function exitIfBackendUnavailable(): boolean {
  if (!skipReason) return false
  pwTest.info().annotations.push({
    type: "local-backend-unavailable",
    description: `[frontend-e2e-live-ui] ${skipReason}`,
  })
  return true
}

function resolveRuntimeRoot(): string {
  const raw = process.env.UNIVERSAL_AUTOMATION_RUNTIME_DIR?.trim()
  if (!raw) return ""
  return path.isAbsolute(raw) ? raw : path.resolve(repoRoot, raw)
}

function writeFlowDraftRuntimeArtifacts(sessionId: string, startUrl: string): void {
  const fixedRuntimeRoot = path.resolve(repoRoot, ".runtime-cache", "automation")
  const envRuntimeRoot = resolveRuntimeRoot()
  const runtimeRoots = Array.from(new Set([fixedRuntimeRoot, envRuntimeRoot].filter(Boolean)))
  const flowDraft = {
    session_id: sessionId,
    start_url: startUrl,
    source_event_count: 2,
    generated_at: new Date().toISOString(),
    steps: [
      { step_id: "step-1", action: "navigate", url: startUrl },
      {
        step_id: "step-2",
        action: "click",
        selected_selector_index: 0,
        target: { selectors: [{ kind: "css", value: "#submit", score: 90 }] },
      },
    ],
  }

  for (const runtimeRoot of runtimeRoots) {
    const sessionDir = path.resolve(runtimeRoot, sessionId)
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      path.resolve(sessionDir, "flow-draft.json"),
      JSON.stringify(flowDraft, null, 2),
      "utf8"
    )
    writeFileSync(
      path.resolve(runtimeRoot, "latest-session.json"),
      JSON.stringify({ sessionId, sessionDir }, null, 2),
      "utf8"
    )
  }
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
    if (!response.ok) return `GET /api/automation/commands returned ${response.status}`
    const payload = (await response.json()) as { commands?: unknown[] }
    if (!Array.isArray(payload.commands) || payload.commands.length === 0) {
      return "GET /api/automation/commands returned no commands"
    }
    return null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `GET /api/automation/commands failed: ${message}`
  }
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
  "@frontend-live-ui @frontend-nonstub @nonstub real ui deep links cover template waiting submit and flow workshop replay actions",
  async ({ page }) => {
    if (exitIfBackendUnavailable()) return

    const startUrl = "https://example.com/register"

    await page.goto("/")
    await expect(page.getByRole("heading", { level: 1, name: "Webaudit" })).toBeVisible()

    const setup = await page.evaluate(
      async ({
        url,
        automationToken,
        automationClientId,
      }: {
        url: string
        automationToken: string
        automationClientId: string
      }): Promise<BrowserSetupPayload> => {
        const postJson = async <T>(path: string, body: unknown): Promise<T> => {
          const headers: Record<string, string> = { "Content-Type": "application/json" }
          if (automationClientId) {
            headers["x-automation-client-id"] = automationClientId
          }
          if (automationToken) {
            headers["x-automation-token"] = automationToken
          }
          const response = await fetch(path, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          })
          const payload = (await response.json()) as T | { detail?: unknown }
          if (!response.ok) {
            throw new Error(`${path} -> ${response.status}: ${JSON.stringify(payload)}`)
          }
          return payload as T
        }

        const session = await postJson<SessionPayload>("/api/sessions/start", {
          start_url: url,
          mode: "manual",
        })
        const flow = await postJson<FlowPayload>("/api/flows", {
          session_id: session.session_id,
          start_url: url,
          source_event_count: 2,
          steps: [
            { step_id: "step-1", action: "navigate", url },
            { step_id: "step-2", action: "type", value_ref: "${params.otp}" },
          ],
        })
        const template = await postJson<TemplatePayload>("/api/templates", {
          flow_id: flow.flow_id,
          name: "nonstub-waiting-otp-template",
          params_schema: [{ key: "otp", type: "secret", required: true }],
          defaults: {},
          policies: { otp: { required: true, provider: "manual", regex: "\\b(\\d{6})\\b" } },
        })
        const runPayload = await postJson<RunEnvelope>("/api/runs", {
          template_id: template.template_id,
          params: {},
        })

        return {
          sessionId: session.session_id,
          runId: runPayload.run.run_id,
          runStatus: runPayload.run.status,
        }
      },
      { url: startUrl, automationToken, automationClientId }
    )

    expect(setup.sessionId.length).toBeGreaterThan(0)
    expect(setup.runId.length).toBeGreaterThan(0)
    expect(setup.runStatus).toBe("waiting_otp")

    writeFlowDraftRuntimeArtifacts(setup.sessionId, startUrl)
    await page.reload()
    await expect(page.getByRole("heading", { level: 1, name: "Webaudit" })).toBeVisible()

    await page.getByRole("tab", { name: "Task Center" }).click()
    await page.getByRole("tab", { name: /Run Records \(Template\)/ }).click()

    const waitingRunOption = page.locator(`#task-center-template-option-${setup.runId}`)
    await expect(waitingRunOption).toBeVisible({ timeout: 15_000 })
    await waitingRunOption.click()

    await expect(
      page.getByText("This run is waiting for an OTP. Enter it and submit to continue:")
    ).toBeVisible()
    await page.getByPlaceholder("Enter OTP").fill("123456")
    const submitOtpResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/api/runs/${setup.runId}/otp`)
    )
    await page.getByRole("button", { name: "Submit" }).click()
    const submitOtpResponse = await submitOtpResponsePromise
    expect(submitOtpResponse.status()).toBe(200)
    await expect(page.getByText("OTP submitted successfully. The run has continued.")).toBeVisible()

    let postOtpStatus: TaskStatus | "" = ""
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `${apiOrigin}/api/runs/${encodeURIComponent(setup.runId)}`,
          { headers: authHeaders }
        )
        if (response.status() !== 200) return ""
        const payload = (await response.json()) as { run?: { status?: string } }
        const status = (payload.run?.status as TaskStatus | undefined) ?? ""
        postOtpStatus = status
        if (status === "failed" || status === "cancelled") {
          throw new Error(
            `[frontend-e2e-live-ui] run ${setup.runId} entered terminal status ${status} after OTP submit`
          )
        }
        return status
      })
      .toMatch(/^(queued|running|waiting_user|success)$/)
    expect(postOtpStatus).not.toBe("failed")
    expect(postOtpStatus).not.toBe("cancelled")

    await page.getByRole("tab", { name: "Flow Workshop" }).click()
    await expect(page.getByRole("heading", { name: "Key outcomes and next steps" })).toBeVisible()

    const saveDraftResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/api/command-tower/latest-flow-draft")
    )
    await page.getByRole("button", { name: "Save Draft" }).click()
    const saveDraftResponse = await saveDraftResponsePromise
    expect(saveDraftResponse.status()).toBe(200)
    await expect(
      page.getByRole("button", { name: "Dismiss notice: Flow draft saved successfully" })
    ).toBeVisible()

    await page.getByText("Advanced debugging evidence (optional)").click()

    const replayStepResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/api/command-tower/replay-latest-step")
    )
    await page.getByRole("button", { name: "Replay Step" }).first().click()
    const replayStepResponse = await replayStepResponsePromise
    expect(replayStepResponse.status()).toBe(200)
    await expect(page.getByText("Step replay triggered for step-1")).toBeVisible()

    const replayFromStepResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/api/command-tower/replay-latest-from-step")
    )
    await page.getByRole("button", { name: "Resume" }).first().click()
    const replayFromStepResponse = await replayFromStepResponsePromise
    expect(replayFromStepResponse.status()).toBe(200)
    await expect(page.getByText("Resume from step step-1 triggered")).toBeVisible()
  }
)
