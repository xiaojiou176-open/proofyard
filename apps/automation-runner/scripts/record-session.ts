import { writeFile } from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import {
  buildAutomationRecorderInitScript,
  isExecutedAsScript,
  runMidsceneTakeover,
  waitForManualConfirmation,
} from "./record-session.browser.js"
import {
  applyProviderProtection,
  assertPathWithinRoots,
  buildFlowDraft,
  cleanupExpiredSessions,
  createSessionId,
  ensureDirs,
  envEnabled,
  eventLooksSensitive,
  eventLooksStripeField,
  extractHostname,
  hasOtpHint,
  isPathWithinRoot,
  isSessionDirectory,
  isSessionDirectoryName,
  parseGatePolicy,
  parsePositiveNumber,
  parseProtectedProviderDomains,
  redactEventsForPersist,
  resolveMidsceneDriverPath,
  resolveMode,
  resolveProtectedProviderDomain,
  resolveRepoRoot,
  resolveRuntimeCacheRoot,
  resolveRuntimeRoot,
  resolveSafeMidsceneDriverPath,
  sanitizeSessionId,
  sanitizeUrlForPersist,
  triggerWorkspaceCleanup,
  type CapturedEvent,
  type SessionMeta,
} from "./record-session.shared.js"
import { AUTOMATION_ENV } from "./lib/env.js"

export {
  applyProviderProtection,
  assertPathWithinRoots,
  buildFlowDraft,
  cleanupExpiredSessions,
  createSessionId,
  envEnabled,
  eventLooksSensitive,
  eventLooksStripeField,
  extractHostname,
  hasOtpHint,
  isPathWithinRoot,
  isSessionDirectory,
  isSessionDirectoryName,
  parseGatePolicy,
  parsePositiveNumber,
  parseProtectedProviderDomains,
  redactEventsForPersist,
  resolveMidsceneDriverPath,
  resolveMode,
  resolveProtectedProviderDomain,
  resolveRepoRoot,
  resolveRuntimeCacheRoot,
  resolveRuntimeRoot,
  resolveSafeMidsceneDriverPath,
  sanitizeSessionId,
  sanitizeUrlForPersist,
  triggerWorkspaceCleanup,
}
export type {
  CapturedEvent,
  FlowStep,
  MidsceneDriverModule,
  MidsceneTakeoverContext,
  ProtectedProviderConfig,
  RecordMode,
  SessionMeta,
} from "./record-session.shared.js"

async function main(): Promise<void> {
  const repoRoot = resolveRepoRoot()
  const mode = resolveMode()
  const baseUrl = AUTOMATION_ENV.UIQ_BASE_URL ?? "http://127.0.0.1:17380"
  const startUrl =
    AUTOMATION_ENV.START_URL?.trim() ||
    process.env.START_URL?.trim() ||
    `${baseUrl.replace(/\/$/, "")}/register`
  const successSelector = AUTOMATION_ENV.SUCCESS_SELECTOR ?? process.env.SUCCESS_SELECTOR ?? ""
  const runtimeRoot = resolveRuntimeRoot(repoRoot)
  const runtimeCacheRoot = path.resolve(repoRoot, ".runtime-cache")
  assertPathWithinRoots(runtimeRoot, [runtimeCacheRoot], "runtime root")

  const sessionId = sanitizeSessionId(AUTOMATION_ENV.SESSION_ID ?? process.env.SESSION_ID)
  const sessionDir = path.join(runtimeRoot, sessionId)
  const videoDir = path.join(sessionDir, "video")
  const harPath = path.join(sessionDir, "register.har")
  const tracePath = path.join(sessionDir, "trace.zip")
  const htmlPath = path.join(sessionDir, "final.register.html")
  const eventLogPath = path.join(sessionDir, "event-log.json")
  const flowDraftPath = path.join(sessionDir, "flow-draft.json")
  const storageStatePath = path.join(sessionDir, "storage-state.json")
  const latestPointerPath = path.join(runtimeRoot, "latest-session.json")

  const allowSensitiveCapture = envEnabled("FLOW_ALLOW_SENSITIVE_CAPTURE")
  const allowSensitiveTrace = allowSensitiveCapture && envEnabled("FLOW_ALLOW_SENSITIVE_TRACE")
  const allowSensitiveStorage = allowSensitiveCapture && envEnabled("FLOW_ALLOW_SENSITIVE_STORAGE")
  const allowSensitiveInputValues =
    allowSensitiveCapture &&
    (envEnabled("FLOW_ALLOW_SENSITIVE_INPUT_VALUES") ||
      envEnabled("RECORD_CAPTURE_INPUT_PLAINTEXT"))
  const captureHar = allowSensitiveCapture && envEnabled("FLOW_ALLOW_SENSITIVE_HAR")
  const captureVideo = allowSensitiveCapture && envEnabled("FLOW_ALLOW_SENSITIVE_VIDEO")
  const captureHtml =
    allowSensitiveCapture &&
    envEnabled("FLOW_ALLOW_SENSITIVE_HTML") &&
    !envEnabled("FLOW_DISABLE_HTML_CAPTURE")
  const protectedProviderDomains = parseProtectedProviderDomains(
    process.env.FLOW_PROTECTED_PROVIDER_DOMAINS
  )
  const protectedProviderGatePolicy = parseGatePolicy(
    process.env.FLOW_PROTECTED_PROVIDER_GATE_POLICY
  )

  await ensureDirs([runtimeRoot, sessionDir, ...(captureVideo ? [videoDir] : [])])
  await triggerWorkspaceCleanup(repoRoot)
  await cleanupExpiredSessions(runtimeRoot)

  const explicitHeadless = AUTOMATION_ENV.HEADLESS ?? process.env.HEADLESS
  const headless = explicitHeadless ? explicitHeadless !== "false" : mode !== "manual"
  if (mode === "manual" && headless) {
    throw new Error("manual mode requires headed browser. Set HEADLESS=false.")
  }

  const useSystemChrome =
    process.env.USE_SYSTEM_CHROME === "true" || process.env.USE_SYSTEM_CHROME === "1"

  const browser = await chromium.launch({
    headless,
    ...(useSystemChrome && {
      channel: "chrome",
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--no-first-run",
        "--no-default-browser-check",
      ],
    }),
  })
  const context = await browser.newContext({
    ...(captureHar
      ? {
          recordHar: {
            mode: "minimal" as const,
            path: harPath,
          },
        }
      : {}),
    ...(captureVideo
      ? {
          recordVideo: {
            dir: videoDir,
            size: { width: 1280, height: 720 },
          },
        }
      : {}),
    viewport: { width: 1280, height: 720 },
    ...(useSystemChrome && {
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    }),
  })

  if (allowSensitiveTrace) {
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: true,
    })
  }

  const page = await context.newPage()
  await page.addInitScript(buildAutomationRecorderInitScript(allowSensitiveInputValues))

  const suggestedEmail = `demo+${Date.now()}@example.com`
  const suggestedPassword = (process.env.REGISTER_PASSWORD ?? "").trim()
  const midsceneDriverPath =
    mode === "midscene"
      ? await resolveSafeMidsceneDriverPath(repoRoot, resolveMidsceneDriverPath())
      : null

  if (mode === "manual") {
    await page.goto(startUrl, { waitUntil: "networkidle" })
    await waitForManualConfirmation(page, successSelector)
  } else {
    if (!midsceneDriverPath) {
      throw new Error("midscene mode requires driver path")
    }
    await runMidsceneTakeover(
      page,
      {
        startUrl,
        suggestedEmail,
        suggestedPassword,
        successSelector,
      },
      midsceneDriverPath
    )
    if (successSelector.trim()) {
      await page.waitForSelector(successSelector, { timeout: 30_000 })
    }
  }

  const capturedEvents = await page.evaluate(() => {
    const recorder = (window as unknown as { __automationRecorder?: { events?: unknown[] } })
      .__automationRecorder
    if (!recorder || !Array.isArray(recorder.events)) {
      return []
    }
    return recorder.events
  })
  const events = redactEventsForPersist(
    capturedEvents as CapturedEvent[],
    allowSensitiveInputValues
  )
  const flowDraft = buildFlowDraft(sessionId, startUrl, events, {
    protectedProviderDomains,
    protectedProviderGatePolicy,
  })

  if (captureHtml) {
    await writeFile(htmlPath, await page.content(), "utf-8")
  }
  await writeFile(eventLogPath, JSON.stringify(events, null, 2), "utf-8")
  await writeFile(flowDraftPath, JSON.stringify(flowDraft, null, 2), "utf-8")
  if (allowSensitiveStorage) {
    await context.storageState({ path: storageStatePath })
  }
  if (allowSensitiveTrace) {
    await context.tracing.stop({ path: tracePath })
  }
  await context.close()
  await browser.close()

  const metadata: SessionMeta = {
    sessionId,
    mode,
    baseUrl: sanitizeUrlForPersist(baseUrl),
    startUrl: sanitizeUrlForPersist(startUrl),
    suggestedEmail,
    outputDir: sessionDir,
    harPath: captureHar ? harPath : null,
    tracePath: allowSensitiveTrace ? tracePath : null,
    htmlPath: captureHtml ? htmlPath : null,
    eventLogPath,
    flowDraftPath,
    storageStatePath: allowSensitiveStorage ? storageStatePath : null,
    videoDir: captureVideo ? videoDir : null,
    midsceneDriverPath,
    capturePolicy: {
      allowSensitiveCapture,
      allowSensitiveTrace,
      allowSensitiveStorage,
      allowSensitiveInputValues,
      captureHar,
      captureVideo,
      captureHtml,
    },
    createdAt: new Date().toISOString(),
  }

  await writeFile(
    path.join(sessionDir, "session-meta.json"),
    JSON.stringify(metadata, null, 2),
    "utf-8"
  )
  await writeFile(latestPointerPath, JSON.stringify({ sessionId, sessionDir }, null, 2), "utf-8")
  process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`)
}

if (isExecutedAsScript(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
    process.stderr.write(`record-session failed: ${message}\n`)
    process.exitCode = 1
  })
}
