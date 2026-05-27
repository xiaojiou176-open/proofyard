/* @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../i18n"
import type { EvidenceRun, EvidenceRunSummary } from "../types"
import TaskCenterView from "./TaskCenterView"

vi.mock("../components/TaskListPanel", () => ({
  default: () => <div data-testid="mock-task-list-panel" />,
}))

vi.mock("../components/TerminalPanel", () => ({
  default: () => <div data-testid="mock-terminal-panel" />,
}))

const selectedRun: EvidenceRun = {
  run_id: "run-selected",
  profile: "pr",
  target_name: "web.local",
  target_type: "web",
  gate_status: "passed",
  retention_state: "retained",
  started_at: "2026-03-31T09:00:00Z",
  finished_at: "2026-03-31T09:05:00Z",
  duration_ms: 300000,
  manifest_path: "manifest.json",
  summary_path: "reports/summary.json",
  missing_paths: [],
  provenance: {
    source: "canonical",
    correlation_id: "corr-selected",
    linked_run_ids: [],
    linked_task_ids: [],
  },
  available_paths: ["manifest.json", "reports/summary.json"],
  reports: { summary: "reports/summary.json" },
  proof_paths: { coverage: "reports/proof.coverage.json" },
  evidence_index_count: 1,
  state_count: 0,
  registry_state: "available",
  parse_error: null,
}

const candidateRun: EvidenceRunSummary = {
  run_id: "run-candidate",
  profile: "pr",
  target_name: "web.local",
  target_type: "web",
  gate_status: "failed",
  retention_state: "retained",
  started_at: "2026-03-31T08:00:00Z",
  finished_at: "2026-03-31T08:05:00Z",
  duration_ms: 301000,
  manifest_path: "manifest.json",
  summary_path: "reports/summary.json",
  missing_paths: [],
  provenance: {
    source: "canonical",
    correlation_id: "corr-candidate",
    linked_run_ids: [],
    linked_task_ids: [],
  },
}

type TaskCenterProps = React.ComponentProps<typeof TaskCenterView>

function createCompareBoardProps(overrides: Partial<TaskCenterProps> = {}): TaskCenterProps {
  return {
    tasks: [],
    taskState: "empty",
    selectedTaskId: "",
    taskErrorMessage: "",
    onSelectTask: () => {},
    onCancelTask: () => {},
    onRefreshTasks: () => {},
    statusFilter: "all",
    onStatusFilterChange: () => {},
    commandFilter: "",
    onCommandFilterChange: () => {},
    taskLimit: 20,
    onTaskLimitChange: () => {},
    logs: [],
    selectedTask: null,
    terminalRows: 8,
    onTerminalRowsChange: () => {},
    terminalFilter: "all",
    onTerminalFilterChange: () => {},
    autoScroll: true,
    onAutoScrollChange: () => {},
    onClearLogs: () => {},
    evidenceRuns: [selectedRun, candidateRun],
    evidenceRegistryState: "available",
    evidenceRunsState: "success",
    evidenceRunsError: "",
    selectedEvidenceRunId: selectedRun.run_id,
    selectedEvidenceRun: selectedRun,
    onSelectedEvidenceRunIdChange: () => {},
    compareCandidateRunId: candidateRun.run_id,
    onCompareCandidateRunIdChange: () => {},
    onRefreshEvidenceRuns: () => {},
    evidenceRunCompare: {
      baseline_run_id: selectedRun.run_id,
      candidate_run_id: candidateRun.run_id,
      compare_state: "ready",
      baseline_retention_state: "retained",
      candidate_retention_state: "retained",
      gate_status_delta: { baseline: "passed", candidate: "failed" },
      summary_delta: { duration_ms: 1000, failed_checks: 1, missing_artifacts: 0 },
      artifact_delta: {
        baseline_missing_paths: [],
        candidate_missing_paths: [],
        report_path_changes: [],
        proof_path_changes: [],
      },
    },
    evidenceRunCompareState: "success",
    evidenceRunCompareError: "",
    evidenceSharePack: {
      run_id: selectedRun.run_id,
      retention_state: "retained",
      compare: null,
      markdown_summary: "summary",
      issue_ready_snippet: "issue",
      release_appendix: "appendix",
      json_bundle: {
        run_id: selectedRun.run_id,
        retention_state: "retained",
        gate_status: "passed",
        missing_paths: [],
        compare: null,
      },
    },
    evidenceSharePackState: "success",
    evidenceSharePackError: "",
    failureExplanation: {
      run_id: selectedRun.run_id,
      summary: "summary",
      uncertainty: "uncertainty",
      evidence_anchors: [],
      next_actions: ["Explain it"],
    },
    failureExplanationState: "success",
    failureExplanationError: "",
    promotionCandidate: {
      run_id: selectedRun.run_id,
      eligible: false,
      retention_state: "retained",
      provenance_ready: true,
      share_pack_ready: true,
      compare_ready: true,
      review_state: "candidate",
      review_state_reason: "Review it first",
      reason_codes: [],
      release_reference: "release.md",
      showcase_reference: "showcase.md",
      supporting_share_pack_reference: "share-pack.md",
    },
    promotionCandidateState: "success",
    promotionCandidateError: "",
    hostedReviewWorkspace: {
      run_id: selectedRun.run_id,
      workspace_state: "review_ready",
      retention_state: "retained",
      compare_state: "ready",
      review_summary: "This packet is ready for human review.",
      next_review_step:
        "Share this review packet with the maintainer who needs the evidence-first summary.",
      explanation: {
        run_id: selectedRun.run_id,
        summary: "Explain the run first.",
        uncertainty: "This review workspace is local-first and not a hosted collaboration platform.",
        evidence_anchors: [],
        next_actions: ["Explain the run first."],
      },
      share_pack: {
        run_id: selectedRun.run_id,
        retention_state: "retained",
        compare: null,
        markdown_summary: "summary",
        issue_ready_snippet: "issue",
        release_appendix: "appendix",
        json_bundle: {
          run_id: selectedRun.run_id,
          retention_state: "retained",
          gate_status: "passed",
          missing_paths: [],
          compare: null,
        },
      },
      compare: null,
      promotion_candidate: {
        run_id: selectedRun.run_id,
        eligible: false,
        retention_state: "retained",
        provenance_ready: true,
        share_pack_ready: true,
        compare_ready: true,
        review_state: "candidate",
        review_state_reason: "Review it first",
        reason_codes: [],
        release_reference: "release.md",
        showcase_reference: "showcase.md",
        supporting_share_pack_reference: "share-pack.md",
      },
      recommended_order: ["Explain the run", "Read the share pack"],
    },
    hostedReviewWorkspaceState: "success",
    hostedReviewWorkspaceError: "",
    runs: [],
    selectedRunId: "",
    onSelectedRunIdChange: () => {},
    otpCode: "",
    onOtpCodeChange: () => {},
    onSubmitOtp: () => {},
    runRecoveryPlan: null,
    runRecoveryPlanState: "empty",
    runRecoveryPlanError: "",
    onReplayLatestFlow: () => {},
    onReplayStep: () => {},
    onResumeFromStep: () => {},
    onGoToLaunch: () => {},
    ...overrides,
  }
}

describe("TaskCenterView compare board", () => {
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

  it("shows compare board verdict and candidate selection for retained evidence", () => {
    const onCompareCandidateRunIdChange = vi.fn()

    act(() => {
      root.render(<TaskCenterView {...createCompareBoardProps({ onCompareCandidateRunIdChange })} />)
    })

    const evidenceTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Evidence Runs")
    )
    act(() => {
      evidenceTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(container.textContent).toContain("Compare board")
    expect(container.textContent).toContain("Regression risk higher")
    expect(container.textContent).toContain("Candidate run-cand")
    expect(container.textContent).toContain("Review Workspace")
    expect(container.textContent).toContain("Local-first review packet")
    expect(container.textContent).toContain("Recommended next operator move")
    expect(container.textContent).toContain("Open the review workspace")
    expect(container.textContent).toContain("Review ladder")
    expect(container.textContent).toContain("Prepare the share pack before widening handoff.")

    const select = container.querySelector("select") as HTMLSelectElement | null
    act(() => {
      if (select) {
        select.value = candidateRun.run_id
        select.dispatchEvent(new Event("change", { bubbles: true }))
      }
    })

    expect(select).not.toBeNull()
    expect(onCompareCandidateRunIdChange).toHaveBeenCalledWith(candidateRun.run_id)
  })

  it("renders operator ladder copy in Chinese under zh-CN locale", () => {
    act(() => {
      root.render(
        <I18nProvider locale="zh-CN" setLocale={() => {}}>
          <TaskCenterView {...createCompareBoardProps()} />
        </I18nProvider>
      )
    })

    const evidenceTab = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("证据运行")
    )
    act(() => {
      evidenceTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(container.textContent).toContain("推荐给操作员的下一步")
    expect(container.textContent).toContain("打开审阅工作区")
    expect(container.textContent).toContain("操作员决策阶梯")
    expect(container.textContent).toContain(
      "在把 promotion 当成默认下一步之前，先打开审阅工作区。"
    )
  })
})
