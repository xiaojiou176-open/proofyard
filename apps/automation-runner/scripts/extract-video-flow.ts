import { writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  buildAiInputPack,
  type CapturedEvent,
  type TranscriptItem,
} from "./lib/ai-input-pack.js"
import { analyzeWithModelResolution } from "./extract-video-flow.gemini.js"
import {
  buildSelectors,
  deriveStepsFromEventLog,
  detectSignals,
  normalizeModelSteps,
  tryParseJson,
  valueRefForEvent,
} from "./extract-video-flow.event-log.js"
import { loadProviderPolicy, parsePolicyValue, resolveProviderPolicyCandidates } from "./extract-video-flow.policy.js"
import { getArg, readJsonOrDefault, readTextOrDefault, resolveSessionDir } from "./extract-video-flow.runtime.js"
export {
  ACTION_SCHEMA_ACTIONS,
  type CandidateStep,
  type ModelAnalysis,
} from "./extract-video-flow.shared.js"
export { analyzeWithModel, resolveAnalysisResult } from "./extract-video-flow.gemini.js"
export {
  buildSelectors,
  deriveStepsFromEventLog,
  detectSignals,
  loadProviderPolicy,
  normalizeModelSteps,
  parsePolicyValue,
  resolveProviderPolicyCandidates,
  tryParseJson,
  valueRefForEvent,
}

async function main(): Promise<void> {
  const sessionDir = await resolveSessionDir()
  const videoPath = getArg("video")
    ? path.resolve(process.cwd(), getArg("video")!)
    : path.join(sessionDir, "session.mp4")
  const transcriptPath = getArg("transcript")
    ? path.resolve(process.cwd(), getArg("transcript")!)
    : path.join(sessionDir, "session.transcript.json")
  const eventLogPath = path.join(sessionDir, "event-log.json")
  const harPath = path.join(sessionDir, "register.har")
  const htmlPath = path.join(sessionDir, "final.register.html")

  const transcript = await readJsonOrDefault<TranscriptItem[]>(transcriptPath, [])
  const events = await readJsonOrDefault<CapturedEvent[]>(eventLogPath, [])
  const har = await readJsonOrDefault<{
    log?: {
      entries?: Array<{
        request?: { method?: string; url?: string }
        response?: { status?: number }
      }>
    }
  }>(harPath, {})
  const htmlContent = await readTextOrDefault(htmlPath, "")
  const inputPack = buildAiInputPack({
    videoPath,
    transcript,
    events,
    har,
    htmlContent,
  })
  const contextPayload = inputPack.payload as Record<string, unknown>
  const cacheDir = path.join(sessionDir, ".context-cache", "video-flow")
  const providerPolicy = await loadProviderPolicy()

  const resolution = await analyzeWithModelResolution(contextPayload, { cacheDir })
  const llm = resolution.analysis
  const fallbackSteps = deriveStepsFromEventLog(events)
  const usingEventLogFallback = !llm || llm.candidateSteps.length === 0
  if (providerPolicy.strictNoFallback && usingEventLogFallback) {
    throw new Error(
      `[ai.gemini.strict_policy_violation] provider policy strict+fallback:none blocks event-log fallback (policy=${providerPolicy.sourcePath} reason=${resolution.reasonCode})`
    )
  }
  const candidateSteps = llm && llm.candidateSteps.length > 0 ? llm.candidateSteps : fallbackSteps
  const combinedText = inputPack.combinedText
  const detectedSignals = [
    ...new Set([...(llm?.detectedSignals ?? []), ...detectSignals(combinedText)]),
  ]

  const output = {
    generatedAt: new Date().toISOString(),
    sessionDir,
    videoPath,
    transcriptPath,
    eventLogPath,
    analysisEngine: llm?.modelName ?? "event-log-fallback",
    analysisPath: llm ? `llm:${resolution.selectedProvider}` : "event-log-fallback",
    analysisReasonCode: llm ? resolution.reasonCode : "ai.gemini.event_log_fallback",
    fallbackUsed: resolution.fallbackUsed,
    providerPolicy,
    contextCacheHit: resolution.contextCache.hit,
    contextCacheKey: resolution.contextCache.key,
    contextCachePath: resolution.contextCache.path,
    contextCacheModel: resolution.contextCache.modelName,
    inputPackSummary: inputPack.summary,
    modelAttempts: resolution.attempts,
    thoughtSignatures: {
      includeThoughtsEnabled: resolution.thoughtSignatures.includeThoughtsEnabled,
      status: resolution.thoughtSignatures.status,
      reasonCode: resolution.thoughtSignatures.reasonCode,
      signatures: resolution.thoughtSignatures.signatures,
      signatureCount: resolution.thoughtSignatures.signatures.length,
    },
    detectedSignals,
    candidateSteps,
  }

  const outPath = path.join(sessionDir, "video_flow.signals.json")
  await writeFile(outPath, JSON.stringify(output, null, 2), "utf-8")
  process.stdout.write(
    `${JSON.stringify(
      {
        outPath,
        steps: candidateSteps.length,
        analysisPath: output.analysisPath,
        analysisEngine: output.analysisEngine,
        analysisReasonCode: output.analysisReasonCode,
        fallbackUsed: output.fallbackUsed,
        contextCacheHit: output.contextCacheHit,
        contextCacheKey: output.contextCacheKey,
      },
      null,
      2
    )}\n`
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
    process.stderr.write(`extract-video-flow failed: ${message}\n`)
    process.exitCode = 1
  })
}
