import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { DriverSmokeResult, TargetProfile } from "./types.js";

function ensureXcodebuildAvailable(): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("xcodebuild", ["-version"], { stdio: "ignore" });
    proc.on("error", (error) => reject(error));
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`xcodebuild -version failed with code ${code}`));
      }
    });
  });
}

function buildXcodeArgs(target: TargetProfile): string[] {
  const xcode = target.xcode ?? {};
  const scheme = process.env.XCUITEST_SCHEME || xcode.scheme;
  if (!scheme) {
    throw new Error("missing xcode scheme (XCUITEST_SCHEME or target.xcode.scheme)");
  }
  const mode = (process.env.XCUITEST_MODE as "test" | "build-for-testing" | undefined) || xcode.mode || "test";
  const args = [mode, "-scheme", scheme];
  const workspace = process.env.XCUITEST_WORKSPACE || xcode.workspace;
  const project = process.env.XCUITEST_PROJECT || xcode.project;
  if (workspace) {
    args.push("-workspace", path.resolve(process.cwd(), "..", workspace));
  } else if (project) {
    args.push("-project", path.resolve(process.cwd(), "..", project));
  }
  const destination = process.env.XCUITEST_DESTINATION || xcode.destination || "platform=macOS";
  args.push("-destination", destination);
  const testPlan = process.env.XCUITEST_TEST_PLAN || xcode.test_plan;
  if (testPlan) {
    args.push("-testPlan", testPlan);
  }
  const configuration = process.env.XCUITEST_CONFIGURATION || xcode.configuration;
  if (configuration) {
    args.push("-configuration", configuration);
  }
  if (mode === "test") {
    const onlyTestingFromEnv = process.env.XCUITEST_ONLY_TESTING
      ? process.env.XCUITEST_ONLY_TESTING.split(",").map((item) => item.trim()).filter(Boolean)
      : [];
    const onlyTesting = onlyTestingFromEnv.length > 0 ? onlyTestingFromEnv : (xcode.only_testing ?? []);
    for (const testId of onlyTesting) {
      args.push("-only-testing", testId);
    }
    const skipTestingFromEnv = process.env.XCUITEST_SKIP_TESTING
      ? process.env.XCUITEST_SKIP_TESTING.split(",").map((item) => item.trim()).filter(Boolean)
      : [];
    const skipTesting = skipTestingFromEnv.length > 0 ? skipTestingFromEnv : (xcode.skip_testing ?? []);
    for (const testId of skipTesting) {
      args.push("-skip-testing", testId);
    }
  }
  return args;
}

export async function runSwiftXCUITestSmoke(target: TargetProfile): Promise<DriverSmokeResult> {
  const startedAt = new Date().toISOString();
  const runId =
    process.env.UIQ_RUN_ID ||
    process.env.UIQ_GOVERNANCE_RUN_ID ||
    `driver-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await ensureXcodebuildAvailable();
  const args = buildXcodeArgs(target);

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
  const reportPath = path.join(reportDir, `swift-xcuitest-${stamp}.json`);
  const logPath = path.join(reportDir, `swift-xcuitest-${stamp}.log`);

  const log = createWriteStream(logPath, { flags: "a" });
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("xcodebuild", args, { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", (chunk) => log.write(chunk));
    proc.stderr.on("data", (chunk) => log.write(chunk));
    proc.on("error", (error) => reject(error));
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`xcodebuild exited with code ${code}`));
      }
    });
  }).finally(() => {
    log.end();
  });

  const finishedAt = new Date().toISOString();
  const result: DriverSmokeResult = {
    target_id: target.target_id,
    driver_id: target.driver_id,
    started_at: startedAt,
    finished_at: finishedAt,
    ok: true,
    detail: `swift xcuitest smoke passed (mode=${args[0]})`,
    artifacts: { report_path: reportPath, log_path: logPath },
    metrics: { args },
  };
  await writeFile(reportPath, JSON.stringify(result, null, 2), "utf-8");
  return result;
}
