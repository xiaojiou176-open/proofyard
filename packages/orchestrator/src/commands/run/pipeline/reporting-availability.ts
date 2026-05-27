import { CROSS_TARGET_KEY_GATE_CHECK_IDS } from "../run-schema.js"
import type { ProfileConfig } from "../run-types.js"
import type { PipelineStageState } from "./stage-execution.js"

type EngineKey = "crawlee" | "lostpixel" | "backstop" | "semgrep" | "k6"

export type EngineAvailabilitySummary = {
  engineAvailability: Record<EngineKey, "available" | "missing" | "not_checked">
  missingRequiredEngines: EngineKey[]
  blockedByMissingEngineCount: number
  startupAvailable: number | undefined
  interactionPassed: number
  interactionTotal: number
  interactionPassRatio: number | undefined
  keyGatePassed: number
  keyGateTotal: number
  keyGatePassRatio: number | undefined
}

type AvailabilityCheck = {
  id: string
  status: "passed" | "failed" | "blocked"
  reasonCode?: string
}

function mapReasonCodeToEngine(reasonCode: string | undefined): EngineKey | undefined {
  const normalized = (reasonCode ?? "").toLowerCase()
  if (normalized.includes("crawlee_not_available")) return "crawlee"
  if (normalized.includes("lostpixel_not_available")) return "lostpixel"
  if (normalized.includes("backstop_not_available")) return "backstop"
  if (normalized.includes("semgrep_not_available")) return "semgrep"
  if (normalized.includes("k6_not_available")) return "k6"
  return undefined
}

export function deriveEngineAvailabilitySummary(args: {
  checks: AvailabilityCheck[]
  profile: ProfileConfig
  state: PipelineStageState
}): EngineAvailabilitySummary {
  const { checks, profile, state } = args
  const blockedMissingFromChecks = checks
    .filter((check) => check.status === "blocked")
    .map((check) => mapReasonCodeToEngine(check.reasonCode))
    .filter((engine): engine is EngineKey => engine !== undefined)
  const blockedMissingFromLoad = (state.loadSummary?.engines ?? [])
    .filter((engine) => engine.status === "blocked")
    .map((engine) => mapReasonCodeToEngine(engine.reasonCode ?? engine.detail))
    .filter((engine): engine is EngineKey => engine !== undefined)
  const missingEngines = new Set([...blockedMissingFromChecks, ...blockedMissingFromLoad])

  const availableEngines = new Set<EngineKey>()
  if (state.effectiveExploreConfig?.engine === "crawlee" && !missingEngines.has("crawlee")) {
    availableEngines.add("crawlee")
  }
  if (state.effectiveVisualConfig?.engine === "lostpixel" && !missingEngines.has("lostpixel")) {
    availableEngines.add("lostpixel")
  }
  if (state.effectiveVisualConfig?.engine === "backstop" && !missingEngines.has("backstop")) {
    availableEngines.add("backstop")
  }
  if (state.effectiveSecurityConfig?.engine === "semgrep" && !missingEngines.has("semgrep")) {
    availableEngines.add("semgrep")
  }
  for (const engine of state.loadSummary?.engines ?? []) {
    if (engine.engine === "k6" && engine.status === "ok") {
      availableEngines.add("k6")
    }
  }

  const requiredEngines = (profile.enginePolicy?.required ?? []).filter(
    (engine): engine is EngineKey =>
      engine === "crawlee" ||
      engine === "lostpixel" ||
      engine === "backstop" ||
      engine === "semgrep" ||
      engine === "k6"
  )
  const allEngineKeys = new Set<EngineKey>([
    ...requiredEngines,
    ...Array.from(availableEngines),
    ...Array.from(missingEngines),
  ])
  const engineAvailability = Object.fromEntries(
    Array.from(allEngineKeys)
      .sort()
      .map((engine) => [
        engine,
        availableEngines.has(engine)
          ? "available"
          : missingEngines.has(engine)
            ? "missing"
            : "not_checked",
      ])
  ) as Record<EngineKey, "available" | "missing" | "not_checked">
  const blockedByMissingEngineCount = missingEngines.size

  const startupChecks = checks.filter(
    (check) => check.id === "runtime.healthcheck" || check.id === "desktop.readiness"
  )
  const startupAvailable =
    startupChecks.length > 0
      ? startupChecks.every((check) => check.status === "passed")
        ? 1
        : 0
      : undefined

  const desktopInteractionTotal = state.desktopE2EResult?.checks.length ?? 0
  const desktopInteractionPassed =
    state.desktopE2EResult?.checks.filter((check) => check.status === "passed").length ?? 0
  const fallbackInteractionChecks =
    desktopInteractionTotal > 0
      ? []
      : checks.filter((check) => check.id === "test.e2e" || check.id === "desktop.e2e")
  const interactionPassed =
    desktopInteractionPassed +
    fallbackInteractionChecks.filter((check) => check.status === "passed").length
  const interactionTotal = desktopInteractionTotal + fallbackInteractionChecks.length
  const interactionPassRatio =
    interactionTotal > 0 ? Number((interactionPassed / interactionTotal).toFixed(4)) : undefined

  const configuredKeyGateChecks = checks.filter((check) =>
    CROSS_TARGET_KEY_GATE_CHECK_IDS.has(check.id)
  )
  const effectiveKeyGateChecks =
    configuredKeyGateChecks.length > 0 ? configuredKeyGateChecks : checks
  const keyGatePassed = effectiveKeyGateChecks.filter((check) => check.status === "passed").length
  const keyGateTotal = effectiveKeyGateChecks.length
  const keyGatePassRatio =
    keyGateTotal > 0 ? Number((keyGatePassed / keyGateTotal).toFixed(4)) : undefined

  return {
    engineAvailability,
    missingRequiredEngines: requiredEngines.filter(
      (engine) => engineAvailability[engine] !== "available"
    ),
    blockedByMissingEngineCount,
    startupAvailable,
    interactionPassed,
    interactionTotal,
    interactionPassRatio,
    keyGatePassed,
    keyGateTotal,
    keyGatePassRatio,
  }
}
