import type React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import CommandGrid from "./CommandGrid"

vi.mock("./ui", () => ({
  Badge: ({ children }: { children: string }) => <span>{children}</span>,
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Card: ({ children }: { children: React.ReactNode }) => <article>{children}</article>,
  TabsList: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  TabsTrigger: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}))

function noop() {}

const sampleCommands = [
  {
    command_id: "run-ui",
    title: "运行 UI",
    description: "启动 UI 流程",
    tags: ["frontend"],
  },
]

describe("CommandGrid tab accessibility", () => {
  it("binds tab buttons to panel with aria-controls and roving tabindex", () => {
    const html = renderToStaticMarkup(
      <CommandGrid
        commands={sampleCommands}
        commandState="success"
        activeTab="all"
        submittingId=""
        feedbackText=""
        onActiveTabChange={noop}
        onRunCommand={noop}
      />
    )

    expect(html).toContain('role="tablist"')
    expect(html).toContain('id="command-category-tab-all"')
    expect(html).toContain('aria-controls="command-grid-panel"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('role="tabpanel"')
    expect(html).toContain('id="command-grid-panel"')
    expect(html).toContain('aria-labelledby="command-category-tab-all"')
  })
})
