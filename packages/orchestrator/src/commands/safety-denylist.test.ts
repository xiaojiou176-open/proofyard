import assert from "node:assert/strict"
import test from "node:test"
import { resolveExploreConfig } from "./run/run-resolve.js"
import type { ProfileConfig, TargetConfig } from "./run/run-types.js"
import { buildDenyRegex } from "./safety-denylist.js"

test("buildDenyRegex blocks dangerous actions while avoiding substring false positives", () => {
  const regex = buildDenyRegex(["delete", "pay", "submit", "转账"])

  assert.equal(regex.test("delete account"), true)
  assert.equal(regex.test("pay now"), true)
  assert.equal(regex.test("please submit order"), true)
  assert.equal(regex.test("确认转账"), true)

  assert.equal(regex.test("repayment plan"), false)
  assert.equal(regex.test("submission draft"), false)
})

test("buildDenyRegex enforces word boundaries for ASCII tokens", () => {
  const regex = buildDenyRegex(["run"])
  assert.equal(regex.test("run smoke checks"), true)
  assert.equal(regex.test("runner status"), false)
})

test("resolveExploreConfig default danger denylist keeps destructive terms and removes broad exploration verbs", () => {
  const target: TargetConfig = {
    name: "local",
    type: "web",
    driver: "web-playwright",
    baseUrl: "http://127.0.0.1:4173",
    scope: { domains: ["127.0.0.1"] },
  }
  const profile: ProfileConfig = {
    name: "nightly",
    steps: ["capture", "explore", "report"],
  }

  const resolved = resolveExploreConfig(target, profile)

  assert.ok(resolved.denylist.includes("delete"))
  assert.ok(resolved.denylist.includes("pay"))
  assert.ok(resolved.denylist.includes("transfer"))
  assert.ok(resolved.denylist.includes("转账"))
  assert.ok(resolved.denylist.includes("提交"))

  assert.equal(resolved.denylist.includes("run"), false)
  assert.equal(resolved.denylist.includes("execute"), false)
  assert.equal(resolved.denylist.includes("replay"), false)
  assert.equal(resolved.denylist.includes("执行"), false)
  assert.equal(resolved.denylist.includes("回放"), false)
})
