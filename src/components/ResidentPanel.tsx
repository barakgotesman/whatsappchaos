import { ScrollArea } from "@/components/ui/scroll-area"
import type { Resident } from "@/types"

const AVATAR_COLORS  = ["#25d366", "#53bdeb", "#f59e0b", "#ef4444", "#a78bfa", "#fb923c"]
const AVATAR_BORDERS = ["#25d366", "#53bdeb", "#f59e0b", "#93000a", "#a78bfa", "#fb923c"]

function avatarColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

function avatarBorder(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_BORDERS[Math.abs(h) % AVATAR_BORDERS.length]
}

function initials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()
}


interface ResidentPanelProps {
  residents: Resident[]
  onClose: () => void
}

/**
 * Group info screen — slides in when user taps the group name in the header.
 * Matches WhatsApp's group info screen: back button, group avatar, member list.
 * Positioned absolutely inside the phone frame, slides over the chat.
 */
export function ResidentPanel({ residents, onClose }: ResidentPanelProps) {
  const sorted = [...residents].sort((a, b) => Number(b.isActive) - Number(a.isActive))

  return (
    <div className="wa-group-info">
      {/* Group info header */}
      <header className="wa-group-info-header">
        <button className="wa-header-icon" onClick={onClose} aria-label="חזרה">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
          </svg>
        </button>
        <span className="wa-group-info-title">פרטי קבוצה</span>
      </header>

      <ScrollArea className="flex-1">
        {/* Group avatar + name block */}
        <div className="wa-group-info-hero">
          <div className="wa-group-info-avatar">🏢</div>
          <div className="wa-group-info-name">בניין גולדה 14 - ועד הבית</div>
          <div className="wa-group-info-meta">{residents.filter(r => r.isActive).length} דיירים פעילים</div>
        </div>

        {/* Members section label */}
        <div className="wa-group-info-section-label">דיירים</div>

        {/* Member rows */}
        {sorted.map((resident) => {
          const color  = avatarColor(resident.id)
          const border = avatarBorder(resident.id)
          return (
            <div key={resident.id} className="wa-group-info-row">
              <div
                className="wa-resident-avatar"
                style={{ background: color, borderColor: border }}
              >
                {initials(resident.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`wa-resident-name ${resident.isActive ? "" : "wa-resident-name--inactive"}`}>
                  {resident.name}
                  {resident.isMuted && <span> 🔇</span>}
                  {!resident.isActive && <span className="wa-resident-apt"> (עזב)</span>}
                </div>
                <div className="wa-resident-apt">דירה {resident.apartment}</div>
              </div>
            </div>
          )
        })}
      </ScrollArea>
    </div>
  )
}
