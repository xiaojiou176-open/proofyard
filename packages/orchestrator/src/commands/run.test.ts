import assert from "node:assert/strict"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { loadProfileConfig, loadTargetConfig } from "./run.js"

const PROFILE_FIXTURE_DIR = resolve(process.cwd(), "configs", "profiles")
const TARGET_FIXTURE_DIR = resolve(process.cwd(), "configs", "targets")

test("loadProfileConfig rejects traversal and path-like names", () => {
  assert.throws(() => loadProfileConfig("../x"), /Invalid profile/i)
  assert.throws(() => loadProfileConfig("/tmp/x"), /Invalid profile/i)
  assert.throws(() => loadProfileConfig("a/b"), /Invalid profile/i)
})

test("loadTargetConfig rejects traversal and path-like names", () => {
  assert.throws(() => loadTargetConfig("../x"), /Invalid target/i)
  assert.throws(() => loadTargetConfig("/tmp/x"), /Invalid target/i)
  assert.throws(() => loadTargetConfig("a/b"), /Invalid target/i)
})

test("loadProfileConfig rejects unknown top-level keys", () => {
  const fixtureName = `tmp-profile-${Date.now()}-${Math.random().toString(16).slice(2)}`
  mkdirSync(PROFILE_FIXTURE_DIR, { recursive: true })
  const file = resolve(PROFILE_FIXTURE_DIR, `${fixtureName}.yaml`)
  writeFileSync(
    file,
    [
      "name: pr",
      "steps:",
      "  - report",
      "gates:",
      "  consoleErrorMax: 0",
      "unexpectedFlag: true",
    ].join("\n"),
    "utf8"
  )
  try {
    assert.throws(() => loadProfileConfig(fixtureName), /unknown key 'unexpectedFlag'/i)
  } finally {
    rmSync(file, { force: true })
  }
})

test("loadTargetConfig rejects web target missing scope.domains", () => {
  const fixtureName = `tmp-target-${Date.now()}-${Math.random().toString(16).slice(2)}`
  mkdirSync(TARGET_FIXTURE_DIR, { recursive: true })
  const file = resolve(TARGET_FIXTURE_DIR, `${fixtureName}.yaml`)
  writeFileSync(
    file,
    [
      `name: ${fixtureName}`,
      "type: web",
      "driver: web-playwright",
      "baseUrl: http://127.0.0.1:4173",
    ].join("\n"),
    "utf8"
  )
  try {
    assert.throws(() => loadTargetConfig(fixtureName), /scope\.domains/i)
  } finally {
    rmSync(file, { force: true })
  }
})

test("loadProfileConfig rejects invalid explore.engine", () => {
  const fixtureName = `tmp-profile-explore-engine-${Date.now()}-${Math.random().toString(16).slice(2)}`
  mkdirSync(PROFILE_FIXTURE_DIR, { recursive: true })
  const file = resolve(PROFILE_FIXTURE_DIR, `${fixtureName}.yaml`)
  writeFileSync(
    file,
    [
      "name: pr",
      "steps:",
      "  - report",
      "gates:",
      "  consoleErrorMax: 0",
      "explore:",
      "  engine: invalid_engine",
    ].join("\n"),
    "utf8"
  )
  try {
    assert.throws(() => loadProfileConfig(fixtureName), /explore\.engine must be builtin\|crawlee/i)
  } finally {
    rmSync(file, { force: true })
  }
})

test("loadProfileConfig rejects invalid visual.engine", () => {
  const fixtureName = `tmp-profile-visual-engine-${Date.now()}-${Math.random().toString(16).slice(2)}`
  mkdirSync(PROFILE_FIXTURE_DIR, { recursive: true })
  const file = resolve(PROFILE_FIXTURE_DIR, `${fixtureName}.yaml`)
  writeFileSync(
    file,
    [
      "name: pr",
      "steps:",
      "  - report",
      "gates:",
      "  consoleErrorMax: 0",
      "visual:",
      "  engine: invalid_engine",
    ].join("\n"),
    "utf8"
  )
  try {
    assert.throws(
      () => loadProfileConfig(fixtureName),
      /visual\.engine must be builtin\|lostpixel\|backstop/i
    )
  } finally {
    rmSync(file, { force: true })
  }
})

test("loadProfileConfig rejects invalid aiReview.severityThreshold", () => {
  const fixtureName = `tmp-profile-ai-review-${Date.now()}-${Math.random().toString(16).slice(2)}`
  mkdirSync(PROFILE_FIXTURE_DIR, { recursive: true })
  const file = resolve(PROFILE_FIXTURE_DIR, `${fixtureName}.yaml`)
  writeFileSync(
    file,
    [
      "name: pr",
      "steps:",
      "  - report",
      "gates:",
      "  consoleErrorMax: 0",
      "aiReview:",
      "  enabled: true",
      "  severityThreshold: impossible",
    ].join("\n"),
    "utf8"
  )
  try {
    assert.throws(
      () => loadProfileConfig(fixtureName),
      /aiReview\.severityThreshold must be critical\|high\|medium\|low/i
    )
  } finally {
    rmSync(file, { force: true })
  }
})

test("loadProfileConfig rejects invalid enginePolicy.required entries", () => {
  const fixtureName = `tmp-profile-engine-policy-${Date.now()}-${Math.random().toString(16).slice(2)}`
  mkdirSync(PROFILE_FIXTURE_DIR, { recursive: true })
  const file = resolve(PROFILE_FIXTURE_DIR, `${fixtureName}.yaml`)
  writeFileSync(
    file,
    [
      "name: pr",
      "steps:",
      "  - report",
      "gates:",
      "  consoleErrorMax: 0",
      "enginePolicy:",
      "  required:",
      "    - unknown_engine",
      "  failOnBlocked: true",
    ].join("\n"),
    "utf8"
  )
  try {
    assert.throws(
      () => loadProfileConfig(fixtureName),
      /enginePolicy\.required must contain crawlee\|lostpixel\|backstop\|semgrep\|k6/i
    )
  } finally {
    rmSync(file, { force: true })
  }
})

test("loadProfileConfig rejects gemini threshold config without sample size", () => {
  const fixtureName = `tmp-profile-gemini-threshold-${Date.now()}-${Math.random().toString(16).slice(2)}`
  mkdirSync(PROFILE_FIXTURE_DIR, { recursive: true })
  const file = resolve(PROFILE_FIXTURE_DIR, `${fixtureName}.yaml`)
  writeFileSync(
    file,
    [
      "name: pr",
      "steps:",
      "  - report",
      "gates:",
      "  consoleErrorMax: 0",
      "geminiAccuracyMin: 0.9",
    ].join("\n"),
    "utf8"
  )
  try {
    assert.throws(() => loadProfileConfig(fixtureName), /geminiSampleSizeMin is required/i)
  } finally {
    rmSync(file, { force: true })
  }
})

test("loadTargetConfig rejects invalid geminiParallelConsistencyMin range", () => {
  const fixtureName = `tmp-target-gemini-range-${Date.now()}-${Math.random().toString(16).slice(2)}`
  mkdirSync(TARGET_FIXTURE_DIR, { recursive: true })
  const file = resolve(TARGET_FIXTURE_DIR, `${fixtureName}.yaml`)
  writeFileSync(
    file,
    [
      `name: ${fixtureName}`,
      "type: web",
      "driver: web-playwright",
      "baseUrl: http://127.0.0.1:4173",
      "scope:",
      "  domains:",
      "    - http://127.0.0.1:4173",
      "geminiParallelConsistencyMin: 1.2",
      "geminiSampleSizeMin: 10",
    ].join("\n"),
    "utf8"
  )
  try {
    assert.throws(() => loadTargetConfig(fixtureName), /target\.geminiParallelConsistencyMin/i)
  } finally {
    rmSync(file, { force: true })
  }
})
