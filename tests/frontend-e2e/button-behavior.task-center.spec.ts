import { expect } from '@playwright/test'
import {
  CONSOLE_TAB_TASK_CENTER_TEST_ID,
  TASK_CENTER_PANEL_COMMAND_RUNS_TEST_ID,
  TASK_CENTER_PANEL_TEMPLATE_RUNS_TEST_ID,
  TASK_CENTER_TAB_COMMAND_RUNS_TEST_ID,
  TASK_CENTER_TAB_TEMPLATE_RUNS_TEST_ID,
  TASK_CENTER_TEMPLATE_RUNS_REFRESH_TEST_ID,
} from '../../apps/web/src/constants/testIds'
import { bootstrapButtonBehaviorApp, buttonBehaviorCase } from './support/button-behavior-harness'

buttonBehaviorCase(
  { case_id: 'nav-task-center-selected', assertion_type: 'aria-selected' },
  async ({ page }) => {
    await bootstrapButtonBehaviorApp(page)
    const taskCenterTab = page.getByTestId(CONSOLE_TAB_TASK_CENTER_TEST_ID)

    await taskCenterTab.click()

    await expect(taskCenterTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.task-center-view')).toBeVisible()
  },
)

buttonBehaviorCase(
  { case_id: 'taskcenter-template-runs-visible', assertion_type: 'visibility-toggle' },
  async ({ page }) => {
    await bootstrapButtonBehaviorApp(page)
    await page.getByTestId(CONSOLE_TAB_TASK_CENTER_TEST_ID).click()

    const templateTab = page.getByTestId(TASK_CENTER_TAB_TEMPLATE_RUNS_TEST_ID)
    const commandPanel = page.getByTestId(TASK_CENTER_PANEL_COMMAND_RUNS_TEST_ID)
    const templatePanel = page.getByTestId(TASK_CENTER_PANEL_TEMPLATE_RUNS_TEST_ID)

    await templateTab.click()

    await expect(templatePanel).toBeVisible()
    await expect(commandPanel).toBeHidden()
  },
)

buttonBehaviorCase(
  { case_id: 'taskcenter-command-runs-visible', assertion_type: 'visibility-toggle' },
  async ({ page }) => {
    await bootstrapButtonBehaviorApp(page)
    await page.getByTestId(CONSOLE_TAB_TASK_CENTER_TEST_ID).click()

    const commandTab = page.getByTestId(TASK_CENTER_TAB_COMMAND_RUNS_TEST_ID)
    const templateTab = page.getByTestId(TASK_CENTER_TAB_TEMPLATE_RUNS_TEST_ID)
    const commandPanel = page.getByTestId(TASK_CENTER_PANEL_COMMAND_RUNS_TEST_ID)
    const templatePanel = page.getByTestId(TASK_CENTER_PANEL_TEMPLATE_RUNS_TEST_ID)

    await templateTab.click()
    await commandTab.click()

    await expect(commandPanel).toBeVisible()
    await expect(templatePanel).toBeHidden()
  },
)

buttonBehaviorCase(
  { case_id: 'taskcenter-submit-waiting-input-success', assertion_type: 'toast-visible' },
  async ({ page }) => {
    const harness = await bootstrapButtonBehaviorApp(page, {
      runs: [
        {
          run_id: 'run-waiting-otp-001',
          template_id: 'tpl-demo-001',
          status: 'waiting_otp',
          step_cursor: 1,
          params: { email: 'demo@example.com' },
          task_id: null,
          last_error: null,
          artifacts_ref: {},
          created_at: '2026-02-20T00:00:00.000Z',
          updated_at: '2026-02-20T00:00:00.000Z',
          logs: [],
        },
      ],
    })
    await page.getByTestId(CONSOLE_TAB_TASK_CENTER_TEST_ID).click()
    await page.getByTestId(TASK_CENTER_TAB_TEMPLATE_RUNS_TEST_ID).click()

    await page.locator('#task-center-template-option-run-waiting-otp-001').click()
    const taskDetail = page.locator('.task-detail-column')
    await expect(taskDetail.getByText('Loading recovery guidance...')).toHaveCount(0, { timeout: 15000 })
    await expect(taskDetail.locator('#task-center-run-input')).toBeVisible()
    await taskDetail.locator('#task-center-run-input').fill('123456')
    await taskDetail.getByRole('button', { name: 'Submit' }).click()

    await expect.poll(() => harness.calls.submitRunOtp).toBe(1)
    await expect(page.getByText('OTP submitted and the run resumed')).toBeVisible()
  },
)

buttonBehaviorCase(
  { case_id: 'taskcenter-refresh-template-runs', assertion_type: 'toast-visible' },
  async ({ page }) => {
    const harness = await bootstrapButtonBehaviorApp(page)
    await page.getByTestId(CONSOLE_TAB_TASK_CENTER_TEST_ID).click()
    await page.getByTestId(TASK_CENTER_TAB_TEMPLATE_RUNS_TEST_ID).click()

    const fetchBefore = harness.calls.fetchTasks
    await page.getByTestId(TASK_CENTER_TEMPLATE_RUNS_REFRESH_TEST_ID).click()

    await expect.poll(() => harness.calls.fetchTasks).toBeGreaterThan(fetchBefore)
  },
)

buttonBehaviorCase(
  { case_id: 'taskcenter-explain-run-panel', assertion_type: 'text-visible' },
  async ({ page }) => {
    await bootstrapButtonBehaviorApp(page)
    await page.getByTestId(CONSOLE_TAB_TASK_CENTER_TEST_ID).click()

    await page.getByRole('button', { name: 'Explain this run' }).click()

    await expect(page.getByTestId('failure-explainer-panel')).toBeVisible()
    await expect(page.getByText('Recommended next step')).toBeVisible()
  },
)

buttonBehaviorCase(
  { case_id: 'taskcenter-share-pack-panel', assertion_type: 'text-visible' },
  async ({ page }) => {
    await bootstrapButtonBehaviorApp(page)
    await page.getByTestId(CONSOLE_TAB_TASK_CENTER_TEST_ID).click()

    await page.getByRole('button', { name: 'Share pack' }).click()

    await expect(page.getByText('Evidence Share Pack')).toBeVisible()
    await expect(page.getByText('Markdown summary')).toBeVisible()
  },
)

buttonBehaviorCase(
  { case_id: 'taskcenter-compare-runs-panel', assertion_type: 'text-visible' },
  async ({ page }) => {
    await bootstrapButtonBehaviorApp(page)
    await page.getByTestId(CONSOLE_TAB_TASK_CENTER_TEST_ID).click()

    await page.getByRole('button', { name: 'Compare runs' }).click()

    await expect(page.getByText('Run Compare')).toBeVisible()
    await expect(page.getByText('Compare state')).toBeVisible()
  },
)

buttonBehaviorCase(
  { case_id: 'taskcenter-review-workspace-panel', assertion_type: 'text-visible' },
  async ({ page }) => {
    await bootstrapButtonBehaviorApp(page)
    await page.getByTestId(CONSOLE_TAB_TASK_CENTER_TEST_ID).click()

    await page.getByRole('button', { name: 'Review workspace' }).click()

    await expect(page.getByText('Review Workspace')).toBeVisible()
    await expect(page.getByText('Packet health')).toBeVisible()
  },
)

buttonBehaviorCase(
  { case_id: 'taskcenter-promotion-guidance-panel', assertion_type: 'text-visible' },
  async ({ page }) => {
    await bootstrapButtonBehaviorApp(page)
    await page.getByTestId(CONSOLE_TAB_TASK_CENTER_TEST_ID).click()

    await page.getByRole('button', { name: 'Promotion guidance' }).click()

    await expect(page.getByText('Promotion guidance')).toBeVisible()
    await expect(page.getByText('Promotion readiness should come last.')).toBeVisible()
  },
)
