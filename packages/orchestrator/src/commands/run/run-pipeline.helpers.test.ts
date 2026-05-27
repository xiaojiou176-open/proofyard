import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"

import {
  argsForSuite,
  computeIsolatedCtPort,
  loadProviderPolicySnapshot,
  parseProviderPolicyValue,
  resolveAiFixMaxIterations,
  resolveAiProvider,
  resolveMaxParallelTasks,
  tailCommandOutput,
} from "./run-pipeline.js"

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    fn()
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test("run-pipeline helper env parsing covers max parallel and fix iterations", () => {
  withEnv(
    {
      UIQ_ORCHESTRATOR_PARALLEL: "0",
      UIQ_ORCHESTRATOR_MAX_PARALLEL_TASKS: "9",
      AI_FIX_MAX_ITERATIONS: "7",
    },
    () => {
      assert.equal(resolveMaxParallelTasks(), 1)
      assert.equal(resolveAiFixMaxIterations(), 7)
    }
  )

  withEnv(
    {
      UIQ_ORCHESTRATOR_PARALLEL: "1",
      UIQ_ORCHESTRATOR_MAX_PARALLEL_TASKS: "not-a-number",
      AI_FIX_MAX_ITERATIONS: "-1",
    },
    () => {
      assert.equal(resolveMaxParallelTasks() >= 1, true)
      assert.equal(resolveAiFixMaxIterations(), 0)
    }
  )
})

test("run-pipeline helper suite args, output tail and ct port are deterministic", () => {
  assert.deepEqual(argsForSuite("unit", "smoke"), ["test:unit"])
  assert.deepEqual(argsForSuite("contract", "smoke"), ["test:contract"])
  assert.deepEqual(argsForSuite("ct", "regression"), ["test:ct"])
  assert.deepEqual(argsForSuite("e2e", "smoke"), ["test:e2e", "--grep", "@smoke"])
  assert.deepEqual(argsForSuite("e2e", "regression"), ["test:e2e", "--grep", "@regression"])
  assert.deepEqual(argsForSuite("e2e", "full"), ["test:e2e"])

  assert.equal(tailCommandOutput("a\nb\nc", 2), "b\nc")
  assert.equal(computeIsolatedCtPort("/tmp/a") === computeIsolatedCtPort("/tmp/a"), true)
  assert.equal(computeIsolatedCtPort("/tmp/a") !== computeIsolatedCtPort("/tmp/b"), true)
})

test("run-pipeline provider policy helpers parse yaml-ish text and env overrides", () => {
  const parsed = parseProviderPolicyValue(`
# comment
provider: gemini
primary: gemini
fallback: none
fallbackMode: strict
`)
  assert.deepEqual(parsed, {
    provider: "gemini",
    primary: "gemini",
    fallback: "none",
    fallbackMode: "strict",
  })

  const dir = mkdtempSync(resolve(tmpdir(), "uiq-provider-policy-"))
  try {
    const policyPath = resolve(dir, "provider-policy.yaml")
    writeFileSync(
      policyPath,
      [
        "provider: legacy-provider",
        "primary: legacy-provider",
        "fallback: gemini",
        "fallbackMode: permissive",
      ].join("\n"),
      "utf8"
    )

    withEnv(
      {
        PROVIDER_POLICY_PATH: policyPath,
        AI_PROVIDER: undefined,
      },
      () => {
        const snapshot = loadProviderPolicySnapshot()
        assert.equal(snapshot.provider, "legacy-provider")
        assert.equal(snapshot.primary, "legacy-provider")
        assert.equal(snapshot.fallback, "gemini")
        assert.equal(snapshot.strictNoFallback, false)
        assert.equal(resolveAiProvider(snapshot), "legacy-provider")
      }
    )

    withEnv(
      {
        PROVIDER_POLICY_PATH: policyPath,
        AI_PROVIDER: "alt-provider",
      },
      () => {
        assert.equal(resolveAiProvider(loadProviderPolicySnapshot()), "alt-provider")
      }
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
