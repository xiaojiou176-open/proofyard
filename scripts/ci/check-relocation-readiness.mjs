#!/usr/bin/env node

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const repoRoot = process.cwd()
const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "webaudit-relocation-"))
const relocatedRoot = path.join(tempBase, "checkout")

const excludeNames = new Set([
  ".git",
  "node_modules",
  ".runtime-cache",
  ".venv",
  ".pytest_cache",
  ".ruff_cache",
  ".mypy_cache",
  ".turbo",
  "dist",
  "build",
  "coverage",
  "htmlcov",
  "mutants",
])

const steps = [
  {
    label: "identity drift",
    command: process.execPath,
    args: ["scripts/ci/check-repo-identity-drift.mjs"],
  },
  {
    label: "mainline alignment",
    command: process.execPath,
    args: ["scripts/ci/check-mainline-alignment.mjs"],
  },
  {
    label: "claim boundaries",
    command: process.execPath,
    args: ["scripts/ci/check-claim-boundaries.mjs"],
  },
  {
    label: "docs gate",
    command: "bash",
    args: ["scripts/docs-gate.sh"],
  },
]

try {
  fs.mkdirSync(relocatedRoot, { recursive: true })
  copyTree(repoRoot, relocatedRoot)
  linkIfPresent(".git")
  linkIfPresent("node_modules")

  for (const step of steps) {
    const result = spawnSync(step.command, step.args, {
      cwd: relocatedRoot,
      encoding: "utf8",
      env: process.env,
      stdio: "pipe",
    })
    if (result.status !== 0) {
      const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim()
      console.error(`[relocation-readiness] failed during ${step.label}`)
      if (detail) console.error(detail)
      process.exit(result.status ?? 1)
    }
  }

  console.log(`[relocation-readiness] ok (${steps.length} step(s))`)
} finally {
  fs.rmSync(tempBase, { recursive: true, force: true })
}

function copyTree(sourceRoot, targetRoot) {
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (excludeNames.has(entry.name)) continue
    const sourcePath = path.join(sourceRoot, entry.name)
    const targetPath = path.join(targetRoot, entry.name)

    if (entry.isDirectory()) {
      fs.mkdirSync(targetPath, { recursive: true })
      copyTree(sourcePath, targetPath)
      continue
    }

    if (entry.isSymbolicLink()) {
      continue
    }

    fs.copyFileSync(sourcePath, targetPath)
  }
}

function linkIfPresent(name) {
  const sourcePath = path.join(repoRoot, name)
  const targetPath = path.join(relocatedRoot, name)
  if (!fs.existsSync(sourcePath)) return
  fs.symlinkSync(sourcePath, targetPath, "junction")
}
