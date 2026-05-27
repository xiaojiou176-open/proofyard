import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"
import type { ComputerUseExecutionResult } from "../../computer-use.js"
import type { ProfileConfig, TargetConfig } from "../run-types.js"
import { createInitialPipelineStageState, executePipelineStages } from "./stage-execution.js"

function baseProfile(): ProfileConfig {
  return {
    name: "pr",
    steps: ["computer_use"],
    gates: {
      consoleErrorMax: 0,
      pageErrorMax: 0,
      http5xxMax: 0,
    },
  }
}

function baseTarget(): TargetConfig {
  return {
    name: "web.ci",
    type: "web",
    driver: "web-playwright",
    baseUrl: "http://127.0.0.1:4173",
    scope: {
      domains: ["http://127.0.0.1:4173"],
    },
  }
}

function failedComputerUseResult(): ComputerUseExecutionResult {
  return {
    status: "failed",
    reason: "ai.gemini.computer_use.max_steps_exceeded",
    exitCode: 1,
    command: "python3",
    args: [],
    scriptPath: "scripts/computer-use/gemini-computer-use.py",
    stdoutTail: "",
    stderrTail: "failed",
    computerUseSafetyConfirmations: 1,
    safetyConfirmationEvidence: {
      events: [{ action: "submit", gateDecision: "blocked" }],
    },
    error: "failed",
  }
}

test("executePipelineStages writes blocked step when computer_use task is missing", async () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-stage-computer-use-blocked-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    const blocked: Array<{ stepId: string; detail: string; reasonCode?: string }> = []
    const state = createInitialPipelineStageState("reports/runtime.json")
    await executePipelineStages(
      {
        baseDir,
        profile: baseProfile(),
        target: baseTarget(),
        overrides: undefined,
        isWebTarget: true,
        effectiveBaseUrl: "http://127.0.0.1:4173",
        effectiveApp: undefined,
        effectiveBundleId: undefined,
        unsupportedSteps: new Set(),
        maxParallelTasks: 1,
        stateModel: { configuredRoutes: [], configuredStories: [], configuredTotal: 0 } as never,
        stepRequested: (stepId) => stepId === "computer_use",
        recordBlockedStep: (stepId, detail, options) => {
          blocked.push({ stepId, detail, reasonCode: options?.reasonCode })
        },
        runStage: async (_stageId, task) => task(),
        ensureRuntimeReady: async () => undefined,
        ensureRuntimeReadySerialized: async () => undefined,
        runTestSuite: async () => {
          throw new Error("not expected")
        },
        runComputerUse: () => failedComputerUseResult(),
      },
      state
    )

    assert.equal(blocked.length, 1)
    assert.equal(blocked[0]?.stepId, "computer_use")
    assert.equal(blocked[0]?.reasonCode, "gate.scenario_computer_use.blocked.task_missing")
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("executePipelineStages persists computer-use report and safety evidence", async () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-stage-computer-use-report-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    const state = createInitialPipelineStageState("reports/runtime.json")
    await executePipelineStages(
      {
        baseDir,
        profile: {
          ...baseProfile(),
          computerUse: {
            task: "open dashboard",
          },
        },
        target: baseTarget(),
        overrides: undefined,
        isWebTarget: true,
        effectiveBaseUrl: "http://127.0.0.1:4173",
        effectiveApp: undefined,
        effectiveBundleId: undefined,
        unsupportedSteps: new Set(),
        maxParallelTasks: 1,
        stateModel: { configuredRoutes: [], configuredStories: [], configuredTotal: 0 } as never,
        stepRequested: (stepId) => stepId === "computer_use",
        recordBlockedStep: () => {
          throw new Error("not expected")
        },
        runStage: async (_stageId, task) => task(),
        ensureRuntimeReady: async () => undefined,
        ensureRuntimeReadySerialized: async () => undefined,
        runTestSuite: async () => {
          throw new Error("not expected")
        },
        runComputerUse: () => failedComputerUseResult(),
      },
      state
    )

    assert.equal(state.generatedReports.computerUse, "reports/computer-use.json")
    assert.equal(state.computerUseSafetyConfirmations, 1)
    assert.deepEqual(state.computerUseSafetyConfirmationEvidence?.events, [
      { action: "submit", gateDecision: "blocked" },
    ])
    const persisted = JSON.parse(
      readFileSync(resolve(baseDir, "reports/computer-use.json"), "utf8")
    ) as {
      reason: string
      computerUseSafetyConfirmations: number
    }
    assert.equal(persisted.reason, "ai.gemini.computer_use.max_steps_exceeded")
    assert.equal(persisted.computerUseSafetyConfirmations, 1)
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("executePipelineStages uses serialized runtime readiness for capture stage", async () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-stage-capture-serialized-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    const state = createInitialPipelineStageState("reports/runtime.json")
    let ensureRuntimeReadyCalled = false
    let ensureRuntimeReadySerializedCalled = false
    await assert.rejects(
      executePipelineStages(
        {
          baseDir,
          profile: {
            name: "capture-only",
            steps: ["capture"],
            gates: {
              consoleErrorMax: 0,
              pageErrorMax: 0,
              http5xxMax: 0,
            },
          },
          target: baseTarget(),
          overrides: undefined,
          isWebTarget: true,
          effectiveBaseUrl: "http://127.0.0.1:4173",
          effectiveApp: undefined,
          effectiveBundleId: undefined,
          unsupportedSteps: new Set(),
          maxParallelTasks: 1,
          stateModel: { configuredRoutes: [], configuredStories: [], configuredTotal: 0 } as never,
          stepRequested: (stepId) => stepId === "capture",
          recordBlockedStep: () => {
            throw new Error("not expected")
          },
          runStage: async (_stageId, task) => task(),
          ensureRuntimeReady: async () => {
            ensureRuntimeReadyCalled = true
            throw new Error("legacy ensureRuntimeReady should not be called")
          },
          ensureRuntimeReadySerialized: async () => {
            ensureRuntimeReadySerializedCalled = true
            throw new Error("serialized ensureRuntimeReady called")
          },
          runTestSuite: async () => {
            throw new Error("not expected")
          },
          runComputerUse: () => failedComputerUseResult(),
        },
        state
      ),
      /serialized ensureRuntimeReady called/
    )

    assert.equal(ensureRuntimeReadyCalled, false)
    assert.equal(ensureRuntimeReadySerializedCalled, true)
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})
