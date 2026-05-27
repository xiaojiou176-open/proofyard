import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

type DetectionReport = {
  generated_at: string;
  tauri: {
    binary_candidates: string[];
    app_bundle_candidates: string[];
    suggestion: string | null;
  };
  swift: {
    xcodeproj_candidates: string[];
    xcworkspace_candidates: string[];
    suggestion: {
      project_or_workspace: string | null;
      scheme_hint: string | null;
    };
  };
};

const ROOT = path.resolve(process.cwd(), "..");
const PARENT = path.resolve(ROOT, "..");

async function findCandidates(base: string, matcher: (name: string) => boolean, depth = 5): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, currentDepth: number): Promise<void> {
    if (currentDepth > depth) {
      return;
    }
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = (await readdir(dir, { withFileTypes: true })) as unknown as Array<{
        name: string;
        isDirectory: () => boolean;
      }>;
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.name.startsWith(".git") || entry.name === "node_modules" || entry.name === ".runtime-cache") {
        continue;
      }
      if (matcher(entry.name)) {
        out.push(full);
      }
      if (entry.isDirectory()) {
        await walk(full, currentDepth + 1);
      }
    }
  }
  await walk(base, 0);
  return out;
}

async function main(): Promise<void> {
  const scanRoots = [ROOT, PARENT];
  const tauriBinaryCandidates = (
    await Promise.all(scanRoots.map((base) => findCandidates(base, (name) => name === "terry-desktop" || name === "tauri", 6)))
  )
    .flat()
    .filter((candidate) => candidate.includes("/target/debug/") || candidate.includes("/target/release/"));
  const tauriAppCandidates = (await Promise.all(scanRoots.map((base) => findCandidates(base, (name) => name.endsWith(".app"), 5)))).flat();
  const xcodeprojCandidates = (await Promise.all(scanRoots.map((base) => findCandidates(base, (name) => name.endsWith(".xcodeproj"), 6)))).flat();
  const xcworkspaceCandidates = (
    await Promise.all(scanRoots.map((base) => findCandidates(base, (name) => name.endsWith(".xcworkspace"), 6)))
  ).flat();

  const report: DetectionReport = {
    generated_at: new Date().toISOString(),
    tauri: {
      binary_candidates: tauriBinaryCandidates,
      app_bundle_candidates: tauriAppCandidates,
      suggestion: tauriBinaryCandidates[0] || tauriAppCandidates[0] || null,
    },
    swift: {
      xcodeproj_candidates: xcodeprojCandidates,
      xcworkspace_candidates: xcworkspaceCandidates,
      suggestion: {
        project_or_workspace: xcodeprojCandidates[0] || xcworkspaceCandidates[0] || null,
        scheme_hint: process.env.XCUITEST_SCHEME || null,
      },
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (!existsSync(path.join(ROOT, "targets", "tauri.macos.yaml"))) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`detect-driver-targets failed: ${message}\n`);
  process.exitCode = 1;
});
