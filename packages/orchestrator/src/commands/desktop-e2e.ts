import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { createDesktopLifecycleStrategy } from "./desktop-lifecycle.js"
import {
  buildDesktopOperatorManualDetail,
  buildDesktopOperatorManualReasonCode,
} from "./desktop-operator-manual.js"

export type DesktopE2EConfig = {
  targetType: string
  app?: string
  bundleId?: string
  businessInteractionRequired?: boolean
  seed?: number
}

export type DesktopE2ECheck = {
  id: string
  status: "passed" | "blocked"
  detail: string
  reasonCode?: string
}

export type DesktopE2EResult = {
  targetType: string
  status: "passed" | "blocked"
  reasonCode?: string
  checks: DesktopE2ECheck[]
  interactionMetrics?: DesktopE2EInteractionMetrics
  interactionRounds?: DesktopE2EInteractionRound[]
  interactionMetadata?: DesktopE2EInteractionMetadata
  screenshotPath?: string
  reportPath: string
}

export type DesktopE2EInteractionType = "click" | "tab" | "scroll" | "input"

export type DesktopE2EInteractionRound = {
  round: number
  action: DesktopE2EInteractionType
  status: "passed" | "blocked"
  detail: string
  durationMs: number
}

export type DesktopE2EInteractionMetrics = {
  roundsPlanned: number
  roundsExecuted: number
  passedRounds: number
  failedRounds: number
  coveredActions: DesktopE2EInteractionType[]
  coverageRequirementMet: boolean
  byAction: Record<
    DesktopE2EInteractionType,
    {
      attempted: number
      passed: number
      failed: number
    }
  >
}

export type DesktopE2EInteractionMetadata = {
  plannerVersion: "seeded-lcg-v1"
  seed: number
  roundsRequested: number
  roundsPlanned: number
  minimumActionCoverage: number
  plan: DesktopE2EInteractionType[]
  businessInteractionRequired: boolean
}

type DesktopActivateTarget = "tauri" | "swift"

const INTERACTION_ACTIONS: DesktopE2EInteractionType[] = ["click", "tab", "scroll", "input"]
const INTERACTION_ROUNDS = 8
const MIN_ACTION_COVERAGE = 3
const DEFAULT_INTERACTION_SEED = 20260220

function block(
  reportPath: string,
  targetType: string,
  checks: DesktopE2ECheck[],
  interactionMetadata?: DesktopE2EInteractionMetadata
): DesktopE2EResult {
  const firstBlocked = checks.find((c) => c.status === "blocked")
  return {
    targetType,
    status: checks.every((c) => c.status === "passed") ? "passed" : "blocked",
    reasonCode: firstBlocked?.reasonCode,
    checks,
    interactionMetadata,
    reportPath,
  }
}

export function buildActivateCheck(
  target: DesktopActivateTarget,
  activate: { ok: boolean; detail: string }
): DesktopE2ECheck {
  return {
    id: "desktop.e2e.activate",
    status: activate.ok ? "passed" : "blocked",
    detail: activate.detail,
    reasonCode: activate.ok ? undefined : `desktop.${target}.activate.failed`,
  }
}

export function buildDeepInteractionCheck(metrics: DesktopE2EInteractionMetrics): DesktopE2ECheck {
  const detail = `success_coverage=${metrics.coveredActions.join(",")}; rounds=${metrics.roundsExecuted}; failed=${metrics.failedRounds}`
  if (metrics.coverageRequirementMet) {
    return {
      id: "desktop.e2e.business.deep_interaction",
      status: "passed",
      detail,
    }
  }
  return {
    id: "desktop.e2e.business.deep_interaction",
    status: "blocked",
    detail,
    reasonCode: "desktop.e2e.deep_interaction.success_coverage_insufficient",
  }
}

function resolveInteractionSeed(seed: number | undefined): number {
  if (typeof seed !== "number" || !Number.isFinite(seed)) {
    return DEFAULT_INTERACTION_SEED
  }
  const normalized = Math.floor(seed) >>> 0
  return normalized === 0 ? DEFAULT_INTERACTION_SEED : normalized
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function shuffleActions(
  values: DesktopE2EInteractionType[],
  nextRandom: () => number
): DesktopE2EInteractionType[] {
  const pool = [...values]
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(nextRandom() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool
}

export function buildInteractionPlan(rounds: number, seed: number): DesktopE2EInteractionType[] {
  const normalizedRounds = Math.max(MIN_ACTION_COVERAGE, rounds)
  const nextRandom = createSeededRandom(seed)
  const plan = shuffleActions(INTERACTION_ACTIONS, nextRandom).slice(0, MIN_ACTION_COVERAGE)
  while (plan.length < normalizedRounds) {
    const idx = Math.floor(nextRandom() * INTERACTION_ACTIONS.length)
    plan.push(INTERACTION_ACTIONS[idx])
  }
  return plan
}

export function isBusinessInteractionBlocking(config: DesktopE2EConfig): boolean {
  return config.businessInteractionRequired !== false
}

export async function runDesktopE2E(
  baseDir: string,
  config: DesktopE2EConfig
): Promise<DesktopE2EResult> {
  const reportPath = "metrics/desktop-e2e.json"
  const interactionSeed = resolveInteractionSeed(config.seed)
  const interactionPlan = buildInteractionPlan(INTERACTION_ROUNDS, interactionSeed)
  const interactionMetadata: DesktopE2EInteractionMetadata = {
    plannerVersion: "seeded-lcg-v1",
    seed: interactionSeed,
    roundsRequested: INTERACTION_ROUNDS,
    roundsPlanned: interactionPlan.length,
    minimumActionCoverage: MIN_ACTION_COVERAGE,
    plan: interactionPlan,
    businessInteractionRequired: isBusinessInteractionBlocking(config),
  }

  const lifecycle = createDesktopLifecycleStrategy(config)
  if (!lifecycle.ok) {
    const result =
      lifecycle.reasonCode === "desktop.tauri.app.missing"
        ? block(
            reportPath,
            config.targetType,
            [
              {
                id: "desktop.e2e.app",
                status: "blocked",
                detail: "target.app is required",
                reasonCode: lifecycle.reasonCode,
              },
            ],
            interactionMetadata
          )
        : lifecycle.reasonCode === "desktop.swift.bundle.missing"
          ? block(
              reportPath,
              config.targetType,
              [
                {
                  id: "desktop.e2e.bundle",
                  status: "blocked",
                  detail: "target.bundleId is required",
                  reasonCode: lifecycle.reasonCode,
                },
              ],
              interactionMetadata
            )
          : block(
              reportPath,
              config.targetType,
              [
                {
                  id: "desktop.e2e.unsupported",
                  status: "blocked",
                  detail: `unsupported target.type=${config.targetType}`,
                  reasonCode: lifecycle.reasonCode,
                },
              ],
              interactionMetadata
            )
    writeFileSync(resolve(baseDir, reportPath), JSON.stringify(result, null, 2), "utf8")
    return result
  }

  const result: DesktopE2EResult = {
    targetType: config.targetType,
    status: "passed",
    reasonCode: buildDesktopOperatorManualReasonCode("desktop.e2e"),
    checks: [
      {
        id: "desktop.e2e.operator_manual_only",
        status: "passed",
        detail: buildDesktopOperatorManualDetail("desktop.e2e"),
        reasonCode: buildDesktopOperatorManualReasonCode("desktop.e2e"),
      },
    ],
    interactionMetadata,
    reportPath,
  }
  writeFileSync(resolve(baseDir, reportPath), JSON.stringify(result, null, 2), "utf8")
  return result
}
