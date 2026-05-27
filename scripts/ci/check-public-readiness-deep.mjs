#!/usr/bin/env node

import { execFileSync } from "node:child_process"

const commands = [
  { command: "bash", args: ["scripts/docs-gate.sh"] },
  { command: "node", args: ["scripts/ci/check-public-collaboration-english.mjs"] },
  { command: "node", args: ["scripts/ci/check-repo-sensitive-surface.mjs"] },
  { command: "node", args: ["scripts/ci/check-repo-sensitive-history.mjs"] },
  { command: "node", args: ["scripts/ci/check-repo-high-signal-pii.mjs"] },
  { command: "node", args: ["scripts/ci/check-public-redaction.mjs"] },
  { command: "node", args: ["scripts/ci/check-history-sensitive-surface.mjs"] },
  { command: "node", args: ["scripts/ci/check-tracked-heavy-artifacts.mjs"] },
  { command: "node", args: ["scripts/ci/check-skill-surface-contract.mjs"] },
  {
    command: "bash",
    args: ["scripts/ci/check-oss-redaction-tooling.sh"],
    env: { UIQ_OSS_AUDIT_STRICT: "true" },
  },
]

for (const { command, args, env } of commands) {
  execFileSync(command, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(env ?? {}),
    },
  })
}

console.log("[public-readiness-deep] ok")
