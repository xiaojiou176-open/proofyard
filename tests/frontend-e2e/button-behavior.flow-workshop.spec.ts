import { expect } from '@playwright/test'
import { CONSOLE_TAB_FLOW_DRAFT_TEST_ID } from '../../apps/web/src/constants/testIds'
import { bootstrapButtonBehaviorApp, buttonBehaviorCase } from './support/button-behavior-harness'

buttonBehaviorCase(
  { case_id: 'nav-flow-workshop-selected', assertion_type: 'aria-selected' },
  async ({ page }) => {
    await bootstrapButtonBehaviorApp(page)
    const workshopTab = page.getByTestId(CONSOLE_TAB_FLOW_DRAFT_TEST_ID)

    await workshopTab.click()

    await expect(workshopTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('heading', { name: 'Key outcome and next action' })).toBeVisible()
  },
)

buttonBehaviorCase(
  { case_id: 'flowworkshop-save-draft-success', assertion_type: 'toast-visible' },
  async ({ page }) => {
    const harness = await bootstrapButtonBehaviorApp(page)
    await page.getByTestId(CONSOLE_TAB_FLOW_DRAFT_TEST_ID).click()

    await page.getByRole('button', { name: 'Save Draft' }).click()

    await expect.poll(() => harness.calls.saveFlowDraft).toBe(1)
    await expect(page.locator('.toast-message').filter({ hasText: 'Flow draft saved successfully' })).toBeVisible()
  },
)

buttonBehaviorCase(
  { case_id: 'flowworkshop-replay-latest-success', assertion_type: 'toast-visible' },
  async ({ page }) => {
    const harness = await bootstrapButtonBehaviorApp(page)
    await page.getByTestId(CONSOLE_TAB_FLOW_DRAFT_TEST_ID).click()

    await page.getByRole('button', { name: 'Replay Latest Flow' }).click()

    await expect.poll(() => harness.calls.replayLatestFlow).toBe(1)
    await expect(page.locator('.toast-message').filter({ hasText: 'Flow replay triggered' })).toBeVisible()
  },
)

buttonBehaviorCase(
  { case_id: 'flowworkshop-replay-step-success', assertion_type: 'toast-visible' },
  async ({ page }) => {
    const harness = await bootstrapButtonBehaviorApp(page)
    await page.getByTestId(CONSOLE_TAB_FLOW_DRAFT_TEST_ID).click()
    await page.getByText('Advanced workshop (optional): system diagnostics, flow editing, and debugging evidence').click()

    await page.getByRole('button', { name: 'Replay Step' }).first().click()

    await expect.poll(() => harness.calls.replayStep).toBe(1)
    await expect(page.locator('.toast-message').filter({ hasText: 'Step replay triggered for step-1' })).toBeVisible()
  },
)

buttonBehaviorCase(
  { case_id: 'flowworkshop-replay-from-step-success', assertion_type: 'toast-visible' },
  async ({ page }) => {
    const harness = await bootstrapButtonBehaviorApp(page)
    await page.getByTestId(CONSOLE_TAB_FLOW_DRAFT_TEST_ID).click()
    await page.getByText('Advanced workshop (optional): system diagnostics, flow editing, and debugging evidence').click()

    await page.getByRole('button', { name: 'Resume' }).first().click()

    await expect.poll(() => harness.calls.replayFromStep).toBe(1)
    await expect(page.locator('.toast-message').filter({ hasText: 'Resume from step step-1 triggered' })).toBeVisible()
  },
)
