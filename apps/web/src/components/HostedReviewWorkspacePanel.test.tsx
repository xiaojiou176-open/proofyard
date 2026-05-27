import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { I18nProvider } from "../i18n"
import HostedReviewWorkspacePanel from "./HostedReviewWorkspacePanel"

const workspace = {
  run_id: "run-a",
  workspace_state: "review_ready" as const,
  retention_state: "retained" as const,
  compare_state: "ready" as const,
  review_summary: "This packet is ready for human review.",
  next_review_step: "Share this review packet with the maintainer who needs the evidence-first summary.",
  explanation: {
    run_id: "run-a",
    summary: "Explain the run first.",
    uncertainty:
      "This review workspace is local-first and artifact-backed. It prepares a review packet, but it is not a hosted collaboration platform.",
    evidence_anchors: [],
    next_actions: ["Explain the run first."],
  },
  share_pack: {
    run_id: "run-a",
    retention_state: "retained" as const,
    compare: null,
    markdown_summary: "summary",
    issue_ready_snippet: "issue",
    release_appendix: "appendix",
    json_bundle: {
      run_id: "run-a",
      retention_state: "retained" as const,
      gate_status: "passed",
      missing_paths: [],
      compare: null,
    },
  },
  compare: null,
  promotion_candidate: {
    run_id: "run-a",
    eligible: false,
    retention_state: "retained" as const,
    provenance_ready: true,
    share_pack_ready: true,
    compare_ready: true,
    review_state: "candidate" as const,
    review_state_reason: "Review it first",
    reason_codes: [],
    release_reference: "release.md",
    showcase_reference: "showcase.md",
    supporting_share_pack_reference: "share-pack.md",
  },
  recommended_order: ["Explain the run", "Read the share pack", "Review compare context"],
}

describe("HostedReviewWorkspacePanel", () => {
  it("renders review packet hierarchy and packet health in English", () => {
    const html = renderToStaticMarkup(
      <HostedReviewWorkspacePanel state="success" error="" workspace={workspace} />
    )

    expect(html).toContain("Review Workspace")
    expect(html).toContain("Review-ready")
    expect(html).toContain("Packet health")
    expect(html).toContain("retained retention")
    expect(html).toContain("ready compare")
    expect(html).toContain("candidate promotion state")
    expect(html).toContain("Explain the run -&gt; Read the share pack -&gt; Review compare context")
    expect(html).toContain("Review ladder meaning")
  })

  it("localizes the review packet hierarchy under zh-CN locale", () => {
    const html = renderToStaticMarkup(
      <I18nProvider locale="zh-CN" setLocale={() => {}}>
        <HostedReviewWorkspacePanel state="success" error="" workspace={workspace} />
      </I18nProvider>
    )

    expect(html).toContain("审阅工作区")
    expect(html).toContain("可审阅")
    expect(html).toContain("审阅包健康度")
    expect(html).toContain("已保留 保留")
    expect(html).toContain("就绪 对比")
    expect(html).toContain("候选 promotion 状态")
    expect(html).toContain("解释这次运行 -&gt; 阅读分享包 -&gt; 审查 compare 上下文")
    expect(html).toContain("审阅阶梯含义")
  })
})
