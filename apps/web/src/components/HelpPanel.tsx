import { memo, useCallback, useEffect, useId, useRef } from "react"
import { HELP_PANEL_RESTART_ONBOARDING_TEST_ID } from "../constants/testIds"
import type { AppView } from "../hooks/useAppStore"
import { useI18n } from "../i18n"
import { Button } from "@uiq/ui"

interface HelpPanelProps {
  activeView: AppView
  onClose: () => void
  onRestartTour: () => void
}

const viewHelp: Record<
  AppView,
  { title: string; desc: string; steps: { title: string; desc: string }[] }
> = {
  launch: {
    title: "Quick Launch",
    desc: "Start with the canonical run here, keep the parameter rail simple, and leave helper or workshop commands for later.",
    steps: [
      {
        title: "Choose the canonical run first",
        desc: "Use the default path before any helper or workshop command so you get the cleanest first proof bundle.",
      },
      {
        title: "Confirm the parameter rail",
        desc: "Check the target URL, credentials, and success selector. Keep the defaults when you are unsure and change one thing at a time.",
      },
      {
        title: 'Click the primary run action',
        desc: "The canonical run is the shortest path to a manifest-backed evidence bundle. Advanced commands are still available, but they are not the first move.",
      },
      {
        title: "Verify the result in Task Center",
        desc: "Switch to Task Center to inspect status and evidence first, then use Recovery Center there before workshop-level controls or raw logs.",
      },
    ],
  },
  tasks: {
    title: "Task Center",
    desc: "This view centralizes command runs, template runs, and canonical evidence so you can confirm outcomes before diving into deeper debugging.",
    steps: [
      {
        title: "Start from the record type that matches your question",
        desc: "Use command runs for the live task, template runs for operator state, and evidence runs for retained proof.",
      },
      {
        title: "Open the detail panel and read the summary first",
        desc: "Read the detail summary before opening raw logs. The UI should tell you whether to inspect evidence, retry, or recover.",
      },
      {
        title: "Use Recovery Center before raw logs",
        desc: "Failure explanation, evidence share, and Recovery Center guidance should answer the next action before you fall back to raw output.",
      },
      {
        title: "Treat logs as the deepest layer",
        desc: 'Use logs when the higher-level summary still leaves uncertainty or when you need to inspect the exact task output.',
      },
    ],
  },
  workshop: {
    title: "Flow Workshop",
    desc: "Use Flow Workshop after the first canonical run when you need to refine a draft, inspect step evidence, or recover from a failure.",
    steps: [
      {
        title: "Start with system health",
        desc: "The top section keeps the next action and current health above the deeper debugging surfaces.",
      },
      {
        title: "Edit the flow steps",
        desc: "You can adjust step order, action type, and the selectors used to locate page elements.",
      },
      {
        title: "Replay one step and verify it",
        desc: "Replay a single step first, then confirm the result with screenshots and the evidence rail before widening the scope.",
      },
      {
        title: "Compare the evidence timeline",
        desc: "Use the right-side timeline to review before/after screenshots for each step.",
      },
    ],
  },
}

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ")

function HelpPanel({ activeView, onClose, onRestartTour }: HelpPanelProps) {
  const { t } = useI18n()
  const panelRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusedRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descId = useId()
  const info = viewHelp[activeView]

  const handlePanelKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const panel = panelRef.current
      if (!panel) return
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== "Tab") return

      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector))
      if (focusables.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }

      const activeElement = document.activeElement as HTMLElement | null
      const currentIndex = focusables.indexOf(activeElement ?? focusables[0])
      const nextIndex = event.shiftKey
        ? currentIndex <= 0
          ? focusables.length - 1
          : currentIndex - 1
        : currentIndex === focusables.length - 1
          ? 0
          : currentIndex + 1

      event.preventDefault()
      focusables[nextIndex]?.focus()
    },
    [onClose]
  )

  useEffect(() => {
    if (typeof document === "undefined") return
    const activeElement = document.activeElement
    previousFocusedRef.current = activeElement instanceof HTMLElement ? activeElement : null
    closeButtonRef.current?.focus()

    window.addEventListener("keydown", handlePanelKeyDown)
    return () => {
      window.removeEventListener("keydown", handlePanelKeyDown)
      previousFocusedRef.current?.focus()
    }
  }, [handlePanelKeyDown])

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="help-panel-overlay"
        onClick={onClose}
        aria-label={t("Close help panel")}
        data-uiq-ignore-button-inventory="overlay-dismiss-surface"
      />
      <aside
        ref={panelRef}
        className="help-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
      >
        <div className="help-panel-header">
          <h2 id={titleId}>{t("Help")}</h2>
          <Button
            ref={closeButtonRef}
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={t("Close help panel")}
            data-uiq-ignore-button-inventory="panel-close-control-not-business-action"
          >
            {"\u2715"}
          </Button>
        </div>
        <div className="help-panel-body">
          {/* Current view help */}
          <div className="help-section">
            <h3>{t(info.title)}</h3>
            <p id={descId}>{t(info.desc)}</p>
          </div>

          <div className="help-section">
            <h3>{t("Steps")}</h3>
            <ol className="help-step-list">
              {info.steps.map((s, i) => (
                <li key={i} className="help-step-item">
                  <span className="help-step-num">{i + 1}</span>
                  <div className="help-step-content">
                    <strong>{t(s.title)}</strong>
                    <p>{t(s.desc)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="help-section">
            <h3>{t("Common Questions")}</h3>
            <details className="help-faq-item">
              <summary>{t("I ran a command but cannot see the result")}</summary>
              <p>
                {t(
                  'Conclusion: the result is not visible yet. Action: switch to "Task Center", click "Refresh", and confirm whether the run appears under command runs, template runs, or evidence runs before inspecting raw logs.'
                )}
              </p>
            </details>
            <details className="help-faq-item">
              <summary>{t("How do I configure the target site URL?")}</summary>
              <p>
                {t(
                  'Use the "Target site URL (UIQ_BASE_URL)" field in the Quick Launch parameter panel. The default value points to local development.'
                )}
              </p>
            </details>
            <details className="help-faq-item">
              <summary>{t("What is a flow draft?")}</summary>
              <p>{t("A flow draft is the editable step list you refine after the first run. Treat it like the workshop notebook, not the first proof result.")}</p>
            </details>
            <details className="help-faq-item">
              <summary>{t("When should I use advanced or helper commands?")}</summary>
              <p>{t("Only after the canonical run has already shown you a result. Advanced commands are for workshop troubleshooting and deeper recovery, not for the first success path.")}</p>
            </details>
            <details className="help-faq-item">
              <summary>{t("What is the API token?")}</summary>
              <p>{t("It is the credential used to access the backend API. You only need it when backend auth is enabled.")}</p>
            </details>
          </div>

          <div className="help-section">
            <h3>{t("Other Actions")}</h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid={HELP_PANEL_RESTART_ONBOARDING_TEST_ID}
              onClick={onRestartTour}
            >
              {t("Restart the first-use guide")}
            </Button>
          </div>
        </div>
      </aside>
    </>
  )
}

export default memo(HelpPanel)
