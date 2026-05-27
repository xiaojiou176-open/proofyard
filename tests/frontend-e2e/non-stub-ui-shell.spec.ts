import { expect, test as pwTest } from "@playwright/test"
import {
  annotateBackendUnavailable,
  buildBackendContext,
  getBackendUnavailableReason,
} from "./support/backend-availability.js"

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

pwTest("@frontend-nonstub @nonstub real ui shell loads commands and navigates tabs", async ({ page }) => {
  if (annotateBackendUnavailable(pwTest, skipReason)) return

  await page.goto("/")

  await expect(page.getByRole("heading", { level: 1, name: "Proofyard" })).toBeVisible()
  await expect(page.getByRole("tablist", { name: "Primary navigation" })).toBeVisible()
  await expect(page.getByRole("tablist", { name: "Command categories" })).toBeVisible()
  await expect(page.locator(".command-card").first()).toBeVisible()
  await expect(page.getByRole("button", { name: "Run" }).first()).toBeVisible()

  await page.getByRole("tab", { name: "Task Center" }).click()
  await expect(page.getByRole("tab", { name: "Task Center" })).toHaveAttribute(
    "aria-selected",
    "true"
  )
  await expect(page.getByRole("region", { name: "Live terminal" })).toBeVisible()

  await page.getByRole("tab", { name: "Flow Workshop" }).click()
  await expect(page.getByRole("tab", { name: "Flow Workshop" })).toHaveAttribute(
    "aria-selected",
    "true"
  )
  await expect(page.getByRole("heading", { name: "Key outcomes and next steps" })).toBeVisible()

  await page.getByRole("tab", { name: "Quick Launch" }).click()
  await expect(page.getByRole("tab", { name: "Quick Launch" })).toHaveAttribute(
    "aria-selected",
    "true"
  )
  await expect(page.getByTestId("param-base-url-input")).toBeVisible()
})
