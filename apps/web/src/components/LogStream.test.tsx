/* @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import LogStream from "./LogStream"

describe("LogStream", () => {
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

  it("renders log timestamp, uppercased level and custom height", function () {
    vi.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue("10:10:10")

    act(() => {
      root.render(
        <LogStream
          maxHeight="320px"
          logs={[
            { ts: "2026-03-08T01:02:03.000Z", level: "info", message: "启动成功" },
            { ts: "2026-03-08T01:03:03.000Z", level: "warn", message: "重试中" },
          ]}
        />
      )
    })

    const terminal = container.querySelector(".terminal-body") as HTMLDivElement
    expect(terminal.style.maxHeight).toBe("320px")
    expect(container.textContent).toContain("10:10:10")
    expect(container.textContent).toContain("[INFO]")
    expect(container.textContent).toContain("[WARN]")
    expect(container.querySelector(".log-tag.info")).not.toBeNull()
    expect(container.querySelector(".log-tag.warn")).not.toBeNull()
  })

  it("uses default maxHeight when prop is omitted", function () {
    act(() => {
      root.render(<LogStream logs={[]} />)
    })

    const terminal = container.querySelector(".terminal-body") as HTMLDivElement
    expect(terminal.style.maxHeight).toBe("200px")
  })
})
