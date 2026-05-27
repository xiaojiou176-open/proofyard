import { Badge, Button, TabsList, TabsTrigger } from "@uiq/ui"
import { memo, type KeyboardEvent as ReactKeyboardEvent, useCallback, useRef } from "react"
import {
  CONSOLE_TAB_FLOW_DRAFT_TEST_ID,
  CONSOLE_TAB_QUICK_LAUNCH_TEST_ID,
  CONSOLE_TAB_TASK_CENTER_TEST_ID,
} from "../constants/testIds"
import type { AppView } from "../hooks/useAppStore"
import { useI18n } from "../i18n"

interface ConsoleHeaderProps {
  runningCount: number
  successCount: number
  failedCount: number
  activeView: AppView
  onViewChange: (view: AppView) => void
  onOpenHelp: () => void
  onRestartTour: () => void
}

const views: { key: AppView; label: string; desc: string; icon: React.ReactNode }[] = [
  {
    key: "launch",
    label: "Quick Launch",
    desc: "Run commands and templates",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polygon points="5 3 19 12 5 21 5 3" />
      </svg>
    ),
  },
  {
    key: "tasks",
    label: "Task Center",
    desc: "Review run status",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
      </svg>
    ),
  },
  {
    key: "workshop",
    label: "Flow Workshop",
    desc: "Edit and debug flows",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
      </svg>
    ),
  },
]

const viewTestIds: Record<AppView, string> = {
  launch: CONSOLE_TAB_QUICK_LAUNCH_TEST_ID,
  tasks: CONSOLE_TAB_TASK_CENTER_TEST_ID,
  workshop: CONSOLE_TAB_FLOW_DRAFT_TEST_ID,
}

const viewTabIds: Record<AppView, string> = {
  launch: "console-tab-launch",
  tasks: "console-tab-tasks",
  workshop: "console-tab-workshop",
}

const viewPanelIds: Record<AppView, string> = {
  launch: "app-view-launch-panel",
  tasks: "app-view-tasks-panel",
  workshop: "app-view-workshop-panel",
}

function ConsoleHeader({
  runningCount,
  successCount,
  failedCount,
  activeView,
  onViewChange,
  onOpenHelp,
  onRestartTour,
}: ConsoleHeaderProps) {
  const { locale, setLocale, t } = useI18n()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  const focusTabByIndex = useCallback((targetIndex: number) => {
    const normalizedIndex = ((targetIndex % views.length) + views.length) % views.length
    tabRefs.current[normalizedIndex]?.focus()
  }, [])

  const activateTabByIndex = useCallback(
    (targetIndex: number) => {
      const normalizedIndex = ((targetIndex % views.length) + views.length) % views.length
      onViewChange(views[normalizedIndex].key)
    },
    [onViewChange]
  )

  const handleTabKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
      if (event.key === "ArrowRight") {
        event.preventDefault()
        focusTabByIndex(index + 1)
        return
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        focusTabByIndex(index - 1)
        return
      }
      if (event.key === "Home") {
        event.preventDefault()
        focusTabByIndex(0)
        return
      }
      if (event.key === "End") {
        event.preventDefault()
        focusTabByIndex(views.length - 1)
        return
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        activateTabByIndex(index)
      }
    },
    [activateTabByIndex, focusTabByIndex]
  )

  return (
    <header>
      <div className="console-header" data-tour="welcome">
        <div className="header-brand">
          <div className="header-logo" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              focusable="false"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M7 8l4 4-4 4" />
              <line x1="13" y1="16" x2="17" y2="16" />
            </svg>
          </div>
          <div className="header-text">
            <h1>Webaudit</h1>
            <p>{t("Browser automation platform")}</p>
          </div>
        </div>
        <div className="header-right">
          <div className="header-stats">
            <Badge className={`stat-badge ${runningCount > 0 ? "running" : ""}`}>
              <span className="stat-dot" aria-hidden="true" />
              {t("Running {count}", { count: runningCount })}
            </Badge>
            <Badge variant="success" className="stat-badge success">
              <span className="stat-dot" aria-hidden="true" />
              {t("Succeeded {count}", { count: successCount })}
            </Badge>
            <Badge variant="destructive" className="stat-badge failed">
              <span className="stat-dot" aria-hidden="true" />
              {t("Failed {count}", { count: failedCount })}
            </Badge>
          </div>
          <div className="header-locale-switch">
            <Button
              type="button"
              size="sm"
              variant={locale === "en" ? "secondary" : "ghost"}
              aria-pressed={locale === "en"}
              data-testid="header-locale-en"
              data-uiq-ignore-button-inventory="locale-switch-non-core-action"
              onClick={() => setLocale("en")}
              title={t("Language")}
            >
              {"EN"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={locale === "zh-CN" ? "secondary" : "ghost"}
              aria-pressed={locale === "zh-CN"}
              data-testid="header-locale-zh-cn"
              data-uiq-ignore-button-inventory="locale-switch-non-core-action"
              onClick={() => setLocale("zh-CN")}
              title={t("Language")}
            >
              {"中文"}
            </Button>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onRestartTour}
            aria-label={t("Restart onboarding")}
            data-uiq-ignore-button-inventory="header-utility-action-not-core-flow"
            title={t("Restart onboarding")}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              focusable="false"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 2v6h-6" />
              <path d="M3 12a9 9 0 0115-6.7L21 8" />
              <path d="M3 22v-6h6" />
              <path d="M21 12a9 9 0 01-15 6.7L3 16" />
            </svg>
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onOpenHelp}
            aria-label={t("Help")}
            title={t("Help")}
            data-tour="help-btn"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              focusable="false"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </Button>
        </div>
      </div>
      <nav aria-label="Primary navigation">
        <TabsList className="console-nav-tabs">
          {views.map((v, index) => {
            const label =
              v.key === "launch"
                ? t("Quick Launch")
                : v.key === "tasks"
                  ? t("Task Center")
                  : t("Flow Workshop")
            const description =
              v.key === "launch"
                ? t("Run commands and templates")
                : v.key === "tasks"
                  ? t("Review run status")
                  : t("Edit and debug flows")
            return (
              <TabsTrigger
                key={v.key}
                ref={(node: HTMLButtonElement | null) => {
                  tabRefs.current[index] = node
                }}
                id={viewTabIds[v.key]}
                active={activeView === v.key}
                className="console-nav-trigger"
                role="tab"
                aria-selected={activeView === v.key}
                aria-controls={viewPanelIds[v.key]}
                tabIndex={activeView === v.key ? 0 : -1}
                onClick={() => onViewChange(v.key)}
                onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) =>
                  handleTabKeyDown(event, index)
                }
                data-tour={`tab-${v.key}`}
                data-testid={viewTestIds[v.key]}
              >
                <span className="console-nav-icon" aria-hidden="true">
                  {v.icon}
                </span>
                {label}
                <span className="console-nav-desc">{description}</span>
              </TabsTrigger>
            )
          })}
        </TabsList>
      </nav>
    </header>
  )
}

export default memo(ConsoleHeader)
