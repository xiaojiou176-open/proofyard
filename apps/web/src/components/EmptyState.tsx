import { memo } from "react"
import { Button } from "@uiq/ui"

interface EmptyStateProps {
  eyebrow?: string
  icon?: React.ReactNode
  title: string
  description?: string
  supportingNote?: string
  action?: {
    label: string
    onClick: () => void
  }
  secondaryAction?: {
    label: string
    onClick: () => void
  }
}

function EmptyState({
  eyebrow,
  icon,
  title,
  description,
  supportingNote,
  action,
  secondaryAction,
}: EmptyStateProps) {
  return (
    <div className="empty-state">
      {eyebrow && <p className="empty-state-eyebrow">{eyebrow}</p>}
      {icon && <div className="empty-state-icon">{icon}</div>}
      <p className="empty-state-title">{title}</p>
      {description && <p className="empty-state-desc">{description}</p>}
      {(action || secondaryAction) && (
        <div className="empty-state-action">
          {action && (
            <Button type="button" variant="default" size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button type="button" variant="ghost" size="sm" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
      {supportingNote && <p className="empty-state-note">{supportingNote}</p>}
    </div>
  )
}

export default memo(EmptyState)
