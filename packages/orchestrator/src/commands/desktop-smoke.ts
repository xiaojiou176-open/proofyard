import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { createDesktopLifecycleStrategy } from "./desktop-lifecycle.js"
import {
  buildDesktopOperatorManualDetail,
  buildDesktopOperatorManualReasonCode,
} from "./desktop-operator-manual.js"

export type DesktopSmokeConfig = {
  targetType: string
  app?: string
  bundleId?: string
}

export type DesktopSmokeResult = {
  targetType: string
  status: "passed" | "blocked"
  reasonCode?: string
  started: boolean
  activated: boolean
  screenshotPath?: string
  quit: boolean
  detail: string
  reportPath: string
}

function writeReport(
  baseDir: string,
  reportPath: string,
  result: DesktopSmokeResult
): DesktopSmokeResult {
  writeFileSync(resolve(baseDir, reportPath), JSON.stringify(result, null, 2), "utf8")
  return result
}

export async function runDesktopSmoke(
  baseDir: string,
  config: DesktopSmokeConfig
): Promise<DesktopSmokeResult> {
  const reportPath = "metrics/desktop-smoke.json"

  const started = false
  const activated = false
  const quit = false

  const lifecycle = createDesktopLifecycleStrategy(config)
  if (!lifecycle.ok) {
    const detail =
      lifecycle.reasonCode === "desktop.tauri.app.missing"
        ? "target.app is required for tauri desktop_smoke"
        : lifecycle.reasonCode === "desktop.swift.bundle.missing"
          ? "target.bundleId is required for swift desktop_smoke"
          : `desktop_smoke unsupported for target.type=${config.targetType}`
    return writeReport(baseDir, reportPath, {
      targetType: config.targetType,
      status: "blocked",
      reasonCode: lifecycle.reasonCode,
      started,
      activated,
      quit,
      detail,
      reportPath,
    })
  }

  return writeReport(baseDir, reportPath, {
    targetType: config.targetType,
    status: "passed",
    reasonCode: buildDesktopOperatorManualReasonCode("desktop.smoke"),
    started,
    activated,
    quit,
    detail: buildDesktopOperatorManualDetail("desktop.smoke"),
    reportPath,
  })
}
