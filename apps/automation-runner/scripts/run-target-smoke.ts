import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runTauriWebDriverSmoke } from "./drivers/tauri-webdriver-smoke.js";
import { runSwiftXCUITestSmoke } from "./drivers/swift-xcuitest-smoke.js";
import type { DriverSmokeResult, TargetProfile } from "./drivers/types.js";

const TARGETS_ROOT = path.resolve(process.cwd(), "..", "config", "targets");

function getOption(name: string): string | null {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

async function readTarget(targetId: string): Promise<TargetProfile> {
  const targetPath = path.join(TARGETS_ROOT, `${targetId}.json`);
  const raw = await readFile(targetPath, "utf-8");
  return JSON.parse(raw) as TargetProfile;
}

async function runDriver(target: TargetProfile): Promise<DriverSmokeResult> {
  if (target.driver_id === "tauri-webdriver") {
    return runTauriWebDriverSmoke(target);
  }
  if (target.driver_id === "swift-xcuitest") {
    return runSwiftXCUITestSmoke(target);
  }
  throw new Error(`unsupported driver_id for smoke: ${target.driver_id}`);
}

async function main(): Promise<void> {
  const targetId = getOption("target") ?? process.env.TARGET_ID ?? "tauri.macos";
  const target = await readTarget(targetId);
  const runId =
    process.env.UIQ_RUN_ID ||
    process.env.UIQ_GOVERNANCE_RUN_ID ||
    `driver-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try {
    const result = await runDriver(target);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const reportDir = path.resolve(
      process.cwd(),
      "..",
      ".runtime-cache",
      "artifacts",
      "runs",
      runId,
      "driver-smoke",
      target.target_id
    );
    await mkdir(reportDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const reportPath = path.join(reportDir, `${target.driver_id}-${stamp}-failed.json`);
    const message = error instanceof Error ? error.message : String(error);
    const failed: DriverSmokeResult = {
      target_id: target.target_id,
      driver_id: target.driver_id,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      ok: false,
      detail: message,
      artifacts: {
        report_path: reportPath,
        log_path: null,
      },
      metrics: {},
    };
    await writeFile(reportPath, JSON.stringify(failed, null, 2), "utf-8");
    process.stderr.write(`run-target-smoke failed: ${message}\nreport: ${reportPath}\n`);
    process.exitCode = 1;
  }
}
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`run-target-smoke fatal: ${message}\n`);
  process.exitCode = 1;
});
