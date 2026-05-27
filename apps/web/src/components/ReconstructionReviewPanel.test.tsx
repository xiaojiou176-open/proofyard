/* @vitest-environment jsdom */

import { act, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ReconstructionReviewPanel from "./ReconstructionReviewPanel"

function createProps(overrides: Partial<ComponentProps<typeof ReconstructionReviewPanel>> = {}) {
  return {
    artifacts: {
      session_dir: "/tmp/session",
      video_path: "/tmp/video.mp4",
      har_path: "/tmp/trace.har",
      html_path: "/tmp/page.html",
    },
    mode: "gemini" as const,
    strategy: "balanced" as const,
    error: "",
    profileResolved: null,
    preview: null,
    generated: null,
    onArtifactsChange: vi.fn(),
    onModeChange: vi.fn(),
    onStrategyChange: vi.fn(),
    onResolveProfile: vi.fn(),
    onPreview: vi.fn(),
    onGenerate: vi.fn(),
    onOrchestrate: vi.fn(),
    ...overrides,
  }
}

describe("ReconstructionReviewPanel", () => {
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

  it("updates artifacts, strategy and triggers action callbacks", function () {
    const props = createProps({ error: "请求失败" })

    act(() => {
      root.render(<ReconstructionReviewPanel {...props} />)
    })

    const inputs = Array.from(container.querySelectorAll("input")) as HTMLInputElement[]
    expect(inputs).toHaveLength(4)

    const nextValues = ["/next/session", "/next/har", "/next/html", "/next/video"]
    inputs.forEach((input, index) => {
      const propsKey = Object.keys(input).find((key) => key.startsWith("__reactProps"))
      const reactProps = (propsKey
        ? (input as unknown as Record<string, unknown>)[propsKey]
        : null) as { onChange?: (event: { target: { value: string } }) => void } | null
      act(() => {
        reactProps?.onChange?.({ target: { value: nextValues[index] } })
      })
    })

    expect(props.onArtifactsChange).toHaveBeenCalledTimes(4)
    expect(props.onArtifactsChange).toHaveBeenLastCalledWith({
      ...props.artifacts,
      video_path: "/next/video",
    })

    const selects = Array.from(container.querySelectorAll("select")) as HTMLSelectElement[]
    expect(selects).toHaveLength(2)
    act(() => {
      selects[0].value = "gemini"
      selects[0].dispatchEvent(new Event("change", { bubbles: true }))
      selects[1].value = "aggressive"
      selects[1].dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(props.onModeChange).toHaveBeenCalledWith("gemini")
    expect(props.onStrategyChange).toHaveBeenCalledWith("aggressive")

    const buttons = Array.from(container.querySelectorAll("button")) as HTMLButtonElement[]
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Resolve Profile",
      "Preview",
      "Generate",
      "Orchestrate",
    ])
    act(() => {
      buttons.forEach((button) =>
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      )
    })

    expect(props.onResolveProfile).toHaveBeenCalledTimes(1)
    expect(props.onPreview).toHaveBeenCalledTimes(1)
    expect(props.onGenerate).toHaveBeenCalledTimes(1)
    expect(props.onOrchestrate).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain("请求失败")
  })

  it("renders profile, preview and generated summary with unresolved fallback", function () {
    const props = createProps({
      profileResolved: {
        profile: "strict",
        video_signals: ["otp"],
        dom_alignment_score: 0.91,
        har_alignment_score: 0.82,
        recommended_manual_checkpoints: ["checkpoint-1"],
        manual_handoff_required: true,
        unsupported_reason: null,
      },
      preview: {
        preview_id: "preview-1",
        flow_draft: {},
        reconstructed_flow_quality: 0.77,
        step_confidence: [0.9],
        unresolved_segments: [],
        manual_handoff_required: false,
        unsupported_reason: null,
        generator_outputs: {},
      },
      generated: {
        flow_id: "flow-1",
        template_id: "tpl-1",
        run_id: null,
        generator_outputs: {},
        reconstructed_flow_quality: 0.9,
        step_confidence: [0.95],
        unresolved_segments: [],
        manual_handoff_required: true,
        unsupported_reason: null,
      },
    })

    act(() => {
      root.render(<ReconstructionReviewPanel {...props} />)
    })

    expect(container.textContent).toContain("profile=strict")
    expect(container.textContent).toContain("dom_alignment=0.91 har_alignment=0.82")
    expect(container.textContent).toContain("preview_id=preview-1")
    expect(container.textContent).toContain("quality=0.77")
    expect(container.textContent).toContain("unresolved=none")
    expect(container.textContent).toContain("flow_id=flow-1")
    expect(container.textContent).toContain("template_id=tpl-1")
  })

  it("shows joined unresolved segments when preview contains entries", function () {
    const props = createProps({
      preview: {
        preview_id: "preview-joined",
        flow_draft: {},
        reconstructed_flow_quality: 0.4,
        step_confidence: [],
        unresolved_segments: ["selector", "otp"],
        manual_handoff_required: true,
        unsupported_reason: null,
        generator_outputs: {},
      },
    })

    act(() => {
      root.render(<ReconstructionReviewPanel {...props} />)
    })

    expect(container.textContent).toContain("unresolved=selector,otp")
  })

  it("renders empty artifact inputs as blank strings", function () {
    const props = createProps({
      artifacts: {},
    })

    act(() => {
      root.render(<ReconstructionReviewPanel {...props} />)
    })

    const inputs = Array.from(container.querySelectorAll("input")) as HTMLInputElement[]
    expect(inputs).toHaveLength(4)
    expect(inputs.every((input) => input.value === "")).toBe(true)
  })
})
