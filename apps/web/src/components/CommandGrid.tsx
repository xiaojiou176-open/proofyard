import { memo, useMemo, useRef, type KeyboardEvent } from "react"
import {
  COMMAND_CATEGORY_ALL_TEST_ID,
  COMMAND_CATEGORY_FRONTEND_TEST_ID,
  COMMAND_CATEGORY_MAINTENANCE_TEST_ID,
  commandRunButtonTestId,
} from "../constants/testIds"
import type { Command, CommandCategory, CommandState } from "../types"
import {
  categoryMeta,
  guessCategory,
  isAiCommand,
  isCanonicalPrimaryCommand,
  isDangerous,
  isHelperCommand,
} from "../utils/commands"
import { Badge, Button, Card, TabsList, TabsTrigger } from "@uiq/ui"

interface CommandGridProps {
  commands: Command[]
  commandState: CommandState
  activeTab: "all" | CommandCategory
  submittingId: string
  feedbackText: string
  onActiveTabChange: (tab: "all" | CommandCategory) => void
  onRunCommand: (command: Command) => void
}

function CommandGrid({
  commands,
  commandState,
  activeTab,
  submittingId,
  feedbackText,
  onActiveTabChange,
  onRunCommand,
}: CommandGridProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const filteredCommands = useMemo(() => {
    if (activeTab === "all") return commands
    return commands.filter((cmd) => guessCategory(cmd) === activeTab)
  }, [activeTab, commands])

  const recommendedCommand = useMemo(
    () =>
      (activeTab === "all" || activeTab === "pipeline")
        ? filteredCommands.find((command) => isCanonicalPrimaryCommand(command)) ?? null
        : null,
    [activeTab, filteredCommands]
  )

  const advancedCommands = useMemo(
    () =>
      activeTab === "all" || activeTab === "pipeline"
        ? filteredCommands.filter((command) => isHelperCommand(command))
        : [],
    [activeTab, filteredCommands]
  )

  const visibleCommands = useMemo(
    () =>
      filteredCommands.filter((command) => {
        if (recommendedCommand && command.command_id === recommendedCommand.command_id) return false
        if (advancedCommands.some((advanced) => advanced.command_id === command.command_id)) return false
        return true
      }),
    [advancedCommands, filteredCommands, recommendedCommand]
  )

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: commands.length }
    for (const cmd of commands) {
      const cat = guessCategory(cmd)
      counts[cat] = (counts[cat] ?? 0) + 1
    }
    return counts
  }, [commands])

  const categoryTestId = (category: "all" | CommandCategory): string | undefined => {
    if (category === "all") return COMMAND_CATEGORY_ALL_TEST_ID
    if (category === "frontend") return COMMAND_CATEGORY_FRONTEND_TEST_ID
    if (category === "maintenance") return COMMAND_CATEGORY_MAINTENANCE_TEST_ID
    return undefined
  }

  const tabs: Array<"all" | CommandCategory> = ["all", ...(Object.keys(categoryMeta) as CommandCategory[])]
  const tabPanelId = "command-grid-panel"
  const getTabId = (category: "all" | CommandCategory) => `command-category-tab-${category}`

  const focusTabAt = (index: number) => {
    const length = tabs.length
    const normalized = (index + length) % length
    tabRefs.current[normalized]?.focus()
  }

  const activateTabAt = (index: number) => {
    onActiveTabChange(tabs[(index + tabs.length) % tabs.length])
  }

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowRight") {
      event.preventDefault()
      focusTabAt(index + 1)
      return
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      focusTabAt(index - 1)
      return
    }
    if (event.key === "Home") {
      event.preventDefault()
      focusTabAt(0)
      return
    }
    if (event.key === "End") {
      event.preventDefault()
      focusTabAt(tabs.length - 1)
      return
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      activateTabAt(index)
    }
  }

  return (
    <>
      <div role="tablist" aria-label="Command categories">
        <TabsList className="command-category-tabs">
          {tabs.map((cat, index) => (
            <TabsTrigger
              key={cat}
              type="button"
              ref={(node: HTMLButtonElement | null) => {
                tabRefs.current[index] = node
              }}
              id={getTabId(cat)}
              active={activeTab === cat}
              className="command-category-trigger"
              role="tab"
              aria-selected={activeTab === cat}
              aria-controls={tabPanelId}
              tabIndex={activeTab === cat ? 0 : -1}
              data-testid={categoryTestId(cat)}
              onClick={() => onActiveTabChange(cat)}
              onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => handleTabKeyDown(event, index)}
            >
              {cat === "all" ? "All" : categoryMeta[cat].label}
              <span className="command-category-count">{categoryCounts[cat] ?? 0}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <div
        id={tabPanelId}
        className="command-grid"
        role="tabpanel"
        aria-labelledby={getTabId(activeTab)}
      >
        {commandState === "loading" && (
          <Card className="loading-card" role="status" aria-live="polite">
            <div className="spinner" aria-hidden="true" />
            {"Loading commands..."}
          </Card>
        )}
        {commandState === "error" && (
          <Card className="loading-card">
            <p className="error-text">{feedbackText}</p>
          </Card>
        )}
        {commandState === "empty" && (
          <div className="empty-state grid-full">
            <div className="empty-state-icon">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M12 9v4M12 17h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="empty-state-title">{"No commands available"}</p>
            <p className="empty-state-desc">{"The backend returned no commands. Check whether the service is running."}</p>
          </div>
        )}
        {commandState === "success" && filteredCommands.length === 0 && (
          <div className="empty-state grid-full">
            <p className="empty-state-title">{"No commands in this category"}</p>
          </div>
        )}
        {recommendedCommand && (
          <Card className="command-card command-card-primary">
            <div>
              <p className="command-primary-kicker">{"Primary path"}</p>
              <h2 className="command-title">{recommendedCommand.title}</h2>
              <div className="command-tags">
                <Badge>{"Default path"}</Badge>
                <Badge>{recommendedCommand.command_id}</Badge>
              </div>
            </div>
            <p className="command-desc">
              {
                "Start here first. This is the canonical orchestrator mainline that produces the manifest-backed evidence bundle and keeps the public story honest."
              }
            </p>
            <div className="command-footer">
              <span className="command-tags-text">
                {"Run the mainline first, then move to Task Center for status, evidence, and recovery."}
              </span>
              <Button
                data-testid={commandRunButtonTestId(recommendedCommand.command_id)}
                size="sm"
                disabled={submittingId === recommendedCommand.command_id}
                onClick={() => onRunCommand(recommendedCommand)}
              >
                {submittingId === recommendedCommand.command_id ? "Running..." : "Run canonical path"}
              </Button>
            </div>
          </Card>
        )}
        {visibleCommands.map((command) => {
          const category = guessCategory(command)
          const isRunning = submittingId === command.command_id
          const dangerous = isDangerous(command)
          const ai = isAiCommand(command)
          return (
            <Card key={command.command_id} className="command-card">
              <div>
                <h2 className="command-title">{command.title}</h2>
                <div className="command-tags">
                  <Badge>{categoryMeta[category].label}</Badge>
                  <Badge>{command.command_id}</Badge>
                  {ai && <Badge variant="secondary">{"AI"}</Badge>}
                </div>
              </div>
              <p className="command-desc">{command.description}</p>
              <div className="command-footer">
                <span className="command-tags-text">
                  {command.tags.length > 0 ? command.tags.join(" / ") : ""}
                </span>
                <Button
                  data-testid={commandRunButtonTestId(command.command_id)}
                  size="sm"
                  variant={dangerous ? "destructive" : "default"}
                  disabled={isRunning}
                  onClick={() => onRunCommand(command)}
                >
                  {isRunning ? "Running..." : dangerous ? "Dangerous run" : "Run"}
                </Button>
              </div>
            </Card>
          )
        })}
        {advancedCommands.length > 0 && (
          <details className="command-advanced-group grid-full">
            <summary>{"Advanced / helper / workshop commands"}</summary>
            <p className="command-advanced-desc">
              {
                "Use these only when you are intentionally debugging or exploring the lower-level helper path. They stay available for advanced users, but they are not the first run."
              }
            </p>
            <div className="command-grid advanced-grid">
              {advancedCommands.map((command) => {
                const isRunning = submittingId === command.command_id
                const dangerous = isDangerous(command)
                const ai = isAiCommand(command)
                return (
                  <Card key={command.command_id} className="command-card command-card-advanced">
                    <div>
                      <h2 className="command-title">{command.title}</h2>
                      <div className="command-tags">
                        <Badge>{"Advanced"}</Badge>
                        <Badge>{command.command_id}</Badge>
                        {ai && <Badge variant="secondary">{"AI"}</Badge>}
                      </div>
                    </div>
                    <p className="command-desc">{command.description}</p>
                    <div className="command-footer">
                      <span className="command-tags-text">
                        {command.tags.length > 0 ? command.tags.join(" / ") : ""}
                      </span>
                      <Button
                        data-testid={commandRunButtonTestId(command.command_id)}
                        size="sm"
                        variant={dangerous ? "destructive" : "outline"}
                        disabled={isRunning}
                        onClick={() => onRunCommand(command)}
                      >
                        {isRunning ? "Running..." : dangerous ? "Dangerous run" : "Run advanced path"}
                      </Button>
                    </div>
                  </Card>
                )
              })}
            </div>
          </details>
        )}
      </div>
    </>
  )
}

export default memo(CommandGrid)
