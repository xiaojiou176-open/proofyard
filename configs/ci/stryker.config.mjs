/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
// @ts-nocheck

import path from "node:path";
import os from "node:os";

function hasGlob(input) {
  return /[*?{}\[\]!()]/.test(input);
}

function toPosix(filePath) {
  return filePath.replace(/\\/g, "/");
}

function escapeGlobLiteral(input) {
  return input.replace(/([*?{}\[\]!()])/g, "[$1]");
}

function normalizeMutateTarget(raw, cwd) {
  const withoutRange = String(raw ?? "").split(":")[0];
  const absoluteTarget = path.isAbsolute(withoutRange)
    ? path.normalize(withoutRange)
    : path.resolve(cwd, withoutRange);
  const relativeTarget = toPosix(path.relative(cwd, absoluteTarget));
  const escapedWorkspaceRoot = escapeGlobLiteral(toPosix(cwd));

  if (!relativeTarget || relativeTarget.startsWith("..")) {
    throw new Error(
      `[mutation][ts] UIQ_TS_MUTATE_TARGET must resolve inside workspace: ${raw}`
    );
  }

  if (hasGlob(withoutRange)) {
    return `${escapedWorkspaceRoot}/${relativeTarget}`;
  }
  return `${escapedWorkspaceRoot}/${escapeGlobLiteral(relativeTarget)}`;
}

const defaultMutateTarget = "apps/mcp-server/src/core/{registry.ts,constants.ts,types.ts}";
const defaultMutationTestCommand =
  "pnpm -s tsx --test apps/mcp-server/tests/core.registry.test.ts apps/mcp-server/tests/core.constants.test.ts apps/mcp-server/tests/core.types.test.ts apps/mcp-server/tests/mcp-timeout-semantic.test.ts";
const requestedMutateTarget = process.env.UIQ_TS_MUTATE_TARGET ?? defaultMutateTarget;
const mutateTarget = normalizeMutateTarget(requestedMutateTarget, process.cwd());
const mutationTestCommand =
  process.env.UIQ_TS_MUTATION_TEST_CMD ?? defaultMutationTestCommand;
const cpuCount = os.cpus?.().length ?? 2;
const envConcurrency = Number.parseInt(process.env.UIQ_STRYKER_CONCURRENCY ?? "", 10);
const resolvedConcurrency =
  Number.isFinite(envConcurrency) && envConcurrency > 0
    ? envConcurrency
    : Math.max(1, Math.min(4, cpuCount));

const config = {
  testRunner: "command",
  commandRunner: {
    command: mutationTestCommand
  },
  allowEmpty: false,
  mutate: [mutateTarget],
  inPlace: true,
  ignorePatterns: [
    "/.venv/**/*",
    "/.runtime-cache/**/*",
    "**/*.html",
    "apps/automation-runner/**/*",
    "apps/api/**/*",
    "contracts/**/*",
    "docs/**/*",
    "apps/web/**/*",
    "packages/**/*",
    "scripts/**/*",
    "security/**/*",
    "tests/**/*",
    "apps/web/**/*"
  ],
  packageManager: "pnpm",
  htmlReporter: {
    fileName: ".runtime-cache/reports/mutation/ts/html/index.html"
  },
  jsonReporter: {
    fileName: ".runtime-cache/reports/mutation/ts/summary.json"
  },
  reporters: ["clear-text", "json", "html"],
  thresholds: {
    high: 100,
    low: 95,
    break: 100
  },
  concurrency: resolvedConcurrency,
  timeoutMS: 120000,
  tempDirName: ".runtime-cache/stryker-tmp",
  tsconfigFile: "tsconfig.stryker.json",
  disableTypeChecks: false
};

export default config;
