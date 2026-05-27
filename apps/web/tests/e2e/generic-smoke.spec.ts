import { expect, test as pwTest } from "@playwright/test"

pwTest("@generic localhost generic smoke", async ({ page }) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => {
    pageErrors.push(error.message)
  })

  const response = await page.goto("/", { waitUntil: "domcontentloaded" })
  expect(response).not.toBeNull()
  expect(response?.status()).toBe(200)
  expect(response?.request().method()).toBe("GET")

  await expect(page.locator("body")).toBeVisible()
  await expect
    .poll(async () => page.evaluate(() => document.readyState), { timeout: 10_000 })
    .toMatch(/^(interactive|complete)$/)

  const bodyText = await page.locator("body").innerText()
  expect(bodyText.trim().length).toBeGreaterThan(0)

  await page.locator("body").click({ position: { x: 8, y: 8 } })
  await page.mouse.wheel(0, 400)
  await expect
    .poll(async () => page.evaluate(() => document.readyState), { timeout: 5_000 })
    .toMatch(/^(interactive|complete)$/)
  expect(pageErrors).toEqual([])
})
