import type React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { it as caseIt, describe, expect, vi } from "vitest"
import {
  CONSOLE_TAB_FLOW_DRAFT_TEST_ID,
  CONSOLE_TAB_QUICK_LAUNCH_TEST_ID,
  CONSOLE_TAB_TASK_CENTER_TEST_ID,
} from "../constants/testIds"
import ConsoleHeader from "./ConsoleHeader"

vi.mock("./ui", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  TabsList: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  TabsTrigger: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}))

function getButtonAttributesByTestId(html: string, testId: string) {
  const marker = `data-testid="${testId}"`
  const buttonPattern = /<button([^>]*)>/g
  let match = buttonPattern.exec(html)
  while (match) {
    const attrs = match[1] ?? ""
    if (attrs.includes(marker)) {
      return attrs
    }
    match = buttonPattern.exec(html)
  }
  return ""
}

describe("ConsoleHeader tab semantics", () => {
  caseIt("exposes tab roles and aria-controls with roving tabindex", () => {
    const html = renderToStaticMarkup(
      <ConsoleHeader
        runningCount={1}
        successCount={2}
        failedCount={3}
        activeView="tasks"
        onViewChange={() => {}}
        onOpenHelp={() => {}}
        onRestartTour={() => {}}
      />
    )

    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-label="Primary navigation"')

    const quickLaunchTabAttrs = getButtonAttributesByTestId(html, CONSOLE_TAB_QUICK_LAUNCH_TEST_ID)
    const taskCenterTabAttrs = getButtonAttributesByTestId(html, CONSOLE_TAB_TASK_CENTER_TEST_ID)
    const flowDraftTabAttrs = getButtonAttributesByTestId(html, CONSOLE_TAB_FLOW_DRAFT_TEST_ID)

    expect(quickLaunchTabAttrs).toContain('role="tab"')
    expect(quickLaunchTabAttrs).toContain('aria-controls="app-view-launch-panel"')
    expect(quickLaunchTabAttrs).toContain('tabindex="-1"')

    expect(taskCenterTabAttrs).toContain('role="tab"')
    expect(taskCenterTabAttrs).toContain('aria-selected="true"')
    expect(taskCenterTabAttrs).toContain('aria-controls="app-view-tasks-panel"')
    expect(taskCenterTabAttrs).toContain('tabindex="0"')

    expect(flowDraftTabAttrs).toContain('role="tab"')
    expect(flowDraftTabAttrs).toContain('aria-controls="app-view-workshop-panel"')
    expect(flowDraftTabAttrs).toContain('tabindex="-1"')
  })
})
