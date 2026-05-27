import {
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
} from "react"
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogOverlay,
  DialogTitle,
} from "@uiq/ui"

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: "danger" | "default"
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const previousActiveRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descId = useId()

  useEffect(() => {
    previousActiveRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    cancelRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      const candidate = previousActiveRef.current
      if (!candidate || !candidate.isConnected) return
      if (candidate.closest('[aria-hidden="true"], [inert]')) return
      candidate.focus()
    }
  }, [])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel()
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [onCancel])

  const handleKeyDown = useCallback((event: ReactKeyboardEvent) => {
    if (event.key !== "Tab") return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    if (!focusable || focusable.length === 0) return

    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    if (event.shiftKey) {
      if (document.activeElement === first) {
        event.preventDefault()
        last.focus()
      }
      return
    }

    if (document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }, [])

  const modal = (
    <DialogOverlay onClick={onCancel}>
      <DialogContent
        ref={dialogRef}
        role="alertdialog"
        titleId={titleId}
        descriptionId={descId}
        onClick={(event: ReactMouseEvent<HTMLDivElement>) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <DialogTitle id={titleId}>{title}</DialogTitle>
        <DialogDescription id={descId}>{message}</DialogDescription>
        <DialogFooter>
          <Button ref={cancelRef} variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={variant === "danger" ? "destructive" : "default"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogOverlay>
  )

  return modal
}

export default memo(ConfirmDialog)
