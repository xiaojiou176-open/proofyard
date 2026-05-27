import { type CSSProperties, memo, useCallback, useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useI18n } from "../i18n"
import { Button } from "@uiq/ui"

interface TourStep {
  selector: string
  title: string
  body: string
  position?: "bottom" | "top" | "left" | "right"
}

const STEPS: TourStep[] = [
  {
    selector: '[data-tour="welcome"]',
    title: "Step 1: decide the goal and inspect the parameter rail",
    body: "Start with the canonical run goal, then inspect the parameter rail on the right. Keep the defaults when you are unsure and change one parameter at a time only after you have a visible result.",
    position: "bottom",
  },
  {
    selector: '[data-tour="tab-launch"]',
    title: 'Step 2: submit the task from "Quick Launch"',
    body: 'Choose the canonical run first and click "Run". Helper or workshop commands stay available later, but the first success path starts here.',
    position: "bottom",
  },
  {
    selector: '[data-tour="tab-tasks"]',
    title: 'Step 3: confirm the result in "Task Center"',
    body: "After the run starts, switch here to confirm whether you now have a result, an evidence bundle, or a recovery action. Read the summary first, then use Recovery Center here before deeper logs or workshop replay.",
    position: "bottom",
  },
]

interface OnboardingTourProps {
  active: boolean
  onComplete: () => void
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ")

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true"
  )
}

function OnboardingTour({ active, onComplete }: OnboardingTourProps) {
  const { t } = useI18n()
  const [step, setStep] = useState(0)
  const popoverRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()

  const currentStep = STEPS[step]
  const handleSkip = useCallback(() => {
    setStep(0)
    onComplete()
  }, [onComplete])

  useEffect(() => {
    if (!active) return
    if (typeof document === "undefined") return
    const consoleRoot = document.querySelector(".console-root")
    const previousAriaHidden = consoleRoot?.getAttribute("aria-hidden")
    const hadInert = consoleRoot?.hasAttribute("inert") ?? false
    const previousBodyOverflow = document.body.style.overflow

    consoleRoot?.setAttribute("aria-hidden", "true")
    consoleRoot?.setAttribute("inert", "")
    document.body.style.overflow = "hidden"

    return () => {
      if (consoleRoot) {
        if (previousAriaHidden == null) {
          consoleRoot.removeAttribute("aria-hidden")
        } else {
          consoleRoot.setAttribute("aria-hidden", previousAriaHidden)
        }
        if (!hadInert) {
          consoleRoot.removeAttribute("inert")
        }
      }
      document.body.style.overflow = previousBodyOverflow
    }
  }, [active])

  useEffect(() => {
    if (!active) return
    if (typeof document === "undefined") return
    const dialog = popoverRef.current
    if (!dialog) return

    const focusables = getFocusableElements(dialog)
    const initialTarget = focusables[0] ?? dialog
    initialTarget.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        handleSkip()
        return
      }

      if (event.key !== "Tab") return
      const currentFocusable = getFocusableElements(dialog)
      if (currentFocusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const fallbackElement = currentFocusable[0]!
      const activeElement = (document.activeElement as HTMLElement | null) ?? fallbackElement
      const currentIndex = Math.max(currentFocusable.indexOf(activeElement), 0)
      const nextIndex = event.shiftKey
        ? currentIndex <= 0
          ? currentFocusable.length - 1
          : currentIndex - 1
        : currentIndex === currentFocusable.length - 1
          ? 0
          : currentIndex + 1
      event.preventDefault()
      currentFocusable[nextIndex]?.focus()
    }

    dialog.addEventListener("keydown", handleKeyDown)
    return () => dialog.removeEventListener("keydown", handleKeyDown)
  }, [active, handleSkip, step])

  const handleNext = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1)
    } else {
      setStep(0)
      onComplete()
    }
  }, [step, onComplete])

  const handlePrev = useCallback(() => {
    if (step > 0) setStep((s) => s - 1)
  }, [step])

  if (!active) return null

  const popoverStyle: CSSProperties = {
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
  }

  const modal = (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="tour-backdrop"
        onClick={handleSkip}
        aria-label={t("Skip the first-use guide")}
        data-uiq-ignore-button-inventory="tour-backdrop-dismiss-surface"
      />
      <div
        ref={popoverRef}
        className="tour-popover"
        style={popoverStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
      >
        <div className="tour-popover-header">
          <h3 id={titleId}>{currentStep ? t(currentStep.title) : ""}</h3>
          <span className="tour-step-count">{`${step + 1} / ${STEPS.length}`}</span>
        </div>
        <div className="tour-popover-body">
          <p id={descId}>{currentStep ? t(currentStep.body) : ""}</p>
        </div>
        <div className="tour-popover-footer">
          <div className="tour-dots">
            {STEPS.map((_, i) => (
              <span key={i} className={`tour-dot ${i === step ? "active" : ""}`} />
            ))}
          </div>
          <div className="flex-row gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleSkip}
              data-uiq-ignore-button-inventory="tour-dismiss-secondary-action"
            >
              {t("Maybe later")}
            </Button>
            {step > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handlePrev}
                data-uiq-ignore-button-inventory="tour-back-secondary-action"
              >
                {t("Previous")}
              </Button>
            )}
            <Button type="button" size="sm" onClick={handleNext}>
              {step === STEPS.length - 1 ? t("Start using Proofyard") : t("Next")}
            </Button>
          </div>
        </div>
      </div>
    </>
  )

  if (typeof document === "undefined") {
    return modal
  }

  return createPortal(modal, document.body)
}

export default memo(OnboardingTour)
