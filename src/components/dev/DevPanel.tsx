import { useEffect, useState } from "react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { trace } from "@/dev/traceStore"
import type {
  EventTraceEntry,
  ResidentTraceEntry,
  LLMTraceEntry,
  StateDiffEntry,
} from "@/dev/traceStore"
import { ScrollArea } from "@/components/ui/scroll-area"

type Tab = "events" | "residents" | "llm" | "diffs"

// ─── Tooltip helper ───────────────────────────────────────────

/** Wraps any inline element and shows a shadcn tooltip on hover */
function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top"><p>{label}</p></TooltipContent>
    </Tooltip>
  )
}

// ─── Tab button ───────────────────────────────────────────────

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`dev-tab-btn${active ? " dev-tab-btn--active" : ""}`}
    >
      {label}
    </button>
  )
}

// ─── Event Log tab ────────────────────────────────────────────

/** Shows every SimulationEvent fired: tick, type, source→target, severity */
function EventLog({ entries }: { entries: EventTraceEntry[] }) {
  if (entries.length === 0) return <DevEmpty>No events yet — start the simulation.</DevEmpty>
  return (
    <div className="dev-list">
      {[...entries].reverse().map((e) => (
        <div key={e.id} className="dev-row">
          <span className="dev-tick">#{e.tick}</span>
          <span className="dev-tag">{e.event.type}</span>
          <span className="dev-dim">
            {e.event.sourceId}
            {e.event.targetId ? ` → ${e.event.targetId}` : ""}
          </span>
          <Tip label={`severity: ${e.event.severity}/100 — ${e.event.severity >= 70 ? "high impact" : e.event.severity >= 40 ? "medium impact" : "low impact"}`}>
            <span className="dev-severity" style={{ color: severityColor(e.event.severity) }}>
              {e.event.severity}
            </span>
          </Tip>
        </div>
      ))}
    </div>
  )
}

// ─── Residents tab ────────────────────────────────────────────

/**
 * Shows the most recent snapshot per resident:
 * anger / stress / happiness bars + trust score + sentiment badge.
 */
function ResidentCards({ entries }: { entries: ResidentTraceEntry[] }) {
  // Deduplicate — keep only the latest entry per resident id
  const latest = new Map<string, ResidentTraceEntry>()
  for (const e of entries) latest.set(e.resident.id, e)

  if (latest.size === 0) return <DevEmpty>No resident data yet.</DevEmpty>

  return (
    <div className="dev-list">
      {[...latest.values()].map(({ resident, tick }) => {
        const { mood, trustInPlayer, currentSentiment, name, apartment } = resident
        return (
          <div key={resident.id} className="dev-resident-card">
            <div className="dev-resident-header">
              <span className="dev-resident-name">{name} <span className="dev-dim">({apartment})</span></span>
              <span className={`dev-sentiment dev-sentiment--${currentSentiment}`}>{currentSentiment}</span>
              <span className="dev-tick">#{tick}</span>
            </div>
            <MoodBar label="😠 anger"   value={mood.anger} />
            <MoodBar label="😰 stress"  value={mood.stress} />
            <MoodBar label="😊 happy"   value={mood.happiness} />
            <div className="dev-trust-row">
              <span className="dev-dim">trust</span>
              <div className="dev-bar-track">
                <div className="dev-bar-fill dev-bar-fill--trust" style={{ width: `${trustInPlayer}%` }} />
              </div>
              <Tip label={`trust in player: ${Math.round(trustInPlayer)}/100 — ${trustInPlayer >= 70 ? "supportive" : trustInPlayer >= 40 ? "neutral" : "hostile"}`}>
                <span className="dev-bar-value">{Math.round(trustInPlayer)}</span>
              </Tip>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MoodBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="dev-trust-row">
      <span className="dev-dim">{label}</span>
      <div className="dev-bar-track">
        <div className="dev-bar-fill" style={{ width: `${value}%`, background: moodColor(value) }} />
      </div>
      <Tip label={`${label}: ${Math.round(value)}/100`}>
        <span className="dev-bar-value">{Math.round(value)}</span>
      </Tip>
    </div>
  )
}

// ─── LLM Log tab ─────────────────────────────────────────────

/** Shows every Groq call: type, latency, success/fallback, prompt + response collapsed */
function LLMLog({ entries }: { entries: LLMTraceEntry[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  if (entries.length === 0) return <DevEmpty>No LLM calls yet — LLM wires up in M4.</DevEmpty>

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="dev-list">
      {[...entries].reverse().map((e) => (
        <div key={e.id} className="dev-llm-entry">
          <div className="dev-row" onClick={() => toggle(e.id)} style={{ cursor: "pointer" }}>
            <span className="dev-tick">#{e.tick}</span>
            <span className="dev-tag">{e.callType}</span>
            <Tip label={`LLM round-trip: ${e.latencyMs}ms`}>
              <span className="dev-dim">{e.latencyMs}ms</span>
            </Tip>
            {!e.success && <span className="dev-badge-error">ERR</span>}
            {e.fallbackUsed && <span className="dev-badge-warn">FALLBACK</span>}
            <span className="dev-expand-icon">{expanded.has(e.id) ? "▲" : "▼"}</span>
          </div>
          {expanded.has(e.id) && (
            <div className="dev-llm-detail">
              <div className="dev-llm-section">PROMPT</div>
              <pre className="dev-pre">{e.prompt}</pre>
              <div className="dev-llm-section">RESPONSE</div>
              <pre className="dev-pre">{e.rawResponse}</pre>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── State Diffs tab ──────────────────────────────────────────

/** Human-readable explanation for each BuildingState scalar key */
const STATE_KEY_DOCS: Record<string, string> = {
  tick:                    "Simulation step counter — increments every engine tick",
  gameTimeElapsedSeconds:  "Real seconds elapsed since the game started",
  gameDurationSeconds:     "Total session length the game was configured for (480–720s)",
  phase:                   "Current game act: intro → tension → crisis → vote → ended",
  noiseLevel:              "0–100 — rising noise triggers noise_complaint events above 60",
  chaosLevel:              "0–100 — primary lose meter; game over if it hits 95",
  stabilityIndex:          "0–100 — inverse of chaos; decays passively each tick",
  voteSentiment:           "0–100 — below 25 the residents call a no-confidence vote (lose)",
  isGameOver:              "True once a win or lose condition has been triggered",
  gameResult:              "'win' or 'lose' — set when the game ends",
  gameOverReason:          "Human-readable explanation of why the game ended",
}

/** Shows per-tick before/after for any BuildingState keys that changed */
function StateDiffs({ entries }: { entries: StateDiffEntry[] }) {
  if (entries.length === 0) return <DevEmpty>No state changes yet.</DevEmpty>
  return (
    <div className="dev-list">
      {[...entries].reverse().map((e) => (
        <div key={e.id} className="dev-diff-entry">
          <span className="dev-tick">#{e.tick}</span>
          {e.changedKeys.map((k) => (
            <div key={k} className="dev-diff-row">
              <Tip label={STATE_KEY_DOCS[k] ?? k}>
                <span className="dev-diff-key">{k}</span>
              </Tip>
              <span className="dev-diff-before">{String((e.before as Record<string, unknown>)[k])}</span>
              <span className="dev-dim">→</span>
              <span className="dev-diff-after">{String((e.after as Record<string, unknown>)[k])}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ─── Shared helpers ───────────────────────────────────────────

function DevEmpty({ children }: { children: React.ReactNode }) {
  return <div className="dev-empty">{children}</div>
}

/** Red at high severity, yellow in middle, green at low */
function severityColor(v: number): string {
  if (v >= 70) return "#ef4444"
  if (v >= 40) return "#f59e0b"
  return "#22c55e"
}

/** Green at low anger/stress, red at high */
function moodColor(v: number): string {
  if (v >= 70) return "#ef4444"
  if (v >= 40) return "#f59e0b"
  return "#22c55e"
}

// ─── Panel root ───────────────────────────────────────────────

/**
 * Right-side dev drawer — only mounted when ?dev=1 and the badge is toggled open.
 * Subscribes to traceStore so it re-renders whenever new data arrives.
 */
export function DevPanel() {
  const [tab, setTab] = useState<Tab>("events")

  // Re-render whenever traceStore emits new data
  const [, setRevision] = useState(0)
  useEffect(() => trace.subscribe(() => setRevision((r) => r + 1)), [])

  const events    = trace.getEvents()
  const residents = trace.getResidents()
  const llmCalls  = trace.getLLMCalls()
  const diffs     = trace.getDiffs()

  return (
    <TooltipProvider delayDuration={300}>
    <aside className="dev-panel">
      <div className="dev-panel-header">DEV PANEL</div>

      <div className="dev-tabs">
        <TabBtn label={`Events (${events.length})`}    active={tab === "events"}    onClick={() => setTab("events")} />
        <TabBtn label={`Residents`}                    active={tab === "residents"} onClick={() => setTab("residents")} />
        <TabBtn label={`LLM (${llmCalls.length})`}    active={tab === "llm"}       onClick={() => setTab("llm")} />
        <TabBtn label={`Diffs (${diffs.length})`}      active={tab === "diffs"}     onClick={() => setTab("diffs")} />
      </div>

      <ScrollArea className="dev-panel-body">
        {tab === "events"    && <EventLog    entries={events} />}
        {tab === "residents" && <ResidentCards entries={residents} />}
        {tab === "llm"       && <LLMLog      entries={llmCalls} />}
        {tab === "diffs"     && <StateDiffs  entries={diffs} />}
      </ScrollArea>
    </aside>
    </TooltipProvider>
  )
}
