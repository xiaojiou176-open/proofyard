/* @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Task } from "../types"
import TaskListPanel from "./TaskListPanel"

function buildTask(taskId: string, status: Task["status"]): Task {
  return {
    task_id: taskId,
    command_id: "cmd-demo",
    status,
    requested_by: null,
    attempt: 1,
    max_attempts: 3,
    created_at: "2026-03-01T00:00:00Z",
    started_at: null,
    finished_at: null,
    exit_code: null,
    message: null,
    output_tail: "",
  }
}

describe("TaskListPanel", () => {
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

  it("renders task list and wires filter/refresh/cancel interactions", function () {
    const onSelectTask = vi.fn()
    const onCancelTask = vi.fn()
    const onRefresh = vi.fn()
    const onStatusFilterChange = vi.fn()
    const onCommandFilterChange = vi.fn()
    const onTaskLimitChange = vi.fn()

    const queued = buildTask("task-queued-1", "queued")
    const running = buildTask("task-running-1", "running")
    const success = buildTask("task-success-1", "success")

    act(() => {
      root.render(
        <TaskListPanel
          tasks={[queued, running, success]}
          taskState="success"
          selectedTaskId={running.task_id}
          taskErrorMessage=""
          onSelectTask={onSelectTask}
          onCancelTask={onCancelTask}
          onRefresh={onRefresh}
          statusFilter="all"
          onStatusFilterChange={onStatusFilterChange}
          commandFilter=""
          onCommandFilterChange={onCommandFilterChange}
          taskLimit={20}
          onTaskLimitChange={onTaskLimitChange}
        />
      )
    })

    const refreshButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Refresh"
    )
    act(() => {
      refreshButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onRefresh).toHaveBeenCalledTimes(1)

    const statusSelect = container.querySelector('select[aria-label="Filter tasks by status"]') as HTMLSelectElement
    act(() => {
      statusSelect.value = "running"
      statusSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(onStatusFilterChange).toHaveBeenCalledWith("running")

    const commandInput = container.querySelector(
      'input[aria-label="Filter run records by command ID"]'
    ) as HTMLInputElement
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set
      setValue?.call(commandInput, "cmd-")
      commandInput.dispatchEvent(new Event("input", { bubbles: true }))
      commandInput.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(onCommandFilterChange).toHaveBeenCalledWith("cmd-")

    const limitSelect = container.querySelector('select[aria-label="Run count limit"]') as HTMLSelectElement
    act(() => {
      limitSelect.value = "50"
      limitSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(onTaskLimitChange).toHaveBeenCalledWith(50)

    const taskButtons = container.querySelectorAll(".task-item-info")
    expect(taskButtons.length).toBe(3)
    act(() => {
      taskButtons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onSelectTask).toHaveBeenCalledWith("task-queued-1")

    const cancelButtons = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent === "Cancel"
    )
    expect(cancelButtons.length).toBe(2)
    act(() => {
      cancelButtons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onCancelTask).toHaveBeenCalledWith(queued)
  })

  it("shows actionable errors and empty/error branches", function () {
    act(() => {
      root.render(
        <TaskListPanel
          tasks={[]}
          taskState="empty"
          selectedTaskId=""
          taskErrorMessage="Task loading failed"
          onSelectTask={() => {}}
          onCancelTask={() => {}}
          onRefresh={() => {}}
          statusFilter="all"
          onStatusFilterChange={() => {}}
          commandFilter=""
          onCommandFilterChange={() => {}}
          taskLimit={20}
          onTaskLimitChange={() => {}}
          emptyTitle="No records yet"
          emptyDescription="Run a task first"
        />
      )
    })

    expect(container.textContent).toContain(
      'Issue: Task loading failed. Suggested action: Click "Refresh" and try again, or start a new run if needed.. Troubleshooting: Check the details pane and the run log.'
    )
    expect(container.textContent).toContain("No records yet")
    expect(container.textContent).toContain("Run a task first")

    act(() => {
      root.render(
        <TaskListPanel
          tasks={[]}
          taskState="error"
          selectedTaskId=""
          taskErrorMessage=""
          onSelectTask={() => {}}
          onCancelTask={() => {}}
          onRefresh={() => {}}
          statusFilter="all"
          onStatusFilterChange={() => {}}
          commandFilter=""
          onCommandFilterChange={() => {}}
          taskLimit={20}
          onTaskLimitChange={() => {}}
        />
      )
    })

    expect(container.textContent).toContain("Issue: Run list loading failed")
  })
})
