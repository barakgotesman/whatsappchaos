interface DevBadgeProps {
  /** Whether the panel is currently open */
  open: boolean
  onToggle: () => void
}

/**
 * Floating [DEV] button in the bottom-right corner.
 * Only rendered when ?dev=1. Toggles the DevPanel drawer.
 */
export function DevBadge({ open, onToggle }: DevBadgeProps) {
  return (
    <button
      onClick={onToggle}
      className="dev-badge"
      title="Toggle dev panel"
    >
      {open ? "✕ DEV" : "⚙ DEV"}
    </button>
  )
}
