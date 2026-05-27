/* @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import EvidenceScreenshotPair from "./EvidenceScreenshotPair"

describe("EvidenceScreenshotPair", () => {
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

  it("renders before and after screenshots with fallback alt text", function () {
    act(() => {
      root.render(
        <EvidenceScreenshotPair
          beforeImageUrl="before.png"
          afterImageUrl="after.png"
          beforeAlt="   "
          afterAlt="after-alt"
          beforeLabel="Before"
          afterLabel="After"
          emptyHint="No screenshots yet"
        />
      )
    })

    const images = Array.from(container.querySelectorAll("img")) as HTMLImageElement[]
    expect(images).toHaveLength(2)
    expect(images[0].getAttribute("alt")).toBe("Before step evidence image")
    expect(images[1].getAttribute("alt")).toBe("after-alt")
    expect(container.textContent).toContain("Before")
    expect(container.textContent).toContain("After")
    expect(container.textContent).not.toContain("No screenshots yet")
  })

  it("shows empty hint when no screenshots exist", function () {
    act(() => {
      root.render(
        <EvidenceScreenshotPair
          beforeImageUrl={null}
          afterImageUrl={undefined}
          beforeAlt="before-alt"
          afterAlt="after-alt"
          emptyHint="Waiting for screenshots"
        />
      )
    })

    expect(container.querySelectorAll("img")).toHaveLength(0)
    expect(container.textContent).toContain("Waiting for screenshots")
  })
})
