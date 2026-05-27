import {
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react"
import DetailFieldRow from "../components/DetailFieldRow"
import EvidenceRunComparePanel from "../components/EvidenceRunComparePanel"
import EvidenceSharePackPanel from "../components/EvidenceSharePackPanel"
import EmptyState from "../components/EmptyState"
import FailureExplainerPanel from "../components/FailureExplainerPanel"
import HostedReviewWorkspacePanel from "../components/HostedReviewWorkspacePanel"
import LogStream from "../components/LogStream"
import RecoveryCenterPanel from "../components/RecoveryCenterPanel"
import RunDetailCard from "../components/RunDetailCard"
import TaskListPanel from "../components/TaskListPanel"
import TerminalPanel from "../components/TerminalPanel"
import { Badge, Button, Card, TabsList, TabsTrigger } from "@uiq/ui"
import {
  TASK_CENTER_COMMAND_RUNS_REFRESH_TEST_ID,
  TASK_CENTER_PANEL_COMMAND_RUNS_TEST_ID,
  TASK_CENTER_PANEL_TEMPLATE_RUNS_TEST_ID,
  TASK_CENTER_TAB_COMMAND_RUNS_TEST_ID,
  TASK_CENTER_TAB_TEMPLATE_RUNS_TEST_ID,
  TASK_CENTER_TEMPLATE_RUNS_REFRESH_TEST_ID,
} from "../constants/testIds"
import { useI18n } from "../i18n"
import { formatActionableErrorMessage } from "../shared/errorFormatter"
import type {
  EvidenceRegistryState,
  EvidenceRun,
  EvidenceRunCompare,
  EvidenceSharePack,
  EvidenceRunSummary,
  FailureExplanation,
  HostedReviewWorkspace,
  LogEntry,
  LogLevel,
  PromotionCandidate,
  RunRecoveryPlan,
  RunRecordSource,
  Task,
  TaskState,
  UniversalRun,
} from "../types"
import { RUN_RECORD_SOURCE_LABEL, UNIVERSAL_RUN_STATUS_LABEL } from "../types"

interface TaskCenterViewProps {
  tasks: Task[]
  taskState: TaskState
  selectedTaskId: string
  taskErrorMessage: string
  onSelectTask: (taskId: string) => void
  onCancelTask: (task: Task) => void
  onRefreshTasks: () => void
  statusFilter: string
  onStatusFilterChange: (value: string) => void
  commandFilter: string
  onCommandFilterChange: (value: string) => void
  taskLimit: number
  onTaskLimitChange: (value: number) => void
  // Terminal
  logs: LogEntry[]
  selectedTask: Task | null
  terminalRows: number
  onTerminalRowsChange: (rows: number) => void
  terminalFilter: "all" | LogLevel
  onTerminalFilterChange: (filter: "all" | LogLevel) => void
  autoScroll: boolean
  onAutoScrollChange: (value: boolean) => void
  onClearLogs: () => void
  evidenceRuns?: EvidenceRunSummary[]
  evidenceRegistryState?: EvidenceRegistryState
  evidenceRunsState?: TaskState
  evidenceRunsError?: string
  selectedEvidenceRunId?: string
  selectedEvidenceRun?: EvidenceRun | null
  onSelectedEvidenceRunIdChange?: (id: string) => void
  compareCandidateRunId?: string
  onCompareCandidateRunIdChange?: (id: string) => void
  onRefreshEvidenceRuns?: () => void
  evidenceRunCompare?: EvidenceRunCompare | null
  evidenceRunCompareState?: TaskState
  evidenceRunCompareError?: string
  evidenceSharePack?: EvidenceSharePack | null
  evidenceSharePackState?: TaskState
  evidenceSharePackError?: string
  failureExplanation?: FailureExplanation | null
  failureExplanationState?: TaskState
  failureExplanationError?: string
  promotionCandidate?: PromotionCandidate | null
  promotionCandidateState?: TaskState
  promotionCandidateError?: string
  hostedReviewWorkspace?: HostedReviewWorkspace | null
  hostedReviewWorkspaceState?: TaskState
  hostedReviewWorkspaceError?: string
  // Runs integration
  runs: UniversalRun[]
  selectedRunId: string
  onSelectedRunIdChange: (id: string) => void
  otpCode: string
  onOtpCodeChange: (code: string) => void
  onSubmitOtp: (
    runId: string,
    status: UniversalRun["status"],
    waitContext?: UniversalRun["wait_context"]
  ) => void
  runRecoveryPlan?: RunRecoveryPlan | null
  runRecoveryPlanState?: TaskState
  runRecoveryPlanError?: string
  onReplayLatestFlow: () => void
  onReplayStep: (stepId: string) => void
  onResumeFromStep: (stepId: string) => void
  onGoToLaunch: () => void
}

const runStatusLabel: Record<UniversalRun["status"], string> = UNIVERSAL_RUN_STATUS_LABEL

const runRecordSourceLabel: Record<RunRecordSource, string> = RUN_RECORD_SOURCE_LABEL

const subTabIds = {
  tasks: "task-center-tab-command-runs",
  runs: "task-center-tab-template-runs",
  evidence: "task-center-tab-evidence-runs",
} as const

const subPanelIds = {
  tasks: "task-center-panel-command-runs",
  runs: "task-center-panel-template-runs",
  evidence: "task-center-panel-evidence-runs",
} as const

const subTabOrder: Array<"tasks" | "runs" | "evidence"> = ["tasks", "runs", "evidence"]
const subTabCount = subTabOrder.length

function buildCompareVerdict(
  compare: EvidenceRunCompare | null,
  t: (message: string, values?: Record<string, string | number>) => string
): {
  label: string
  summary: string
} {
  if (!compare) {
    return {
      label: t("Compare not ready"),
      summary: t(
        "Choose another retained run to form a baseline-versus-candidate judgment before you move into sharing or promotion."
      ),
    }
  }
  if (compare.compare_state === "partial_compare") {
    return {
      label: t("Partial compare"),
      summary: t(
        "This compare still provides context, but the evidence is incomplete. Treat it as a warning light, not as a release or promotion verdict."
      ),
    }
  }
  const failedChecksDelta = compare.summary_delta.failed_checks ?? 0
  const missingArtifactsDelta = compare.summary_delta.missing_artifacts
  if (failedChecksDelta > 0 || missingArtifactsDelta > 0) {
    return {
      label: t("Regression risk higher"),
      summary: t(
        "The candidate run looks less steady than the baseline. Review the changed checks and missing evidence before you share or promote it."
      ),
    }
  }
  if (failedChecksDelta < 0 || missingArtifactsDelta < 0) {
    return {
      label: t("Looks steadier than baseline"),
      summary: t(
        "The candidate run improved on the baseline. Confirm the evidence and share-pack summary before using it for wider handoff."
      ),
    }
  }
  return {
    label: t("Stable versus baseline"),
    summary: t(
      "The candidate run is broadly aligned with the baseline. Explain the result, then use share pack or promotion guidance as the next review steps."
    ),
  }
}

function localizeRunRecordSource(
  source: RunRecordSource,
  t: (message: string, values?: Record<string, string | number>) => string
) {
  return t(runRecordSourceLabel[source])
}

function localizeRunStatus(
  status: UniversalRun["status"],
  t: (message: string, values?: Record<string, string | number>) => string
) {
  return t(runStatusLabel[status])
}

function localizeRetentionState(
  value: string,
  t: (message: string, values?: Record<string, string | number>) => string
) {
  return t(value)
}

function buildEvidenceNextStep(
  selectedEvidenceRun: EvidenceRun | null,
  failureExplanation: FailureExplanation | null,
  evidenceSharePack: EvidenceSharePack | null,
  evidenceRunCompare: EvidenceRunCompare | null,
  hostedReviewWorkspace: HostedReviewWorkspace | null,
  promotionReady: boolean,
  t: (message: string, values?: Record<string, string | number>) => string
) {
  if (!selectedEvidenceRun) return null
  if (selectedEvidenceRun.retention_state !== "retained") {
    return {
      label: t("Retain the evidence bundle first"),
      summary: t(
        "Keep this run out of sharing and promotion decisions until the retained bundle is complete."
      ),
    }
  }
  if (!failureExplanation) {
    return {
      label: t("Explain the run first"),
      summary: t(
        "Use the explainer before compare or promotion so the operator has one grounded reading of what happened."
      ),
    }
  }
  if (!evidenceSharePack) {
    return {
      label: t("Prepare the share pack"),
      summary: t(
        "Package the current run into a handoff-friendly summary before you widen review or promotion discussion."
      ),
    }
  }
  if (evidenceRunCompare?.compare_state === "partial_compare") {
    return {
      label: t("Resolve compare gaps"),
      summary: t(
        "The compare still gives context, but it is not strong enough for a confident handoff or promotion judgment."
      ),
    }
  }
  if (hostedReviewWorkspace?.workspace_state === "review_ready") {
    return {
      label: t("Open the review workspace"),
      summary: t(
        "The packet is ready for maintainer-facing review. Use that surface before you treat promotion as the next default move."
      ),
    }
  }
  if (promotionReady) {
    return {
      label: t("Review promotion guidance"),
      summary: t(
        "The retained run already looks strong enough for promotion review, but promotion should still stay downstream of explanation and review."
      ),
    }
  }
  return {
    label: t("Compare before handoff"),
    summary: t(
      "Use a retained baseline comparison before you widen the handoff, even if the current run already looks healthy."
    ),
  }
}

function localizeEvidenceRegistryState(
  value: EvidenceRegistryState,
  t: (message: string, values?: Record<string, string | number>) => string
) {
  return t(value)
}

function TaskCenterView({
  tasks,
  taskState,
  selectedTaskId,
  taskErrorMessage,
  onSelectTask,
  onCancelTask,
  onRefreshTasks,
  statusFilter,
  onStatusFilterChange,
  commandFilter,
  onCommandFilterChange,
  taskLimit,
  onTaskLimitChange,
  logs,
  selectedTask,
  terminalRows,
  onTerminalRowsChange,
  terminalFilter,
  onTerminalFilterChange,
  autoScroll,
  onAutoScrollChange,
  onClearLogs,
  evidenceRuns = [],
  evidenceRegistryState = "missing",
  evidenceRunsState = "empty",
  evidenceRunsError = "",
  selectedEvidenceRunId = "",
  selectedEvidenceRun = null,
  onSelectedEvidenceRunIdChange = () => {},
  compareCandidateRunId = "",
  onCompareCandidateRunIdChange = () => {},
  onRefreshEvidenceRuns = () => {},
  evidenceRunCompare = null,
  evidenceRunCompareState = "empty",
  evidenceRunCompareError = "",
  evidenceSharePack = null,
  evidenceSharePackState = "empty",
  evidenceSharePackError = "",
  failureExplanation = null,
  failureExplanationState = "empty",
  failureExplanationError = "",
  promotionCandidate = null,
  hostedReviewWorkspace = null,
  hostedReviewWorkspaceState = "empty",
  hostedReviewWorkspaceError = "",
  runs,
  selectedRunId,
  onSelectedRunIdChange,
  otpCode,
  onOtpCodeChange,
  onSubmitOtp,
  runRecoveryPlan = null,
  runRecoveryPlanState = "empty",
  runRecoveryPlanError = "",
  onReplayLatestFlow,
  onReplayStep,
  onResumeFromStep,
  onGoToLaunch,
}: TaskCenterViewProps) {
  const { t } = useI18n()
  const runRecordDetailHintText = t(
    "Run Record Details: Source / Status / Progress / Timeline / Output"
  )
  const [subTab, setSubTab] = useState<"tasks" | "runs" | "evidence">("tasks")
  const subTabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const comparePanelRef = useRef<HTMLDivElement | null>(null)
  const sharePackPanelRef = useRef<HTMLDivElement | null>(null)
  const failurePanelRef = useRef<HTMLDivElement | null>(null)
  const reviewWorkspacePanelRef = useRef<HTMLDivElement | null>(null)
  const promotionPanelRef = useRef<HTMLDivElement | null>(null)

  const selectedRun = runs.find((r) => r.run_id === selectedRunId) ?? null
  const selectedRunIndex = useMemo(
    () => runs.findIndex((run) => run.run_id === selectedRunId),
    [runs, selectedRunId]
  )
  const selectedRunOptionId = selectedRun
    ? `task-center-template-option-${selectedRun.run_id}`
    : undefined
  const runningTasks = tasks.filter((task) => task.status === "running").length
  const waitingRuns = runs.filter(
    (run) => run.status === "waiting_otp" || run.status === "waiting_user"
  ).length
  const taskFailures = tasks.filter((task) => task.status === "failed").length
  const evidenceRunCount = evidenceRuns.length
  const selectedEvidenceRunOptionId = selectedEvidenceRun
    ? `task-center-evidence-option-${selectedEvidenceRun.run_id}`
    : undefined
  const compareCandidateOptions = evidenceRuns.filter((run) => run.run_id !== selectedEvidenceRunId)
  const effectiveCompareCandidateId =
    (compareCandidateRunId &&
      compareCandidateOptions.some((run) => run.run_id === compareCandidateRunId) &&
      compareCandidateRunId) ||
    compareCandidateOptions.find((run) => run.retention_state === "retained")?.run_id ||
    compareCandidateOptions[0]?.run_id ||
    ""
  const compareCandidateSummary =
    compareCandidateOptions.find((run) => run.run_id === effectiveCompareCandidateId) ?? null
  const compareVerdict = buildCompareVerdict(evidenceRunCompare, t)
  const promotionReady =
    promotionCandidate?.eligible ??
    (selectedEvidenceRun?.retention_state === "retained" &&
      Boolean(selectedEvidenceRun.provenance.source) &&
      Boolean(evidenceSharePack?.markdown_summary.trim()))
  const promotionGuidance = !selectedEvidenceRun
    ? ""
    : selectedEvidenceRun.retention_state !== "retained"
      ? t(
          "Promotion should wait until this run is retained. Treat missing or partial evidence as a review blocker, not as release-ready proof."
        )
      : !selectedEvidenceRun.provenance.source
        ? t(
            "Promotion should wait until provenance is attached. A retained bundle without provenance is still missing part of the trust story."
          )
        : promotionCandidate
          ? t(promotionCandidate.review_state_reason)
          : promotionReady
          ? t(
              "This retained run already has provenance and a shareable summary. Review it as a promotion candidate after you explain or share the evidence."
            )
          : t("Promotion becomes useful after you generate and review the evidence share pack.")
  const evidenceNextStep = buildEvidenceNextStep(
    selectedEvidenceRun,
    failureExplanation,
    evidenceSharePack,
    evidenceRunCompare,
    hostedReviewWorkspace,
    promotionReady,
    t
  )

  const focusSubTab = useCallback((targetIndex: number) => {
    const normalizedIndex = ((targetIndex % subTabCount) + subTabCount) % subTabCount
    subTabRefs.current[normalizedIndex]?.focus()
  }, [])

  const activateSubTab = useCallback((targetIndex: number) => {
    const normalizedIndex = ((targetIndex % subTabCount) + subTabCount) % subTabCount
    setSubTab(subTabOrder[normalizedIndex])
  }, [])
  const jumpToPanel = useCallback((panel: { current: HTMLDivElement | null }) => {
    panel.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [])

  const handleSubTabKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
      if (event.key === "ArrowRight") {
        event.preventDefault()
        focusSubTab(index + 1)
        return
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        focusSubTab(index - 1)
        return
      }
      if (event.key === "Home") {
        event.preventDefault()
        focusSubTab(0)
        return
      }
      if (event.key === "End") {
        event.preventDefault()
        focusSubTab(subTabCount - 1)
        return
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        activateSubTab(index)
      }
    },
    [activateSubTab, focusSubTab]
  )

  const handleTemplateRunsListKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLUListElement>) => {
      if (runs.length === 0) return
      const currentIndex = selectedRunIndex >= 0 ? selectedRunIndex : 0
      let nextIndex = currentIndex

      if (event.key === "ArrowDown") {
        event.preventDefault()
        nextIndex = (currentIndex + 1) % runs.length
      } else if (event.key === "ArrowUp") {
        event.preventDefault()
        nextIndex = (currentIndex - 1 + runs.length) % runs.length
      } else if (event.key === "Home") {
        event.preventDefault()
        nextIndex = 0
      } else if (event.key === "End") {
        event.preventDefault()
        nextIndex = runs.length - 1
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        onSelectedRunIdChange(runs[currentIndex].run_id)
        return
      } else {
        return
      }

      onSelectedRunIdChange(runs[nextIndex].run_id)
    },
    [onSelectedRunIdChange, runs, selectedRunIndex]
  )

  const formatRunErrorMessage = (message: string): string =>
    formatActionableErrorMessage(message, {
      action: t("Correct the current step input and retry."),
      troubleshootingEntry: t("Review the run log and the Task Center detail panel on this page."),
    })

  return (
    <div
      className="task-center-view"
      id="app-view-tasks-panel"
      role="tabpanel"
      aria-labelledby="console-tab-tasks"
    >
      <div className="task-list-column">
        <Card className="task-center-hero-card">
          <div className="task-center-hero">
            <div className="task-center-hero-copy">
              <p className="launch-section-kicker">{t("Operations Deck")}</p>
              <h2 className="task-center-hero-title">
                {t("Locate the current run first, then narrow the problem through status, details, and terminal output")}
              </h2>
              <p className="task-center-hero-body">
                {t(
                  "Use the left side to filter and switch between run records, the right side to focus the current context, and the bottom terminal to explain what happened. Start with the main run before diving into deeper debugging actions."
                )}
              </p>
            </div>
            <div className="task-center-hero-stats">
              <div className="task-center-stat">
                <span className="task-center-stat-label">{t("Running")}</span>
                <strong className="task-center-stat-value">{runningTasks}</strong>
              </div>
              <div className="task-center-stat">
                <span className="task-center-stat-label">{t("Waiting")}</span>
                <strong className="task-center-stat-value">{waitingRuns}</strong>
              </div>
              <div className="task-center-stat">
                <span className="task-center-stat-label">{t("Failed records")}</span>
                <strong className="task-center-stat-value danger">{taskFailures}</strong>
              </div>
            </div>
          </div>
        </Card>
        {/* Sub-tabs for command/template run records */}
        <div role="tablist" aria-label={t("Task Center run record types")}>
          <TabsList className="task-center-subtabs">
            <TabsTrigger
            ref={(node: HTMLButtonElement | null) => {
              subTabRefs.current[0] = node
            }}
            id={subTabIds.tasks}
            active={subTab === "tasks"}
            className="task-center-subtab-trigger"
            role="tab"
            aria-selected={subTab === "tasks"}
            aria-controls={subPanelIds.tasks}
            tabIndex={subTab === "tasks" ? 0 : -1}
            onClick={() => setSubTab("tasks")}
            onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => handleSubTabKeyDown(event, 0)}
            data-testid={TASK_CENTER_TAB_COMMAND_RUNS_TEST_ID}
          >
            {t("Run Records (Command)")}
            <span className="task-center-subtab-count">{tasks.length}</span>
            </TabsTrigger>
            <TabsTrigger
            ref={(node: HTMLButtonElement | null) => {
              subTabRefs.current[1] = node
            }}
            id={subTabIds.runs}
            active={subTab === "runs"}
            className="task-center-subtab-trigger"
            role="tab"
            aria-selected={subTab === "runs"}
            aria-controls={subPanelIds.runs}
            tabIndex={subTab === "runs" ? 0 : -1}
            onClick={() => setSubTab("runs")}
            onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => handleSubTabKeyDown(event, 1)}
            data-testid={TASK_CENTER_TAB_TEMPLATE_RUNS_TEST_ID}
          >
            {t("Run Records (Template)")}
            <span className="task-center-subtab-count">{runs.length}</span>
            </TabsTrigger>
            <TabsTrigger
              ref={(node: HTMLButtonElement | null) => {
                subTabRefs.current[2] = node
              }}
              id={subTabIds.evidence}
              active={subTab === "evidence"}
              className="task-center-subtab-trigger"
              role="tab"
              aria-selected={subTab === "evidence"}
              aria-controls={subPanelIds.evidence}
              tabIndex={subTab === "evidence" ? 0 : -1}
              onClick={() => setSubTab("evidence")}
              onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => handleSubTabKeyDown(event, 2)}
            >
              {t("Evidence Runs")}
              <span className="task-center-subtab-count">{evidenceRunCount}</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <div
          id={subPanelIds.tasks}
          role="tabpanel"
          aria-labelledby={subTabIds.tasks}
          hidden={subTab !== "tasks"}
          data-testid={TASK_CENTER_PANEL_COMMAND_RUNS_TEST_ID}
        >
          <TaskListPanel
            tasks={tasks}
            taskState={taskState}
            selectedTaskId={selectedTaskId}
            taskErrorMessage={taskErrorMessage}
            onSelectTask={onSelectTask}
            onCancelTask={onCancelTask}
            onRefresh={onRefreshTasks}
            statusFilter={statusFilter}
            onStatusFilterChange={onStatusFilterChange}
            commandFilter={commandFilter}
            onCommandFilterChange={onCommandFilterChange}
            taskLimit={taskLimit}
            onTaskLimitChange={onTaskLimitChange}
            listTitle={t("Run Records")}
            sourceLabel={localizeRunRecordSource("command", t)}
            emptyTitle={t("No run records yet")}
            emptyDescription={t("Run a command from Quick Launch to see records here.")}
            refreshTestId={TASK_CENTER_COMMAND_RUNS_REFRESH_TEST_ID}
          />
        </div>
        <div
          id={subPanelIds.runs}
          role="tabpanel"
          aria-labelledby={subTabIds.runs}
          hidden={subTab !== "runs"}
          data-testid={TASK_CENTER_PANEL_TEMPLATE_RUNS_TEST_ID}
        >
          <div className="form-row justify-between">
            <h2 className="section-title m-0">{t("Run Records")}</h2>
            <Button
              variant="ghost"
              size="sm"
              data-testid={TASK_CENTER_TEMPLATE_RUNS_REFRESH_TEST_ID}
              data-uiq-ignore-button-inventory="task-center-template-runs-refresh-secondary-action"
              onClick={onRefreshTasks}
            >
              {t("Refresh")}
            </Button>
          </div>
          {runs.length === 0 ? (
            <EmptyState
              icon={
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M8 12h8" />
                </svg>
              }
              title={t("No run records yet")}
              description={t("Template run records appear here after you select a template and start a run from Quick Launch.")}
              action={{ label: t("Go to Quick Launch"), onClick: onGoToLaunch }}
            />
          ) : (
            <ul
              className="task-list"
              role="listbox"
              aria-label={t("Run records list (template)")}
              aria-activedescendant={selectedRunOptionId}
              tabIndex={0}
              onKeyDown={handleTemplateRunsListKeyDown}
            >
              {runs.map((run) => (
                <li
                  key={run.run_id}
                  id={`task-center-template-option-${run.run_id}`}
                  className={`task-item ${selectedRunId === run.run_id ? "active" : ""}`}
                  role="option"
                  aria-selected={selectedRunId === run.run_id}
                  onClick={() => onSelectedRunIdChange(run.run_id)}
                >
                  <div className="task-item-info">
                    <strong>{`${localizeRunRecordSource("template", t)} \u00B7 ${t("Record #{id}", { id: run.run_id.slice(0, 8) })}`}</strong>
                    <p>{`${localizeRunStatus(run.status, t)} \u00B7 ${t("Step {count}", { count: run.step_cursor })}`}</p>
                  </div>
                  <Badge variant={run.status === "success" ? "success" : "default"}>
                    {localizeRunStatus(run.status, t)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div
          id={subPanelIds.evidence}
          role="tabpanel"
          aria-labelledby={subTabIds.evidence}
          hidden={subTab !== "evidence"}
        >
          <div className="form-row justify-between">
            <h2 className="section-title m-0">{t("Evidence Runs")}</h2>
            <Button
              variant="ghost"
              size="sm"
              data-uiq-ignore-button-inventory="task-center-evidence-runs-refresh-secondary-action"
              onClick={onRefreshEvidenceRuns}
            >
              {t("Refresh")}
            </Button>
          </div>
          {evidenceRunsState === "error" ? (
            <EmptyState
              icon={
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v5" />
                  <path d="M12 16h.01" />
                </svg>
              }
              title={t("Evidence run history is unavailable")}
              description={evidenceRunsError || t("The backend could not load canonical evidence runs.")}
            />
          ) : evidenceRuns.length === 0 ? (
            <EmptyState
              eyebrow={t("Evidence state: {state}", {
                state: localizeEvidenceRegistryState(evidenceRegistryState, t),
              })}
              icon={
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M8 12h8" />
                </svg>
              }
              title={
                evidenceRegistryState === "missing"
                  ? t("No canonical evidence surface yet")
                  : t("No retained evidence runs yet")
              }
              description={
                evidenceRegistryState === "missing"
                  ? t("Webaudit cannot find the canonical runs directory in this checkout yet. Start with the canonical run first so the manifest-backed evidence surface can exist.")
                  : t("The canonical runs directory exists, but there are no retained evidence runs to inspect yet. Run the canonical path first, then come back here to explain, share, or compare the result.")
              }
              supportingNote={
                evidenceRegistryState === "missing"
                  ? t("This tab becomes useful after the first canonical run creates the manifest, summary, and proof reports.")
                  : t("A retained run is the point where you can safely explain, share, compare, and think about promotion.")
              }
              action={{
                label:
                  evidenceRegistryState === "missing"
                    ? t("Go to Quick Launch")
                    : t("Run the canonical flow"),
                onClick: onGoToLaunch,
              }}
            />
          ) : (
            <ul
              className="task-list"
              role="listbox"
              aria-label={t("Canonical evidence runs list")}
              aria-activedescendant={selectedEvidenceRunOptionId}
              tabIndex={0}
            >
              {evidenceRuns.map((run) => (
                <li
                  key={run.run_id}
                  id={`task-center-evidence-option-${run.run_id}`}
                  className={`task-item ${selectedEvidenceRunId === run.run_id ? "active" : ""}`}
                  role="option"
                  aria-selected={selectedEvidenceRunId === run.run_id}
                  onClick={() => onSelectedEvidenceRunIdChange(run.run_id)}
                >
                  <div className="task-item-info">
                    <strong>{t("Evidence Run #{id}", { id: run.run_id.slice(0, 8) })}</strong>
                    <p>{`${t(run.gate_status ?? "unknown")} · ${localizeRetentionState(run.retention_state, t)}`}</p>
                  </div>
                  <Badge variant={run.retention_state === "retained" ? "success" : "default"}>
                    {localizeRetentionState(run.retention_state, t)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="task-detail-column">
        <Card className="task-center-summary-card">
          <div className="task-center-summary-row">
            <div>
              <p className="launch-section-kicker">{t("Current Focus")}</p>
              <h3 className="launch-section-title">
              {subTab === "tasks"
                  ? t("Command run context")
                  : subTab === "runs"
                    ? t("Template run context")
                    : t("Canonical evidence context")}
              </h3>
            </div>
            <Badge variant={subTab === "tasks" ? "secondary" : "success"}>
              {subTab === "tasks"
                ? t("Command mainline")
                : subTab === "runs"
                  ? t("Template mainline")
                  : t("Evidence registry")}
            </Badge>
          </div>
          <p className="task-center-summary-desc">
            {subTab === "tasks"
              ? t("Check the current task status, errors, and output first, then decide whether to cancel or retry.")
              : subTab === "runs"
                ? t("Check whether the template run needs input, is waiting to resume, or needs step log review before doing anything else.")
                : t("Inspect retained versus missing evidence first, then follow the linked run and task identifiers before drilling into screenshots, proof, or reports.")}
          </p>
        </Card>

        {subTab === "tasks" ? (
          selectedTask ? (
            <RunDetailCard
              title={t("Run Record #{id}", { id: selectedTask.task_id.slice(0, 8) })}
              status={t(selectedTask.status)}
              isSuccess={selectedTask.status === "success"}
              detailHint={runRecordDetailHintText}
            >
              <DetailFieldRow
                fields={[
                  { label: t("Source"), value: localizeRunRecordSource("command", t) },
                  { label: t("Command ID"), value: selectedTask.command_id },
                  {
                    label: t("Attempt"),
                    value: `${selectedTask.attempt} / ${selectedTask.max_attempts}`,
                  },
                ]}
              />
              <DetailFieldRow
                fields={[
                  { label: t("Created At"), value: new Date(selectedTask.created_at).toLocaleString() },
                  selectedTask.finished_at
                    ? {
                        label: t("Finished At"),
                        value: new Date(selectedTask.finished_at).toLocaleString(),
                      }
                    : null,
                ]}
              />
              {selectedTask.message && (
                <div className="field">
                  <span className="field-label">{t("Message")}</span>
                  <span className="hint-text">{selectedTask.message}</span>
                </div>
              )}
              {selectedTask.exit_code !== null && selectedTask.exit_code !== undefined && (
                <div className="field">
                  <span className="field-label">{t("Exit Code")}</span>
                  <span className="text-sm">{selectedTask.exit_code}</span>
                </div>
              )}
            </RunDetailCard>
          ) : (
            <EmptyState
              icon={
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M9 9h6M9 13h4" />
                </svg>
              }
              title={t("Select a run record to inspect the details")}
              description={t("Choose a record from the command run list on the left to inspect its details and output log.")}
            />
          )
        ) : subTab === "runs" ? (
          selectedRun ? (
          <RunDetailCard
            title={t("Run Record #{id}", { id: selectedRun.run_id.slice(0, 8) })}
            status={localizeRunStatus(selectedRun.status, t)}
            isSuccess={selectedRun.status === "success"}
            detailHint={runRecordDetailHintText}
          >
            <DetailFieldRow
              fields={[
                { label: t("Source"), value: localizeRunRecordSource("template", t) },
                { label: t("Template ID"), value: selectedRun.template_id.slice(0, 12) },
                { label: t("Step Progress"), value: `${t("Step")} ${selectedRun.step_cursor}` },
              ]}
            />
            <DetailFieldRow
              fields={[
                { label: t("Created At"), value: new Date(selectedRun.created_at).toLocaleString() },
              ]}
            />
            {selectedRun.last_error && (
              <div className="field">
                <span className="field-label">{t("Last Error")}</span>
                <span className="error-text">{formatRunErrorMessage(selectedRun.last_error)}</span>
              </div>
            )}
            {selectedRun.logs && selectedRun.logs.length > 0 && (
              <div className="mt-3">
                <h3 className="section-subtitle">{t("Run Log")}</h3>
                <LogStream logs={selectedRun.logs} />
              </div>
            )}
            <RecoveryCenterPanel
              plan={runRecoveryPlan}
              state={runRecoveryPlanState}
              error={runRecoveryPlanError}
              otpCode={otpCode}
              onOtpCodeChange={onOtpCodeChange}
              onSubmitOtp={onSubmitOtp}
              onReplayLatestFlow={onReplayLatestFlow}
              onReplayStep={onReplayStep}
              onResumeFromStep={onResumeFromStep}
              waitContext={selectedRun.wait_context}
              onInspectTask={(taskId) => {
                setSubTab("tasks")
                onSelectTask(taskId)
              }}
            />
          </RunDetailCard>
          ) : (
          <EmptyState
            icon={
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 9h6M9 13h4" />
              </svg>
            }
            title={t("Select a run record to inspect the details")}
            description={t("Choose a record from the template run list on the left to inspect its status, parameters, and logs.")}
          />
          )
        ) : selectedEvidenceRun ? (
          <RunDetailCard
            title={t("Evidence Run #{id}", { id: selectedEvidenceRun.run_id.slice(0, 8) })}
            status={t(selectedEvidenceRun.gate_status ?? "unknown")}
            isSuccess={selectedEvidenceRun.retention_state === "retained"}
            detailHint={t("Canonical evidence keeps the run bundle inspectable even when the runtime directory later changes.")}
          >
            <div className="field mb-3">
              <span className="field-label">{t("Why this evidence matters")}</span>
              <span className="hint-text">
                {selectedEvidenceRun.retention_state === "retained"
                  ? t("This run is retained, so it is the best place to explain what happened, prepare a share pack, compare against another run, and decide whether it is ready to promote.")
                  : selectedEvidenceRun.retention_state === "missing"
                    ? t("This run is missing required proof paths. Read the explanation first and avoid treating it as an authoritative result.")
                    : selectedEvidenceRun.retention_state === "partial"
                      ? t("This run is only partially retained. Check the missing paths before you share or promote it.")
                      : t("This run has no retained evidence yet. Start from the canonical path again before relying on it.")}
              </span>
            </div>
            <div className="field mb-3">
              <span className="field-label">{t("Compare board")}</span>
              <div className="form-row flex-wrap gap-2 mt-2">
                <Badge variant={evidenceRunCompare?.compare_state === "ready" ? "success" : "secondary"}>
                  {compareVerdict.label}
                </Badge>
                {compareCandidateSummary && (
                  <Badge variant="outline">
                    {t("Candidate {id} · {retentionState}", {
                      id: compareCandidateSummary.run_id.slice(0, 8),
                      retentionState: localizeRetentionState(compareCandidateSummary.retention_state, t),
                    })}
                  </Badge>
                )}
              </div>
              <p className="hint-text mt-2">{compareVerdict.summary}</p>
              {compareCandidateOptions.length > 0 ? (
                <label className="field mt-2">
                  <span className="field-label">{t("Baseline candidate")}</span>
                  <select
                    value={effectiveCompareCandidateId}
                    onChange={(event) => onCompareCandidateRunIdChange(event.currentTarget.value)}
                  >
                    {compareCandidateOptions.map((run) => (
                      <option key={run.run_id} value={run.run_id}>
                        {`${run.run_id.slice(0, 8)} · ${localizeRetentionState(run.retention_state, t)} · ${t(run.gate_status ?? "unknown")}`}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="hint-text mt-2">
                  {t("You need another retained evidence run before compare becomes a useful judgment surface.")}
                </p>
              )}
            </div>
            <div className="field-group">
              {evidenceNextStep && (
                <div className="field">
                  <span className="field-label">{t("Recommended next operator move")}</span>
                  <strong className="hint-text">{evidenceNextStep.label}</strong>
                  <p className="hint-text mt-1">{evidenceNextStep.summary}</p>
                </div>
              )}
              <div className="field">
                <span className="field-label">{t("Operator decision ladder")}</span>
                <p className="hint-text mt-1">
                  {t("Use the recommended move first, then continue in this order so the operator story stays explainable and reviewable.")}
                </p>
                <ol className="hint-text">
                  <li>{t("Explain first, before raw logs or promotion.")}</li>
                  <li>{t("Prepare the share pack before widening handoff.")}</li>
                  <li>{t("Compare against a retained baseline when context still feels thin.")}</li>
                  <li>{t("Open the review workspace before treating promotion as the default next move.")}</li>
                  <li>{t("Use promotion guidance only after the packet is reviewable.")}</li>
                </ol>
              </div>
              <div className="field">
                <span className="field-label">{t("Evidence operations")}</span>
                <span className="hint-text">
                  {t("Start by explaining the current run, then package it for sharing, compare it against another retained run, and only then decide whether it deserves promotion.")}
                    </span>
                  </div>
                  <div className="form-row flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={() => jumpToPanel(failurePanelRef)}>
                  {t("Explain this run")}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => jumpToPanel(sharePackPanelRef)}>
                  {t("Share pack")}
                </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => jumpToPanel(comparePanelRef)}>
                      {t("Compare runs")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => jumpToPanel(reviewWorkspacePanelRef)}
                    >
                      {t("Review workspace")}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => jumpToPanel(promotionPanelRef)}>
                      {t("Promotion guidance")}
                    </Button>
                  </div>
                </div>
            <DetailFieldRow
              fields={[
                { label: t("Profile"), value: selectedEvidenceRun.profile ?? "unknown" },
                {
                  label: t("Target"),
                  value:
                    selectedEvidenceRun.target_name ??
                    selectedEvidenceRun.target_type ??
                    t("unknown"),
                },
                { label: t("Retention"), value: localizeRetentionState(selectedEvidenceRun.retention_state, t) },
              ]}
            />
            <DetailFieldRow
              fields={[
                {
                  label: t("Correlation"),
                  value: selectedEvidenceRun.provenance.correlation_id ?? t("not linked"),
                },
                {
                  label: t("Linked Runs"),
                  value:
                    selectedEvidenceRun.provenance.linked_run_ids.join(", ") || t("none"),
                },
                {
                  label: t("Linked Tasks"),
                  value:
                    selectedEvidenceRun.provenance.linked_task_ids.join(", ") || t("none"),
                },
              ]}
            />
            <DetailFieldRow
              fields={[
                { label: t("Manifest"), value: selectedEvidenceRun.manifest_path ?? t("missing") },
                { label: t("Summary"), value: selectedEvidenceRun.summary_path ?? t("missing") },
                {
                  label: t("Evidence Count"),
                  value: String(selectedEvidenceRun.evidence_index_count),
                },
              ]}
            />
            {selectedEvidenceRun.missing_paths.length > 0 && (
              <div className="field">
                <span className="field-label">{t("Missing Paths")}</span>
                <span className="hint-text">{selectedEvidenceRun.missing_paths.join(", ")}</span>
              </div>
            )}
            {selectedEvidenceRun.parse_error && (
              <div className="field">
                <span className="field-label">{t("Parse Error")}</span>
                <span className="error-text">{selectedEvidenceRun.parse_error}</span>
              </div>
            )}
            <div ref={comparePanelRef}>
              <EvidenceRunComparePanel
                compare={evidenceRunCompare}
                state={evidenceRunCompareState}
                error={evidenceRunCompareError}
              />
            </div>
            <div ref={sharePackPanelRef}>
              <EvidenceSharePackPanel
                sharePack={evidenceSharePack}
                state={evidenceSharePackState}
                error={evidenceSharePackError}
              />
            </div>
            <div ref={failurePanelRef}>
              <FailureExplainerPanel
                explanation={failureExplanation}
                state={failureExplanationState}
                error={failureExplanationError}
              />
            </div>
            <div ref={reviewWorkspacePanelRef}>
              <HostedReviewWorkspacePanel
                workspace={hostedReviewWorkspace}
                state={hostedReviewWorkspaceState}
                error={hostedReviewWorkspaceError}
              />
            </div>
            <div ref={promotionPanelRef} className="field mt-3">
              <span className="field-label">{t("Promotion guidance")}</span>
              <span className="hint-text">{promotionGuidance}</span>
              <span className="hint-text">
                {promotionReady
                  ? t("This run already looks promotion-friendly at the product level.")
                  : t("Treat promotion as a later decision after the evidence is fully reviewable.")}
              </span>
            </div>
          </RunDetailCard>
        ) : (
          <EmptyState
            icon={
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 9h6M9 13h4" />
              </svg>
            }
            title={t("Select an evidence run to inspect the bundle")}
            description={t("Choose a canonical evidence run from the left to inspect retention state, linked identifiers, and manifest-backed proof paths.")}
          />
        )}
      </div>

      <div className="task-terminal-column task-terminal-stack">
        <TerminalPanel
          logs={logs}
          selectedTask={selectedTask}
          terminalRows={terminalRows}
          onTerminalRowsChange={onTerminalRowsChange}
          terminalFilter={terminalFilter}
          onTerminalFilterChange={onTerminalFilterChange}
          autoScroll={autoScroll}
          onAutoScrollChange={onAutoScrollChange}
          onClear={onClearLogs}
        />
      </div>
    </div>
  )
}

export default memo(TaskCenterView)
