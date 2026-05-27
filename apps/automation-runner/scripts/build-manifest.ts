import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { RunManifest, TargetPlatform, TargetProfile } from "./manifest-protocol.js";

const runtimeCacheRootOverride =
  (process.env.UIQ_RUNTIME_CACHE_ROOT ?? process.env.UIQ_MCP_RUNTIME_CACHE_ROOT ?? "").trim();
const runtimeCacheRoot = runtimeCacheRootOverride
  ? path.resolve(runtimeCacheRootOverride)
  : path.resolve(process.cwd(), "..", ".runtime-cache");
const RUNTIME_ROOT = path.resolve(runtimeCacheRoot, "automation");
const TARGETS_ROOT = path.resolve(process.cwd(), "..", "config", "targets");

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

function getOption(name: string): string | null {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

async function resolveTarget(): Promise<TargetProfile> {
  const targetId = getOption("target") ?? process.env.TARGET_ID ?? "web.local";
  const targetPath = path.join(TARGETS_ROOT, `${targetId}.json`);
  if (!existsSync(targetPath)) {
    return {
      target_id: targetId,
      platform: (process.env.TARGET_PLATFORM as TargetPlatform) || "web",
      driver_id: process.env.DRIVER_ID || "web-playwright",
      base_url: process.env.BASE_URL || undefined,
    };
  }
  return readJson<TargetProfile>(targetPath);
}

async function main(): Promise<void> {
  const explicitSessionId = getOption("session-id");
  let latest: { sessionId: string; sessionDir: string } | null = null;
  const resolveSession = (): { sessionId: string; sessionDir: string } => {
    if (explicitSessionId) {
      const explicitDir = path.join(RUNTIME_ROOT, explicitSessionId);
      if (!existsSync(explicitDir)) {
        throw new Error(`session not found: ${explicitDir}`);
      }
      const explicitFlow = path.join(explicitDir, "flow-draft.json");
      if (!existsSync(explicitFlow)) {
        throw new Error(`session has no flow-draft.json: ${explicitDir}`);
      }
      return { sessionId: explicitSessionId, sessionDir: explicitDir };
    }

    latest ??= JSON.parse(
      readFileSync(path.join(RUNTIME_ROOT, "latest-session.json"), "utf-8")
    ) as { sessionId: string; sessionDir: string };
    const pointerSessionId = latest.sessionId;
    const pointerSessionDir = latest.sessionDir;
    const pointerFlow = path.join(pointerSessionDir, "flow-draft.json");
    if (pointerSessionId && existsSync(pointerSessionDir) && existsSync(pointerFlow)) {
      return { sessionId: pointerSessionId, sessionDir: pointerSessionDir };
    }

    if (!existsSync(RUNTIME_ROOT)) {
      throw new Error(`runtime root not found: ${RUNTIME_ROOT}`);
    }

    const fallback = readdirSync(RUNTIME_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const dir = path.join(RUNTIME_ROOT, entry.name);
        const flowPath = path.join(dir, "flow-draft.json");
        if (!existsSync(flowPath)) {
          return null;
        }
        const stat = statSync(flowPath);
        return { sessionId: entry.name, sessionDir: dir, mtimeMs: stat.mtimeMs };
      })
      .filter((item): item is { sessionId: string; sessionDir: string; mtimeMs: number } => item !== null)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];

    if (!fallback) {
      throw new Error("no usable session with flow-draft.json found under .runtime-cache/automation");
    }
    return { sessionId: fallback.sessionId, sessionDir: fallback.sessionDir };
  };

  const { sessionId, sessionDir } = resolveSession();
  if (!existsSync(sessionDir)) {
    throw new Error(`session directory not found: ${sessionDir}`);
  }
  const target = await resolveTarget();

  const flowDraftPath = path.join(sessionDir, "flow-draft.json");
  const harPath = path.join(sessionDir, "register.har");
  const htmlPath = path.join(sessionDir, "source.html");
  const videoDir = path.join(sessionDir, "video");
  const replayResultPath = path.join(sessionDir, "replay-flow-result.json");

  let stepTotal = 0;
  let failedSteps = 0;
  if (existsSync(replayResultPath)) {
    const replay = await readJson<{ stepResults?: Array<{ ok?: boolean }> }>(replayResultPath);
    const list = replay.stepResults ?? [];
    stepTotal = list.length;
    failedSteps = list.filter((item) => item.ok === false).length;
  }

  const manifest: RunManifest = {
    run_id: sessionId,
    generated_at: new Date().toISOString(),
    target,
    artifacts: {
      session_dir: sessionDir,
      flow_draft_path: existsSync(flowDraftPath) ? flowDraftPath : null,
      har_path: existsSync(harPath) ? harPath : null,
      html_path: existsSync(htmlPath) ? htmlPath : null,
      video_dir: existsSync(videoDir) ? videoDir : null,
      replay_result_path: existsSync(replayResultPath) ? replayResultPath : null,
    },
    summary: {
      step_total: stepTotal,
      failed_steps: failedSteps,
      has_flow_draft: existsSync(flowDraftPath),
      has_har: existsSync(harPath),
      has_html: existsSync(htmlPath),
      has_video: existsSync(videoDir),
    },
  };

  const manifestPath = path.join(sessionDir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  process.stdout.write(`${JSON.stringify({ manifestPath, runId: sessionId }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`build-manifest failed: ${message}\n`);
  process.exitCode = 1;
});
