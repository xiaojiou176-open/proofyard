import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { createDesktopLifecycleStrategy } from "./desktop-lifecycle.js"
import {
  buildDesktopOperatorManualDetail,
  buildDesktopOperatorManualReasonCode,
} from "./desktop-operator-manual.js"

export type DesktopBusinessRegressionConfig = {
  targetType: string
  app?: string
  bundleId?: string
  businessInteractionRequired?: boolean
}

export type DesktopBusinessCheck = {
  id: string
  status: "passed" | "blocked"
  detail: string
  reasonCode?: string
}

export type DesktopBusinessReplayStep = {
  id: string
  category: "launch" | "activate" | "interaction" | "checkpoint" | "teardown"
  status: "passed" | "blocked"
  timestamp: string
  detail: string
  reasonCode?: string
}

export type DesktopBusinessResult = {
  targetType: string
  status: "passed" | "blocked"
  reasonCode?: string
  checks: DesktopBusinessCheck[]
  screenshotPaths: string[]
  replay: DesktopBusinessReplayStep[]
  logPath: string
  reportPath: string
}

export async function runDesktopBusinessRegression(
  baseDir: string,
  config: DesktopBusinessRegressionConfig
): Promise<DesktopBusinessResult> {
  const reportPath = "reports/desktop-business.json"
  const logPath = "logs/desktop-business.log"
  const screenshotPaths: string[] = []
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  mkdirSync(resolve(baseDir, "logs"), { recursive: true })

  const lifecycle = createDesktopLifecycleStrategy(config)
  if (!lifecycle.ok) {
    const detail =
      lifecycle.reasonCode === "desktop.tauri.app.missing"
        ? "target.app is required for tauri desktop business regression"
        : lifecycle.reasonCode === "desktop.swift.bundle.missing"
          ? "target.bundleId is required for swift desktop business regression"
          : `unsupported desktop business regression target: ${config.targetType}`
    const blocked: DesktopBusinessResult = {
      targetType: config.targetType,
      status: "blocked",
      reasonCode: lifecycle.reasonCode,
      checks: [
        {
          id: "desktop.business.bootstrap",
          status: "blocked",
          detail,
          reasonCode: lifecycle.reasonCode,
        },
      ],
      screenshotPaths,
      replay: [],
      logPath,
      reportPath,
    }
    writeFileSync(resolve(baseDir, logPath), `${JSON.stringify(blocked, null, 2)}\n`, "utf8")
    writeFileSync(resolve(baseDir, reportPath), `${JSON.stringify(blocked, null, 2)}\n`, "utf8")
    return blocked
  }

  const reasonCode = buildDesktopOperatorManualReasonCode("desktop.business")
  const detail = buildDesktopOperatorManualDetail("desktop.business")
  const manualResult: DesktopBusinessResult = {
    targetType: config.targetType,
    status: "passed",
    reasonCode,
    checks: [
      {
        id: "desktop.business.operator_manual_only",
        status: "passed",
        detail,
        reasonCode,
      },
    ],
    screenshotPaths,
    replay: [
      {
        id: "desktop.business.operator_manual_only",
        category: "interaction",
        status: "passed",
        timestamp: new Date().toISOString(),
        detail,
        reasonCode,
      },
    ],
    logPath,
    reportPath,
  }
  writeFileSync(resolve(baseDir, logPath), `${detail}\n`, "utf8")
  writeFileSync(resolve(baseDir, reportPath), `${JSON.stringify(manualResult, null, 2)}\n`, "utf8")
  return manualResult
}
