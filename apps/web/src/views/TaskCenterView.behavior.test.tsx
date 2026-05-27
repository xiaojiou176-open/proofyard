/* @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LogEntry, RunRecoveryPlan, Task, UniversalRun } from "../types"
import TaskCenterView from "./TaskCenterView"

vi.mock("../components/TaskListPanel", () => ({
  default: () => <div data-testid="mock-task-list-panel" />,
}))

vi.mock("../components/TerminalPanel", () => ({
  default: () => <div data-testid="mock-terminal-panel" />,
}))

const sampleTask: Task = {
  task_id: "task-123",
  command_id: "cmd-001",
  status: "failed",
  requested_by: null,
  attempt: 1,
  max_attempts: 2,
  created_at: "2026-01-01T00:00:00Z",
  started_at: "2026-01-01T00:00:00Z",
  finished_at: "2026-01-01T00:10:00Z",
  exit_code: 1,
  message: "任务执行失败",
  output_tail: "trace",
}

const sampleLogs: LogEntry[] = [
  {
    id: "log-1",
    ts: "2026-01-01T00:00:00Z",
    level: "error",
    message: "step failed",
    commandId: "cmd-001",
  },
]

const runOne: UniversalRun = {
  run_id: "run-11111111",
  template_id: "tpl-11111111",
  status: "failed",
  wait_context: null,
  step_cursor: 2,
  params: {},
  task_id: null,
  last_error: "provider timeout",
  artifacts_ref: {},
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  logs: sampleLogs,
}

const runTwo: UniversalRun = {
  ...runOne,
  run_id: "run-22222222",
  status: "running",
  last_error: null,
  logs: [],
}

const waitingOtpRun: UniversalRun = {
  ...runOne,
  run_id: "run-waiting-otp",
  status: "waiting_otp",
  wait_context: { reason_code: "otp_required" },
  logs: [],
}

const providerProtectedRun: UniversalRun = {
  ...runOne,
  run_id: "run-provider-wait",
  status: "waiting_user",
  wait_context: { reason_code: "provider_protected_payment_step" },
  logs: [],
}

const createRecoveryPlan = (overrides: Partial<RunRecoveryPlan> = {}): RunRecoveryPlan => ({
  run_id: "run-11111111",
  status: "failed",
  headline: "This run failed and needs a guided retry.",
  summary:
    "Start from the suggested replay action instead of jumping straight to raw logs or manual shell commands.",
  reason_code: null,
  primary_action: {
    action_id: "replay_latest",
    label: "Replay latest flow",
    description: "Replay latest flow",
    kind: "replay",
    step_id: null,
    requires_input: false,
    input_label: null,
    safety_level: "confirm_before_apply",
    safety_reason: "Replay stays operator-confirmed.",
  },
  actions: [
    {
      action_id: "replay_latest",
      label: "Replay latest flow",
      description: "Replay latest flow",
      kind: "replay",
      step_id: null,
      requires_input: false,
      input_label: null,
      safety_level: "confirm_before_apply",
      safety_reason: "Replay stays operator-confirmed.",
    },
  ],
  suggested_step_id: null,
  linked_task_id: null,
  correlation_id: null,
  ...overrides,
})

describe("TaskCenterView behavior", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.restoreAllMocks()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  it("renders command-run detail fields for message and exit code", function () {
    act(() => {
      root.render(
        <TaskCenterView
          tasks={[sampleTask]}
          taskState="success"
          selectedTaskId={sampleTask.task_id}
          taskErrorMessage=""
          onSelectTask={() => {}}
          onCancelTask={() => {}}
          onRefreshTasks={() => {}}
          statusFilter="all"
          onStatusFilterChange={() => {}}
          commandFilter=""
          onCommandFilterChange={() => {}}
          taskLimit={20}
          onTaskLimitChange={() => {}}
          logs={[]}
          selectedTask={sampleTask}
          terminalRows={8}
          onTerminalRowsChange={() => {}}
          terminalFilter="all"
          onTerminalFilterChange={() => {}}
          autoScroll
          onAutoScrollChange={() => {}}
          onClearLogs={() => {}}
          runs={[]}
          selectedRunId=""
          onSelectedRunIdChange={() => {}}
          otpCode=""
          onOtpCodeChange={() => {}}
          onSubmitOtp={() => {}}
          runRecoveryPlan={null}
          runRecoveryPlanState="empty"
          runRecoveryPlanError=""
          onReplayLatestFlow={() => {}}
          onReplayStep={() => {}}
          onResumeFromStep={() => {}}
          onGoToLaunch={() => {}}
        />
      )
    })

    expect(container.textContent).toContain("任务执行失败")
    expect(container.textContent).toContain("Exit Code")
    expect(container.textContent).toContain("1")
  }, 20000)

  it("supports tab/list keyboard navigation and shows template run error/log sections", function () {
    const onSelectedRunIdChange = vi.fn()

    act(() => {
      root.render(
        <TaskCenterView
          tasks={[sampleTask]}
          taskState="success"
          selectedTaskId={sampleTask.task_id}
          taskErrorMessage=""
          onSelectTask={() => {}}
          onCancelTask={() => {}}
          onRefreshTasks={() => {}}
          statusFilter="all"
          onStatusFilterChange={() => {}}
          commandFilter=""
          onCommandFilterChange={() => {}}
          taskLimit={20}
          onTaskLimitChange={() => {}}
          logs={sampleLogs}
          selectedTask={sampleTask}
          terminalRows={8}
          onTerminalRowsChange={() => {}}
          terminalFilter="all"
          onTerminalFilterChange={() => {}}
          autoScroll
          onAutoScrollChange={() => {}}
          onClearLogs={() => {}}
          runs={[runOne, runTwo]}
          selectedRunId={runOne.run_id}
          onSelectedRunIdChange={onSelectedRunIdChange}
          otpCode=""
          onOtpCodeChange={() => {}}
          onSubmitOtp={() => {}}
          runRecoveryPlan={createRecoveryPlan({ run_id: runOne.run_id })}
          runRecoveryPlanState="success"
          runRecoveryPlanError=""
          onReplayLatestFlow={() => {}}
          onReplayStep={() => {}}
          onResumeFromStep={() => {}}
          onGoToLaunch={() => {}}
        />
      )
    })

    const tabs = Array.from(container.querySelectorAll('[role="tab"]')) as HTMLButtonElement[]
    expect(tabs.length).toBeGreaterThanOrEqual(2)
    act(() => {
      tabs[0]?.focus()
      tabs[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }))
    })
    expect(document.activeElement).toBe(tabs[tabs.length - 1])

    act(() => {
      tabs[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }))
    })
    expect(document.activeElement).toBe(tabs[0])

    act(() => {
      tabs[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    const runList = container.querySelector('[role="listbox"]') as HTMLUListElement
    expect(runList).toBeInstanceOf(HTMLUListElement)

    act(() => {
      runList.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
      runList.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })

    expect(onSelectedRunIdChange).toHaveBeenCalledWith(runTwo.run_id)
    expect(onSelectedRunIdChange).toHaveBeenCalledWith(runOne.run_id)
    expect(container.textContent).toContain("Last Error")
    expect(container.textContent).toContain("Suggested action:")
    expect(container.textContent).toContain("Run Log")
  })

  it("covers waiting-input actions and additional keyboard branches", function () {
    const onSelectedRunIdChange = vi.fn()
    const onSubmitOtp = vi.fn()

    act(() => {
      root.render(
        <TaskCenterView
          tasks={[sampleTask]}
          taskState="success"
          selectedTaskId={sampleTask.task_id}
          taskErrorMessage=""
          onSelectTask={() => {}}
          onCancelTask={() => {}}
          onRefreshTasks={() => {}}
          statusFilter="all"
          onStatusFilterChange={() => {}}
          commandFilter=""
          onCommandFilterChange={() => {}}
          taskLimit={20}
          onTaskLimitChange={() => {}}
          logs={sampleLogs}
          selectedTask={sampleTask}
          terminalRows={8}
          onTerminalRowsChange={() => {}}
          terminalFilter="all"
          onTerminalFilterChange={() => {}}
          autoScroll
          onAutoScrollChange={() => {}}
          onClearLogs={() => {}}
          runs={[waitingOtpRun, providerProtectedRun]}
          selectedRunId={waitingOtpRun.run_id}
          onSelectedRunIdChange={onSelectedRunIdChange}
          otpCode=""
          onOtpCodeChange={() => {}}
          onSubmitOtp={onSubmitOtp}
          runRecoveryPlan={createRecoveryPlan({
            run_id: waitingOtpRun.run_id,
            status: "waiting_otp",
            headline: "This run is waiting for an OTP. Enter it and submit to continue:",
            summary: "Submit the required OTP first, then the run can resume without switching to legacy helper paths.",
            reason_code: "otp_required",
            primary_action: {
              action_id: "submit_otp",
              label: "Submit OTP",
              description: "Submit OTP",
              kind: "resume",
              step_id: null,
              requires_input: true,
              input_label: "OTP",
              safety_level: "manual_only",
              safety_reason: "OTP stays manual.",
            },
            actions: [
              {
                action_id: "submit_otp",
                label: "Submit OTP",
                description: "Submit OTP",
                kind: "resume",
                step_id: null,
                requires_input: true,
                input_label: "OTP",
                safety_level: "manual_only",
                safety_reason: "OTP stays manual.",
              },
            ],
          })}
          runRecoveryPlanState="success"
          runRecoveryPlanError=""
          onReplayLatestFlow={() => {}}
          onReplayStep={() => {}}
          onResumeFromStep={() => {}}
          onGoToLaunch={() => {}}
        />
      )
    })

    const tabs = Array.from(container.querySelectorAll('[role="tab"]')) as HTMLButtonElement[]
    act(() => {
      tabs[0]?.focus()
      tabs[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
    })
    expect(document.activeElement).toBe(tabs[1])

    act(() => {
      tabs[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))
    })
    expect(document.activeElement).toBe(tabs[0])

    act(() => {
      tabs[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })
    expect(container.querySelector('[data-testid="task-center-panel-template-runs"]')?.hasAttribute("hidden")).toBe(false)

    const runList = container.querySelector('[role="listbox"]') as HTMLUListElement
    act(() => {
      runList.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }))
      runList.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }))
      runList.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }))
      runList.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }))
    })

    expect(onSelectedRunIdChange).toHaveBeenCalledWith(waitingOtpRun.run_id)
    expect(onSelectedRunIdChange).toHaveBeenCalledWith(providerProtectedRun.run_id)
    expect(container.textContent).toContain(
      "This run is waiting for an OTP. Enter it and submit to continue:"
    )

    const otpInput = container.querySelector("#task-center-run-input") as HTMLInputElement
    const submitButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Submit"
    )
    act(() => {
      otpInput.value = "123456"
      otpInput.dispatchEvent(new Event("input", { bubbles: true }))
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onSubmitOtp).toHaveBeenCalledWith(
      waitingOtpRun.run_id,
      waitingOtpRun.status,
      waitingOtpRun.wait_context
    )

    act(() => {
      root.render(
        <TaskCenterView
          tasks={[sampleTask]}
          taskState="success"
          selectedTaskId={sampleTask.task_id}
          taskErrorMessage=""
          onSelectTask={() => {}}
          onCancelTask={() => {}}
          onRefreshTasks={() => {}}
          statusFilter="all"
          onStatusFilterChange={() => {}}
          commandFilter=""
          onCommandFilterChange={() => {}}
          taskLimit={20}
          onTaskLimitChange={() => {}}
          logs={sampleLogs}
          selectedTask={sampleTask}
          terminalRows={8}
          onTerminalRowsChange={() => {}}
          terminalFilter="all"
          onTerminalFilterChange={() => {}}
          autoScroll
          onAutoScrollChange={() => {}}
          onClearLogs={() => {}}
          runs={[waitingOtpRun, providerProtectedRun]}
          selectedRunId={providerProtectedRun.run_id}
          onSelectedRunIdChange={onSelectedRunIdChange}
          otpCode=""
          onOtpCodeChange={() => {}}
          onSubmitOtp={onSubmitOtp}
          runRecoveryPlan={createRecoveryPlan({
            run_id: providerProtectedRun.run_id,
            status: "waiting_user",
            headline:
              "The payment page is already open. Complete the provider step manually, then continue here.",
            summary:
              "Continue the same run after the provider-hosted step is complete, then use replay only if the flow still needs a guided retry.",
            reason_code: "provider_protected_payment_step",
            primary_action: {
              action_id: "continue_manual_gate",
              label: "Continue after provider step",
              description: "Continue provider step",
              kind: "resume",
              step_id: null,
              requires_input: false,
              input_label: null,
              safety_level: "manual_only",
              safety_reason: "Provider step stays manual.",
            },
            actions: [
              {
                action_id: "continue_manual_gate",
                label: "Continue after provider step",
                description: "Continue provider step",
                kind: "resume",
                step_id: null,
                requires_input: false,
                input_label: null,
                safety_level: "manual_only",
                safety_reason: "Provider step stays manual.",
              },
            ],
          })}
          runRecoveryPlanState="success"
          runRecoveryPlanError=""
          onReplayLatestFlow={() => {}}
          onReplayStep={() => {}}
          onResumeFromStep={() => {}}
          onGoToLaunch={() => {}}
        />
      )
    })

    const templateTab = container.querySelector(
      '[data-testid="task-center-tab-template-runs"]'
    ) as HTMLButtonElement
    act(() => {
      templateTab.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(container.textContent).toContain(
      "The payment page is already open. Complete the provider step manually, then continue here."
    )
    const continueButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Continue"
    )
    act(() => {
      continueButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onSubmitOtp).toHaveBeenCalledWith(
      providerProtectedRun.run_id,
      providerProtectedRun.status,
      providerProtectedRun.wait_context
    )
  })

  it("covers command/template empty detail states and launch redirect action", function () {
    const onGoToLaunch = vi.fn()

    act(() => {
      root.render(
        <TaskCenterView
          tasks={[]}
          taskState="success"
          selectedTaskId=""
          taskErrorMessage=""
          onSelectTask={() => {}}
          onCancelTask={() => {}}
          onRefreshTasks={() => {}}
          statusFilter="all"
          onStatusFilterChange={() => {}}
          commandFilter=""
          onCommandFilterChange={() => {}}
          taskLimit={20}
          onTaskLimitChange={() => {}}
          logs={[]}
          selectedTask={null}
          terminalRows={8}
          onTerminalRowsChange={() => {}}
          terminalFilter="all"
          onTerminalFilterChange={() => {}}
          autoScroll
          onAutoScrollChange={() => {}}
          onClearLogs={() => {}}
          runs={[]}
          selectedRunId=""
          onSelectedRunIdChange={() => {}}
          otpCode=""
          onOtpCodeChange={() => {}}
          onSubmitOtp={() => {}}
          runRecoveryPlan={null}
          runRecoveryPlanState="empty"
          runRecoveryPlanError=""
          onReplayLatestFlow={() => {}}
          onReplayStep={() => {}}
          onResumeFromStep={() => {}}
          onGoToLaunch={onGoToLaunch}
        />
      )
    })

    expect(container.textContent).toContain(
      "Choose a record from the command run list on the left to inspect its details and output log."
    )

    const templateTab = container.querySelector(
      '[data-testid="task-center-tab-template-runs"]'
    ) as HTMLButtonElement
    act(() => {
      templateTab.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(container.textContent).toContain(
      "Template run records appear here after you select a template and start a run from Quick Launch."
    )

    const launchButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Go to Quick Launch"
    )
    act(() => {
      launchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onGoToLaunch).toHaveBeenCalledTimes(1)

    act(() => {
      root.render(
        <TaskCenterView
          tasks={[]}
          taskState="success"
          selectedTaskId=""
          taskErrorMessage=""
          onSelectTask={() => {}}
          onCancelTask={() => {}}
          onRefreshTasks={() => {}}
          statusFilter="all"
          onStatusFilterChange={() => {}}
          commandFilter=""
          onCommandFilterChange={() => {}}
          taskLimit={20}
          onTaskLimitChange={() => {}}
          logs={[]}
          selectedTask={null}
          terminalRows={8}
          onTerminalRowsChange={() => {}}
          terminalFilter="all"
          onTerminalFilterChange={() => {}}
          autoScroll
          onAutoScrollChange={() => {}}
          onClearLogs={() => {}}
          runs={[runOne]}
          selectedRunId=""
          onSelectedRunIdChange={() => {}}
          otpCode=""
          onOtpCodeChange={() => {}}
          onSubmitOtp={() => {}}
          runRecoveryPlan={null}
          runRecoveryPlanState="empty"
          runRecoveryPlanError=""
          onReplayLatestFlow={() => {}}
          onReplayStep={() => {}}
          onResumeFromStep={() => {}}
          onGoToLaunch={onGoToLaunch}
        />
      )
    })
    act(() => {
      templateTab.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(container.textContent).toContain(
      "Choose a record from the template run list on the left to inspect its status, parameters, and logs."
    )
  })
})
