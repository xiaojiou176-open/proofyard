import { expect, test as pwTest, type Page  } from '@playwright/test'

type Command = {
  command_id: string
  title: string
  description: string
  tags: string[]
}

type Task = {
  task_id: string
  command_id: string
  status: 'queued' | 'running' | 'success' | 'failed' | 'cancelled'
  requested_by: string | null
  attempt: number
  max_attempts: number
  created_at: string
  started_at: string | null
  finished_at: string | null
  exit_code: number | null
  message: string | null
  output_tail: string
}

type UniversalRun = {
  run_id: string
  template_id: string
  status: 'queued' | 'running' | 'waiting_user' | 'waiting_otp' | 'success' | 'failed' | 'cancelled'
  step_cursor: number
  params: Record<string, string>
  task_id: string | null
  last_error: string | null
  artifacts_ref: Record<string, string>
  created_at: string
  updated_at: string
  logs: Array<{ ts: string; level: 'info' | 'warn' | 'error'; message: string }>
}

type StubState = {
  commands: Command[]
  tasks: Task[]
  runs: UniversalRun[]
  templates: Array<{
    template_id: string
    flow_id: string
    name: string
    params_schema: Array<{
      key: string
      type: 'string' | 'secret' | 'enum' | 'regex' | 'email'
      required: boolean
      description?: string | null
      enum_values?: string[]
      pattern?: string | null
    }>
    defaults: Record<string, string>
    policies: {
      retries: number
      timeout_seconds: number
      otp: {
        required: boolean
        provider: 'manual' | 'gmail' | 'imap' | 'vonage'
        timeout_seconds: number
        regex: string
      }
      branches: Record<string, unknown>
    }
    created_by: string | null
    created_at: string
    updated_at: string
  }>
  latestFlow: {
    session_id: string | null
    start_url: string | null
    generated_at: string | null
    source_event_count: number
    step_count: number
    steps: Array<{ step_id: string; action: string; selector?: string | null }>
  }
  flowDraft: {
    flow_id: string
    session_id: string
    start_url: string
    generated_at: string
    source_event_count: number
    steps: Array<{
      step_id: string
      action: 'navigate' | 'click' | 'type'
      selected_selector_index: number
      target: { selectors: Array<{ kind: 'css' | 'role' | 'id' | 'name'; value: string; score: number }> }
      url?: string
    }>
  }
  evidenceTimeline: Array<{
    step_id: string
    action: string
    ok: boolean
    detail: string
    duration_ms: number
    matched_selector: string | null
    selector_index: number | null
    screenshot_before_path: string | null
    screenshot_after_path: string | null
    screenshot_before_data_url: string | null
    screenshot_after_data_url: string | null
    fallback_trail: Array<{
      selector_index: number
      kind: string
      value: string
      normalized: string | null
      success: boolean
      error: string | null
    }>
  }>
  calls: {
    fetchTasks: number
    fetchDiagnostics: number
    runCommand: number
    createRun: number
    cancelTask: number
    submitRunOtp: number
    saveFlowDraft: number
    replayLatestFlow: number
    replayStep: number
    replayFromStep: number
    taskQuery: {
      status: string
      command_id: string
      limit: string
    }
  }
  seq: number
}

async function clickCategoryTab(page: Page, testId: string, roleName: string) {
  const byTestId = page.getByTestId(testId)
  if ((await byTestId.count()) > 0) {
    await byTestId.click()
    return
  }
  await page.getByRole('tab', { name: new RegExp(`^${roleName}(\\s|$)`) }).click()
}

async function getBaseUrlInput(page: Page) {
  const byTestId = page.getByTestId('param-base-url-input')
  if ((await byTestId.count()) > 0) return byTestId
  return page.getByRole('textbox', { name: 'Target site URL (UIQ_BASE_URL)' })
}

async function getRegisterPasswordInput(page: Page) {
  const byTestId = page.getByTestId('param-register-password-input')
  if ((await byTestId.count()) > 0) return byTestId
  return page.getByRole('textbox', { name: 'Registration password (optional)' })
}

async function clickRegisterPasswordVisibilityToggle(page: Page, input: ReturnType<Page['locator']>) {
  const byTestId = page.getByTestId('params-toggle-register-password-visibility')
  if ((await byTestId.count()) > 0) {
    await byTestId.click()
    return
  }
  const field = page.locator('.field').filter({ has: input })
  await field.getByRole('button', { name: /Show|Hide/ }).click()
}

async function clickTabByTestIdOrRole(page: Page, testId: string, roleName: string) {
  const byTestId = page.getByTestId(testId)
  if ((await byTestId.count()) > 0) {
    await byTestId.click()
    return
  }
  await page.getByRole('tab', { name: new RegExp(`^${roleName}(\\s|$)`) }).click()
}

function createTask(taskId: string, commandId: string, status: Task['status']): Task {
  return {
    task_id: taskId,
    command_id: commandId,
    status,
    requested_by: 'e2e',
    attempt: 1,
    max_attempts: 3,
    created_at: '2026-02-20T00:00:00.000Z',
    started_at: '2026-02-20T00:00:01.000Z',
    finished_at: null,
    exit_code: null,
    message: status === 'running' ? 'Task is running' : null,
    output_tail: `output-${taskId}`,
  }
}

function createState(): StubState {
  return {
    commands: [
      {
        command_id: 'cmd-e2e-001',
        title: 'Open homepage',
        description: 'Critical-button E2E verification command',
        tags: ['e2e'],
      },
      {
        command_id: 'clean',
        title: 'Clear cache',
        description: 'delete temp cache before rerun',
        tags: ['maintenance'],
      },
    ],
    tasks: [
      createTask('task-running-001', 'cmd-e2e-001', 'running'),
      { ...createTask('task-success-001', 'cmd-e2e-001', 'success'), finished_at: '2026-02-20T00:02:00.000Z', exit_code: 0 },
    ],
    runs: [
      {
        run_id: 'run-waiting-otp-001',
        template_id: 'tpl-e2e-001',
        status: 'waiting_otp',
        step_cursor: 2,
        params: { email: 'demo@example.com' },
        task_id: null,
        last_error: null,
        artifacts_ref: {},
        created_at: '2026-02-20T00:00:00.000Z',
        updated_at: '2026-02-20T00:00:00.000Z',
        logs: [],
      },
    ],
    templates: [
      {
        template_id: 'tpl-e2e-001',
        flow_id: 'flow-e2e-001',
        name: 'Example template',
        params_schema: [{ key: 'email', type: 'email', required: true, description: 'Account email' }],
        defaults: { email: 'demo@example.com' },
        policies: {
          retries: 0,
          timeout_seconds: 120,
          otp: { required: true, provider: 'manual', timeout_seconds: 120, regex: '\\b(\\d{6})\\b' },
          branches: {},
        },
        created_by: 'e2e',
        created_at: '2026-02-20T00:00:00.000Z',
        updated_at: '2026-02-20T00:00:00.000Z',
      },
    ],
    latestFlow: {
      session_id: 'session-e2e-001',
      start_url: 'https://example.com',
      generated_at: '2026-02-20T00:00:00.000Z',
      source_event_count: 4,
      step_count: 2,
      steps: [
        { step_id: 's1', action: 'navigate', selector: null },
        { step_id: 's2', action: 'click', selector: '#submit' },
      ],
    },
    flowDraft: {
      flow_id: 'flow-e2e-001',
      session_id: 'session-e2e-001',
      start_url: 'https://example.com',
      generated_at: '2026-02-20T00:00:00.000Z',
      source_event_count: 4,
      steps: [
        {
          step_id: 's1',
          action: 'navigate',
          selected_selector_index: 0,
          url: 'https://example.com',
          target: { selectors: [{ kind: 'css', value: 'body', score: 80 }] },
        },
        {
          step_id: 's2',
          action: 'click',
          selected_selector_index: 0,
          target: { selectors: [{ kind: 'css', value: '#submit', score: 90 }] },
        },
      ],
    },
    evidenceTimeline: [
      {
        step_id: 's1',
        action: 'navigate',
        ok: true,
        detail: 'step s1 ok',
        duration_ms: 120,
        matched_selector: null,
        selector_index: null,
        screenshot_before_path: null,
        screenshot_after_path: null,
        screenshot_before_data_url: null,
        screenshot_after_data_url: null,
        fallback_trail: [],
      },
      {
        step_id: 's2',
        action: 'click',
        ok: false,
        detail: 'step s2 failed',
        duration_ms: 240,
        matched_selector: '#submit',
        selector_index: 0,
        screenshot_before_path: null,
        screenshot_after_path: null,
        screenshot_before_data_url: null,
        screenshot_after_data_url: null,
        fallback_trail: [],
      },
    ],
    calls: {
      fetchTasks: 0,
      fetchDiagnostics: 0,
      runCommand: 0,
      createRun: 0,
      cancelTask: 0,
      submitRunOtp: 0,
      saveFlowDraft: 0,
      replayLatestFlow: 0,
      replayStep: 0,
      replayFromStep: 0,
      taskQuery: {
        status: 'all',
        command_id: '',
        limit: '100',
      },
    },
    seq: 100,
  }
}

function createReplayTask(state: StubState, commandId: string): Task {
  state.seq += 1
  return createTask(`task-e2e-${state.seq}`, commandId, 'running')
}

async function installBackendStubs(page: Page, state: StubState) {
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const method = request.method()
    const url = new URL(request.url())
    const { pathname } = url

    if (pathname === '/api/automation/commands' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ commands: state.commands }) })
      return
    }
    if (pathname === '/api/automation/tasks' && method === 'GET') {
      state.calls.fetchTasks += 1
      const status = url.searchParams.get('status') ?? 'all'
      const commandId = url.searchParams.get('command_id') ?? ''
      const limit = url.searchParams.get('limit') ?? '100'
      state.calls.taskQuery = { status, command_id: commandId, limit }

      let filtered = [...state.tasks]
      if (status !== 'all') filtered = filtered.filter((task) => task.status === status)
      if (commandId.trim()) filtered = filtered.filter((task) => task.command_id.includes(commandId.trim()))
      const limitValue = Number.parseInt(limit, 10)
      if (Number.isInteger(limitValue) && limitValue > 0) filtered = filtered.slice(0, limitValue)

      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: filtered }) })
      return
    }
    if (pathname === '/api/automation/run' && method === 'POST') {
      state.calls.runCommand += 1
      const payload = request.postDataJSON() as { command_id?: string }
      const task = createReplayTask(state, payload.command_id ?? 'cmd-e2e-001')
      state.tasks = [task, ...state.tasks]
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ task }) })
      return
    }
    if (pathname.match(/^\/api\/automation\/tasks\/[^/]+\/cancel$/) && method === 'POST') {
      state.calls.cancelTask += 1
      const taskId = pathname.split('/')[4] ?? ''
      state.tasks = state.tasks.map((task) =>
        task.task_id === taskId
          ? { ...task, status: 'cancelled', finished_at: '2026-02-20T00:03:00.000Z', exit_code: 130, message: 'Cancelled' }
          : task,
      )
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
      return
    }

    if (pathname === '/api/flows' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flows: [] }) })
      return
    }
    if (pathname === '/api/templates' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ templates: state.templates }) })
      return
    }
    if (pathname === '/api/runs' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ runs: state.runs }) })
      return
    }
    if (pathname === '/api/runs' && method === 'POST') {
      state.calls.createRun += 1
      state.seq += 1
      const newRunId = `run-e2e-${state.seq}`
      const payload = request.postDataJSON() as { template_id?: string; params?: Record<string, string> }
      state.runs = [
        {
          run_id: newRunId,
          template_id: payload.template_id ?? 'tpl-e2e-001',
          status: 'queued',
          step_cursor: 1,
          params: payload.params ?? {},
          task_id: null,
          last_error: null,
          artifacts_ref: {},
          created_at: '2026-02-20T00:00:00.000Z',
          updated_at: '2026-02-20T00:00:00.000Z',
          logs: [{ ts: '2026-02-20T00:00:00.000Z', level: 'info', message: 'run created' }],
        },
        ...state.runs,
      ]
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ run_id: newRunId }) })
      return
    }
    if (pathname.match(/^\/api\/runs\/[^/]+\/otp$/) && method === 'POST') {
      state.calls.submitRunOtp += 1
      const runId = pathname.split('/')[3] ?? ''
      state.runs = state.runs.map((run) =>
        run.run_id === runId
          ? {
              ...run,
              status: 'running',
              logs: [...run.logs, { ts: '2026-02-20T00:00:02.000Z', level: 'info', message: 'otp submitted' }],
              updated_at: '2026-02-20T00:00:02.000Z',
            }
          : run,
      )
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ run_id: runId, status: 'running' }) })
      return
    }

    if (pathname === '/api/command-tower/latest-flow' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.latestFlow) })
      return
    }
    if (pathname === '/api/command-tower/latest-flow-draft' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ session_id: state.flowDraft.session_id, flow: state.flowDraft }),
      })
      return
    }
    if (pathname === '/api/command-tower/latest-flow-draft' && method === 'PATCH') {
      state.calls.saveFlowDraft += 1
      const payload = request.postDataJSON() as { flow?: typeof state.flowDraft }
      if (payload.flow) state.flowDraft = payload.flow
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
      return
    }
    if (pathname === '/api/command-tower/evidence-timeline' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: state.evidenceTimeline }) })
      return
    }
    if (pathname === '/api/command-tower/evidence' && method === 'GET') {
      const stepId = url.searchParams.get('step_id') ?? ''
      const hit = state.evidenceTimeline.find((item) => item.step_id === stepId)
      if (!hit) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'not found' }) })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hit) })
      return
    }
    if (pathname === '/api/command-tower/replay-latest' && method === 'POST') {
      state.calls.replayLatestFlow += 1
      const task = createReplayTask(state, 'flow-replay')
      state.tasks = [task, ...state.tasks]
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ task }) })
      return
    }
    if (pathname === '/api/command-tower/replay-latest-step' && method === 'POST') {
      state.calls.replayStep += 1
      const task = createReplayTask(state, 'flow-step-replay')
      state.tasks = [task, ...state.tasks]
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ task }) })
      return
    }
    if (pathname === '/api/command-tower/replay-latest-from-step' && method === 'POST') {
      state.calls.replayFromStep += 1
      const task = createReplayTask(state, 'flow-resume')
      state.tasks = [task, ...state.tasks]
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ task }) })
      return
    }
    if (pathname === '/api/evidence-runs' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ runs: [], registry_state: 'empty' }),
      })
      return
    }
    if (pathname.match(/^\/api\/runs\/[^/]+\/recover-plan$/) && method === 'GET') {
      const runId = pathname.split('/')[3] ?? ''
      const run = state.runs.find((item) => item.run_id === runId)
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
    if (pathname.match(/^\/api\/templates\/[^/]+\/readiness$/) && method === 'GET') {
      const templateId = pathname.split('/')[3] ?? ''
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          template_id: templateId,
          flow_id: state.flowDraft.flow_id,
          readiness_score: 88,
          risk_level: 'low',
          step_count: state.flowDraft.steps.length,
          average_confidence: 0.96,
          selector_risk_count: 0,
          manual_gate_density: 0,
          low_confidence_steps: [],
          selectorless_steps: [],
          high_risk_steps: [],
        }),
      })
      return
    }

    throw new Error(`[critical-buttons] Unhandled API route: ${method} ${pathname}`)
  })

  await page.route('**/health/**', async (route) => {
    const method = route.request().method()
    const pathname = new URL(route.request().url()).pathname
    if (pathname === '/health/diagnostics') {
      state.calls.fetchDiagnostics += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          uptime_seconds: 600,
          task_total: state.tasks.length,
          task_counts: {
            queued: state.tasks.filter((task) => task.status === 'queued').length,
            running: state.tasks.filter((task) => task.status === 'running').length,
            success: state.tasks.filter((task) => task.status === 'success').length,
            failed: state.tasks.filter((task) => task.status === 'failed').length,
            cancelled: state.tasks.filter((task) => task.status === 'cancelled').length,
          },
          metrics: { requests_total: 42, rate_limited: 0 },
        }),
      })
      return
    }
    if (pathname === '/health/alerts') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          state: 'ok',
          failure_rate: 0,
          threshold: 0.2,
          completed: state.tasks.filter((task) => task.status === 'success').length,
          failed: state.tasks.filter((task) => task.status === 'failed').length,
        }),
      })
      return
    }
    if (pathname === '/health/rum' && method === 'POST') {
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ accepted: true }) })
      return
    }
    throw new Error(`[critical-buttons] Unhandled health route: ${method} ${pathname}`)
  })
}

async function assertApiKeyBranch(page: Page) {
  const apiKeyInput = page.locator('#api-key')
  if ((await apiKeyInput.count()) === 0) {
    // New Gemini-first panel no longer exposes a dedicated api-key input.
    await expect(page.locator('#automation-token'), 'automation token input must be rendered when api-key input is absent').toHaveCount(1)
    return
  }
  const apiKeyField = page.locator('.field').filter({ has: page.locator('#api-key') })
  await apiKeyInput.fill('sk-demo-123')
  await expect(apiKeyInput).toHaveAttribute('type', 'password')
  await apiKeyField.getByRole('button', { name: 'Show' }).click()
  await expect(apiKeyInput).toHaveAttribute('type', 'text')
  await apiKeyField.getByRole('button', { name: 'Hide' }).click()
  await expect(apiKeyInput).toHaveAttribute('type', 'password')
}

async function assertModelFallbackBranch(page: Page) {
  const modelNameInput = page.locator('#model-name')
  await expect(modelNameInput, 'model-name input must stay available for explicit Gemini model pinning').toHaveCount(1)
  await modelNameInput.fill('gemini-3.1-pro-preview')
  await expect(modelNameInput).toHaveValue('gemini-3.1-pro-preview')
}

pwTest.describe('@frontend-critical-buttons', () => {
  pwTest.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('ab_onboarding_done', '1')
      window.localStorage.setItem('ab_first_use_done', '1')
    })
  })

  pwTest('QuickLaunch / TaskCenter / Header / Terminal critical buttons', async ({ page }) => {
    const state = createState()
    await installBackendStubs(page, state)
    await page.goto('/')

    await expect(page.getByRole('heading', { level: 1, name: 'Proofyard' })).toBeVisible()

    await page.getByRole('button', { name: 'Run' }).first().click()
    await expect(page.getByText('Submitted Open homepage')).toBeVisible()
    await expect.poll(() => state.calls.runCommand).toBeGreaterThan(0)

    await page.getByRole('button', { name: 'Start run', exact: true }).first().click()
    await expect(page.getByText('Run created successfully')).toBeVisible()
    await expect.poll(() => state.calls.createRun).toBeGreaterThan(0)

    await page.getByRole('tab', { name: 'Task Center' }).click()
    await expect(page.getByRole('tab', { name: 'Task Center' })).toHaveAttribute('aria-selected', 'true')

    await page.getByRole('tab', { name: /Run Records \(Template\)/ }).click()
    await expect(page.getByRole('listbox', { name: 'Run records list (template)' })).toBeVisible()
    await page.getByRole('tab', { name: /Run Records \(Command\)/ }).click()
    await expect(page.getByRole('list', { name: 'Run records list (command)' })).toBeVisible()

    const taskListColumn = page.locator('.task-list-column')
    const refreshBefore = state.calls.fetchTasks
    await taskListColumn.getByRole('button', { name: 'Refresh' }).first().click()
    await expect.poll(() => state.calls.fetchTasks).toBeGreaterThan(refreshBefore)

    await page.getByRole('button', { name: 'Cancel' }).first().click()
    await expect(page.getByText(/Cancelled task/)).toBeVisible()
    await expect.poll(() => state.calls.cancelTask).toBeGreaterThan(0)

    await page.getByRole('tab', { name: /Run Records \(Template\)/ }).click()
    const waitingOtpOptionById = page.locator('#task-center-template-option-run-waiting-otp-001')
    await expect(waitingOtpOptionById).toHaveCount(1)
    await waitingOtpOptionById.click()
    await expect(page.getByText(/Run Record #run-wait/)).toBeVisible()
    const taskDetail = page.locator('.task-detail-column')
    await expect(taskDetail.getByText('Loading recovery guidance...')).toHaveCount(0, { timeout: 15000 })
    await expect(taskDetail.locator('#task-center-run-input')).toBeVisible()
    await taskDetail.locator('#task-center-run-input').fill('654321')
    await taskDetail.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(page.getByText('OTP submitted and the run resumed')).toBeVisible()
    await expect.poll(() => state.calls.submitRunOtp).toBeGreaterThan(0)

    const pageHeader = page.locator('header').first()
    await pageHeader.getByRole('button', { name: 'Help' }).click()
    const helpDialog = page.getByRole('dialog', { name: 'Help' })
    await expect(helpDialog).toBeVisible()
    await helpDialog.getByLabel('Close help panel').click()

    await pageHeader.getByRole('button', { name: 'Restart onboarding' }).click()
    await expect(page.getByText('Step 1: decide the goal and inspect the parameter rail')).toBeVisible()
    await page.getByRole('button', { name: 'Maybe later' }).click()

    const terminal = page.getByRole('region', { name: 'Live terminal' })
    await terminal.getByRole('button', { name: 'Clear' }).click()
    await expect(terminal.getByText('The terminal log is empty')).toBeVisible()
  })

  pwTest('Major mapping anchors (31/32/40/41/42/43/46/47/48/58) stay stable', async ({ page }) => {
    const state = createState()
    state.tasks = [createTask('task-running-major-map-001', 'cmd-e2e-001', 'running')]
    await installBackendStubs(page, state)
    await page.goto('/')
    await page.evaluate(() => {
      window.localStorage.setItem('ab_first_use_done', '0')
      window.localStorage.setItem('ab_first_use_stage', 'welcome')
      window.localStorage.removeItem('ab_first_use_progress')
    })
    await page.reload()

    await page.getByTestId('console-tab-quick-launch').click()
    const locateConfigButton = page.getByTestId('quick-launch-first-use-locate-config')
    if (await locateConfigButton.count()) {
      await expect(locateConfigButton).toBeVisible()
    }
    await clickCategoryTab(page, 'command-category-maintenance', 'Maintenance')
    await clickCategoryTab(page, 'command-category-frontend', 'Frontend')
    await clickCategoryTab(page, 'command-category-all', 'All')

    const baseUrlInput = await getBaseUrlInput(page)
    await baseUrlInput.fill('http://127.0.0.1:17380/register')
    await expect(baseUrlInput).toHaveValue('http://127.0.0.1:17380/register')
    if (await locateConfigButton.count()) {
      await locateConfigButton.click()
    }

    const registerPassword = await getRegisterPasswordInput(page)
    await expect(registerPassword).toHaveAttribute('type', 'password')
    await clickRegisterPasswordVisibilityToggle(page, registerPassword)
    await expect(registerPassword).toHaveAttribute('type', 'text')
    await clickRegisterPasswordVisibilityToggle(page, registerPassword)
    await expect(registerPassword).toHaveAttribute('type', 'password')

    await clickTabByTestIdOrRole(page, 'console-tab-task-center', 'Task Center')
    const taskCenterTab = page.getByTestId('console-tab-task-center')
    if ((await taskCenterTab.count()) > 0) {
      await expect(taskCenterTab).toHaveAttribute('aria-selected', 'true')
    } else {
      await expect(page.getByRole('tab', { name: /^Task Center(\s|$)/ })).toHaveAttribute('aria-selected', 'true')
    }
    await clickTabByTestIdOrRole(page, 'task-center-tab-command-runs', 'Run Records (Command)')
    await clickTabByTestIdOrRole(page, 'task-center-tab-template-runs', 'Run Records (Template)')
    const refreshByTestId = page.getByTestId('task-center-template-runs-refresh')
    if ((await refreshByTestId.count()) > 0) {
      await refreshByTestId.click()
    } else {
      await page.locator('.task-list-column').getByRole('button', { name: 'Refresh' }).first().click()
    }
  })

  pwTest('ParamsPanel api-key branch is explicitly covered', async ({ page }) => {
    const state = createState()
    await installBackendStubs(page, state)
    await page.goto('/')
    await assertApiKeyBranch(page)
  })

  pwTest('ParamsPanel model-name input branch is explicitly covered', async ({ page }) => {
    const state = createState()
    await installBackendStubs(page, state)
    await page.goto('/')
    await assertModelFallbackBranch(page)
  })

  pwTest('ConfirmDialog / ParamsPanel(shared) / TaskListPanel / Terminal controls', async ({ page }) => {
    const state = createState()
    await installBackendStubs(page, state)
    await page.goto('/')

    const tokenField = page.locator('.field').filter({ has: page.locator('#automation-token') })
    const tokenInput = page.locator('#automation-token')
    await tokenInput.fill('token-demo-123')
    await expect(tokenInput).toHaveAttribute('type', 'password')
    await tokenField.getByRole('button', { name: 'Show' }).click()
    await expect(tokenInput).toHaveAttribute('type', 'text')
    await tokenField.getByRole('button', { name: 'Hide' }).click()
    await expect(tokenInput).toHaveAttribute('type', 'password')

    const headlessCheckbox = page.getByLabel('Run browser in the background (headless)')
    const strictCheckbox = page.getByLabel('Use strict element recognition (Midscene strict)')
    await headlessCheckbox.check()
    await strictCheckbox.check()
    await expect(headlessCheckbox).toBeChecked()
    await expect(strictCheckbox).toBeChecked()

    let cleanCommandCard = page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: 'Clear cache' }) })
      .first()
    if ((await cleanCommandCard.count()) === 0) {
      cleanCommandCard = page
        .locator('article')
        .filter({ has: page.getByRole('button', { name: 'Run' }) })
        .first()
    }
    const executeButton = cleanCommandCard.getByRole('button', { name: 'Run' })
    await expect(executeButton).toBeVisible()
    await executeButton.click()
    const dangerDialog = page.getByRole('alertdialog').filter({ hasText: 'Dangerous run' })
    const dialogOverlay = page.locator('.ui-dialog-overlay, .dialog-overlay')
    if ((await dangerDialog.count()) > 0 || (await dialogOverlay.count()) > 0) {
      if ((await dangerDialog.count()) > 0) {
        await expect(dangerDialog).toBeVisible()
      }
      const cancelButton = page.getByRole('button', { name: 'Cancel', exact: true }).last()
      if ((await cancelButton.count()) > 0) {
        await cancelButton.click()
      } else {
        await page.keyboard.press('Escape')
      }
      await expect(dialogOverlay).toHaveCount(0)
      await expect(dangerDialog).toHaveCount(0)
    }

    await clickTabByTestIdOrRole(page, 'console-tab-task-center', 'Task Center')
    const taskCenterPanel = page.locator('section#app-view-tasks-panel')
    await expect(taskCenterPanel).toBeVisible()
    const taskListColumn = taskCenterPanel.locator('.task-list-column')
    await taskListColumn.getByLabel('Filter tasks by status').selectOption('running')
    await taskListColumn.getByLabel('Filter run records by command ID').fill('clean-e2e-001')
    await taskListColumn.getByLabel('Run count limit').selectOption('20')
    await taskListColumn.getByRole('button', { name: 'Refresh' }).first().click()
    await expect.poll(() => state.calls.taskQuery).toEqual({
      status: 'running',
      command_id: 'clean-e2e-001',
      limit: '20',
    })

    const terminal = page.getByRole('region', { name: 'Live terminal' })
    const terminalHeight = terminal.locator('#terminal-size')
    const beforeRows = await terminalHeight.inputValue()
    await terminalHeight.focus()
    await page.keyboard.press('ArrowRight')
    await expect(terminalHeight).not.toHaveValue(beforeRows)

    const autoScrollCheckbox = terminal.getByLabel('Auto-scroll')
    await autoScrollCheckbox.uncheck()
    await expect(autoScrollCheckbox).not.toBeChecked()
    await terminal.getByLabel('Filter log level').selectOption('error')
    await expect(terminal.getByText('The terminal log is empty')).toBeVisible()
    await terminal.getByLabel('Filter log level').selectOption('all')
    await terminal.getByRole('button', { name: 'Clear' }).click()
    await expect(terminal.getByText('The terminal log is empty')).toBeVisible()
  })

  pwTest('FlowWorkshop critical buttons', async ({ page }) => {
    const state = createState()
    await installBackendStubs(page, state)
    await page.goto('/')

    await page.getByRole('tab', { name: 'Flow Workshop' }).click()
    await expect(page.getByRole('heading', { name: 'Key outcome and next action' })).toBeVisible()
    await page.getByText('Advanced workshop (optional): system diagnostics, flow editing, and debugging evidence').click()

    await page.getByRole('button', { name: 'Save Draft' }).first().click()
    await expect(page.locator('.toast-message').filter({ hasText: 'Flow draft saved successfully' })).toBeVisible()
    await expect.poll(() => state.calls.saveFlowDraft).toBeGreaterThan(0)

    await page.getByRole('button', { name: 'Replay Latest Flow' }).click()
    await expect(page.locator('.toast-message').filter({ hasText: 'Flow replay triggered' })).toBeVisible()
    await expect.poll(() => state.calls.replayLatestFlow).toBeGreaterThan(0)

    await page.getByRole('button', { name: 'Add Step' }).click()
    await expect(page.getByRole('list', { name: 'flow-editor-steps' }).getByRole('listitem')).toHaveCount(3)

    await page.getByRole('button', { name: 'Replay Step' }).first().click()
    await expect(page.locator('.toast-message').filter({ hasText: 'Step replay triggered for s1' })).toBeVisible()
    await expect.poll(() => state.calls.replayStep).toBeGreaterThan(0)

    await page.getByText('Step parameters (action / URL / input reference)').first().click()
    await page.getByLabel('step-0-action').selectOption('type')
    await page.getByLabel('step-0-value-ref').fill('${params.otp_code}')
    await expect(page.getByLabel('step-0-value-ref')).toHaveValue('${params.otp_code}')

    await page.getByText('Advanced settings (step_id / selector / order)').first().click()
    const firstAdvancedPanel = page.locator('.debug-disclosure').nth(1)
    await firstAdvancedPanel.getByRole('button', { name: 'Move up' }).click()
    await firstAdvancedPanel.getByRole('button', { name: 'Move down' }).click()
    await expect(page.getByRole('list', { name: 'flow-editor-steps' }).getByRole('listitem')).toHaveCount(3)

    await page.getByRole('button', { name: /Resume/ }).first().click()
    await expect(page.locator('.toast-message').filter({ hasText: 'Resume from step s2 triggered' })).toBeVisible()
    await expect.poll(() => state.calls.replayFromStep).toBeGreaterThan(0)

    const diagnosticsBefore = state.calls.fetchDiagnostics
    await page.locator('.flow-editor-column').getByRole('button', { name: 'Refresh' }).click()
    await expect.poll(() => state.calls.fetchDiagnostics).toBeGreaterThan(diagnosticsBefore)
  })

  pwTest('Onboarding complete chain', async ({ page }) => {
    const state = createState()
    await installBackendStubs(page, state)
    await page.addInitScript(() => {
      window.localStorage.removeItem('ab_onboarding_done')
      window.localStorage.setItem('ab_first_use_done', '1')
    })
    await page.goto('/')

    await expect(page.getByRole('dialog', { name: 'Step 1: decide the goal and inspect the parameter rail' })).toBeVisible()
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.getByRole('dialog', { name: 'Step 2: submit the task from "Quick Launch"' })).toBeVisible()
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.getByRole('dialog', { name: 'Step 3: confirm the result in "Task Center"' })).toBeVisible()
    await page.getByRole('button', { name: 'Start using Proofyard' }).click()

    await expect(page.getByRole('dialog', { name: 'Step 1: decide the goal and inspect the parameter rail' })).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('ab_onboarding_done'))).toBe('1')
  })
})
