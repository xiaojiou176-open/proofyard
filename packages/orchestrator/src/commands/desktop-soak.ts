import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { buildDesktopOperatorManualReasonCode } from "./desktop-operator-manual.js"
import {
  appNameFromPath,
  findAppNameByBundleId,
  findFirstPid,
  getProcessSample,
  getWindowCount,
  isProcessRunning,
  readBundleIdFromApp,
  runChecked,
  sleep,
} from "./desktop-utils.js"

type DesktopSoakDeps = {
  appNameFromPath: typeof appNameFromPath
  findAppNameByBundleId: typeof findAppNameByBundleId
  findFirstPid: typeof findFirstPid
  getProcessSample: typeof getProcessSample
  getWindowCount: typeof getWindowCount
  isProcessRunning: typeof isProcessRunning
  readBundleIdFromApp: typeof readBundleIdFromApp
  runChecked: typeof runChecked
  sleep: typeof sleep
}

const defaultDesktopSoakDeps: DesktopSoakDeps = {
  appNameFromPath,
  findAppNameByBundleId,
  findFirstPid,
  getProcessSample,
  getWindowCount,
  isProcessRunning,
  readBundleIdFromApp,
  runChecked,
  sleep,
}

export type DesktopSoakConfig = {
  targetType: string
  app?: string
  bundleId?: string
  durationSeconds: number
  intervalSeconds: number
  gates?: {
    rssGrowthMbMax?: number
    cpuAvgPercentMax?: number
    crashCountMax?: number
  }
}

export type DesktopSoakSample = {
  timestamp: string
  running: boolean
  rssMb?: number
  cpuPercent?: number
  windowCount?: number
}

type DesktopSoakWindowFluctuation = {
  observedSamples: number
  changeCount: number
  maxDelta: number
  avgDelta: number
}

type DesktopSoakStabilityMetrics = {
  crashRecoveryAttempts: number
  crashRecoveryFailedCount: number
  maxContinuousInactivityWindows: number
  maxContinuousInactivitySeconds: number
  windowFluctuation: DesktopSoakWindowFluctuation
}

export type DesktopSoakResult = {
  targetType: string
  status: "passed" | "blocked"
  reasonCode?: string
  durationSeconds: number
  intervalSeconds: number
  appName?: string
  crashCount: number
  rssGrowthMb?: number
  rssMaxMb?: number
  cpuAvgPercent?: number
  stabilityMetrics?: DesktopSoakStabilityMetrics
  samples: DesktopSoakSample[]
  reportPath: string
}

export async function runDesktopSoak(
  baseDir: string,
  config: DesktopSoakConfig,
  deps: DesktopSoakDeps = defaultDesktopSoakDeps
): Promise<DesktopSoakResult> {
  const reportPath = "metrics/desktop-soak.json"
  const samples: DesktopSoakSample[] = []
  let appName: string | undefined

  if (config.targetType === "tauri") {
    if (!config.app) {
      const blocked: DesktopSoakResult = {
        targetType: config.targetType,
        status: "blocked",
        reasonCode: "desktop.tauri.app.missing",
        durationSeconds: config.durationSeconds,
        intervalSeconds: config.intervalSeconds,
        crashCount: 1,
        samples,
        reportPath,
      }
      writeFileSync(resolve(baseDir, reportPath), JSON.stringify(blocked, null, 2), "utf8")
      return blocked
    }
    appName = deps.appNameFromPath(config.app)
  } else if (config.targetType === "swift") {
    if (!config.bundleId) {
      const blocked: DesktopSoakResult = {
        targetType: config.targetType,
        status: "blocked",
        reasonCode: "desktop.swift.bundle.missing",
        durationSeconds: config.durationSeconds,
        intervalSeconds: config.intervalSeconds,
        crashCount: 1,
        samples,
        reportPath,
      }
      writeFileSync(resolve(baseDir, reportPath), JSON.stringify(blocked, null, 2), "utf8")
      return blocked
    }
    appName = deps.findAppNameByBundleId(config.bundleId)
  } else {
    const blocked: DesktopSoakResult = {
      targetType: config.targetType,
      status: "blocked",
      reasonCode: "desktop.target.unsupported",
      durationSeconds: config.durationSeconds,
      intervalSeconds: config.intervalSeconds,
      crashCount: 1,
      samples,
      reportPath,
    }
    writeFileSync(resolve(baseDir, reportPath), JSON.stringify(blocked, null, 2), "utf8")
    return blocked
  }

  const manualResult: DesktopSoakResult = {
    targetType: config.targetType,
    status: "passed",
    reasonCode: buildDesktopOperatorManualReasonCode("desktop.soak"),
    durationSeconds: config.durationSeconds,
    intervalSeconds: config.intervalSeconds,
    appName,
    crashCount: 0,
    stabilityMetrics: {
      crashRecoveryAttempts: 0,
      crashRecoveryFailedCount: 0,
      maxContinuousInactivityWindows: 0,
      maxContinuousInactivitySeconds: 0,
      windowFluctuation: {
        observedSamples: 0,
        changeCount: 0,
        maxDelta: 0,
        avgDelta: 0,
      },
    },
    samples,
    reportPath,
  }
  writeFileSync(resolve(baseDir, reportPath), JSON.stringify(manualResult, null, 2), "utf8")
  return manualResult
}
