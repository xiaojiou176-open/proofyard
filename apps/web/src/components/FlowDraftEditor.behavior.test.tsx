/* @vitest-environment jsdom */

import { fireEvent } from "@testing-library/react"
import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { FlowEditableDraft } from "../types"
import FlowDraftEditor from "./FlowDraftEditor"

function createDraft(): FlowEditableDraft {
  return {
    start_url: "https://example.com",
    steps: [
      {
        step_id: "s1",
        action: "click",
        selected_selector_index: 0,
        target: {
          selectors: [
            { kind: "css", value: "#submit", score: 90 },
            { kind: "xpath", value: "//button[@id='submit']", score: 80 },
          ],
        },
      },
      {
        step_id: "s2",
        action: "click",
        selected_selector_index: 0,
        target: { selectors: [] },
      },
    ],
  }
}

describe("FlowDraftEditor behavior", () => {
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

  it("renders empty state without draft", function () {
    act(() => {
      root.render(
        <FlowDraftEditor
          draft={null}
          selectedStepId=""
          onSelectStep={() => {}}
          onChange={() => {}}
          onSave={() => {}}
          onRunStep={() => {}}
          onResumeFromStep={() => {}}
        />
      )
    })
    expect(container.textContent).toContain("No flow draft yet")
  })

  it("supports editing, moving, removing and action-specific fields", function () {
    const onSelectStep = vi.fn()
    const onSave = vi.fn()
    const onRunStep = vi.fn()
    const onResumeFromStep = vi.fn()
    let latestDraft = createDraft()

    function Harness() {
      const [draft, setDraft] = useState<FlowEditableDraft>(createDraft())
      latestDraft = draft
      return (
        <FlowDraftEditor
          draft={draft}
          selectedStepId="s1"
          onSelectStep={onSelectStep}
          onChange={setDraft}
          onSave={onSave}
          onRunStep={onRunStep}
          onResumeFromStep={onResumeFromStep}
        />
      )
    }

    act(() => {
      root.render(<Harness />)
    })

    const startUrl = container.querySelector("#flow-start-url") as HTMLInputElement
    act(() => {
      startUrl.value = "https://example.com/new"
      startUrl.dispatchEvent(new Event("input", { bubbles: true }))
      startUrl.dispatchEvent(new Event("change", { bubbles: true }))
    })

    const addStepButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Add Step"
    )
    act(() => {
      addStepButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(latestDraft.steps).toHaveLength(3)

    const stepEntryButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("s1")
    )
    const runButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Replay Step"
    )
    const resumeButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Resume"
    )
    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save Draft"
    )

    act(() => {
      stepEntryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      resumeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onSelectStep).toHaveBeenCalledWith("s1")
    expect(onRunStep).toHaveBeenCalledWith("s1")
    expect(onResumeFromStep).toHaveBeenCalledWith("s1")
    expect(onSave).toHaveBeenCalledTimes(1)

    const actionSelect = container.querySelector('[aria-label="step-0-action"]') as HTMLSelectElement
    act(() => {
      actionSelect.value = "navigate"
      actionSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(container.querySelector('[aria-label="step-0-url"]')).toBeInstanceOf(HTMLInputElement)

    const navigateUrlInput = container.querySelector('[aria-label="step-0-url"]') as HTMLInputElement
    act(() => {
      navigateUrlInput.value = "https://example.com/path"
      navigateUrlInput.dispatchEvent(new Event("input", { bubbles: true }))
      navigateUrlInput.dispatchEvent(new Event("change", { bubbles: true }))
    })

    act(() => {
      actionSelect.value = "type"
      actionSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(container.querySelector('[aria-label="step-0-value-ref"]')).toBeInstanceOf(HTMLInputElement)

    const valueRefInput = container.querySelector('[aria-label="step-0-value-ref"]') as HTMLInputElement
    act(() => {
      valueRefInput.value = "${params.otp}"
      valueRefInput.dispatchEvent(new Event("input", { bubbles: true }))
      valueRefInput.dispatchEvent(new Event("change", { bubbles: true }))
    })

    const stepIdInput = container.querySelector('[aria-label="step-0-id"]') as HTMLInputElement
    act(() => {
      fireEvent.input(stepIdInput, { target: { value: "s1-renamed" } })
    })
    expect(latestDraft.steps[0]?.step_id).toBe("s1-renamed")

    const selectorIndex = container.querySelector(
      '[aria-label="step-0-selector-index"]'
    ) as HTMLSelectElement
    act(() => {
      selectorIndex.value = "1"
      selectorIndex.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(latestDraft.steps[0]?.selected_selector_index).toBe(1)

    const emptySelectorIndex = container.querySelector(
      '[aria-label="step-1-selector-index"]'
    ) as HTMLSelectElement
    expect(emptySelectorIndex.textContent).toContain("No selector")

    const upButtons = Array.from(
      container.querySelectorAll('button[aria-label="Move up"]')
    ) as HTMLButtonElement[]
    const downButtons = Array.from(
      container.querySelectorAll('button[aria-label="Move down"]')
    ) as HTMLButtonElement[]

    const beforeNoop = latestDraft.steps.map((step) => step.step_id)
    act(() => {
      upButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(latestDraft.steps.map((step) => step.step_id)).toEqual(beforeNoop)

    act(() => {
      downButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(latestDraft.steps[1]?.step_id).toBe("s1-renamed")

    const deleteButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "✕"
    )
    act(() => {
      deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(latestDraft.steps.length).toBeLessThan(3)
  })
})
