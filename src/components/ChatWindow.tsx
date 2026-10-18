import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import type { ChatMessage } from "@/types"

// ── Avatar colors — one per resident, cycling through palette ──
const AVATAR_COLORS = ["#25d366", "#53bdeb", "#f59e0b", "#ef4444", "#a78bfa", "#fb923c"]
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

// ── SVG icons ─────────────────────────────────────────────────
function MoodIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
      <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/>
    </svg>
  )
}

function AddIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
    </svg>
  )
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
    </svg>
  )
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
    </svg>
  )
}

// ── Individual message bubble ──────────────────────────────────

/**
 * Renders one message bubble:
 * - Player (אתה): right-aligned green bubble, no avatar, read ticks
 * - Resident: left-aligned dark bubble, avatar + name
 * - System: centered pill badge
 */
function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.type === "system") {
    return (
      <div className="wa-system-row">
        <span className="wa-system-badge">{message.content}</span>
      </div>
    )
  }

  const isPlayer = message.type === "player"
  const minuteOffset = Math.floor(message.tick / 20)
  const hour = 9 + Math.floor(minuteOffset / 60)
  const minute = minuteOffset % 60
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`

  const color = avatarColor(message.senderId)
  const border = avatarBorder(message.senderId)

  if (isPlayer) {
    return (
      <div className="wa-bubble-row wa-bubble-row--out">
        <div className={`wa-bubble wa-bubble--out`}>{message.content}</div>
        <div className="wa-bubble-time">
          <span>{time}</span>
          <span className="wa-read-ticks">✓✓</span>
        </div>
      </div>
    )
  }

  return (
    <div className="wa-bubble-row wa-bubble-row--in">
      <div className="wa-bubble-sender-row">
        <div
          className="wa-bubble-avatar"
          style={{ background: color, borderColor: border }}
        >
          {initials(message.senderName)}
        </div>
        <span className="wa-bubble-sender-name" style={{ color }}>
          {message.senderName}
        </span>
      </div>
      <div className="wa-bubble wa-bubble--in">{message.content}</div>
      <div className="wa-bubble-time">
        <span>{time}</span>
      </div>
    </div>
  )
}

// ── Chat window ────────────────────────────────────────────────

/** Within this many px of the bottom still counts as "at the bottom" (absorbs sub-pixel/overscroll jitter) */
const NEAR_BOTTOM_PX = 80

interface ChatWindowProps {
  messages: ChatMessage[]
  onSendMessage: (text: string) => void
  disabled: boolean
  /** Bumped by the parent each time the player sends — triggers a scroll-to-bottom */
  playerSendCount: number
}

/**
 * WhatsApp chat feed + input bar, living inside the iPhone frame.
 * Auto-scroll only fires when the user is already near the bottom —
 * scrolling up to read history will not be interrupted.
 */
export function ChatWindow({ messages, onSendMessage, disabled, playerSendCount }: ChatWindowProps) {
  const [draft, setDraft] = useState("")
  // Ref to the shadcn ScrollArea's inner viewport div
  const viewportRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // True while the user is reading the bottom of the chat. Kept in a ref (not state) because
  // it's updated on every scroll event and only read when a new message arrives.
  const atBottomRef = useRef(true)
  // True during our own smooth scroll, so its intermediate positions don't count as the user scrolling away
  const autoScrollingRef = useRef(false)
  // Messages that arrived while the user was scrolled up — drives the "N new messages" badge
  const [unread, setUnread] = useState(0)
  const prevLenRef = useRef(messages.length)

  /** Scrolls the feed to the newest message and clears the unread badge. */
  const scrollToBottom = useCallback((smooth: boolean) => {
    const vp = viewportRef.current
    if (!vp) return
    atBottomRef.current = true
    setUnread(0)
    if (!smooth) { vp.scrollTop = vp.scrollHeight; return }
    autoScrollingRef.current = true
    vp.scrollTo({ top: vp.scrollHeight, behavior: "smooth" })
    // scrollend isn't universal — release the flag after the animation would have finished
    window.setTimeout(() => { autoScrollingRef.current = false }, 500)
  }, [])

  // Track whether the user is at the bottom. Ignored while we're animating the scroll ourselves.
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    function onScroll() {
      if (autoScrollingRef.current) return
      const dist = vp!.scrollHeight - vp!.scrollTop - vp!.clientHeight
      const nearBottom = dist < NEAR_BOTTOM_PX
      atBottomRef.current = nearBottom
      if (nearBottom) setUnread((n) => (n === 0 ? n : 0))  // reached bottom manually → badge clears
    }
    vp.addEventListener("scroll", onScroll, { passive: true })
    return () => vp.removeEventListener("scroll", onScroll)
  }, [])

  // Player just sent: always jump to the bottom so their message and the replies are visible
  useLayoutEffect(() => {
    if (playerSendCount > 0) scrollToBottom(false)
  }, [playerSendCount, scrollToBottom])

  // New messages: follow them if the user was at the bottom BEFORE they rendered (the ref holds
  // that state — measuring after render would count the new bubble's height as "scrolled away").
  // Otherwise leave the scroll position alone and count them for the badge.
  useLayoutEffect(() => {
    const added = messages.length - prevLenRef.current
    prevLenRef.current = messages.length
    if (added <= 0) return
    if (atBottomRef.current) scrollToBottom(true)
    else {
      // The player's own bubble is handled by playerSendCount; don't badge it
      const fresh = messages.slice(-added).filter((m) => m.type !== "player" && m.type !== "system")
      if (fresh.length) setUnread((n) => n + fresh.length)
    }
  }, [messages, scrollToBottom])

  // Resize textarea height to fit content, capped at 6 rows
  function resizeTextarea() {
    const el = inputRef.current
    if (!el) return
    el.style.height = "auto"
    const lineHeight = parseInt(getComputedStyle(el).lineHeight) || 20
    el.style.height = Math.min(el.scrollHeight, lineHeight * 6) + "px"
  }

  function handleSend() {
    const text = draft.trim()
    if (!text || disabled) return
    onSendMessage(text)
    setDraft("")
    inputRef.current?.focus()
    // Reset textarea height after clearing draft
    requestAnimationFrame(() => {
      if (inputRef.current) inputRef.current.style.height = "auto"
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const hasDraft = draft.trim().length > 0

  return (
    <>
      {/* Scrollable message feed — viewport ref needed for manual scroll control */}
      <div className="wa-chat-wrap">
        <ScrollArea className="wa-chat" viewportRef={viewportRef as React.RefObject<HTMLDivElement>}>
          <div className="wa-messages-inner">
            {messages.length === 0 && (
              <div className="wa-empty-state">הקבוצה עדיין שקטה...</div>
            )}
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
          </div>
        </ScrollArea>

        {/* Shown only when the user scrolled up and new messages arrived below */}
        {unread > 0 && (
          <Button
            onClick={() => scrollToBottom(true)}
            variant="ghost"
            className="wa-new-badge"
            aria-label={`${unread} הודעות חדשות, גלול למטה`}
          >
            <span>{unread === 1 ? "הודעה חדשה" : `${unread} הודעות חדשות`}</span>
            <span aria-hidden="true">↓</span>
          </Button>
        )}
      </div>

      {/* Input bar — matches Stitch: [+] [emoji field] [mic/send] */}
      <div className="wa-input-bar">
        <button className="wa-input-icon" tabIndex={-1} aria-label="עוד">
          <AddIcon />
        </button>

        <div className="wa-input-field">
          <span className="wa-input-icon shrink-0" aria-hidden="true">
            <MoodIcon />
          </span>
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); resizeTextarea() }}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            rows={1}
            placeholder={disabled ? "המשחק הסתיים" : "הקלד הודעה"}
            className="wa-textarea"
          />
        </div>

        {/* Toggle between mic (empty) and send (has text) */}
        <Button
          onClick={hasDraft ? handleSend : undefined}
          disabled={disabled}
          variant="ghost"
          size="icon"
          className="wa-send-btn"
          aria-label={hasDraft ? "שלח" : "הקלטה"}
        >
          {hasDraft ? <SendIcon /> : <MicIcon />}
        </Button>
      </div>
    </>
  )
}
