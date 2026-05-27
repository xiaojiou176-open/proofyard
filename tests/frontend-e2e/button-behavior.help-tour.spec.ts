import { expect } from '@playwright/test'
import { bootstrapButtonBehaviorApp, buttonBehaviorCase } from './support/button-behavior-harness'

buttonBehaviorCase(
  { case_id: 'helptour-open-panel', assertion_type: 'text-visible' },
  async ({ page }) => {
    await bootstrapButtonBehaviorApp(page)
    await page.getByRole('button', { name: 'Help' }).click()

    await expect(page.getByRole('dialog', { name: 'Help' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Steps' })).toBeVisible()
  },
)

buttonBehaviorCase(
  { case_id: 'helptour-restart-onboarding', assertion_type: 'storage-change' },
  async ({ page }) => {
    await bootstrapButtonBehaviorApp(page)
    await page.getByRole('button', { name: 'Help' }).click()
    await page.getByRole('button', { name: 'Restart the first-use guide' }).click()

    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('ab_onboarding_done'))).toBe(null)
    await expect(page.getByText('Step 1: decide the goal and inspect the parameter rail')).toBeVisible()
  },
)
