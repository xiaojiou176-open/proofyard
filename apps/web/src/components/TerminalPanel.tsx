import { memo, useEffect, useMemo, useRef, type ChangeEvent } from "react"
import type { LogEntry, LogLevel, Task } from "../types"
import { Button, Checkbox, Input, Select } from "@uiq/ui"

const logPrefix: Record<LogLevel, string> = {
  info: "INFO",
  success: " OK ",
  warn: "WARN",
  error: " ERR",
}

interface TerminalPanelProps {
  logs: LogEntry[]
  selectedTask: Task | null
  terminalRows: number
  onTerminalRowsChange: (rows: number) => void
  terminalFilter: "all" | LogLevel
  onTerminalFilterChange: (filter: "all" | LogLevel) => void
  autoScroll: boolean
  onAutoScrollChange: (value: boolean) => void
  onClear: () => void
}

function TerminalPanel({
  logs,
  selectedTask,
  terminalRows,
  onTerminalRowsChange,
  terminalFilter,
  onTerminalFilterChange,
  autoScroll,
  onAutoScrollChange,
  onClear,
}: TerminalPanelProps) {
  const terminalRef = useRef<HTMLDivElement>(null)

  const filteredLogs = useMemo(() => {
    if (terminalFilter === "all") return logs
    return logs.filter((log) => log.level === terminalFilter)
  }, [logs, terminalFilter])

  useEffect(() => {
    if (!autoScroll) return
    const box = terminalRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [filteredLogs, autoScroll])

  return (
    <section className="terminal-card" aria-label="Live terminal">
      <div className="terminal-head">
        <div className="terminal-head-left">
          <div className="terminal-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <h2>{"Terminal"}</h2>
        </div>
        <div className="terminal-actions">
          <label htmlFor="terminal-size" className="terminal-size-control">
            {"Height"}
            <Input
              id="terminal-size"
              type="range"
              min={6}
              max={30}
              value={terminalRows}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                onTerminalRowsChange(Number(e.target.value))
              }
              aria-valuetext={`${terminalRows} rows`}
            />
            <span className="terminal-size-value" aria-live="polite" data-testid="terminal-size-value">
              {`${terminalRows} rows`}
            </span>
          </label>
          <Select
            className="terminal-filter-control"
            value={terminalFilter}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              onTerminalFilterChange(e.target.value as "all" | LogLevel)
            }
            aria-label="Filter log level"
            data-uiq-ignore-button-inventory="terminal-filter-control"
          >
            <option value="all">{"All"}</option>
            <option value="info">{"INFO"}</option>
            <option value="success">{"OK"}</option>
            <option value="warn">{"WARN"}</option>
            <option value="error">{"ERR"}</option>
          </Select>
          <label className="terminal-toggle-control">
            <Checkbox
              checked={autoScroll}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onAutoScrollChange(e.target.checked)}
            />
            {"Auto-scroll"}
          </label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClear}
            data-uiq-ignore-button-inventory="terminal-clear-secondary-action"
          >
            {"Clear"}
          </Button>
        </div>
      </div>
      <div
        ref={terminalRef}
        className="terminal-body"
        role="log"
        aria-live="polite"
        style={{ minHeight: `${terminalRows * 1.5}rem` }}
      >
        {filteredLogs.length === 0 ? (
          <span className="log-empty">{"The terminal log is empty"}</span>
        ) : (
          filteredLogs.map((log) => (
            <span key={log.id} className="log-line">
              <span className="log-time">{new Date(log.ts).toLocaleTimeString()}</span>{" "}
              <span className={`log-tag ${log.level}`}>[{logPrefix[log.level]}]</span> {log.message}
              {"\n"}
            </span>
          ))
        )}
      </div>
      {selectedTask && (
        <div className="terminal-sub" tabIndex={0} aria-label="Current task output">
          {selectedTask.output_tail || `Task ${selectedTask.task_id} has no output yet`}
        </div>
      )}
    </section>
  )
}

export default memo(TerminalPanel)
