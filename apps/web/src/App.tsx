import { useCallback, useEffect, useRef } from "react"
import ConfirmDialog from "./components/ConfirmDialog"
import ConsoleHeader from "./components/ConsoleHeader"
import HelpPanel from "./components/HelpPanel"
import { I18nProvider } from "./i18n"
import OnboardingTour from "./components/OnboardingTour"
import ToastStack from "./components/ToastStack"
import { useApiClient } from "./hooks/useApiClient"
import { useAppStore } from "./hooks/useAppStore"
import { usePolling } from "./hooks/usePolling"
import type { Command, Task } from "./types"
import { isDangerous } from "./utils/commands"
import FlowWorkshopView from "./views/FlowWorkshopView"
import QuickLaunchView from "./views/QuickLaunchView"
import TaskCenterView from "./views/TaskCenterView"

export default function App() {
  const store = useAppStore()
  const api = useApiClient(store)
  const apiRef = useRef(api)
  const lastEvidenceStepRef = useRef("")
  const {
    isFirstUseActive,
    firstUseStage,
    setFirstUseStage,
    firstUseProgress,
    canCompleteFirstUse,
    markFirstUseRunTriggered,
    markFirstUseResultSeen,
    completeFirstUse,
    selectedStudioTemplateId,
    studioTemplates,
    selectedStepId,
    setCommandState,
    setTaskState,
    setFeedbackText,
    addLog,
    pushNotice,
    setStudioTemplateName,
    setStudioSchemaRows,
    setStudioDefaults,
    setStudioPolicies,
    setStudioRunParams,
    setSelectedStudioFlowId,
    setConfirmDialog,
  } = store
  const shouldShowOnboarding = store.showOnboarding
  const {
    fetchCommands,
    fetchTasks,
    fetchDiagnostics,
    fetchAlerts,
    fetchLatestFlow,
    fetchLatestFlowDraft,
    fetchEvidenceTimeline,
    fetchEvidenceRuns,
    fetchStudioData,
    runCommand,
    createRun,
    cancelTask,
  } = api

  useEffect(() => {
    apiRef.current = api
  }, [api])

  // Bootstrap
  const bootstrap = useCallback(async () => {
    setCommandState("loading")
    setTaskState("loading")

    const coreResults = await Promise.allSettled([fetchCommands(), fetchTasks()])
    const coreError = coreResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    )
    if (coreError) {
      const message =
        coreError.reason instanceof Error ? coreError.reason.message : "Core data loading failed"
      setCommandState("error")
      setTaskState("error")
      setFeedbackText(message)
      addLog("error", message)
      pushNotice("error", message)
      return
    }

    const auxiliaryResults = await Promise.allSettled([
      fetchDiagnostics(),
      fetchAlerts(),
      fetchLatestFlow(),
      fetchLatestFlowDraft(),
      fetchEvidenceTimeline(),
      fetchEvidenceRuns(),
      fetchStudioData(),
    ])
    const auxiliaryFailures = auxiliaryResults.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    )

    if (auxiliaryFailures.length > 0) {
      const firstFailure = auxiliaryFailures[0].reason
      const detail = firstFailure instanceof Error ? firstFailure.message : "Unknown error"
      const warning = `Core data is ready, but some supporting data failed to load: ${detail}`
      setFeedbackText(warning)
      addLog("warn", warning)
      pushNotice("warn", warning)
      return
    }

    setFeedbackText("System ready")
    addLog("success", "System initialization completed")
    pushNotice("success", "System ready. Welcome to Webaudit.")
  }, [
    addLog,
    fetchAlerts,
    fetchCommands,
    fetchDiagnostics,
    fetchEvidenceRuns,
    fetchEvidenceTimeline,
    fetchLatestFlow,
    fetchLatestFlowDraft,
    fetchStudioData,
    fetchTasks,
    pushNotice,
    setCommandState,
    setFeedbackText,
    setTaskState,
  ])

  usePolling(store, bootstrap, fetchTasks)

  // Sync selected template -> form data
  useEffect(() => {
    if (!selectedStudioTemplateId) return
    const target = studioTemplates.find((item) => item.template_id === selectedStudioTemplateId)
    if (!target) return
    setStudioTemplateName(target.name)
    setStudioSchemaRows(
      target.params_schema.map((item) => ({
        key: item.key ?? "",
        type: item.type ?? "string",
        required: Boolean(item.required),
        description: item.description ?? "",
        enum_values: (item.enum_values ?? []).join(","),
        pattern: item.pattern ?? "",
      }))
    )
    setStudioDefaults(target.defaults ?? {})
    setStudioPolicies({
      retries: target.policies?.retries ?? 0,
      timeout_seconds: target.policies?.timeout_seconds ?? 120,
      otp: {
        required: target.policies?.otp?.required ?? false,
        provider: target.policies?.otp?.provider ?? "manual",
        timeout_seconds: target.policies?.otp?.timeout_seconds ?? 120,
        regex: target.policies?.otp?.regex ?? "\\b(\\d{6})\\b",
        sender_filter: target.policies?.otp?.sender_filter ?? "",
        subject_filter: target.policies?.otp?.subject_filter ?? "",
      },
    })
    setStudioRunParams(target.defaults ?? {})
    setSelectedStudioFlowId(target.flow_id)
  }, [
    selectedStudioTemplateId,
    setSelectedStudioFlowId,
    setStudioDefaults,
    setStudioPolicies,
    setStudioRunParams,
    setStudioSchemaRows,
    setStudioTemplateName,
    studioTemplates,
  ])

  // Fetch step evidence on selection
  useEffect(() => {
    const stepId = selectedStepId.trim()
    if (!stepId) {
      lastEvidenceStepRef.current = ""
      void apiRef.current.fetchStepEvidence("")
      return
    }
    if (lastEvidenceStepRef.current === stepId) return
    lastEvidenceStepRef.current = stepId
    void apiRef.current.fetchStepEvidence(stepId)
  }, [selectedStepId])

  useEffect(() => {
    void apiRef.current.fetchEvidenceRunDetail()
  }, [store.selectedEvidenceRunId])

  useEffect(() => {
    void apiRef.current.fetchEvidenceRunCompare()
  }, [store.selectedEvidenceRunId, store.selectedEvidenceCompareCandidateId, store.evidenceRuns])

  useEffect(() => {
    void apiRef.current.fetchEvidenceSharePack()
  }, [store.selectedEvidenceRunId, store.selectedEvidenceCompareCandidateId, store.evidenceRuns])

  useEffect(() => {
    void apiRef.current.fetchFailureExplanation()
  }, [store.selectedEvidenceRunId, store.selectedEvidenceCompareCandidateId, store.evidenceRuns])

  useEffect(() => {
    void apiRef.current.fetchPromotionCandidate()
  }, [store.selectedEvidenceRunId, store.selectedEvidenceCompareCandidateId, store.evidenceRuns])

  useEffect(() => {
    void apiRef.current.fetchHostedReviewWorkspace()
  }, [store.selectedEvidenceRunId, store.selectedEvidenceCompareCandidateId, store.evidenceRuns])

  useEffect(() => {
    void apiRef.current.fetchRunRecoveryPlan()
  }, [store.selectedStudioRunId])

  useEffect(() => {
    void apiRef.current.fetchTemplateReadiness()
  }, [store.selectedStudioTemplateId])

  // --- Handlers ---
  const handleRunCommand = useCallback(
    async (command: Command) => {
      if (isDangerous(command)) {
        setConfirmDialog({
          title: "Confirm dangerous command",
          message: `The command "${command.title}" may modify or delete files. Do you want to continue?`,
          onConfirm: () => {
            setConfirmDialog(null)
            void (async () => {
              const success = await runCommand(command)
              if (!success || !isFirstUseActive) return
              markFirstUseRunTriggered()
              store.setActiveView("tasks")
            })()
          },
        })
        return
      }
      const success = await runCommand(command)
      if (!success || !isFirstUseActive) return
      markFirstUseRunTriggered()
      store.setActiveView("tasks")
    },
    [isFirstUseActive, markFirstUseRunTriggered, runCommand, setConfirmDialog, store]
  )

  const handleCancelTask = useCallback((task: Task) => void cancelTask(task), [cancelTask])
  const handleCreateRun = useCallback(async () => {
    const created = await createRun()
    if (!created) return
    if (isFirstUseActive) {
      markFirstUseRunTriggered()
      store.setActiveView("tasks")
    }
  }, [createRun, isFirstUseActive, markFirstUseRunTriggered, store])

  const handleGoToLaunch = useCallback(() => store.setActiveView("launch"), [store])
  const handleOpenWorkshop = useCallback(() => store.setActiveView("workshop"), [store])
  const handleOpenMcpGuide = useCallback(() => store.setShowHelp(true), [store])

  useEffect(() => {
    if (!isFirstUseActive) return
    const hasOutcome =
      store.tasks.some((task) => task.status === "success" || task.status === "failed") ||
      store.studioRuns.some((run) => run.status === "success" || run.status === "failed")
    if (hasOutcome) markFirstUseResultSeen()
  }, [isFirstUseActive, markFirstUseResultSeen, store.studioRuns, store.tasks])

  return (
    <I18nProvider locale={store.locale} setLocale={store.setLocale}>
      <div className="console-root">
        <a href="#main-content" className="skip-nav">
          {"Skip to main content"}
        </a>

        <ToastStack notices={store.notices} onDismiss={store.dismissNotice} />

        <OnboardingTour active={shouldShowOnboarding} onComplete={store.completeOnboarding} />

        <ConsoleHeader
          runningCount={store.runningCount}
          successCount={store.successCount}
          failedCount={store.failedCount}
          activeView={store.activeView}
          onViewChange={store.setActiveView}
          onOpenHelp={() => store.setShowHelp(true)}
          onRestartTour={store.restartOnboarding}
        />

        <main className="view-container" id="main-content">
        <section
          id="app-view-launch-panel"
          role="tabpanel"
          aria-labelledby="console-tab-launch"
          hidden={store.activeView !== "launch"}
        >
          <QuickLaunchView
            commands={store.commands}
            commandState={store.commandState}
            activeTab={store.activeTab}
            submittingId={store.submittingId}
            feedbackText={store.feedbackText}
            onActiveTabChange={store.setActiveTab}
            onRunCommand={handleRunCommand}
            params={store.params}
            onParamsChange={store.handleParamsChange}
            templates={store.studioTemplates}
            onCreateRun={handleCreateRun}
            onRunParamsChange={store.setStudioRunParams}
            runParams={store.studioRunParams}
            onSelectedTemplateIdChange={store.setSelectedStudioTemplateId}
            selectedTemplateId={store.selectedStudioTemplateId}
            isFirstUseActive={isFirstUseActive}
            firstUseStage={firstUseStage}
            onFirstUseStageChange={setFirstUseStage}
            firstUseProgress={firstUseProgress}
            canCompleteFirstUse={canCompleteFirstUse}
            onCompleteFirstUse={completeFirstUse}
            onOpenWorkshop={handleOpenWorkshop}
            onOpenMcpGuide={handleOpenMcpGuide}
          />
        </section>

        <section
          id="app-view-tasks-panel"
          role="tabpanel"
          aria-labelledby="console-tab-tasks"
          hidden={store.activeView !== "tasks"}
        >
          <TaskCenterView
            tasks={store.tasks}
            taskState={store.taskState}
            selectedTaskId={store.selectedTaskId}
            taskErrorMessage={store.taskErrorMessage}
            onSelectTask={store.setSelectedTaskId}
            onCancelTask={handleCancelTask}
            onRefreshTasks={api.refreshTasks}
            statusFilter={store.statusFilter}
            onStatusFilterChange={store.setStatusFilter}
            commandFilter={store.commandFilter}
            onCommandFilterChange={store.setCommandFilter}
            taskLimit={store.taskLimit}
            onTaskLimitChange={store.setTaskLimit}
            logs={store.logs}
            selectedTask={store.selectedTask}
            terminalRows={store.terminalRows}
            onTerminalRowsChange={store.setTerminalRows}
            terminalFilter={store.terminalFilter}
            onTerminalFilterChange={store.setTerminalFilter}
            autoScroll={store.autoScroll}
            onAutoScrollChange={store.setAutoScroll}
            onClearLogs={store.clearLogs}
            evidenceRuns={store.evidenceRuns}
            evidenceRegistryState={store.evidenceRegistryState}
            evidenceRunsState={store.evidenceRunsState}
            evidenceRunsError={store.evidenceRunsError}
            selectedEvidenceRunId={store.selectedEvidenceRunId}
            selectedEvidenceRun={store.selectedEvidenceRun}
            onSelectedEvidenceRunIdChange={store.setSelectedEvidenceRunId}
            compareCandidateRunId={store.selectedEvidenceCompareCandidateId}
            onCompareCandidateRunIdChange={store.setSelectedEvidenceCompareCandidateId}
            onRefreshEvidenceRuns={fetchEvidenceRuns}
            evidenceRunCompare={store.evidenceRunCompare}
            evidenceRunCompareState={store.evidenceRunCompareState}
            evidenceRunCompareError={store.evidenceRunCompareError}
            evidenceSharePack={store.evidenceSharePack}
            evidenceSharePackState={store.evidenceSharePackState}
            evidenceSharePackError={store.evidenceSharePackError}
            failureExplanation={store.failureExplanation}
            failureExplanationState={store.failureExplanationState}
            failureExplanationError={store.failureExplanationError}
            promotionCandidate={store.promotionCandidate}
            promotionCandidateState={store.promotionCandidateState}
            promotionCandidateError={store.promotionCandidateError}
            hostedReviewWorkspace={store.hostedReviewWorkspace}
            hostedReviewWorkspaceState={store.hostedReviewWorkspaceState}
            hostedReviewWorkspaceError={store.hostedReviewWorkspaceError}
            runs={store.studioRuns}
            selectedRunId={store.selectedStudioRunId}
            onSelectedRunIdChange={store.setSelectedStudioRunId}
            otpCode={store.studioOtpCode}
            onOtpCodeChange={store.setStudioOtpCode}
            onSubmitOtp={api.submitRunOtp}
            runRecoveryPlan={store.runRecoveryPlan}
            runRecoveryPlanState={store.runRecoveryPlanState}
            runRecoveryPlanError={store.runRecoveryPlanError}
            onReplayLatestFlow={api.replayLatestFlow}
            onReplayStep={api.replayStep}
            onResumeFromStep={api.replayFromStep}
            onGoToLaunch={handleGoToLaunch}
          />
        </section>

        <section
          id="app-view-workshop-panel"
          role="tabpanel"
          aria-labelledby="console-tab-workshop"
          hidden={store.activeView !== "workshop"}
        >
          <FlowWorkshopView
            diagnostics={store.diagnostics}
            alerts={store.alerts}
            diagnosticsError={store.diagnosticsError}
            alertError={store.alertError}
            latestFlow={store.latestFlow}
            flowError={store.flowError}
            flowDraft={store.flowDraft}
            selectedStepId={store.selectedStepId}
            stepEvidence={store.stepEvidence}
            evidenceTimeline={store.evidenceTimeline}
            evidenceTimelineError={store.evidenceTimelineError}
            resumeWithPreconditions={store.resumeWithPreconditions}
            stepEvidenceError={store.stepEvidenceError}
            recoveryPlan={store.runRecoveryPlan}
            recoveryPlanState={store.runRecoveryPlanState}
            recoveryPlanError={store.runRecoveryPlanError}
            profileTargetStudioState={store.profileTargetStudioState}
            profileTargetStudioError={store.profileTargetStudioError}
            studioTemplates={store.studioTemplates}
            selectedStudioTemplateId={store.selectedStudioTemplateId}
            onSelectedTemplateIdChange={store.setSelectedStudioTemplateId}
            profileStudioOptions={store.profileStudioOptions}
            targetStudioOptions={store.targetStudioOptions}
            selectedProfileStudioName={store.selectedProfileStudioName}
            selectedTargetStudioName={store.selectedTargetStudioName}
            profileStudioDocument={store.profileStudioDocument}
            targetStudioDocument={store.targetStudioDocument}
            otpCode={store.studioOtpCode}
            onOtpCodeChange={store.setStudioOtpCode}
            onSubmitOtp={api.submitRunOtp}
            onOpenTaskCenter={() => store.setActiveView("tasks")}
            templateReadiness={store.templateReadiness}
            templateReadinessState={store.templateReadinessState}
            templateReadinessError={store.templateReadinessError}
            onFlowDraftChange={store.setFlowDraft}
            onSelectStep={store.setSelectedStepId}
            onResumeWithPreconditionsChange={store.setResumeWithPreconditions}
            onSaveFlowDraft={api.saveFlowDraft}
            onReplayLatestFlow={api.replayLatestFlow}
            onReplayStep={api.replayStep}
            onResumeFromStep={api.replayFromStep}
            onRefresh={api.refreshDiagnostics}
            onLoadProfileTargetStudio={api.fetchProfileTargetStudio}
            onSaveConfigStudio={api.saveConfigStudio}
            reconstructionArtifacts={store.reconstructionArtifacts}
            reconstructionMode={store.reconstructionMode}
            reconstructionStrategy={store.reconstructionStrategy}
            reconstructionError={store.reconstructionError}
            profileResolved={store.profileResolved}
            reconstructionPreview={store.reconstructionPreview}
            reconstructionGenerated={store.reconstructionGenerated}
            onReconstructionArtifactsChange={store.setReconstructionArtifacts}
            onReconstructionModeChange={store.setReconstructionMode}
            onReconstructionStrategyChange={store.setReconstructionStrategy}
            onResolveProfile={api.resolveProfile}
            onPreviewReconstruction={api.previewReconstruction}
            onGenerateReconstruction={api.generateReconstruction}
            onOrchestrateFromArtifacts={api.orchestrateFromArtifacts}
          />
        </section>
        </main>

        {store.showHelp && (
          <HelpPanel
            activeView={store.activeView}
            onClose={() => store.setShowHelp(false)}
            onRestartTour={store.restartOnboarding}
          />
        )}

        {store.confirmDialog && (
          <ConfirmDialog
            title={store.confirmDialog.title}
            message={store.confirmDialog.message}
            variant="danger"
            confirmLabel="Confirm run"
            onConfirm={store.confirmDialog.onConfirm}
            onCancel={() => store.setConfirmDialog(null)}
          />
        )}
      </div>
    </I18nProvider>
  )
}
