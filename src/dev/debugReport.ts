import type { BuildingState, Resident, GenerateMessageRequest } from "@/types"
import { trace } from "@/dev/traceStore"
import { isLlmCircuitOpen } from "@/llm/groqClient"
import { getPendingEvents } from "@/llm/residentSpeaker"
import { unansweredResidentCount, isAwaitingPlayer } from "@/simulation/pacing"

/** How much history goes in the report — enough to diagnose, small enough to paste in one message */
const MAX_CHAT = 30
const MAX_EVENTS = 25
const MAX_LLM = 6
const MAX_DIFFS = 10

/** Rounds to a whole number for compact tables */
const r = (n: number) => Math.round(n)

/**
 * Builds a markdown debug report of the current session — chat history, events (flagged if they
 * ever got voiced in chat), resident moods, recent LLM calls and pacing state — meant to be
 * copied and pasted into a conversation with the developer.
 *
 * Dev-only; reads the trace store and the live snapshots. Persona text is left out of LLM
 * prompts to keep the report short (it never changes).
 *
 * @param state - current building state snapshot (chat history, phase, meters)
 * @param residents - current resident snapshots
 */
export function buildDebugReport(state: BuildingState, residents: Resident[]): string {
  const names = new Map(residents.map((x) => [x.id, x.name]))
  const nm = (id?: string) => (id ? `${id}${names.has(id) ? ` (${names.get(id)})` : ""}` : "-")
  const events = trace.getEvents()
  const voiced = new Set(state.chatMessages.map((m) => m.relatedEventId).filter(Boolean))
  const pending = new Set(getPendingEvents().map((e) => e.id))
  const out: string[] = []

  // ── Summary ──
  out.push(`# WhatsApp Chaos debug report`)
  out.push(`generated: ${new Date().toISOString()}`)
  out.push(
    `tick ${state.tick} | phase ${state.phase} | elapsed ${r(state.gameTimeElapsedSeconds)}/${state.gameDurationSeconds}s` +
    ` | chaos ${r(state.chaosLevel)} | noise ${r(state.noiseLevel)} | stability ${r(state.stabilityIndex)} | voteSentiment ${r(state.voteSentiment)}`,
  )
  out.push(
    `llm: ${trace.isMockMode() ? "MOCK" : "real"} | circuitOpen=${isLlmCircuitOpen()}` +
    ` | gameOver=${state.isGameOver}${state.gameResult ? ` (${state.gameResult}: ${state.gameOverReason})` : ""}`,
  )
  out.push(
    `pacing: unansweredResidentMsgs=${unansweredResidentCount(state.chatMessages)} awaitingPlayer=${isAwaitingPlayer(state)}` +
    ` lastNegativeEventTick=${state.lastEventTick ?? "-"} pendingUnvoicedEvents=${getPendingEvents().length}`,
  )
  out.push(`activeIssues: ${state.activeIssues.filter((i) => !i.isResolved).map((i) => i.type).join(", ") || "none"}`)

  // ── Chat ── (each resident message is tagged with the event that triggered it)
  out.push(`\n## Chat (last ${MAX_CHAT} of ${state.chatMessages.length})`)
  const evById = new Map(events.map((e) => [e.event.id, e.event]))
  for (const m of state.chatMessages.slice(-MAX_CHAT)) {
    const ev = m.relatedEventId ? evById.get(m.relatedEventId) : undefined
    const tag = ev ? ` [re: ${ev.type}${ev.targetId ? ` → ${ev.targetId}` : ""}]` : ""
    out.push(`#${m.tick} ${m.senderName}: ${m.content}${tag}`)
  }

  // ── Events ──
  out.push(`\n## Events (last ${MAX_EVENTS} of ${events.length}) — voiced = a chat message was written about it`)
  for (const e of events.slice(-MAX_EVENTS)) {
    const v = voiced.has(e.event.id) ? "voiced" : pending.has(e.event.id) ? "QUEUED" : "NOT voiced"
    out.push(`#${e.tick} ${e.event.type} ${nm(e.event.sourceId)}${e.event.targetId ? ` → ${nm(e.event.targetId)}` : ""} sev=${e.event.severity} | ${v}`)
  }

  // ── Residents ──
  out.push(`\n## Residents (now)`)
  out.push(`id | anger | stress | happy | trust | sentiment | active/muted`)
  for (const x of residents) {
    out.push(`${x.id} | ${r(x.mood.anger)} | ${r(x.mood.stress)} | ${r(x.mood.happiness)} | ${r(x.trustInPlayer)} | ${x.currentSentiment} | ${x.isActive}/${x.isMuted}`)
  }

  // ── LLM calls ──
  const calls = trace.getLLMCalls()
  out.push(`\n## LLM calls (last ${MAX_LLM} of ${calls.length})`)
  for (const c of calls.slice(-MAX_LLM)) {
    out.push(`### #${c.tick} ${c.callType} ${c.latencyMs}ms success=${c.success} fallback=${c.fallbackUsed}`)
    out.push("request: " + compactPrompt(c.prompt))
    out.push("response: " + c.rawResponse)
  }

  // ── State diffs ──
  const diffs = trace.getDiffs()
  out.push(`\n## State changes (last ${MAX_DIFFS} of ${diffs.length})`)
  for (const d of diffs.slice(-MAX_DIFFS)) {
    out.push(
      `#${d.tick} ` +
      d.changedKeys
        .map((k) => `${k}: ${fmt((d.before as Record<string, unknown>)[k])}→${fmt((d.after as Record<string, unknown>)[k])}`)
        .join(", "),
    )
  }

  return out.join("\n")
}

/** Rounds numbers in diffs to 1 decimal; leaves other values as-is */
function fmt(v: unknown): string {
  return typeof v === "number" ? String(Math.round(v * 10) / 10) : String(v)
}

/**
 * Generate-call prompts are stored as pretty JSON of the request; drop the (long, static)
 * persona text and collapse to one line. Analyze prompts are plain text and pass through.
 */
function compactPrompt(prompt: string): string {
  try {
    const req = JSON.parse(prompt) as GenerateMessageRequest
    const { personaDescription: _persona, ...rest } = req
    void _persona
    return JSON.stringify(rest)
  } catch {
    return prompt.replace(/\s+/g, " ").trim()
  }
}
