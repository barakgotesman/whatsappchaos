import type {
  Resident,
  BuildingState,
  SimulationEvent,
  ChatMessage,
  GenerateMessageRequest,
} from "@/types"
import { generateMessage } from "./groqClient"
import { trace } from "@/dev/traceStore"
import { SENDER_ID, PLAYER_LLM_NAME } from "@/constants"
import { isAwaitingPlayer } from "@/simulation/pacing"

/** Only one resident speaks per tick — keeps chat readable and limits LLM calls */
const MAX_SPEAKERS_PER_TICK = 1

/** Minimum real-time ms between any two resident messages — prevents spam.
 *  12s caps ambient output at ~5 calls/min so the Groq token budget (TPM/TPD), not just
 *  the request limit, survives a full session; player replies bypass it via forceSpeak. */
const MIN_MESSAGE_GAP_MS = 12000

/** Per-resident cooldown — a resident who just spoke waits this long before speaking again.
 *  Prevents any single resident from monopolizing the chat. */
const MIN_RESIDENT_COOLDOWN_MS = 20000

/** Timestamp of the last resident message sent — enforces MIN_MESSAGE_GAP_MS */
let lastMessageAt = 0

/** True while an LLM generate call is in flight — prevents concurrent Groq requests
 *  that would burst the rate limit and cause all of them to fail */
let inFlight = false

/** Events that fired but haven't been voiced in chat yet. Without this, an event that fires while
 *  the speaker is gated (message gap, call in flight, waiting for the player, source on cooldown)
 *  would silently vanish — the dev panel shows the event but the chat never mentions it. */
let pendingEvents: SimulationEvent[] = []

/** An unvoiced event goes stale after this many ticks (~36s) — late complaints about old news read wrong */
const MAX_EVENT_AGE_TICKS = 12

/** Cap on queued events; the most severe/recent are kept */
const MAX_PENDING_EVENTS = 6

/** Snapshot of events still waiting to be voiced — read-only, for the dev debug report. */
export function getPendingEvents(): SimulationEvent[] {
  return [...pendingEvents]
}

/** True while at least one fresh event still waits to be voiced (lets the caller skip the quiet-tick shortcut). */
export function hasPendingEvents(tick: number): boolean {
  return pendingEvents.some((e) => tick - e.tick <= MAX_EVENT_AGE_TICKS)
}

/**
 * Adds new events to the queue, drops stale ones, and keeps the list ordered
 * most-severe-first (ties: newest first) so the loudest issue is voiced next.
 *
 * @param events - events fired this tick
 * @param tick - current tick, used for staleness
 */
function enqueueEvents(events: SimulationEvent[], tick: number): void {
  const known = new Set(pendingEvents.map((e) => e.id))
  const merged = [...pendingEvents, ...events.filter((e) => !known.has(e.id))]
    .filter((e) => tick - e.tick <= MAX_EVENT_AGE_TICKS)
    .sort((a, b) => b.severity - a.severity || b.tick - a.tick)
  pendingEvents = merged.slice(0, MAX_PENDING_EVENTS)
}

/** Per-resident last-spoke timestamps — enforces MIN_RESIDENT_COOLDOWN_MS */
const residentLastSpokeAt = new Map<string, number>()

/**
 * Entry point called after each engine tick or player message.
 * Selects which residents speak, generates their LLM messages, and returns
 * ChatMessage[] ready to be injected into the engine.
 *
 * @param events - SimulationEvents fired this tick (used to pick speakers)
 * @param residents - current resident snapshots
 * @param state - current building state snapshot
 * @param forceSpeak - if true, bypasses the time gap and guarantees at least one speaker
 *                     (used after the player sends a message so someone always replies)
 */
export async function generateResidentMessages(
  events: SimulationEvent[],
  residents: Resident[],
  state: BuildingState,
  forceSpeak = false,
): Promise<ChatMessage[]> {
  // Remember this tick's events BEFORE any gate below can bail out, so they get voiced later.
  // Player-reply turns (forceSpeak) respond to the player, not to the event backlog.
  if (!forceSpeak) enqueueEvents(events, state.tick)

  // Enforce minimum gap — skip unless forceSpeak is set
  if (!forceSpeak && Date.now() - lastMessageAt < MIN_MESSAGE_GAP_MS) return []
  // Skip if a call is already in flight — prevents concurrent Groq requests that burst the rate limit.
  // forceSpeak bypasses this so the player always gets a reply even if a tick call is in progress.
  if (!forceSpeak && inFlight) return []
  // Turn-taking: after a couple of unanswered resident messages the group waits for the player
  // instead of piling on. Expires after a while so a silent player still feels pressure.
  if (!forceSpeak && isAwaitingPlayer(state)) return []

  inFlight = true
  try {
    // Voice the queued backlog (includes this tick's events); player replies use no event topic
    const speakers = selectSpeakers(forceSpeak ? events : pendingEvents, residents, state, forceSpeak)
    if (speakers.length === 0) return []

    // MAX_SPEAKERS_PER_TICK is 1 so there is always exactly one call
    const settled = await Promise.allSettled(
      speakers.map(({ resident, event }) =>
        generateForResident(resident, event, state, residents),
      ),
    )

    const messages: ChatMessage[] = []
    for (const result of settled) {
      if (result.status === "fulfilled" && result.value) {
        messages.push(result.value)
      }
    }

    if (messages.length > 0) {
      // Events that got a message are done; the rest stay queued until they go stale
      const voiced = new Set(messages.map((m) => m.relatedEventId))
      pendingEvents = pendingEvents.filter((e) => !voiced.has(e.id))
      lastMessageAt = Date.now()
      // Record per-resident cooldown so they don't speak again immediately
      for (const msg of messages) {
        residentLastSpokeAt.set(msg.senderId, lastMessageAt)
      }
    }
    return messages
  } finally {
    inFlight = false
  }
}

// ─── Speaker selection ────────────────────────────────────────

/**
 * Chooses up to MAX_SPEAKERS_PER_TICK residents to speak this tick.
 * Priority: residents directly involved in events first,
 * then high-mood spontaneous speakers sorted by anger + stress.
 * When forceSpeak is true, the cooldown is relaxed so someone always replies.
 *
 * @param events - events that fired this tick
 * @param residents - all residents
 * @param state - current building state (used for chaos context)
 * @param forceSpeak - if true, relaxes per-resident cooldown to guarantee a speaker
 */
function selectSpeakers(
  events: SimulationEvent[],
  residents: Resident[],
  state: BuildingState,
  forceSpeak = false,
): Array<{ resident: Resident; event: SimulationEvent }> {
  const now = Date.now()
  // In forced mode, use a shorter cooldown (20s instead of 30s) so someone always
  // replies to the player, but the same resident can't speak back-to-back within a session.
  const cooldown = forceSpeak ? 20000 : MIN_RESIDENT_COOLDOWN_MS
  const active = residents.filter(
    (r) => r.isActive && !r.isMuted && (now - (residentLastSpokeAt.get(r.id) ?? 0)) >= cooldown,
  )
  const selected: Array<{ resident: Resident; event: SimulationEvent }> = []
  const used = new Set<string>()

  // Event-driven: the source resident of each event speaks first.
  // Infrastructure events have sourceId="building" (not a resident), so we fall back
  // to the angriest eligible resident — they're the most likely to react to the issue.
  for (const event of events) {
    if (selected.length >= MAX_SPEAKERS_PER_TICK) break
    const eligible = active.filter((r) => !used.has(r.id))
    // Source resident speaks if available; if they're on cooldown (or it's a building-level
    // event) the angriest eligible resident reacts instead, so the event is never left unvoiced.
    const resident = (event.sourceId !== "building" && eligible.find((r) => r.id === event.sourceId))
      || eligible.slice().sort((a, b) => b.mood.anger - a.mood.anger)[0]
    if (resident) {
      selected.push({ resident, event })
      used.add(resident.id)
    }
  }

  // Spontaneous: high-mood residents may speak even without a direct event
  if (selected.length < MAX_SPEAKERS_PER_TICK) {
    const eligible = active.filter((r) => !used.has(r.id))
    const spontaneous = eligible
      .filter((r) => shouldSpeakSpontaneously(r))
      .sort((a, b) => b.mood.anger + b.mood.stress - (a.mood.anger + a.mood.stress))

    for (const resident of spontaneous) {
      if (selected.length >= MAX_SPEAKERS_PER_TICK) break
      const event = events[0] ?? makeDummyEvent(resident.id, state.tick)
      selected.push({ resident, event })
      used.add(resident.id)
    }

    // In forced mode, if still nobody selected, pick the most emotionally activated
    // resident regardless of spontaneous probability — the player must get a reply
    if (forceSpeak && selected.length === 0 && eligible.length > 0) {
      const mostActivated = eligible
        .slice()
        .sort((a, b) => b.mood.anger + b.mood.stress - (a.mood.anger + a.mood.stress))[0]
      const event = events[0] ?? makeDummyEvent(mostActivated.id, state.tick)
      selected.push({ resident: mostActivated, event })
    }
  }

  return selected
}

/**
 * Decides if a resident speaks without being directly triggered by an event.
 * High sociability lowers the bar; high anger/stress raises the urgency.
 *
 * @param resident - the resident to evaluate
 */
function shouldSpeakSpontaneously(resident: Resident): boolean {
  const moodPressure = (resident.mood.anger + resident.mood.stress) / 2
  // Base chatter: up to 8% per tick (sociability 0–100 → 0–8%)
  // Lower than before because MIN_MESSAGE_GAP_MS already paces the flow
  const sociabilityChance = resident.traits.sociability * 0.08
  // Very high mood pressure (>80) overrides the random check
  return moodPressure > 80 || Math.random() * 100 < sociabilityChance
}

// ─── Message generation ───────────────────────────────────────

/**
 * Generates a single resident's message via the LLM.
 * Traces the call to the dev panel and returns a ChatMessage or null on failure.
 *
 * @param resident - the resident who is speaking
 * @param event - the triggering event (provides topic context)
 * @param state - current building state (provides active issues + chat history)
 * @param residents - all residents (used to look up the event source's name)
 */
async function generateForResident(
  resident: Resident,
  event: SimulationEvent,
  state: BuildingState,
  residents: Resident[],
): Promise<ChatMessage | null> {
  const sourceResident = residents.find((r) => r.id === event.sourceId)
  const targetResident = event.targetId ? residents.find((r) => r.id === event.targetId) : undefined
  // Last 3 messages as plain strings for LLM context.
  // Replace "אתה" (UI label for the player) with "ועד הבית" so the LLM understands
  // who sent the message — "אתה" is a Hebrew pronoun that means nothing to the model.
  const recentMessages = state.chatMessages
    .slice(-3)
    .map((m) => `${m.senderId === SENDER_ID.PLAYER ? PLAYER_LLM_NAME : m.senderName}: ${m.content}`)

  const req: GenerateMessageRequest = {
    callType: "generate",
    residentId: resident.id,
    personaDescription: resident.personaDescription,
    mood: resident.mood,
    trustInPlayer: resident.trustInPlayer,
    currentSentiment: resident.currentSentiment,
    eventType: event.type,
    sourceResidentName: sourceResident?.name ?? "דייר",
    targetResidentName: targetResident?.name,
    speakerIsSource: event.sourceId === resident.id,
    severity: event.severity,
    activeIssues: state.activeIssues.filter((i) => !i.isResolved).map((i) => i.type),
    recentMessages,
  }

  const start = Date.now()
  const response = await generateMessage(req)
  const latencyMs = Date.now() - start

  // null = circuit breaker opened; caller will detect isLlmCircuitOpen() and halt
  if (response === null) return null

  trace.traceLLM({
    callType: "generate",
    prompt: JSON.stringify(req, null, 2),
    rawResponse: response.message,
    parsed: response.message,
    success: !response.fallbackUsed,
    fallbackUsed: response.fallbackUsed,
    latencyMs,
    tick: state.tick,
  })

  if (!response.message.trim()) return null

  return {
    id: crypto.randomUUID(),
    senderId: resident.id,
    senderName: resident.name,
    content: response.message,
    tick: state.tick,
    type: "resident",
    relatedEventId: event.id,
  }
}

/**
 * Synthetic event used when a spontaneous speaker has no triggering event.
 * Gives the LLM a plausible neutral context.
 */
function makeDummyEvent(residentId: string, tick: number): SimulationEvent {
  return {
    id: `dummy_${tick}_${residentId}`,
    type: "noise_complaint",  // generic enough for any persona to react to
    sourceId: residentId,
    severity: 30,
    tick,
    metadata: {},
  }
}
