import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

import { AUTOMATION_ENV } from "./lib/env.js"
import { runStep, shouldCaptureScreenshotsForStep } from "./lib/replay-flow-execute.js"
import {
  parseProtectedProviderDomains,
  readJson,
  resolveFlowPath,
} from "./lib/replay-flow-parse.js"
import { loadResumeContext, persistResumeContext } from "./lib/replay-flow-resume.js"
import type { FlowDraft } from "./lib/replay-flow-types.js"

export function resolveReplayStepHeadless(explicitHeadless: string | undefined): boolean {
  return explicitHeadless ? explicitHeadless !== "false" : true
}

function buildReplayStepLaunchOptions(headless: boolean): {
  headless: boolean
  args: string[]
} {
  return {
    headless,
    args: [
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--disable-software-rasterizer",
      "--in-process-gpu",
    ],
  }
}

export function buildReplayStepContextOptions(
  shouldLoadResumeContext: boolean,
  storageStatePath: string | null | undefined
): { viewport: { width: number; height: number }; storageState?: string } {
  return {
    viewport: { width: 1280, height: 720 },
    ...(shouldLoadResumeContext && storageStatePath ? { storageState: storageStatePath } : {}),
  }
}

export function resolveReplayStepTargetUrl(
  stepAction: string,
  shouldLoadResumeContext: boolean,
  snapshotCurrentUrl: string | null | undefined,
  startUrl: string
): string {
  return stepAction !== "navigate" && shouldLoadResumeContext && snapshotCurrentUrl
    ? snapshotCurrentUrl
    : startUrl
}

export function deriveReplayStepStatus(result: {
  manual_gate_required?: boolean
  ok: boolean
}): "manual_gate" | "running" | "failed" {
  return result.manual_gate_required ? "manual_gate" : result.ok ? "running" : "failed"
}

export function shouldThrowReplayStepResult(result: {
  manual_gate_required?: boolean
  ok: boolean
}): boolean {
  return !result.ok && !result.manual_gate_required
}

async function main(): Promise<void> {
  const stepId = (AUTOMATION_ENV.FLOW_STEP_ID ?? "").trim()
  if (!stepId) {
    throw new Error("FLOW_STEP_ID is required")
  }

  const { flowPath, sessionDir } = await resolveFlowPath()
  const flow = await readJson<FlowDraft>(flowPath)
  const step = flow.steps.find((item) => item.step_id === stepId)
  if (!step) {
    throw new Error(`step not found: ${stepId}`)
  }

  const startUrl = AUTOMATION_ENV.START_URL?.trim() || flow.start_url
  const explicitHeadless = AUTOMATION_ENV.HEADLESS
  const headless = resolveReplayStepHeadless(explicitHeadless)
  const shouldLoadResumeContext = process.env.FLOW_LOAD_RESUME_CONTEXT !== "false"
  const protectedProviderDomains = parseProtectedProviderDomains(
    process.env.FLOW_PROTECTED_PROVIDER_DOMAINS
  )

  const resumeContext = await loadResumeContext(sessionDir)
  const browser = await chromium.launch(buildReplayStepLaunchOptions(headless))
  const context = await browser.newContext(
    buildReplayStepContextOptions(shouldLoadResumeContext, resumeContext.storageStatePath)
  )
  const page = await context.newPage()

  const evidenceDir = path.join(sessionDir, "evidence")
  await mkdir(evidenceDir, { recursive: true })

  try {
    const targetUrl = resolveReplayStepTargetUrl(
      step.action,
      shouldLoadResumeContext,
      resumeContext.snapshot?.current_url,
      startUrl
    )
    await page.goto(targetUrl, { waitUntil: "networkidle" })

    const captureScreenshots = shouldCaptureScreenshotsForStep(step)
    const beforePath = path.join(evidenceDir, `${stepId}-before.png`)
    if (captureScreenshots) {
      await page.screenshot({ path: beforePath, fullPage: true })
    }

    const result = await runStep(page, step, protectedProviderDomains)

    const afterPath = path.join(evidenceDir, `${stepId}-after.png`)
    if (captureScreenshots) {
      await page.screenshot({ path: afterPath, fullPage: true })
      result.screenshot_before_path = beforePath
      result.screenshot_after_path = afterPath
    }

    const output = {
      generatedAt: new Date().toISOString(),
      flowPath,
      startUrl,
      stepId,
      ...result,
    }
    const outputPath = path.join(sessionDir, "replay-flow-step-result.json")
    await writeFile(outputPath, JSON.stringify(output, null, 2), "utf-8")

    const status = deriveReplayStepStatus(result)
    await persistResumeContext(context, page, sessionDir, status, step.step_id)

    if (shouldThrowReplayStepResult(result)) {
      throw new Error(`step replay failed, see ${outputPath}`)
    }
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  } finally {
    await context.close()
    await browser.close()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
    process.stderr.write(`replay-flow-step failed: ${message}\n`)
    process.exitCode = 1
  })
}
