import { expect } from '@playwright/test'
import { CONSOLE_TAB_QUICK_LAUNCH_TEST_ID, CONSOLE_TAB_TASK_CENTER_TEST_ID } from '../../apps/web/src/constants/testIds'
import { bootstrapButtonBehaviorApp, buttonBehaviorCase } from './support/button-behavior-harness'

buttonBehaviorCase(
  { case_id: 'nav-quick-launch-selected', assertion_type: 'aria-selected' },
  async ({ page }) => {
    await bootstrapButtonBehaviorApp(page)
    const quickLaunchTab = page.getByTestId(CONSOLE_TAB_QUICK_LAUNCH_TEST_ID)
    const taskCenterTab = page.getByTestId(CONSOLE_TAB_TASK_CENTER_TEST_ID)

    await taskCenterTab.click()
    await quickLaunchTab.click()

    await expect(quickLaunchTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('#quick-launch-params-panel')).toBeVisible()
  },
)

buttonBehaviorCase(
  { case_id: 'nav-locale-en-selected', assertion_type: 'storage-change' },
  async ({ page }) => {
    await bootstrapButtonBehaviorApp(page, {
      localStorage: {
        webaudit_locale: 'zh-CN',
      },
    })

    await page.getByRole('button', { name: 'EN', exact: true }).click()

    await expect.poll(() =>
      page.evaluate(() => window.localStorage.getItem('webaudit_locale'))
    ).toBe('en')
    await expect(page.getByRole('button', { name: 'EN', exact: true })).toHaveAttribute('aria-pressed', 'true')
  },
)

buttonBehaviorCase(
  { case_id: 'nav-locale-zh-cn-selected', assertion_type: 'storage-change' },
  async ({ page }) => {
    await bootstrapButtonBehaviorApp(page)

    await page.getByRole('button', { name: '中文', exact: true }).click()

    await expect.poll(() =>
      page.evaluate(() => window.localStorage.getItem('webaudit_locale'))
    ).toBe('zh-CN')
    await expect(page.getByRole('button', { name: '中文', exact: true })).toHaveAttribute('aria-pressed', 'true')
  },
)

buttonBehaviorCase(
  { case_id: 'quicklaunch-first-use-start-stage', assertion_type: 'text-visible' },
  async ({ page }) => {
    await bootstrapButtonBehaviorApp(page, {
      localStorage: {
        onboardingDone: true,
        firstUseDone: false,
      },
      tasks: [],
      runs: [],
    })

    await page.getByRole('button', { name: 'Start step 1' }).click()
    await expect(page.getByText(/Step 1: configure baseUrl, startUrl, and successSelector in the parameter rail/)).toBeVisible()
  },
)

buttonBehaviorCase(
  { case_id: 'quicklaunch-enter-run-stage', assertion_type: 'text-visible' },
  async ({ page }) => {
    await bootstrapButtonBehaviorApp(page, {
      localStorage: {
        onboardingDone: true,
        firstUseDone: false,
        firstUseStage: 'configure',
        firstUseProgress: {
          configValid: true,
          runTriggered: false,
          resultSeen: false,
        },
      },
      tasks: [],
      runs: [],
    })

    await page.getByRole('button', { name: 'Configuration done, continue to run' }).click()
    await expect(
      page.getByText(/Step 2: use the canonical run first. Templates and advanced workshop commands can wait/)
    ).toBeVisible()
  },
)

buttonBehaviorCase(
  { case_id: 'quicklaunch-first-use-locate-config', assertion_type: 'text-visible' },
  async ({ page }) => {
    await bootstrapButtonBehaviorApp(page, {
      localStorage: {
        onboardingDone: true,
        firstUseDone: false,
      },
      tasks: [],
      runs: [],
    })

    await page.getByTestId('quick-launch-first-use-locate-config').click()
    await expect(
      page.getByText(/Step 1: configure baseUrl, startUrl, and successSelector in the parameter rail/)
    ).toBeVisible()
  },
)

buttonBehaviorCase(
  { case_id: 'quicklaunch-sidebar-toggle-panel', assertion_type: 'visibility-toggle' },
  async ({ page }) => {
    await bootstrapButtonBehaviorApp(page)
    const collapseButton = page.getByRole('button', { name: 'Collapse parameter rail' })
    const paramsPanel = page.locator('#quick-launch-params-panel')

    await collapseButton.click()
    await expect(paramsPanel).toBeHidden()
    await expect(page.getByRole('button', { name: 'Expand parameter rail' })).toBeVisible()
  },
)
