import { expect, test as pwTest, type Page  } from '@playwright/test'
import {
  CONSOLE_TAB_TASK_CENTER_TEST_ID,
  PARAM_BASE_URL_INPUT_TEST_ID,
  QUICK_LAUNCH_FIRST_USE_LOCATE_CONFIG_TEST_ID,
  TASK_CENTER_PANEL_TEMPLATE_RUNS_TEST_ID,
  TASK_CENTER_TAB_TEMPLATE_RUNS_TEST_ID,
} from '../../apps/web/src/constants/testIds'

type StubOptions = {
  runs?: Array<{
    run_id: string
    template_id: string
    status: 'queued' | 'running' | 'waiting_user' | 'waiting_otp' | 'success' | 'failed' | 'cancelled'
    step_cursor: number
    params?: Record<string, string>
    task_id?: string | null
    last_error?: string | null
    artifacts_ref?: Record<string, string>
    created_at?: string
    updated_at?: string
    logs?: Array<{ ts: string; level: 'info' | 'warn' | 'error'; message: string }>
  }>
  onSubmitOtp?: (payload: { runId: string; otpCode: string }) => void
}

async function stubBackendRequests(page: Page, options: StubOptions = {}) {
  const runsState = (options.runs ?? []).map((run) => ({
    params: {},
    task_id: null,
    last_error: null,
    artifacts_ref: {},
    created_at: '2026-02-19T00:00:00.000Z',
    updated_at: '2026-02-19T00:00:00.000Z',
    logs: [],
    ...run,
  }))

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.match(/^\/api\/runs\/[^/]+\/otp$/) && route.request().method() === 'POST') {
      let otpCode = ''
      const raw = route.request().postData()
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { otp_code?: string }
          otpCode = parsed.otp_code ?? ''
        } catch {
          otpCode = ''
        }
      }
      const runId = url.pathname.split('/')[3] ?? ''
      const target = runsState.find((run) => run.run_id === runId)
      if (target) {
        target.status = 'running'
        target.last_error = null
        target.logs = [
          ...(target.logs ?? []),
          { ts: '2026-02-19T00:00:02.000Z', level: 'info', message: 'otp submitted' },
        ]
      }
      options.onSubmitOtp?.({ runId, otpCode })
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ run_id: runId, status: 'running' }) })
      return
    }
    if (url.pathname === '/api/automation/commands') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ commands: [] }) })
      return
    }
    if (url.pathname === '/api/automation/tasks') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) })
      return
    }
    if (url.pathname === '/api/command-tower/latest-flow') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ session_id: null, step_count: 0, source_event_count: 0, steps: [] }),
      })
      return
    }
    if (url.pathname === '/api/command-tower/latest-flow-draft') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flow: null }) })
      return
    }
    if (url.pathname === '/api/command-tower/evidence-timeline') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
      return
    }
    if (url.pathname === '/api/flows') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flows: [] }) })
      return
    }
    if (url.pathname === '/api/templates') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ templates: [] }) })
      return
    }
    if (url.pathname === '/api/runs') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ runs: runsState }) })
      return
    }
    if (url.pathname === '/api/evidence-runs') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ runs: [], registry_state: 'empty' }),
      })
      return
    }
    if (url.pathname.match(/^\/api\/runs\/[^/]+\/recover-plan$/) && route.request().method() === 'GET') {
      const runId = url.pathname.split('/')[3] ?? ''
      const run = runsState.find((item) => item.run_id === runId)
      const waitingOtp = run?.status === 'waiting_otp'
      const waitingUser = run?.status === 'waiting_user'
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          plan: {
            run_id: runId,
            status: waitingOtp ? 'waiting_otp' : waitingUser ? 'waiting_user' : 'failed',
            headline: waitingOtp
              ? 'This run is waiting for an OTP. Enter it and submit to continue:'
              : waitingUser
                ? 'This run is waiting for additional input. Provide it and submit to continue:'
                : 'Recovery plan available',
            summary: waitingOtp
              ? 'Enter the OTP code and submit to resume the run.'
              : waitingUser
                ? 'Provide the required input and submit to resume the run.'
                : 'Provide waiting input and continue.',
            reason_code: waitingOtp ? 'otp_required' : waitingUser ? 'manual_input_required' : 'waiting_input',
            primary_action: waitingOtp
              ? {
                  action_id: 'submit_otp',
                  label: 'Submit OTP',
                  description: 'Submit the OTP code and resume this run.',
                  kind: 'resume',
                  step_id: null,
                  requires_input: true,
                  input_label: 'OTP',
                }
              : waitingUser
                ? {
                    action_id: 'submit_input',
                    label: 'Submit additional input',
                    description: 'Submit the required input and resume this run.',
                    kind: 'resume',
                    step_id: null,
                    requires_input: true,
                    input_label: 'Additional Input',
                  }
                : null,
            actions: waitingOtp
              ? [
                  {
                    action_id: 'submit_otp',
                    label: 'Submit OTP',
                    description: 'Submit the OTP code and resume this run.',
                    kind: 'resume',
                    step_id: null,
                    requires_input: true,
                    input_label: 'OTP',
                  },
                ]
              : waitingUser
                ? [
                    {
                      action_id: 'submit_input',
                      label: 'Submit additional input',
                      description: 'Submit the required input and resume this run.',
                      kind: 'resume',
                      step_id: null,
                      requires_input: true,
                      input_label: 'Additional Input',
                    },
                  ]
                : [],
            suggested_step_id: null,
            linked_task_id: null,
            correlation_id: null,
          },
        }),
      })
      return
    }
    throw new Error(`[first-use-guardrails] Unhandled API route: ${route.request().method()} ${url.pathname}`)
  })
  await page.route('**/health/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/health/diagnostics') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          uptime_seconds: 600,
          task_total: runsState.length,
          task_counts: { queued: 0, running: 0, success: 0, failed: 0, cancelled: 0 },
          metrics: { requests_total: 42, rate_limited: 0 },
        }),
      })
      return
    }
    if (url.pathname === '/health/alerts') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          state: 'ok',
          failure_rate: 0,
          threshold: 0.2,
          completed: 0,
          failed: 0,
        }),
      })
      return
    }
    throw new Error(`[first-use-guardrails] Unhandled health route: ${route.request().method()} ${url.pathname}`)
  })
}

async function bootstrapFirstUse(page: Page) {
  await stubBackendRequests(page)
  await page.addInitScript(() => {
    window.localStorage.setItem('ab_onboarding_done', '1')
    window.localStorage.removeItem('ab_first_use_done')
    window.localStorage.removeItem('ab_first_use_stage')
    window.localStorage.removeItem('ab_first_use_progress')
  })
}

async function openTaskCenterTab(page: Page) {
  await expect(async () => {
    const taskCenterTab = page.getByTestId(CONSOLE_TAB_TASK_CENTER_TEST_ID)
    if ((await taskCenterTab.count()) === 0) {
      await page.goto('/', { waitUntil: 'domcontentloaded' })
    }
    await expect(taskCenterTab).toBeVisible({ timeout: 3_000 })
    await taskCenterTab.dispatchEvent('click')
    await expect(taskCenterTab).toHaveAttribute('aria-selected', 'true', { timeout: 1_000 })
  }).toPass({ timeout: 20_000 })
}

async function clickLocateConfig(page: Page) {
  const byTestId = page.getByTestId(QUICK_LAUNCH_FIRST_USE_LOCATE_CONFIG_TEST_ID)
  if ((await byTestId.count()) > 0) {
    await byTestId.click()
    return
  }
  await page.getByRole('button', { name: 'Go to configuration' }).click()
}

async function getBaseUrlInput(page: Page) {
  const byTestId = page.getByTestId(PARAM_BASE_URL_INPUT_TEST_ID)
  if ((await byTestId.count()) > 0) return byTestId
  return page.getByRole('textbox', { name: 'Target site URL (UIQ_BASE_URL)' })
}

pwTest.describe('@frontend-first-use guardrails', () => {
  pwTest.use({ viewport: { width: 1440, height: 900 } })

  pwTest('@frontend-first-use guard config blocks run before valid params', async ({ page }) => {
    await bootstrapFirstUse(page)
    await page.goto('/')

    await expect(page.getByText('First-use guide', { exact: true })).toBeVisible()
    const startStepButton = page.getByRole('button', { name: 'Start step 1' })
    if ((await startStepButton.count()) > 0) {
      await startStepButton.click()
    }
    await clickLocateConfig(page)

    const baseUrlInput = await getBaseUrlInput(page)
    await expect(baseUrlInput).toBeVisible({ timeout: 15_000 })
    await baseUrlInput.fill('invalid-url')

    const enterRunBtn = page.getByRole('button', { name: 'Configuration done, continue to run' })
    await expect(enterRunBtn).toBeDisabled()
    await expect(page.getByText('Enter a valid baseUrl, an optional startUrl, and a successSelector before continuing.')).toBeVisible()

    await baseUrlInput.fill('http://127.0.0.1:17380')
    await expect(enterRunBtn).toBeEnabled()
  })

  pwTest('@frontend-first-use guard verify blocks completion before result', async ({ page }) => {
    await stubBackendRequests(page)
    await page.addInitScript(() => {
      window.localStorage.setItem('ab_onboarding_done', '1')
      window.localStorage.removeItem('ab_first_use_done')
      window.localStorage.setItem('ab_first_use_stage', 'verify')
      window.localStorage.setItem('ab_first_use_progress', JSON.stringify({ runTriggered: true, resultSeen: false }))
    })

    await page.goto('/')

    await expect(page.getByText('No success or failure result is visible yet. Wait for the task to finish in Task Center first.')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Complete the first-use guide' })).toBeDisabled({ timeout: 15_000 })
  })
})

pwTest.describe('@frontend-first-use resume', () => {
  pwTest('@frontend-first-use resume waiting-otp run can resume after submit', async ({ page }) => {
    const submitted: Array<{ runId: string; otpCode: string }> = []
    await stubBackendRequests(page, {
      runs: [
        {
          run_id: 'run-waiting-otp-001',
          template_id: 'tpl-demo-001',
          status: 'waiting_otp',
          step_cursor: 2,
        },
      ],
      onSubmitOtp: (payload) => submitted.push(payload),
    })
    await page.addInitScript(() => {
      window.localStorage.setItem('ab_onboarding_done', '1')
      window.localStorage.setItem('ab_first_use_done', '1')
    })

    await page.goto('/')
    await openTaskCenterTab(page)
    const templateRunsTab = page.getByTestId(TASK_CENTER_TAB_TEMPLATE_RUNS_TEST_ID)
    await expect(templateRunsTab).toHaveAttribute('role', 'tab')
    await templateRunsTab.click()
    await expect(page.getByTestId(TASK_CENTER_PANEL_TEMPLATE_RUNS_TEST_ID)).toBeVisible()
    const taskDetail = page.locator('.task-detail-column')
    await expect(taskDetail.getByText('Loading recovery guidance...')).toHaveCount(0, { timeout: 15000 })
    await expect(taskDetail.locator('#task-center-run-input')).toBeVisible()

    await taskDetail.locator('#task-center-run-input').fill('123456')
    await taskDetail.getByRole('button', { name: 'Submit' }).click()

    await expect(page.getByText('OTP submitted and the run resumed')).toBeVisible()
    await expect.poll(() => submitted.length).toBe(1)
    await expect(submitted[0]).toEqual({ runId: 'run-waiting-otp-001', otpCode: '123456' })
    await expect(page.locator('.task-detail-column .chip', { hasText: 'Running' })).toBeVisible()
  })

  pwTest('@frontend-first-use resume waiting-user run can resume after submit', async ({ page }) => {
    const submitted: Array<{ runId: string; otpCode: string }> = []
    await stubBackendRequests(page, {
      runs: [
        {
          run_id: 'run-waiting-user-001',
          template_id: 'tpl-demo-002',
          status: 'waiting_user',
          step_cursor: 3,
        },
      ],
      onSubmitOtp: (payload) => submitted.push(payload),
    })
    await page.addInitScript(() => {
      window.localStorage.setItem('ab_onboarding_done', '1')
      window.localStorage.setItem('ab_first_use_done', '1')
    })

    await page.goto('/')
    await openTaskCenterTab(page)
    const templateRunsTab = page.getByTestId(TASK_CENTER_TAB_TEMPLATE_RUNS_TEST_ID)
    await expect(templateRunsTab).toHaveAttribute('role', 'tab')
    await templateRunsTab.click()
    await expect(page.getByTestId(TASK_CENTER_PANEL_TEMPLATE_RUNS_TEST_ID)).toBeVisible()
    const taskDetail = page.locator('.task-detail-column')
    await expect(taskDetail.getByText('Loading recovery guidance...')).toHaveCount(0, { timeout: 15000 })
    await expect(taskDetail.locator('#task-center-run-input')).toBeVisible()

    await taskDetail.locator('#task-center-run-input').fill('manual-input-001')
    await taskDetail.getByRole('button', { name: 'Submit' }).click()

    await expect(page.getByText('additional input submitted and the run resumed')).toBeVisible()
    await expect.poll(() => submitted.length).toBe(1)
    await expect(submitted[0]).toEqual({ runId: 'run-waiting-user-001', otpCode: 'manual-input-001' })
    await expect(page.locator('.task-detail-column .chip', { hasText: 'Running' })).toBeVisible()
  })
})
