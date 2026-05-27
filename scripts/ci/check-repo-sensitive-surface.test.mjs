import test from "node:test"
import assert from "node:assert/strict"
import {
  findTrackedSensitiveContentMatch,
  isTrackedSensitiveExcludedPath,
} from "./lib/tracked-sensitive-rules.mjs"

test("flags absolute macOS home paths", () => {
  const fakePath = ["", "Users", "alice", "Documents", "webaudit"].join("/")
  const match = findTrackedSensitiveContentMatch(
    `legacyRoot = "${fakePath}"`
  )
  assert.equal(match?.ruleId, "absolute-macos-user-path")
  assert.equal(match?.line, 1)
})

test("allows scrubbed bearer placeholders", () => {
  const match = findTrackedSensitiveContentMatch("Authorization: Bearer SCRUBBED_TOKEN")
  assert.equal(match, null)
})

test("flags raw bearer tokens", () => {
  const match = findTrackedSensitiveContentMatch("Authorization: Bearer live_token_123456")
  assert.equal(match?.ruleId, "bearer-token")
})

test("excludes detector definition files from repo-wide scans", () => {
  assert.equal(isTrackedSensitiveExcludedPath("scripts/ci/check-public-redaction.mjs"), true)
  assert.equal(isTrackedSensitiveExcludedPath("scripts/ci/check-repo-identity-drift.mjs"), false)
})
