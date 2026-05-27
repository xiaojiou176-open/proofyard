import { access, mkdir, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import type { DriverSmokeResult, TargetProfile } from "./types.js";

function substituteTemplate(value: unknown, appPath: string | undefined): unknown {
  if (typeof value === "string") {
    if (appPath) {
      return value.replace(/\$\{app_path\}/g, appPath);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteTemplate(item, appPath));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = substituteTemplate(item, appPath);
    }
    return out;
  }
  return value;
}

async function ensureReadableFile(filePath: string): Promise<void> {
  await access(filePath, fsConstants.R_OK);
}

async function callWebDriver(
  webdriverUrl: string,
  route: string,
  init?: RequestInit,
): Promise<{ status: number; json: unknown }> {
  const url = `${webdriverUrl.replace(/\/$/, "")}${route}`;
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`webdriver request failed: ${url} (${message})`);
  }
  const json = (await response.json().catch(() => ({}))) as unknown;
  return { status: response.status, json };
}

export async function runTauriWebDriverSmoke(target: TargetProfile): Promise<DriverSmokeResult> {
  const startedAt = new Date().toISOString();
  const runId =
    process.env.UIQ_RUN_ID ||
    process.env.UIQ_GOVERNANCE_RUN_ID ||
    `driver-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const appPathRaw = process.env.TAURI_APP_PATH || target.app_path;
  const appPath = appPathRaw ? path.resolve(process.cwd(), "..", appPathRaw) : undefined;
  const webdriverUrl = process.env.WEBDRIVER_URL || target.webdriver_url || "http://127.0.0.1:4444";
  const webdriverProvider = process.env.WEBDRIVER_PROVIDER || "unknown";
  if (!appPath) {
    throw new Error("missing app_path/TAURI_APP_PATH");
  }
  await ensureReadableFile(appPath);

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
  const reportPath = path.join(reportDir, `tauri-webdriver-${stamp}.json`);

  const statusCall = await callWebDriver(webdriverUrl, "/status");
  if (statusCall.status >= 400) {
    throw new Error(`webdriver status failed: HTTP ${statusCall.status}`);
  }

  const envCapabilities = process.env.WEBDRIVER_CAPABILITIES_JSON
    ? (JSON.parse(process.env.WEBDRIVER_CAPABILITIES_JSON) as Record<string, unknown>)
    : null;
  const capabilities = (substituteTemplate(
    envCapabilities ?? target.capabilities ?? { alwaysMatch: { browserName: "tauri", "tauri:options": { application: "${app_path}" } } },
    appPath,
  ) ?? {}) as Record<string, unknown>;

  const sessionPayload = { capabilities };
  const sessionCall = await callWebDriver(webdriverUrl, "/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sessionPayload),
  });
  if (sessionCall.status >= 400) {
    throw new Error(`webdriver create session failed: HTTP ${sessionCall.status} body=${JSON.stringify(sessionCall.json)}`);
  }
  const sessionJson = sessionCall.json as { value?: { sessionId?: string } | { sessionId?: string }; sessionId?: string };
  const sessionId =
    (sessionJson.value && "sessionId" in sessionJson.value ? sessionJson.value.sessionId : undefined) ||
    sessionJson.sessionId;
  if (!sessionId) {
    throw new Error("webdriver create session returned no session id");
  }

  await callWebDriver(webdriverUrl, `/session/${sessionId}/url`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "about:blank" }),
  });
  await callWebDriver(webdriverUrl, `/session/${sessionId}`, { method: "DELETE" });

  const finishedAt = new Date().toISOString();
  const result: DriverSmokeResult = {
    target_id: target.target_id,
    driver_id: target.driver_id,
    started_at: startedAt,
    finished_at: finishedAt,
    ok: true,
    detail: `tauri webdriver smoke passed (provider=${webdriverProvider})`,
    artifacts: { report_path: reportPath, log_path: null },
    metrics: {
      webdriver_url: webdriverUrl,
      webdriver_provider: webdriverProvider,
      app_path: appPath,
      session_id: sessionId,
    },
  };
  await writeFile(reportPath, JSON.stringify(result, null, 2), "utf-8");
  return result;
}
