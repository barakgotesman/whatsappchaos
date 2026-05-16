import type { BuildingState } from "@/types"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface StatusBarProps {
  state: BuildingState
  onGroupNameClick: () => void
  /** Whether the simulation is currently running */
  isRunning: boolean
  /** Called when the user picks "השהה" / "המשך" from the menu */
  onTogglePause: () => void
}

/**
 * WhatsApp group chat header inside the iPhone frame.
 * Tapping the group name/avatar opens the group info screen (residents list).
 * The "⋮" menu exposes a pause/resume option via shadcn DropdownMenu.
 * No chaos indicators or phase labels — all feedback comes from chat behavior.
 */
export function StatusBar({ state: _state, onGroupNameClick, isRunning, onTogglePause }: StatusBarProps) {
  return (
    <header className="wa-header">
      {/* Back arrow (decorative) */}
      <button className="wa-header-icon" aria-label="חזרה">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
        </svg>
      </button>

      {/* Group avatar + name — tappable, opens group info */}
      <button
        className="wa-header-group"
        onClick={onGroupNameClick}
        aria-label="פרטי קבוצה"
      >
        <div className="wa-header-avatar">🏢</div>
        <div className="wa-header-text">
          <div className="wa-header-title">בניין גולדה 14 - ועד הבית</div>
          <div className="wa-header-subtitle">לחץ לפרטי הקבוצה</div>
        </div>
      </button>

      {/* Three-dot menu — pause / resume */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="wa-header-icon" aria-label="תפריט">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
            </svg>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="wa-dropdown-content">
          <DropdownMenuItem onClick={onTogglePause} className="wa-dropdown-item">
            {isRunning ? "השהה" : "המשך"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
