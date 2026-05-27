/* @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LogEntry, Task } from "../types"
import TerminalPanel from "./TerminalPanel"

function buildTask(): Task {
  return {
    task_id: "task-demo-001",
    command_id: "cmd-demo",
    status: "running",
    requested_by: null,
    attempt: 1,
    max_attempts: 3,
    created_at: "2026-03-01T00:00:00Z",
    started_at: "2026-03-01T00:00:01Z",
    finished_at: null,
    exit_code: null,
    message: null,
    output_tail: "task-output-tail",
  }
}

function buildLog(id: string, level: LogEntry["level"], message: string): LogEntry {
  return {
    id,
    ts: "2026-03-01T00:00:00Z",
    level,
    message,
  }
}

describe("TerminalPanel", () => {
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

  it("wires terminal controls and renders selected task output", function () {
    const onTerminalRowsChange = vi.fn()
    const onTerminalFilterChange = vi.fn()
    const onAutoScrollChange = vi.fn()
    const onClear = vi.fn()

    act(() => {
      root.render(
        <TerminalPanel
          logs={[
            buildLog("log-1", "info", "booting"),
            buildLog("log-2", "error", "failed to load"),
          ]}
          selectedTask={buildTask()}
          terminalRows={12}
          onTerminalRowsChange={onTerminalRowsChange}
          terminalFilter="all"
          onTerminalFilterChange={onTerminalFilterChange}
          autoScroll
          onAutoScrollChange={onAutoScrollChange}
          onClear={onClear}
        />
      )
    })

    expect(container.textContent).toContain("booting")
    expect(container.textContent).toContain("failed to load")
    expect(container.textContent).toContain("task-output-tail")
    expect(container.querySelector('[data-testid="terminal-size-value"]')?.textContent).toBe("12 rows")

    const slider = container.querySelector("#terminal-size") as HTMLInputElement
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set
      setValue?.call(slider, "20")
      slider.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(onTerminalRowsChange).toHaveBeenCalledWith(20)

    const filterSelect = container.querySelector('select[aria-label="Filter log level"]') as HTMLSelectElement
    act(() => {
      filterSelect.value = "error"
      filterSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(onTerminalFilterChange).toHaveBeenCalledWith("error")

    const autoScrollCheckbox = container.querySelector(
      'input[type="checkbox"]'
    ) as HTMLInputElement
    act(() => {
      autoScrollCheckbox.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onAutoScrollChange).toHaveBeenCalledWith(false)

    const clearButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Clear"
    )
    act(() => {
      clearButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it("supports empty state, level filtering and autoscroll update", function () {
    const baseProps = {
      selectedTask: null,
      terminalRows: 8,
      onTerminalRowsChange: vi.fn(),
      onTerminalFilterChange: vi.fn(),
      onAutoScrollChange: vi.fn(),
      onClear: vi.fn(),
    }

    act(() => {
      root.render(
        <TerminalPanel
          logs={[]}
          terminalFilter="all"
          autoScroll={false}
          {...baseProps}
        />
      )
    })
    expect(container.textContent).toContain("The terminal log is empty")

    act(() => {
      root.render(
        <TerminalPanel
          logs={[
            buildLog("log-1", "info", "only-info"),
            buildLog("log-2", "error", "only-error"),
          ]}
          terminalFilter="error"
          autoScroll={false}
          {...baseProps}
        />
      )
    })
    expect(container.textContent).toContain("only-error")
    expect(container.textContent).not.toContain("only-info")

    const terminalBody = container.querySelector(".terminal-body") as HTMLDivElement
    Object.defineProperty(terminalBody, "scrollHeight", {
      configurable: true,
      value: 480,
    })
    terminalBody.scrollTop = 0

    act(() => {
      root.render(
        <TerminalPanel
          logs={[
            buildLog("log-1", "error", "only-error"),
            buildLog("log-3", "error", "new-error"),
          ]}
          terminalFilter="error"
          autoScroll
          {...baseProps}
        />
      )
    })

    expect(terminalBody.scrollTop).toBe(480)
  })
})
