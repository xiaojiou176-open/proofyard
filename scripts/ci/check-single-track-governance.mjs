#!/usr/bin/env node

import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const CHECKS = [
  {
    file: "scripts/setup.sh",
    pattern: /pnpm install[^\n]*--ignore-workspace/,
    message: "repo setup must not recreate isolated installs with pnpm --ignore-workspace",
  },
  {
    file: "scripts/dev-up.sh",
    pattern: /pnpm install[^\n]*--ignore-workspace/,
    message: "dev-up must not auto-repair isolated installs with pnpm --ignore-workspace",
  },
  {
    file: "scripts/thirdparty/sync-upstream.sh",
    pattern: /\.\/\.venv\/bin\//,
    message: "legacy sync guidance must not recommend the retired root .venv",
  },
  {
    file: "scripts/ci/check-relocation-readiness.mjs",
    pattern: /linkIfPresent\("\.venv"\)/,
    message: "relocation readiness must not symlink the retired root .venv",
  },
  {
    file: "scripts/ci/uiq-pytest-truth-gate.py",
    pattern: /"\.venv"/,
    message: "pytest truth gate must not special-case the retired root .venv",
  },
  {
    file: "configs/governance/root-allowlist.json",
    pattern: /"\.venv"/,
    message: "root allowlist must not permit the retired root .venv",
  },
  {
    file: "configs/governance/runtime-live-policy.json",
    pattern: /"\.venv"/,
    message: "runtime live policy must not protect the retired root .venv",
  },
  {
    file: "scripts/runtime-gc.sh",
    pattern: /"\.venv"/,
    message: "runtime-gc safe cleanup exclusions must not advertise the retired root .venv",
  },
]

const failures = []
for (const check of CHECKS) {
  const filePath = resolve(check.file)
  const content = readFileSync(filePath, "utf8")
  if (check.pattern.test(content)) {
    failures.push(`${check.message} (${check.file})`)
  }
}

if (failures.length > 0) {
  console.error("[single-track-governance] FAILED")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log("[single-track-governance] PASS")
console.log(`[single-track-governance] checked files: ${CHECKS.map((item) => item.file).join(", ")}`)
