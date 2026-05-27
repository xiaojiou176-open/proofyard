import type { ComponentProps } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { UniversalTemplate } from "../types"
import QuickLaunchView from "./QuickLaunchView"

vi.mock("../components/CommandGrid", () => ({
  default: () => null,
}))

vi.mock("../components/ParamsPanel", () => ({
  default: () => null,
}))

vi.mock("../components/EmptyState", () => ({
  default: () => null,
}))

const baseTemplate: UniversalTemplate = {
  template_id: "tpl-1",
  flow_id: "flow-abcdef123456",
  name: "示例模板",
  params_schema: [{ key: "email", type: "email", required: true }],
  defaults: { email: "demo@example.com" },
  policies: {
    retries: 0,
    timeout_seconds: 120,
    otp: {
      required: true,
      provider: "manual",
      timeout_seconds: 120,
      regex: "\\b(\\d{6})\\b",
      sender_filter: "",
      subject_filter: "",
    },
    branches: {},
  },
  created_by: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

function getButtonAttributes(html: string, label: string): string {
  const buttonPattern = /<button([^>]*)>([\s\S]*?)<\/button>/g
  let match = buttonPattern.exec(html)
  while (match) {
    const attrs = match[1] ?? ""
    const text = (match[2] ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
    if (text === label) {
      return attrs
    }
    match = buttonPattern.exec(html)
  }
  return ""
}

function renderFirstUseView(overrides?: Partial<ComponentProps<typeof QuickLaunchView>>) {
  return renderToStaticMarkup(
    <QuickLaunchView
      commands={[]}
      commandState="success"
      activeTab="all"
      submittingId=""
      feedbackText=""
      onActiveTabChange={() => {}}
      onRunCommand={() => {}}
      params={{
        baseUrl: "http://127.0.0.1:17380",
        startUrl: "",
        successSelector: "#ok",
        modelName: "models/gemini-3.1-pro-preview",
        registerPassword: "",
        automationToken: "",
        automationClientId: "client-001",
        headless: false,
        midsceneStrict: false,
      }}
      onParamsChange={() => {}}
      templates={[]}
      onCreateRun={() => {}}
      onRunParamsChange={() => {}}
      runParams={{}}
      onSelectedTemplateIdChange={() => {}}
      selectedTemplateId=""
      isFirstUseActive
      firstUseStage="configure"
      firstUseProgress={{ configValid: false, runTriggered: false, resultSeen: false }}
      canCompleteFirstUse={false}
      onFirstUseStageChange={() => {}}
      onCompleteFirstUse={() => {}}
      {...overrides}
    />
  )
}

describe("QuickLaunchView first-use guard rails", () => {
  it('disables "Configuration done, continue to run" before config becomes valid', () => {
    const html = renderFirstUseView()
    expect(html).toContain(
      "Enter a valid baseUrl, an optional startUrl, and a successSelector before continuing."
    )
    expect(getButtonAttributes(html, "Configuration done, continue to run")).toContain("disabled")
  })

  it("disables completion when result is not visible yet", () => {
    const html = renderFirstUseView({
      firstUseStage: "verify",
      firstUseProgress: { configValid: true, runTriggered: true, resultSeen: false },
      canCompleteFirstUse: false,
    })
    expect(html).toContain(
      "No success or failure result is visible yet. Wait for the task to finish in Task Center first."
    )
    expect(getButtonAttributes(html, "Complete the first-use guide")).toContain("disabled")
  })

  it("keeps the verify-stage wording aligned with Task Center then Recovery Center", () => {
    const html = renderFirstUseView({
      firstUseStage: "verify",
      firstUseProgress: { configValid: true, runTriggered: true, resultSeen: true },
      canCompleteFirstUse: true,
    })
    expect(html).toContain(
      "Step 3: switch to Task Center, confirm the result, and use Recovery Center there before raw logs or workshop replay."
    )
  })

  it("renders public English-first template copy", () => {
    const html = renderFirstUseView({
      firstUseStage: "run",
      firstUseProgress: { configValid: true, runTriggered: false, resultSeen: false },
      templates: [baseTemplate],
      selectedTemplateId: baseTemplate.template_id,
      runParams: { email: "demo@example.com" },
    })
    expect(html).toContain("Flow template:")
    expect(html).toContain("OTP")
    expect(html).toContain("Start run")
  })

  it("adds a clear exit condition before leaving Quick Launch", () => {
    const html = renderFirstUseView({
      firstUseStage: "run",
      firstUseProgress: { configValid: true, runTriggered: true, resultSeen: false },
      templates: [baseTemplate],
      selectedTemplateId: baseTemplate.template_id,
      runParams: { email: "demo@example.com" },
    })
    expect(html).toContain("Leave this page only when these three things are true")
    expect(html).toContain(
      "The parameter rail is valid, one canonical run is already visible, and your next click is to Task Center instead of a side road."
    )
  })

  it("exposes sidebar toggle state with aria-expanded and aria-controls", () => {
    const html = renderFirstUseView()
    const toggleAttrs = getButtonAttributes(html, "❮")
    expect(toggleAttrs).toContain('aria-expanded="true"')
    expect(toggleAttrs).toContain('aria-controls="quick-launch-params-panel"')
    expect(html).toContain('id="quick-launch-params-panel"')
  })
})
