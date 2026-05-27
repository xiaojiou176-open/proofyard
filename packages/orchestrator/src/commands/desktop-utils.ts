import { execFileSync, spawnSync } from "node:child_process"

export type ShellResult = {
  ok: boolean
  detail: string
  stdout: string
  stderr: string
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

export function runChecked(command: string, args: string[], timeoutMs = 10000): ShellResult {
  const result = spawnSync(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  })
  const stdout = result.stdout?.toString()?.trim() ?? ""
  const stderr = result.stderr?.toString()?.trim() ?? ""
  if (result.error) {
    return {
      ok: false,
      detail: `${command} ${args.join(" ")} error: ${(result.error as Error).message}`,
      stdout,
      stderr,
    }
  }
  if (result.status === 0) {
    return {
      ok: true,
      detail: `${command} ${args.join(" ")} ok`,
      stdout,
      stderr,
    }
  }
  return {
    ok: false,
    detail: `${command} ${args.join(" ")} failed: ${stderr || stdout || "unknown error"}`,
    stdout,
    stderr,
  }
}

export function buildDesktopOperatorManualShellResult(commandId: string): ShellResult {
  return {
    ok: false,
    detail: `${commandId} remains an operator-manual lane under host-process safety governance; agent-driven desktop control is disabled and evidence must be captured manually by the owner.`,
    stdout: "",
    stderr: "",
  }
}

export function appNameFromPath(appPath: string): string {
  const normalized = appPath.endsWith("/") ? appPath.slice(0, -1) : appPath
  const parts = normalized.split("/")
  const last = parts[parts.length - 1] || ""
  return last.endsWith(".app") ? last.slice(0, -4) : last
}

export function readBundleIdFromApp(appPath: string): string | undefined {
  try {
    const output = execFileSync(
      "/usr/libexec/PlistBuddy",
      ["-c", "Print :CFBundleIdentifier", `${appPath}/Contents/Info.plist`],
      { stdio: ["ignore", "pipe", "ignore"] }
    )
      .toString()
      .trim()
    return output || undefined
  } catch {
    return undefined
  }
}

export function findAppPathByBundleId(bundleId: string): string | undefined {
  try {
    const output = execFileSync("mdfind", [`kMDItemCFBundleIdentifier == '${bundleId}'`], {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .split("\n")
      .map((v) => v.trim())
      .find((v) => v.endsWith(".app"))
    return output || undefined
  } catch {
    return undefined
  }
}

export function findAppNameByBundleId(bundleId: string): string | undefined {
  const appPath = findAppPathByBundleId(bundleId)
  return appPath ? appNameFromPath(appPath) : undefined
}

export function isProcessRunning(appName: string): boolean {
  const check = runChecked("pgrep", ["-x", appName], 5000)
  return check.ok
}

export function findFirstPid(appName: string): number | undefined {
  const check = runChecked("pgrep", ["-x", appName], 5000)
  if (!check.ok || !check.stdout) {
    return undefined
  }
  const first = check.stdout
    .split("\n")
    .map((v) => v.trim())
    .find(Boolean)
  if (!first) {
    return undefined
  }
  const pid = Number(first)
  return Number.isInteger(pid) ? pid : undefined
}

export function getWindowCount(appName: string): number | undefined {
  void appName
  return undefined
}

export function getProcessSample(pid: number): { rssMb: number; cpuPercent: number } | undefined {
  const sample = runChecked("ps", ["-o", "rss=,%cpu=", "-p", String(pid)], 5000)
  if (!sample.ok || !sample.stdout) {
    return undefined
  }
  const parts = sample.stdout.trim().split(/\s+/)
  if (parts.length < 2) {
    return undefined
  }
  const rssKb = Number(parts[0])
  const cpu = Number(parts[1])
  if (!Number.isFinite(rssKb) || !Number.isFinite(cpu)) {
    return undefined
  }
  return {
    rssMb: Number((rssKb / 1024).toFixed(2)),
    cpuPercent: Number(cpu.toFixed(2)),
  }
}
