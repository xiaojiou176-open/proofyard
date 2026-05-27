/* @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Command } from "../types"
import CommandGrid from "./CommandGrid"

const commands: Command[] = [
  {
    command_id: "run",
    title: "运行 canonical 主路径",
    description: "canonical",
    tags: ["pipeline", "canonical"],
  },
  {
    command_id: "run-ui",
    title: "仅运行浏览器流程（手动模式）",
    description: "UI only",
    tags: ["pipeline", "ui-only", "helper", "legacy", "workshop"],
  },
  {
    command_id: "clean",
    title: "清理临时文件",
    description: "danger",
    tags: ["maintenance"],
  },
]

describe("CommandGrid", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  it("filters tabs and runs selected commands", function () {
    const onActiveTabChange = vi.fn()
    const onRunCommand = vi.fn()

    act(() => {
      root.render(
        <CommandGrid
          commands={commands}
          commandState="success"
          activeTab="all"
          submittingId=""
          feedbackText=""
          onActiveTabChange={onActiveTabChange}
          onRunCommand={onRunCommand}
        />
      )
    })

    const tabs = Array.from(container.querySelectorAll('[role="tab"]')) as HTMLButtonElement[]
    act(() => {
      tabs[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      tabs[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })
    expect(onActiveTabChange).toHaveBeenCalled()

    const primaryButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Run canonical path"
    )
    const advancedSummary = Array.from(container.querySelectorAll("summary")).find((summary) =>
      summary.textContent?.includes("Advanced / helper / workshop commands")
    ) as HTMLElement | undefined
    act(() => {
      primaryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      advancedSummary?.parentElement?.setAttribute("open", "true")
    })
    const advancedButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.getAttribute("data-testid") === "command-run-run-ui"
    )
    act(() => {
      advancedButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onRunCommand).toHaveBeenCalledTimes(2)
    expect(onRunCommand).toHaveBeenCalledWith(commands[0])
    expect(onRunCommand).toHaveBeenCalledWith(commands[1])
  })

  it("handles loading/error/empty placeholders and roving tab focus keys", function () {
    const onActiveTabChange = vi.fn()
    const onRunCommand = vi.fn()

    act(() => {
      root.render(
        <CommandGrid
          commands={[]}
          commandState="loading"
          activeTab="all"
          submittingId=""
          feedbackText=""
          onActiveTabChange={onActiveTabChange}
          onRunCommand={onRunCommand}
        />
      )
    })
    expect(container.textContent).toContain("Loading commands...")

    act(() => {
      root.render(
        <CommandGrid
          commands={[]}
          commandState="error"
          activeTab="all"
          submittingId=""
          feedbackText="load failed"
          onActiveTabChange={onActiveTabChange}
          onRunCommand={onRunCommand}
        />
      )
    })
    expect(container.textContent).toContain("load failed")

    act(() => {
      root.render(
        <CommandGrid
          commands={[]}
          commandState="empty"
          activeTab="all"
          submittingId=""
          feedbackText=""
          onActiveTabChange={onActiveTabChange}
          onRunCommand={onRunCommand}
        />
      )
    })
    expect(container.textContent).toContain("No commands available")

    act(() => {
      root.render(
        <CommandGrid
          commands={[commands[1]]}
          commandState="success"
          activeTab="frontend"
          submittingId=""
          feedbackText=""
          onActiveTabChange={onActiveTabChange}
          onRunCommand={onRunCommand}
        />
      )
    })
    expect(container.textContent).toContain("No commands in this category")

    act(() => {
      root.render(
        <CommandGrid
          commands={commands}
          commandState="success"
          activeTab="all"
          submittingId=""
          feedbackText=""
          onActiveTabChange={onActiveTabChange}
          onRunCommand={onRunCommand}
        />
      )
    })

    const tabs = Array.from(container.querySelectorAll('[role="tab"]')) as HTMLButtonElement[]
    expect(tabs.length).toBeGreaterThan(2)

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
      tabs[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }))
    })
    expect(document.activeElement).toBe(tabs[tabs.length - 1])

    act(() => {
      tabs[tabs.length - 1]?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Home", bubbles: true })
      )
      tabs[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }))
    })
    expect(document.activeElement).toBe(tabs[0])
    expect(onActiveTabChange).toHaveBeenCalled()
  })

  it("shows running state and ai badge when command is submitting", function () {
    const onActiveTabChange = vi.fn()
    const onRunCommand = vi.fn()
    const aiCommand: Command = {
      command_id: "ai-generate-script",
      title: "AI 生成流程",
      description: "ai",
      tags: ["ai"],
    }

    act(() => {
      root.render(
        <CommandGrid
          commands={[aiCommand]}
          commandState="success"
          activeTab="all"
          submittingId={aiCommand.command_id}
          feedbackText=""
          onActiveTabChange={onActiveTabChange}
          onRunCommand={onRunCommand}
        />
      )
    })

    const runButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Running..."
    ) as HTMLButtonElement | undefined
    expect(runButton).not.toBeUndefined()
    expect(runButton?.disabled).toBe(true)
    expect(container.textContent).toContain("AI")
  })
})
