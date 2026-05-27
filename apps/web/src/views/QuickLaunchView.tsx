import { Badge, Button, Card, CardContent, Input } from "@uiq/ui"
import { type ChangeEvent, memo, useState } from "react"
import CommandGrid from "../components/CommandGrid"
import EmptyState from "../components/EmptyState"
import type { ParamsState } from "../components/ParamsPanel"
import ParamsPanel from "../components/ParamsPanel"
import {
  QUICK_LAUNCH_FIRST_USE_LOCATE_CONFIG_TEST_ID,
  QUICK_LAUNCH_FIRST_USE_START_TEST_ID,
} from "../constants/testIds"
import type { FirstUseStage } from "../hooks/useAppStore"
import { useI18n } from "../i18n"
import type { Command, CommandCategory, CommandState, UniversalTemplate } from "../types"

interface QuickLaunchViewProps {
  commands: Command[]
  commandState: CommandState
  activeTab: "all" | CommandCategory
  submittingId: string
  feedbackText: string
  onActiveTabChange: (tab: "all" | CommandCategory) => void
  onRunCommand: (command: Command) => void
  params: ParamsState
  onParamsChange: (patch: Partial<ParamsState>) => void
  // Studio template integration
  templates: UniversalTemplate[]
  onCreateRun: () => void
  onRunParamsChange: (params: Record<string, string>) => void
  runParams: Record<string, string>
  onSelectedTemplateIdChange: (id: string) => void
  selectedTemplateId: string
  isFirstUseActive: boolean
  firstUseStage: FirstUseStage
  firstUseProgress: {
    configValid: boolean
    runTriggered: boolean
    resultSeen: boolean
  }
  canCompleteFirstUse: boolean
  onFirstUseStageChange: (stage: FirstUseStage) => void
  onCompleteFirstUse: () => void
  onOpenWorkshop?: () => void
  onOpenMcpGuide?: () => void
}

const buildTemplateFieldId = (templateId: string, key: string) =>
  `template-param-${templateId}-${key}`.replace(/[^a-zA-Z0-9-_]/g, "-")

function QuickLaunchView({
  commands,
  commandState,
  activeTab,
  submittingId,
  feedbackText,
  onActiveTabChange,
  onRunCommand,
  params,
  onParamsChange,
  templates,
  onCreateRun,
  onRunParamsChange,
  runParams,
  onSelectedTemplateIdChange,
  selectedTemplateId,
  isFirstUseActive,
  firstUseStage,
  firstUseProgress,
  canCompleteFirstUse,
  onFirstUseStageChange,
  onCompleteFirstUse,
  onOpenWorkshop = () => {},
  onOpenMcpGuide = () => {},
}: QuickLaunchViewProps) {
  const { t } = useI18n()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const paramsPanelId = "quick-launch-params-panel"
  const selectedTemplate = templates.find((item) => item.template_id === selectedTemplateId) ?? null
  const isCurrentStage = (stage: FirstUseStage) => firstUseStage === stage
  const canGoConfigure = isCurrentStage("welcome") || isCurrentStage("configure")
  const canGoRun =
    (isCurrentStage("configure") || isCurrentStage("run")) && firstUseProgress.configValid
  const canShowComplete = firstUseStage === "verify"

  return (
    <div className="quick-launch-view">
      <div className="quick-launch-main">
        <Card className="launch-hero-card">
          <CardContent className="launch-hero-grid p-4">
            <div className="launch-hero-copy">
              <p className="launch-hero-kicker">{t("Proofyard Command Center")}</p>
              <h2 className="launch-hero-title">
                {t("Evidence-first browser automation with recovery and MCP")}
              </h2>
              <p className="launch-hero-body">
                {t(
                  "Start from one canonical run, confirm the result in Task Center, and only then open template reuse, AI reconstruction, or MCP side roads. This is for AI agents, Codex, Claude Code, OpenHands, OpenCode, OpenClaw, and human operators who need inspectable runs instead of guesswork."
                )}
              </p>
              <div className="launch-hero-badges">
                <Badge variant="secondary">
                  {t("{count} command entrypoints", { count: commands.length })}
                </Badge>
                <Badge variant={templates.length > 0 ? "success" : "default"}>
                  {templates.length > 0
                    ? t("{count} template accelerators", { count: templates.length })
                    : t("Templates can be added later")}
                </Badge>
                <Badge>
                  {sidebarCollapsed ? t("Parameter rail collapsed") : t("Parameter rail expanded")}
                </Badge>
              </div>
            </div>
            <div className="launch-hero-panels">
              <div className="launch-hero-panel">
                <span className="launch-hero-panel-label">{t("Current primary action")}</span>
                <strong className="launch-hero-panel-value">
                  {isFirstUseActive
                    ? t("Finish one canonical run first")
                    : t("Run the canonical path before anything else")}
                </strong>
                <p className="launch-hero-panel-hint">
                  {isFirstUseActive
                    ? t(
                        "Follow the guide through configuration, execution, and Task Center result verification first."
                      )
                    : t(
                        "Start from the primary command in the grid and treat template launch as an optional accelerator."
                      )}
                </p>
              </div>
              <div className="launch-hero-panel accent">
                <span className="launch-hero-panel-label">{t("Current template focus")}</span>
                <strong className="launch-hero-panel-value">
                  {selectedTemplate ? selectedTemplate.name : t("No template selected")}
                </strong>
                <p className="launch-hero-panel-hint">
                  {selectedTemplate
                    ? t(
                        "Template parameters belong after the default path is stable, not before the first proof run."
                      )
                    : t(
                        "Templates stay secondary until you already trust the underlying canonical path."
                      )}
                </p>
              </div>
              <div className="launch-hero-panel">
                <span className="launch-hero-panel-label">{t("Advanced Side Roads")}</span>
                <strong className="launch-hero-panel-value">
                  {t("AI Reconstruction Assistant")} / {t("MCP Integration Side Road")}
                </strong>
                <p className="launch-hero-panel-hint">
                  {t(
                    "They also form the strongest bridge for AI-agent builders using Codex, Claude Code, OpenHands, OpenCode, OpenClaw, or other tool-using shells who need browser evidence, governed MCP access, and artifact-first reconstruction without turning the product into a generic bot platform."
                  )}
                </p>
              </div>
              <div className="launch-hero-panel accent">
                <span className="launch-hero-panel-label">{t("Named ecosystem fit")}</span>
                <strong className="launch-hero-panel-value">
                  {t("MCP-first today: Claude Code / OpenCode")}
                </strong>
                <p className="launch-hero-panel-hint">
                  {t(
                    "API-first or hybrid today: Codex, OpenHands, and OpenClaw. Use this as a discovery rule, not as an official-integration claim."
                  )}
                </p>
                <div className="launch-hero-fit-list">
                  <div className="launch-hero-fit-row">
                    <span className="launch-hero-fit-name">{t("Claude Code")}</span>
                    <span className="launch-hero-fit-pill">{t("MCP-first")}</span>
                  </li>
                  <li className="launch-hero-fit-row">
                    <span className="launch-hero-fit-name">{t("OpenCode")}</span>
                    <span className="launch-hero-fit-pill">{t("MCP-first")}</span>
                  </div>
                  <div className="launch-hero-fit-row">
                    <span className="launch-hero-fit-name">
                      {t("Codex / OpenHands / OpenClaw")}
                    </span>
                    <span className="launch-hero-fit-pill">{t("API-first or hybrid")}</span>
                  </li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {isFirstUseActive && (
          <Card className="launch-first-use-card mb-4">
            <div className="section-divider">
              <span className="section-divider-line" />
              <span className="section-divider-label">{t("First-use guide")}</span>
              <span className="section-divider-line" />
            </div>
            <CardContent className="p-4">
              <p className="text-muted">
                {firstUseStage === "welcome" &&
                  t(
                    "Welcome. Start with step 1 by clicking the button below and configuring the run parameters."
                  )}
                {firstUseStage === "configure" &&
                  t(
                    "Step 1: configure baseUrl, startUrl, and successSelector in the parameter rail. You can only continue once the configuration is valid."
                  )}
                {firstUseStage === "run" &&
                  t(
                    "Step 2: use the canonical run first. Templates and advanced workshop commands can wait until after the first result appears."
                  )}
                {firstUseStage === "verify" &&
                  t(
                    "Step 3: switch to Task Center, confirm the result, and use Recovery Center there before raw logs or workshop replay."
                  )}
              </p>
              <p className="text-muted">
                {t(
                  "Progress: configure {config} / trigger a run {run} / review a result {review}",
                  {
                    config: firstUseProgress.configValid ? "✅" : "⬜",
                    run: firstUseProgress.runTriggered ? "✅" : "⬜",
                    review: firstUseProgress.resultSeen ? "✅" : "⬜",
                  }
                )}
              </p>
              <div className="form-actions">
                {firstUseStage === "welcome" && (
                  <Button
                    size="sm"
                    data-testid={QUICK_LAUNCH_FIRST_USE_START_TEST_ID}
                    onClick={() => onFirstUseStageChange("configure")}
                  >
                    {t("Start step 1")}
                  </Button>
                )}
                {canGoConfigure && (
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid={QUICK_LAUNCH_FIRST_USE_LOCATE_CONFIG_TEST_ID}
                    onClick={() => onFirstUseStageChange("configure")}
                  >
                    {t("Go to configuration")}
                  </Button>
                )}
                {(isCurrentStage("configure") || isCurrentStage("run")) && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onFirstUseStageChange("run")}
                    disabled={!canGoRun}
                  >
                    {t("Configuration done, continue to run")}
                  </Button>
                )}
                {canShowComplete && (
                  <Button
                    size="sm"
                    onClick={onCompleteFirstUse}
                    disabled={!canCompleteFirstUse}
                    data-uiq-ignore-button-inventory="first-use-complete-secondary-action"
                  >
                    {t("Complete the first-use guide")}
                  </Button>
                )}
              </div>
              {firstUseStage === "configure" && !firstUseProgress.configValid && (
                <p className="text-muted">
                  {t(
                    "Enter a valid baseUrl, an optional startUrl, and a successSelector before continuing."
                  )}
                </p>
              )}
              {firstUseStage === "verify" && !firstUseProgress.resultSeen && (
                <p className="text-muted">
                  {t(
                    "No success or failure result is visible yet. Wait for the task to finish in Task Center first."
                  )}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <section className="launch-primary-zone" aria-label="Primary command zone">
          <div className="launch-section-head">
            <div>
              <p className="launch-section-kicker">{t("Primary Actions")}</p>
              <h3 className="launch-section-title">
                {t("Choose one entrypoint and start a run immediately")}
              </h3>
            </div>
            <p className="launch-section-desc">
              {t(
                "The main flow lives here: filter commands, launch the run, and get immediate feedback in one place."
              )}
            </p>
          </div>
          <Card className="launch-path-card mb-4">
            <CardContent className="p-4">
              <p className="launch-section-kicker">{t("15-minute evaluator path")}</p>
              <ol className="help-step-list">
                <li className="help-step-item">
                  <span className="help-step-num">1</span>
                  <div className="help-step-content">
                    <strong>{t("Keep the defaults first")}</strong>
                    <p>
                      {t(
                        "Confirm the parameter rail, but avoid over-tuning before the first visible result."
                      )}
                    </p>
                  </div>
                </li>
                <li className="help-step-item">
                  <span className="help-step-num">2</span>
                  <div className="help-step-content">
                    <strong>{t("Run the canonical path")}</strong>
                    <p>
                      {t(
                        "Use the primary command first. Helper and workshop commands stay available later, under the advanced group."
                      )}
                    </p>
                  </div>
                </li>
                <li className="help-step-item">
                  <span className="help-step-num">3</span>
                  <div className="help-step-content">
                    <strong>{t("Confirm the outcome in Task Center")}</strong>
                    <p>
                      {t(
                        "Once a result is visible, inspect the evidence summary in Task Center first."
                      )}
                    </p>
                  </div>
                </li>
                <li className="help-step-item">
                  <span className="help-step-num">4</span>
                  <div className="help-step-content">
                    <strong>{t("Use Recovery Center before raw logs or workshop replay")}</strong>
                    <p>
                      {t(
                        "Treat Recovery Center as the official recovery layer inside Task Center. Only move to raw logs or Flow Workshop after the suggested recovery path still leaves you blocked."
                      )}
                    </p>
                  </div>
                </li>
              </ol>
              <div className="field mt-4">
                <span className="field-label">
                  {t("Leave this page only when these three things are true")}
                </span>
                <span className="hint-text">
                  {t(
                    "The parameter rail is valid, one canonical run is already visible, and your next click is to Task Center instead of a side road."
                  )}
                </span>
              </div>
            </CardContent>
          </Card>
          <CommandGrid
            commands={commands}
            commandState={commandState}
            activeTab={activeTab}
            submittingId={submittingId}
            feedbackText={feedbackText}
            onActiveTabChange={onActiveTabChange}
            onRunCommand={onRunCommand}
          />
        </section>

        {/* Templates section */}
        {templates.length > 0 && (
          <section className="templates-section" aria-label="Template accelerator zone">
            <div className="launch-section-head compact">
              <div>
                <p className="launch-section-kicker">{t("Optional Accelerator")}</p>
                <h3 className="launch-section-title">{t("Template quick launch")}</h3>
              </div>
              <p className="launch-section-desc">
                {t(
                  "Use templates to accelerate a flow only after the underlying manual path is already stable."
                )}
              </p>
            </div>
            <div className="section-divider">
              <span className="section-divider-line" />
              <span className="section-divider-label">{t("Template quick launch")}</span>
              <span className="section-divider-line" />
            </div>
            <div className="templates-grid">
              {templates.map((tpl) => {
                const isSelected = selectedTemplateId === tpl.template_id
                return (
                  <Card
                    key={tpl.template_id}
                    className={`template-card ${isSelected ? "active" : ""}`}
                    style={isSelected ? { borderColor: "var(--accent)" } : undefined}
                  >
                    <div className="template-card-header">
                      <h4>{tpl.name}</h4>
                      <Badge>{t("{count} params", { count: tpl.params_schema.length })}</Badge>
                    </div>
                    <p className="template-meta">
                      {t("Flow template: {id}", { id: tpl.flow_id.slice(0, 8) })}
                      {tpl.policies?.otp?.required && " / OTP"}
                      {` / Timeout ${tpl.policies?.timeout_seconds ?? 120}s`}
                    </p>
                    {isSelected && (
                      <div className="mt-3">
                        <div className="field-group">
                          {tpl.params_schema.map((param) => (
                            <div key={param.key} className="field">
                              <label
                                className="field-label"
                                htmlFor={buildTemplateFieldId(tpl.template_id, param.key)}
                              >
                                {param.description || param.key}
                              </label>
                              <Input
                                id={buildTemplateFieldId(tpl.template_id, param.key)}
                                type={param.type === "secret" ? "password" : "text"}
                                value={runParams[param.key] ?? ""}
                                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                  onRunParamsChange({ ...runParams, [param.key]: e.target.value })
                                }
                                placeholder={param.required ? t("Required") : t("Optional")}
                              />
                            </div>
                          ))}
                        </div>
                        <div className="form-actions">
                          <Button
                            size="sm"
                            onClick={onCreateRun}
                            data-uiq-ignore-button-inventory="template-run-secondary-cta"
                          >
                            {t("Start run")}
                          </Button>
                        </div>
                      </div>
                    )}
                    {!isSelected && (
                      <div className="mt-3">
                        <Button
                          variant="outline"
                          size="sm"
                          data-uiq-ignore-button-inventory="template-select-secondary-cta"
                          onClick={() => {
                            onSelectedTemplateIdChange(tpl.template_id)
                            onRunParamsChange(tpl.defaults ?? {})
                          }}
                        >
                          {t("Select template")}
                        </Button>
                      </div>
                    )}
                  </Card>
                )
              })}
            </div>
          </section>
        )}

        {templates.length === 0 && commandState === "success" && (
          <section className="templates-section" aria-label="Template accelerator zone">
            <div className="launch-section-head compact">
              <div>
                <p className="launch-section-kicker">{t("Optional Accelerator")}</p>
                <h3 className="launch-section-title">{t("Template quick launch")}</h3>
              </div>
              <p className="launch-section-desc">
                {t(
                  "No templates exist yet. You can still run the main flow directly and add templates later in Flow Workshop."
                )}
              </p>
            </div>
            <div className="section-divider">
              <span className="section-divider-line" />
              <span className="section-divider-label">{t("Template quick launch")}</span>
              <span className="section-divider-line" />
            </div>
            <EmptyState
              icon={
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  role="img"
                  aria-label={t("Create template")}
                >
                  <title>{t("Create template")}</title>
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M12 8v8M8 12h8" />
                </svg>
              }
              title={t("No templates yet")}
              description={t(
                "Templates freeze a set of steps and parameters so that you can launch repeatable runs faster. Record and save a flow in Flow Workshop to create one."
              )}
            />
          </section>
        )}

        <section className="templates-section" aria-label="Advanced integration side roads">
          <div className="launch-section-head compact">
            <div>
              <p className="launch-section-kicker">{t("Advanced Side Roads")}</p>
              <h3 className="launch-section-title">
                {t("AI reconstruction and MCP stay visible without taking over the main path")}
              </h3>
            </div>
            <p className="launch-section-desc">
              {t(
                "These surfaces matter after you already trust the canonical path. Treat them like specialist tools: visible, useful, and clearly secondary."
              )}{" "}
              {t(
                "They also form the strongest bridge for AI-agent builders using Codex, Claude Code, or other tool-using shells who need browser evidence, governed MCP access, and artifact-first reconstruction without turning the product into a generic bot platform."
              )}
            </p>
          </div>
          <div className="templates-grid">
            <Card className="template-card">
              <div className="template-card-header">
                <h4>{t("AI Reconstruction Assistant")}</h4>
                <Badge variant="outline">{t("Optional")}</Badge>
              </div>
              <p className="template-meta">
                {t(
                  "Use artifact-driven reconstruction only when you need help rebuilding a flow from session evidence. It stays in Flow Workshop and still requires human review."
                )}{" "}
                {t(
                  "This is the AI-facing helper surface for builders who already have artifacts and need a reviewable reconstruction lane."
                )}
              </p>
              <div className="mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  data-uiq-ignore-button-inventory="ai-reconstruction-secondary-cta"
                  onClick={onOpenWorkshop}
                >
                  {t("Open Flow Workshop")}
                </Button>
              </div>
            </Card>
            <Card className="template-card">
              <div className="template-card-header">
                <h4>{t("MCP Integration Side Road")}</h4>
                <Badge variant="outline">{t("Integration")}</Badge>
              </div>
              <p className="template-meta">
                {t(
                  "Use MCP when an external AI client needs to inspect runs, launch workflows, or export proof on top of the existing backend and artifacts. It is not a second backend."
                )}{" "}
                {t(
                  "Use it when the agent shell should stay external and Proofyard should stay the browser-evidence substrate."
                )}
              </p>
              <div className="mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  data-uiq-ignore-button-inventory="mcp-side-road-secondary-cta"
                  onClick={onOpenMcpGuide}
                >
                  {t("Open MCP guide")}
                </Button>
              </div>
            </Card>
          </div>
        </section>
      </div>
      <aside className={`quick-launch-sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="quick-launch-sidebar-shell">
          <div className="quick-launch-sidebar-head">
            <div>
              <p className="launch-section-kicker">{t("Configuration Rail")}</p>
              <h3 className="launch-section-title">{t("Run parameters")}</h3>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarCollapsed((v) => !v)}
              aria-label={
                sidebarCollapsed ? t("Expand parameter rail") : t("Collapse parameter rail")
              }
              aria-expanded={!sidebarCollapsed}
              aria-controls={paramsPanelId}
            >
              {sidebarCollapsed ? "\u276F" : "\u276E"}
            </Button>
          </div>
          <p className="quick-launch-sidebar-desc">
            {t(
              "Keep environment, credentials, and success markers here. Run the main path first, then fine-tune the details."
            )}
          </p>
          <div id={paramsPanelId} className="quick-launch-sidebar-panel" hidden={sidebarCollapsed}>
            {!sidebarCollapsed && <ParamsPanel params={params} onChange={onParamsChange} />}
          </div>
        </div>
      </aside>
    </div>
  )
}

export default memo(QuickLaunchView)
