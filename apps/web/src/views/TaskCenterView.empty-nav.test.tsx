/* @vitest-environment jsdom */

import { act, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../i18n"
import type { LogEntry, RunRecoveryPlan, Task, UniversalRun } from "../types"
import TaskCenterView from "./TaskCenterView"

vi.mock("../components/TaskListPanel", () => ({
  default: () => <div data-testid="mock-task-list-panel" />,
}))

vi.mock("../components/TerminalPanel", () => ({
  default: () => <div data-testid="mock-terminal-panel" />,
}))

const task: Task = {
  task_id: "task-empty-1",
  command_id: "cmd-empty-1",
  status: "success",
  requested_by: null,
  attempt: 1,
  max_attempts: 1,
  created_at: "2026-03-08T00:00:00Z",
  started_at: "2026-03-08T00:00:01Z",
  finished_at: "2026-03-08T00:00:02Z",
  exit_code: 0,
  message: "done",
  output_tail: "ok",
}

const logs: LogEntry[] = []

function createRun(overrides: Partial<UniversalRun> = {}): UniversalRun {
  return {
    run_id: "run-1",
    template_id: "tpl-1",
    status: "waiting_user",
    wait_context: { reason_code: "manual_input_required" },
    step_cursor: 1,
    params: {},
    task_id: null,
    last_error: null,
    artifacts_ref: {},
    created_at: "2026-03-08T00:00:00Z",
    updated_at: "2026-03-08T00:00:01Z",
    logs: [],
    ...overrides,
  }
}

function createRecoveryPlan(overrides: Partial<RunRecoveryPlan> = {}): RunRecoveryPlan {
  return {
    run_id: "run-1",
    status: "waiting_user",
    headline: "This run is waiting for additional input. Provide it and submit to continue:",
    summary:
      "Use the guided resume action first. If that is not enough, replay from the suggested step instead of guessing the right endpoint.",
    reason_code: "manual_input_required",
    primary_action: {
      action_id: "submit_input",
      label: "Submit additional input",
      description: "Provide missing input",
      kind: "resume",
      step_id: null,
      requires_input: true,
      input_label: "Additional Input",
      safety_level: "manual_only",
      safety_reason: "Manual input stays manual.",
    },
    actions: [
      {
        action_id: "submit_input",
        label: "Submit additional input",
        description: "Provide missing input",
        kind: "resume",
        step_id: null,
        requires_input: true,
        input_label: "Additional Input",
        safety_level: "manual_only",
        safety_reason: "Manual input stays manual.",
      },
    ],
    suggested_step_id: null,
    linked_task_id: null,
    correlation_id: null,
    ...overrides,
  }
}

function renderView(root: Root, props: Partial<ComponentProps<typeof TaskCenterView>> = {}) {
  act(() => {
    root.render(
      <I18nProvider locale="en" setLocale={() => {}}>
        <TaskCenterView
          tasks={[task]}
          taskState="success"
          selectedTaskId={task.task_id}
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
          logs={logs}
          selectedTask={task}
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
          onReplayLatestFlow={() => {}}
          onReplayStep={() => {}}
          onResumeFromStep={() => {}}
          onGoToLaunch={() => {}}
          {...props}
        />
      </I18nProvider>
    )
  })
}

describe("TaskCenterView empty and keyboard branches", () => {
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
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  it("shows launch guidance and empty-state copy when no template runs exist", function () {
    const onGoToLaunch = vi.fn()
    renderView(root, { runs: [], selectedRunId: "", onGoToLaunch })

    expect(container.textContent).toContain("No run records yet")
    expect(container.textContent).toContain("Go to Quick Launch")

    const launchButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Go to Quick Launch")
    )
    expect(launchButton).not.toBeNull()

    act(() => {
      launchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onGoToLaunch).toHaveBeenCalledTimes(1)
  }, 20000)

  it("shows evidence empty-state copy when no canonical evidence runs exist", function () {
    const onGoToLaunch = vi.fn()
    renderView(root, {
      evidenceRuns: [],
      evidenceRegistryState: "missing",
      evidenceRunsState: "empty",
      selectedEvidenceRunId: "",
      selectedEvidenceRun: null,
      onGoToLaunch,
    })

    const evidenceTab = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Evidence Runs")
    )
    expect(evidenceTab).not.toBeNull()
    act(() => {
      evidenceTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(container.textContent).toContain("No canonical evidence surface yet")
    expect(container.textContent).toContain("canonical runs directory")
    expect(container.textContent).toContain("Go to Quick Launch")
    const launchButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Go to Quick Launch")
    )
    expect(launchButton).not.toBeNull()
    act(() => {
      launchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onGoToLaunch).toHaveBeenCalledTimes(1)
  })

  it("covers template-run listbox keyboard navigation and manual input copy", function () {
    const onSelectedRunIdChange = vi.fn()
    const onSubmitOtp = vi.fn()
    const runA = createRun({ run_id: "run-a" })
    const runB = createRun({
      run_id: "run-b",
      status: "waiting_otp",
      wait_context: { reason_code: "otp_required" },
    })
    renderView(root, {
      runs: [runA, runB],
      selectedRunId: "run-a",
      onSelectedRunIdChange,
      otpCode: "123456",
      onOtpCodeChange: vi.fn(),
      onSubmitOtp,
      runRecoveryPlan: createRecoveryPlan({ run_id: "run-a" }),
      runRecoveryPlanState: "success",
      runRecoveryPlanError: "",
    })

    const runTab = container.querySelector<HTMLButtonElement>('[data-testid="task-center-tab-template-runs"]')
    expect(runTab).not.toBeNull()
    act(() => {
      runTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    const listbox = container.querySelector<HTMLUListElement>('[role="listbox"]')
    expect(listbox).not.toBeNull()

    act(() => {
      listbox?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
      listbox?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }))
      listbox?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }))
      listbox?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }))
    })

    expect(onSelectedRunIdChange).toHaveBeenCalledWith("run-b")
    expect(onSelectedRunIdChange).toHaveBeenCalledWith("run-a")
    expect(container.textContent).toContain("Waiting for User Input")

    const submitButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Submit")
    )
    expect(submitButton).not.toBeNull()

    act(() => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onSubmitOtp).toHaveBeenCalledWith("run-a", "waiting_user", runA.wait_context)
  })

  it("renders Task Center hero copy in Chinese under zh-CN locale", function () {
    act(() => {
      root.render(
        <I18nProvider locale="zh-CN" setLocale={() => {}}>
          <TaskCenterView
            tasks={[task]}
            taskState="success"
            selectedTaskId={task.task_id}
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
            logs={logs}
            selectedTask={task}
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
            onReplayLatestFlow={() => {}}
            onReplayStep={() => {}}
            onResumeFromStep={() => {}}
            onGoToLaunch={() => {}}
          />
        </I18nProvider>
      )
    })

    expect(container.textContent).toContain("运行面板")
    expect(container.textContent).toContain("先定位当前运行")
    expect(container.textContent).toContain("当前焦点")
  })
})
