import { expect } from '@playwright/test'
import { bootstrapButtonBehaviorApp, buttonBehaviorCase } from './support/button-behavior-harness'

buttonBehaviorCase(
  { case_id: 'commandgrid-filter-pipeline', assertion_type: 'text-visible' },
  async ({ page }) => {
    await bootstrapButtonBehaviorApp(page)
    await page.getByRole('tab', { name: /Pipeline/ }).click()

    await expect(page.getByRole('heading', { name: 'Run pipeline task' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Initialize environment' })).toHaveCount(0)
  },
)

buttonBehaviorCase(
  { case_id: 'commandgrid-filter-frontend', assertion_type: 'text-visible' },
  async ({ page }) => {
    await bootstrapButtonBehaviorApp(page, {
      commands: [
        {
          command_id: 'frontend-lint',
          title: 'Frontend checks',
          description: 'Verify frontend category filtering',
          tags: ['frontend'],
        },
        {
          command_id: 'clean-cache',
          title: 'Clear cache',
          description: 'Verify maintenance category filtering',
          tags: ['maintenance'],
        },
      ],
    })
    await page.getByTestId('command-category-frontend').click()

    await expect(page.getByRole('heading', { name: 'Frontend checks' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Clear cache' })).toHaveCount(0)
  },
)

buttonBehaviorCase(
  { case_id: 'commandgrid-filter-maintenance', assertion_type: 'text-visible' },
  async ({ page }) => {
    await bootstrapButtonBehaviorApp(page, {
      commands: [
        {
          command_id: 'frontend-lint',
          title: 'Frontend checks',
          description: 'Verify frontend category filtering',
          tags: ['frontend'],
        },
        {
          command_id: 'clean-cache',
          title: 'Clear cache',
          description: 'Verify maintenance category filtering',
          tags: ['maintenance'],
        },
      ],
    })
    await page.getByTestId('command-category-maintenance').click()

    await expect(page.getByRole('heading', { name: 'Clear cache' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Frontend checks' })).toHaveCount(0)
  },
)

buttonBehaviorCase(
  { case_id: 'commandgrid-run-command-success', assertion_type: 'toast-visible' },
  async ({ page }) => {
    const harness = await bootstrapButtonBehaviorApp(page)
    const commandCard = page
      .locator('.command-grid')
      .locator(':scope > *')
      .filter({ hasText: 'Run pipeline task' })
      .first()

    await expect(commandCard).toBeVisible()
    await commandCard.getByRole('button', { name: 'Run' }).click()

    await expect.poll(() => harness.calls.runCommand).toBe(1)
    await expect(page.getByText('Submitted Run pipeline task')).toBeVisible()
  },
)
