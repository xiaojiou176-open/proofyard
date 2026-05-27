import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"
import { runExploreWithCrawleeBridge } from "../../../probes/explore-crawlee/src/index.js"
import { runVisualWithBackstopBridge } from "../../../probes/visual-backstop/src/index.js"
import { runVisualWithLostPixelBridge } from "../../../probes/visual-lostpixel/src/index.js"

function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(resolve(tmpdir(), "uiq-adapter-"))
  const done = Promise.resolve(fn(dir))
  return done.finally(() => {
    rmSync(dir, { recursive: true, force: true })
  })
}

test("explore crawlee adapter either blocks with canonical reasonCode or delegates to builtin fallback", async () => {
  await withTempDir(async (dir) => {
    let fallbackCalls = 0
    let forwardedEngine: "builtin" | "crawlee" | undefined
    const fallback = async (
      _baseDir: string,
      options: {
        baseUrl: string
        budgetSeconds: number
        maxDepth: number
        maxStates: number
        denylist: string[]
        denyStrategy: {
          lexical: string[]
          roles: string[]
          selectors: string[]
          urlPatterns: string[]
        }
        seed?: number
        engine?: "builtin" | "crawlee"
      }
    ) => {
      fallbackCalls += 1
      forwardedEngine = options.engine
      return {
        discoveredStates: 1,
        maxDepthReached: 0,
        crashCount: 0,
        consoleErrorCount: 0,
        http5xxCount: 0,
        dangerousActionHits: 0,
        visitedStateKeys: 1,
        pageErrors: [],
        consoleErrors: [],
        http5xxUrls: [],
        states: [],
        effectiveConfig: {
          budgetSeconds: options.budgetSeconds,
          maxDepth: options.maxDepth,
          maxStates: options.maxStates,
          denylist: options.denylist,
          denyStrategy: options.denyStrategy,
          engine: "builtin" as const,
        },
        diagnostics: {
          replayMetadata: {
            seed: options.seed ?? 20260218,
            timezone: "UTC",
            locale: "en-US",
            animationPolicy: "disabled" as const,
            reducedMotion: "reduce" as const,
            replayPath: "logs/explore-replay.json",
          },
          flakyRiskMitigations: ["test-fallback"],
        },
        executionStatus: "ok" as const,
        engineUsed: "builtin" as const,
        blockedReasonCode: undefined,
        blockedDetail: undefined,
        reportPath: "reports/explore.json",
      }
    }
    const result = await runExploreWithCrawleeBridge(
      dir,
      {
        engine: "crawlee",
        baseUrl: "http://127.0.0.1:4173",
        budgetSeconds: 5,
        maxDepth: 1,
        maxStates: 1,
        seed: 123,
        denylist: [],
        denyStrategy: { lexical: [], roles: [], selectors: [], urlPatterns: [] },
      },
      fallback
    )
    assert.equal(result.engineUsed, "crawlee")
    const persisted = JSON.parse(readFileSync(resolve(dir, result.reportPath), "utf8"))
    assert.equal(persisted.engineUsed, "crawlee")
    if (result.executionStatus === "blocked") {
      assert.equal(fallbackCalls, 0)
      assert.equal(result.blockedReasonCode, "gate.explore_engine.blocked.crawlee_not_available")
      assert.equal(persisted.blockedReasonCode, "gate.explore_engine.blocked.crawlee_not_available")
    } else {
      assert.equal(fallbackCalls, 1)
      assert.equal(forwardedEngine, "builtin")
      assert.equal(result.blockedReasonCode, undefined)
      assert.equal(result.effectiveConfig.engine, "crawlee")
      assert.equal(result.diagnostics.adapter, "crawlee-bridge")
      assert.equal(persisted.executionStatus, "ok")
      assert.equal(persisted.blockedReasonCode, undefined)
    }
  })
})

test("visual lostpixel adapter either blocks with canonical reasonCode or delegates to builtin fallback", async () => {
  await withTempDir(async (dir) => {
    let fallbackCalls = 0
    let forwardedEngine: "builtin" | "lostpixel" | "backstop" | undefined
    const fallback = async (
      _baseDir: string,
      config: {
        baseUrl: string
        targetName: string
        mode: "diff" | "update"
        baselineDir?: string
        maxDiffPixels?: number
        engine?: "builtin" | "lostpixel" | "backstop"
      }
    ) => {
      fallbackCalls += 1
      forwardedEngine = config.engine
      return {
        engine: "builtin-png-diff" as const,
        engineUsed: "builtin" as const,
        executionStatus: "ok" as const,
        blockedReasonCode: undefined,
        blockedDetail: undefined,
        url: config.baseUrl,
        mode: config.mode,
        baselineCreated: false,
        baselinePath: "/tmp/baseline.png",
        currentPath: "visual/current/home_default.png",
        diffPath: "visual/diff/home_default.png",
        diffPixels: 0,
        totalPixels: 1,
        diffRatio: 0,
        reportPath: "visual/report.json",
      }
    }
    const result = await runVisualWithLostPixelBridge(
      dir,
      {
        engine: "lostpixel",
        baseUrl: "http://127.0.0.1:4173",
        targetName: "web.local",
        mode: "diff",
      },
      fallback
    )
    assert.equal(result.engineUsed, "lostpixel")
    const persisted = JSON.parse(readFileSync(resolve(dir, result.reportPath), "utf8"))
    assert.equal(persisted.engineUsed, "lostpixel")
    if (result.executionStatus === "blocked") {
      assert.equal(fallbackCalls, 0)
      assert.equal(result.blockedReasonCode, "gate.visual_engine.blocked.lostpixel_not_available")
      assert.equal(
        persisted.blockedReasonCode,
        "gate.visual_engine.blocked.lostpixel_not_available"
      )
    } else {
      assert.equal(fallbackCalls, 1)
      assert.equal(forwardedEngine, "builtin")
      assert.equal(result.blockedReasonCode, undefined)
      assert.equal(result.engine, "lostpixel-bridge")
      assert.equal(persisted.executionStatus, "ok")
      assert.equal(persisted.blockedReasonCode, undefined)
    }
  })
})

test("visual backstop adapter either blocks with canonical reasonCode or delegates to builtin fallback", async () => {
  await withTempDir(async (dir) => {
    let fallbackCalls = 0
    let forwardedEngine: "builtin" | "lostpixel" | "backstop" | undefined
    const fallback = async (
      _baseDir: string,
      config: {
        baseUrl: string
        targetName: string
        mode: "diff" | "update"
        baselineDir?: string
        maxDiffPixels?: number
        engine?: "builtin" | "lostpixel" | "backstop"
      }
    ) => {
      fallbackCalls += 1
      forwardedEngine = config.engine
      return {
        engine: "builtin-png-diff" as const,
        engineUsed: "builtin" as const,
        executionStatus: "ok" as const,
        blockedReasonCode: undefined,
        blockedDetail: undefined,
        url: config.baseUrl,
        mode: config.mode,
        baselineCreated: false,
        baselinePath: "/tmp/baseline.png",
        currentPath: "visual/current/home_default.png",
        diffPath: "visual/diff/home_default.png",
        diffPixels: 0,
        totalPixels: 1,
        diffRatio: 0,
        reportPath: "visual/report.json",
      }
    }
    const result = await runVisualWithBackstopBridge(
      dir,
      {
        engine: "backstop",
        baseUrl: "http://127.0.0.1:4173",
        targetName: "web.local",
        mode: "diff",
      },
      fallback
    )
    assert.equal(result.engineUsed, "backstop")
    const persisted = JSON.parse(readFileSync(resolve(dir, result.reportPath), "utf8"))
    assert.equal(persisted.engineUsed, "backstop")
    if (result.executionStatus === "blocked") {
      assert.equal(fallbackCalls, 0)
      assert.equal(result.blockedReasonCode, "gate.visual_engine.blocked.backstop_not_available")
      assert.equal(persisted.blockedReasonCode, "gate.visual_engine.blocked.backstop_not_available")
    } else {
      assert.equal(fallbackCalls, 1)
      assert.equal(forwardedEngine, "builtin")
      assert.equal(result.blockedReasonCode, undefined)
      assert.equal(result.engine, "backstop-bridge")
      assert.equal(persisted.executionStatus, "ok")
      assert.equal(persisted.blockedReasonCode, undefined)
    }
  })
})
