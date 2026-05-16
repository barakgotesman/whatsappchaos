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

/** Only one resident speaks per tick — keeps chat readable and limits LLM calls */
const MAX_SPEAKERS_PER_TICK = 1

/** Minimum real-time ms between any two resident messages — prevents spam */
const MIN_MESSAGE_GAP_MS = 8000

/** Per-resident cooldown — a resident who just spoke waits this long before speaking again.
 *  Prevents any single resident from monopolizing the chat. */
const MIN_RESIDENT_COOLDOWN_MS = 30000

/** Timestamp of the last resident message sent — enforces MIN_MESSAGE_GAP_MS */
let lastMessageAt = 0

/** Per-resident last-spoke timestamps — enforces MIN_RESIDENT_COOLDOWN_MS */
const residentLastSpokeAt = new Map<string, number>()

/**
 * Entry point called after each engine tick.
 * Selects which residents speak, generates their LLM messages, and returns
 * ChatMessage[] ready to be injected into the engine.
 *
 * @param events - SimulationEvents fired this tick (used to pick speakers)
 * @param residents - current resident snapshots
 * @param state - current building state snapshot
 */
export async function generateResidentMessages(
  events: SimulationEvent[],
  residents: Resident[],
  state: BuildingState,
): Promise<ChatMessage[]> {
  // Enforce minimum gap — skip this tick entirely if too soon after the last message
  if (Date.now() - lastMessageAt < MIN_MESSAGE_GAP_MS) return []

  const speakers = selectSpeakers(events, residents, state)
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
    lastMessageAt = Date.now()
    // Record per-resident cooldown so they don't speak again immediately
    for (const msg of messages) {
      residentLastSpokeAt.set(msg.senderId, lastMessageAt)
    }
  }
  return messages
}

// ─── Speaker selection ────────────────────────────────────────

/**
 * Chooses up to MAX_SPEAKERS_PER_TICK residents to speak this tick.
 * Priority: residents directly involved in events first,
 * then high-mood spontaneous speakers sorted by anger + stress.
 *
 * @param events - events that fired this tick
 * @param residents - all residents
 * @param state - current building state (used for chaos context)
 */
function selectSpeakers(
  events: SimulationEvent[],
  residents: Resident[],
  state: BuildingState,
): Array<{ resident: Resident; event: SimulationEvent }> {
  const now = Date.now()
  // Exclude residents who spoke too recently — enforces chat diversity
  const active = residents.filter(
    (r) => r.isActive && !r.isMuted && (now - (residentLastSpokeAt.get(r.id) ?? 0)) >= MIN_RESIDENT_COOLDOWN_MS,
  )
  const selected: Array<{ resident: Resident; event: SimulationEvent }> = []
  const used = new Set<string>()

  // Event-driven: the source resident of each event speaks first
  for (const event of events) {
    if (selected.length >= MAX_SPEAKERS_PER_TICK) break
    const resident = active.find((r) => r.id === event.sourceId && !used.has(r.id))
    if (resident) {
      selected.push({ resident, event })
      used.add(resident.id)
    }
  }

  // Spontaneous: high-mood residents may speak even without a direct event
  if (selected.length < MAX_SPEAKERS_PER_TICK) {
    const spontaneous = active
      .filter((r) => !used.has(r.id) && shouldSpeakSpontaneously(r))
      .sort((a, b) => b.mood.anger + b.mood.stress - (a.mood.anger + a.mood.stress))

    for (const resident of spontaneous) {
      if (selected.length >= MAX_SPEAKERS_PER_TICK) break
      // Give them the most severe event for context, or invent a neutral one
      const event = events[0] ?? makeDummyEvent(resident.id, state.tick)
      selected.push({ resident, event })
      used.add(resident.id)
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
  // Last 5 messages as plain strings for LLM context.
  // Replace "אתה" (UI label for the player) with "ועד הבית" so the LLM understands
  // who sent the message — "אתה" is a Hebrew pronoun that means nothing to the model.
  const recentMessages = state.chatMessages
    .slice(-5)
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
