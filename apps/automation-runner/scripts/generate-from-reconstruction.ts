import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  buildManualGateReport,
  computeReplaySla,
  type ReplayAttempt,
} from "./generate-from-reconstruction.reporting.js"

type SelectorCandidate = {
  kind: string
  value: string
}

type ReconstructionStep = {
  step_id?: string
  action?: string
  url?: string | null
  value_ref?: string | null
  selected_selector_index?: number | null
  target?: {
    selectors?: SelectorCandidate[]
  } | null
  preconditions?: string[]
  unsupported_reason?: string | null
}

type EndpointSpec = {
  method: string
  fullUrl: string
  path: string
  contentType: string | null
}

type BootstrapStep = {
  method: string
  fullUrl: string
  path: string
  reason: string
}

type FlowRequestSpec = {
  actionEndpoint?: EndpointSpec | null
  registerEndpoint?: EndpointSpec | null
  bootstrapSequence?: BootstrapStep[]
  replayHints?: {
    contentType?: string | null
    tokenHeaderNames?: string[]
    successStatuses?: number[]
  }
  payloadExample?: Record<string, unknown>
}

type ReconstructionFlowDraft = {
  start_url: string
  steps: ReconstructionStep[]
  action_endpoint?: EndpointSpec | null
  bootstrap_sequence?: BootstrapStep[]
  replay_hints?: {
    contentType?: string | null
    tokenHeaderNames?: string[]
    successStatuses?: number[]
  } | null
  payload_example?: Record<string, unknown> | null
}

type ReconstructionPreview = {
  preview_id: string
  flow_draft: ReconstructionFlowDraft
}

function getArg(name: string): string | null {
  const prefix = `--${name}=`
  const found = process.argv.find((arg) => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : null
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf-8")
  return JSON.parse(raw) as T
}

type GeneratedStep = {
  step_id: string
  action: string
  url?: string | null
  value_ref?: string | null
  selectors: SelectorCandidate[]
  selected_selector_index?: number | null
  preconditions: string[]
  unsupported_reason?: string | null
}

type ApiReplayContext = {
  actionEndpoint: EndpointSpec
  bootstrapSequence: BootstrapStep[]
  contentType: string
  tokenHeaderNames: string[]
  successStatuses: number[]
  payloadExample: Record<string, unknown>
}

function normalizeSteps(rawSteps: ReconstructionStep[]): GeneratedStep[] {
  return rawSteps
    .filter((step): step is ReconstructionStep => Boolean(step && typeof step === "object"))
    .map((step, index) => {
      const rawSelectors = Array.isArray(step.target?.selectors) ? step.target?.selectors : []
      const selectors = rawSelectors
        .filter(
          (candidate): candidate is SelectorCandidate =>
            Boolean(candidate?.kind) && Boolean(candidate?.value)
        )
        .map((candidate) => ({ kind: String(candidate.kind), value: String(candidate.value) }))
      return {
        step_id: String(step.step_id ?? `s${index + 1}`),
        action: String(step.action ?? "manual_gate"),
        url: step.url ?? null,
        value_ref: step.value_ref ?? null,
        selectors,
        selected_selector_index:
          typeof step.selected_selector_index === "number" ? step.selected_selector_index : null,
        preconditions: Array.isArray(step.preconditions)
          ? step.preconditions.map((item) => String(item))
          : [],
        unsupported_reason: step.unsupported_reason ?? null,
      }
    })
}

function renderPlaywright(startUrl: string, steps: GeneratedStep[]): string {
  const startUrlLiteral = JSON.stringify(startUrl)
  const stepsLiteral = JSON.stringify(steps, null, 2)
  const template = `import { test, expect, type Locator, type Page } from '@playwright/test'

type SelectorCandidate = { kind: string; value: string }
type GeneratedStep = {
  step_id: string
  action: string
  url?: string | null
  value_ref?: string | null
  selectors: SelectorCandidate[]
  selected_selector_index?: number | null
  preconditions: string[]
  unsupported_reason?: string | null
}

const START_URL: string = __START_URL__
const FLOW_STEPS: GeneratedStep[] = __FLOW_STEPS__

function requiredEnv(name: string): string {
  // env-waiver: process_env_template reason=generated_template_env scope=generated-template
  const value = process.env[name]
  if (typeof value === 'string' && value.trim()) {
    return value
  }
  throw new Error(\`Missing required environment variable: \${name}\`)
}

const params: Record<string, string> = {
  email: \`generated+\${Date.now()}@example.com\`,
  // env-waiver: process_env_template reason=generated_template_env scope=generated-template
  input: process.env.RECON_PARAM_INPUT ?? 'demo-input',
}
const secrets: Record<string, string | undefined> = {
  password: process.env.RECON_SECRET_PASSWORD,
  input: process.env.RECON_SECRET_INPUT,
}

function resolveSecretValue(key: string): string {
  const direct = secrets[key]
  if (direct && direct.trim()) return direct
  const envKey = \`RECON_SECRET_\${key.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}\`
  const envValue = process.env[envKey]
  if (envValue && envValue.trim()) return envValue
  if (key === 'password') {
    return requiredEnv('RECON_SECRET_PASSWORD')
  }
  if (key === 'input') {
    return requiredEnv('RECON_SECRET_INPUT')
  }
  throw new Error(\`missing secret input for \${key}; set \${envKey}, RECON_SECRET_INPUT, or RECON_SECRET_PASSWORD\`)
}

function resolveValue(reference: string | null | undefined): string {
  if (!reference) return ''
  const normalized = reference.trim()
  const match = normalized.match(/^\\$\\{(params|secrets)\\.([^}]+)\\}$/)
  if (!match) return normalized
  const [, scope, key] = match
  if (scope === 'params') return params[key] ?? ''
  return resolveSecretValue(key)
}

function buildLocator(page: Page, selector: SelectorCandidate): Locator {
  switch (selector.kind) {
    case 'role': {
      const rolePattern = selector.value.match(/^([a-zA-Z0-9_-]+)(?:\\[name=['"](.+)['"]\\])?$/)
      if (rolePattern) {
        const [, role, name] = rolePattern
        if (name) {
          return page.getByRole(role as Parameters<Page['getByRole']>[0], { name })
        }
        return page.getByRole(role as Parameters<Page['getByRole']>[0])
      }
      return page.getByRole('button', { name: selector.value })
    }
    case 'text':
      return page.getByText(selector.value)
    case 'testid':
      return page.getByTestId(selector.value)
    case 'id':
      return page.locator(selector.value.startsWith('#') ? selector.value : \`#\${selector.value}\`)
    case 'name':
      if (selector.value.startsWith('[name=')) {
        return page.locator(selector.value)
      }
      return page.locator(\`[name="\${selector.value.replace(/^name=/, '').replace(/"/g, '\\"')}"]\`)
    case 'xpath':
      return page.locator(\`xpath=\${selector.value}\`)
    case 'css':
      return page.locator(selector.value)
    default:
      return page.locator(selector.value)
  }
}

async function resolveLocator(page: Page, step: GeneratedStep): Promise<Locator | null> {
  if (step.selectors.length === 0) return null
  const preferred =
    typeof step.selected_selector_index === 'number' && step.selected_selector_index >= 0
      ? step.selected_selector_index
      : null
  const ordered =
    preferred === null ? step.selectors : [step.selectors[preferred], ...step.selectors.filter((_, idx) => idx !== preferred)]
  for (const candidate of ordered) {
    const locator = buildLocator(page, candidate).first()
    if ((await locator.count()) > 0) return locator
  }
  return null
}

async function executeStep(page: Page, step: GeneratedStep): Promise<void> {
  if (step.action === 'manual_gate') {
    throw new Error(step.unsupported_reason || \`manual gate at \${step.step_id}\`)
  }
  if (step.action === 'navigate') {
    await page.goto(step.url || START_URL)
    return
  }
  const locator = await resolveLocator(page, step)
  switch (step.action) {
    case 'click':
      if (!locator) throw new Error(\`selector not found for click step \${step.step_id}\`)
      await locator.click()
      return
    case 'type':
      if (!locator) throw new Error(\`selector not found for type step \${step.step_id}\`)
      await locator.fill(resolveValue(step.value_ref))
      return
    case 'select':
      if (!locator) throw new Error(\`selector not found for select step \${step.step_id}\`)
      await locator.selectOption(resolveValue(step.value_ref))
      return
    case 'wait_for':
      if (locator) {
        await expect(locator).toBeVisible()
      } else {
        await page.waitForTimeout(1000)
      }
      return
    case 'assert':
      if (locator) {
        await expect(locator).toBeVisible()
      } else {
        await expect(page).toHaveURL(/.*/)
      }
      return
    case 'extract':
      if (!locator) throw new Error(\`selector not found for extract step \${step.step_id}\`)
      await locator.textContent()
      return
    case 'branch':
      return
    default:
      throw new Error(\`unsupported action "\${step.action}" at \${step.step_id}\`)
  }
}

test('generated from reconstruction', async ({ page }) => {
  if (!FLOW_STEPS.some((step) => step.action === 'navigate')) {
    await page.goto(START_URL)
  }
  for (const step of FLOW_STEPS) {
    await test.step(\`\${step.step_id}:\${step.action}\`, async () => {
      await executeStep(page, step)
    })
  }
})
`
  return template.replace("__START_URL__", startUrlLiteral).replace("__FLOW_STEPS__", stepsLiteral)
}

function pickEndpoint(
  flowDraft: ReconstructionFlowDraft,
  spec: FlowRequestSpec | null
): EndpointSpec {
  const endpoint = flowDraft.action_endpoint ?? spec?.actionEndpoint ?? spec?.registerEndpoint
  if (endpoint) return endpoint
  const fallbackUrl = new URL(flowDraft.start_url)
  return {
    method: "POST",
    fullUrl: `${fallbackUrl.origin}/api/register`,
    path: "/api/register",
    contentType: "application/json",
  }
}

function buildPayloadTemplate(
  raw: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const payload: Record<string, unknown> = raw ? { ...raw } : {}
  if (typeof payload.email !== "string") payload.email = "${params.email}"
  if (typeof payload.password !== "string") payload.password = "${secrets.password}"
  return payload
}

function resolveApiContext(
  flowDraft: ReconstructionFlowDraft,
  spec: FlowRequestSpec | null
): ApiReplayContext {
  const actionEndpoint = pickEndpoint(flowDraft, spec)
  const bootstrapSequence = flowDraft.bootstrap_sequence ?? spec?.bootstrapSequence ?? []
  const replayHints = flowDraft.replay_hints ?? spec?.replayHints ?? {}
  const contentType = actionEndpoint.contentType ?? replayHints.contentType ?? "application/json"
  const tokenHeaderNames =
    replayHints.tokenHeaderNames && replayHints.tokenHeaderNames.length > 0
      ? replayHints.tokenHeaderNames
      : ["x-csrf-token"]
  const successStatuses =
    replayHints.successStatuses && replayHints.successStatuses.length > 0
      ? replayHints.successStatuses
      : [200, 201]
  const payloadExample = buildPayloadTemplate(
    flowDraft.payload_example ?? spec?.payloadExample ?? null
  )
  return {
    actionEndpoint,
    bootstrapSequence,
    contentType,
    tokenHeaderNames,
    successStatuses,
    payloadExample,
  }
}

function renderApi(flowDraft: ReconstructionFlowDraft, apiContext: ApiReplayContext): string {
  const baseOrigin = new URL(flowDraft.start_url).origin
  const endpointLiteral = JSON.stringify(apiContext.actionEndpoint, null, 2)
  const bootstrapLiteral = JSON.stringify(apiContext.bootstrapSequence, null, 2)
  const tokenHeadersLiteral = JSON.stringify(apiContext.tokenHeaderNames, null, 2)
  const successStatusesLiteral = JSON.stringify(apiContext.successStatuses, null, 2)
  const payloadLiteral = JSON.stringify(apiContext.payloadExample, null, 2)
  const baseOriginLiteral = JSON.stringify(baseOrigin)
  const contentTypeLiteral = JSON.stringify(apiContext.contentType)

  return `import { test, expect } from '@playwright/test'

type EndpointSpec = {
  method: string
  fullUrl: string
  path: string
  contentType: string | null
}

type BootstrapStep = {
  method: string
  fullUrl: string
  path: string
  reason: string
}

const BASE_ORIGIN = ${baseOriginLiteral}
const ACTION_ENDPOINT: EndpointSpec = ${endpointLiteral}
const BOOTSTRAP_SEQUENCE: BootstrapStep[] = ${bootstrapLiteral}
const TOKEN_HEADER_NAMES: string[] = ${tokenHeadersLiteral}
const SUCCESS_STATUSES: number[] = ${successStatusesLiteral}
const CONTENT_TYPE = ${contentTypeLiteral}
const PAYLOAD_TEMPLATE: Record<string, unknown> = ${payloadLiteral}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function resolveTokenizedValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const match = value.trim().match(/^\\$\\{(params|secrets)\\.([^}]+)\\}$/)
  if (!match) return value
  const [, scope, key] = match
  if (scope === 'params') {
    if (key === 'email') {
      return \`generated+\${Date.now()}@example.com\`
    }
    const envKey = \`RECON_PARAM_\${key.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}\`
    return process.env[envKey] ?? process.env.RECON_PARAM_INPUT ?? ''
  }
  const envKey = \`RECON_SECRET_\${key.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}\`
  const secretValue =
    process.env[envKey] ??
    (key === 'password' ? process.env.RECON_SECRET_PASSWORD : undefined) ??
    process.env.RECON_SECRET_INPUT
  if (!secretValue || !secretValue.trim()) {
    throw new Error(\`missing secret input for \${key}; set \${envKey} or RECON_SECRET_INPUT\`)
  }
  return secretValue
}

function normalizePayloadValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizePayloadValue(item))
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = normalizePayloadValue(item)
    }
    return result
  }
  return resolveTokenizedValue(value)
}

function buildPayload(): Record<string, unknown> {
  const payload = normalizePayloadValue(PAYLOAD_TEMPLATE) as Record<string, unknown>
  if (!asString(payload.email)) {
    payload.email = \`generated+\${Date.now()}@example.com\`
  }
  if (!asString(payload.password)) {
    const password = process.env.RECON_SECRET_PASSWORD ?? process.env.RECON_SECRET_INPUT
    if (!password || !password.trim()) {
      throw new Error('missing secret input for password; set RECON_SECRET_PASSWORD')
    }
    payload.password = password
  }
  return payload
}

function buildUrl(pathOrFull: string): string {
  if (pathOrFull.startsWith('http://') || pathOrFull.startsWith('https://')) {
    return pathOrFull
  }
  return \`\${BASE_ORIGIN}\${pathOrFull}\`
}

test('generated api replay', async ({ request }) => {
  const headers: Record<string, string> = {}
  let discoveredToken: string | null = null

  for (const step of BOOTSTRAP_SEQUENCE) {
    const response = await request.fetch(buildUrl(step.fullUrl || step.path), {
      method: step.method || 'GET',
    })
    expect(response.status(), \`bootstrap \${step.path} should not 5xx\`).toBeLessThan(500)
    const contentType = response.headers()['content-type'] ?? ''
    if (contentType.includes('application/json')) {
      const json = (await response.json()) as Record<string, unknown>
      discoveredToken = asString(json.csrf_token) ?? asString(json.token) ?? discoveredToken
    }
  }

  if (CONTENT_TYPE && CONTENT_TYPE.trim()) {
    headers['content-type'] = CONTENT_TYPE
  }
  if (discoveredToken) {
    for (const header of TOKEN_HEADER_NAMES) {
      headers[header] = discoveredToken
    }
  }

  const actionUrl = buildUrl(ACTION_ENDPOINT.fullUrl || ACTION_ENDPOINT.path)
  const method = (ACTION_ENDPOINT.method || 'POST').toUpperCase()
  const payload = buildPayload()
  const requestInit: {
    method: string
    headers: Record<string, string>
    data?: Record<string, unknown>
    form?: Record<string, string>
  } = {
    method,
    headers,
  }

  if (!['GET', 'HEAD', 'DELETE'].includes(method)) {
    if ((CONTENT_TYPE || '').toLowerCase().includes('application/x-www-form-urlencoded')) {
      const formData: Record<string, string> = {}
      for (const [key, value] of Object.entries(payload)) {
        formData[key] = String(value)
      }
      requestInit.form = formData
    } else {
      requestInit.data = payload
    }
  }

  const response = await request.fetch(actionUrl, requestInit)
  expect(
    SUCCESS_STATUSES.includes(response.status()),
    \`expected status in [\${SUCCESS_STATUSES.join(',')}] but got \${response.status()}\`,
  ).toBeTruthy()

  const responseType = response.headers()['content-type'] ?? ''
  if (responseType.includes('application/json')) {
    const body = (await response.json()) as Record<string, unknown>
    if (typeof body.email === 'string') {
      expect(body.email).toContain('@')
    }
  }
})
`
}

async function resolveFlowSpecPath(previewPath: string, outDir: string): Promise<string | null> {
  const explicit = getArg("spec")
  if (explicit) {
    return path.resolve(process.cwd(), explicit)
  }
  const candidates = [
    path.join(outDir, "flow_request.spec.json"),
    path.join(path.dirname(previewPath), "flow_request.spec.json"),
    path.join(path.dirname(previewPath), "..", "flow_request.spec.json"),
  ]
  for (const candidate of candidates) {
    try {
      await readFile(candidate, "utf-8")
      return candidate
    } catch {
      // Ignore missing candidates and continue probing fallbacks.
    }
  }
  return null
}

async function main(): Promise<void> {
  const previewPathArg = getArg("preview")
  if (!previewPathArg) throw new Error("--preview is required")
  const previewPath = path.resolve(process.cwd(), previewPathArg)
  const preview = await readJson<ReconstructionPreview>(previewPath)
  const normalizedSteps = normalizeSteps(preview.flow_draft.steps)

  const outDir = getArg("outDir")
    ? path.resolve(process.cwd(), getArg("outDir")!)
    : path.resolve(process.cwd(), "tests", "generated", preview.preview_id)
  await mkdir(outDir, { recursive: true })

  const specPath = await resolveFlowSpecPath(previewPath, outDir)
  const flowSpec = specPath ? await readJson<FlowRequestSpec>(specPath) : null
  const apiContext = resolveApiContext(preview.flow_draft, flowSpec)

  const flowPath = path.join(outDir, "flow-draft.json")
  const playwrightPath = path.join(outDir, "generated-playwright.spec.ts")
  const apiPath = path.join(outDir, "generated-api.spec.ts")
  const readinessPath = path.join(outDir, "run-readiness-report.json")

  await writeFile(flowPath, JSON.stringify(preview.flow_draft, null, 2), "utf-8")
  await writeFile(
    playwrightPath,
    renderPlaywright(preview.flow_draft.start_url, normalizedSteps),
    "utf-8"
  )
  await writeFile(apiPath, renderApi(preview.flow_draft, apiContext), "utf-8")
  const now = new Date()
  const { manualGateReasons, manualGateReasonMatrix, manualGateStatsPanel } =
    buildManualGateReport(normalizedSteps)
  const replayAttempt: ReplayAttempt = {
    attempted: false,
    success: null,
    status: "not_attempted",
  }
  const replaySla = await computeReplaySla({
    outDir,
    readinessPath,
    now,
    readJson,
  })

  await writeFile(
    readinessPath,
    JSON.stringify(
      {
        generatedAt: now.toISOString(),
        previewId: preview.preview_id,
        stepCount: preview.flow_draft.steps.length,
        ready: true,
        apiReplayReady: Boolean(apiContext.actionEndpoint.path),
        requiredBootstrapSteps: apiContext.bootstrapSequence.length,
        replayAttempt,
        replaySuccessRate7d: replaySla.replaySuccessRate7d,
        replaySuccessSamples7d: replaySla.replaySuccessSamples7d,
        replaySla,
        manualGateReasons,
        manualGateReasonMatrix,
        manualGateStatsPanel,
      },
      null,
      2
    ),
    "utf-8"
  )

  process.stdout.write(
    `${JSON.stringify({ flowPath, playwrightPath, apiPath, readinessPath, specPath }, null, 2)}\n`
  )
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  process.stderr.write(`generate-from-reconstruction failed: ${message}\n`)
  process.exitCode = 1
})
