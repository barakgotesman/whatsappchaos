import type {
  Resident,
  BuildingState,
  SimulationEvent,
  ChatMessage,
  GenerateMessageRequest,
} from "@/types"
import { generateMessage } from "./groqClient"
import { trace } from "@/dev/traceStore"

/** Max residents that can speak in a single tick — keeps chat readable */
const MAX_SPEAKERS_PER_TICK = 2

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
  const speakers = selectSpeakers(events, residents, state)
  if (speakers.length === 0) return []

  // Generate messages in parallel — each call is independent
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
  const active = residents.filter((r) => r.isActive && !r.isMuted)
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
  // Sociability determines base chatter rate (0–30% chance per tick)
  const sociabilityChance = resident.traits.sociability * 0.3
  // Mood pressure can push them over the threshold even if quiet by nature
  return moodPressure > 70 || Math.random() * 100 < sociabilityChance
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
  // Last 5 messages as plain strings for LLM context
  const recentMessages = state.chatMessages
    .slice(-5)
    .map((m) => `${m.senderName}: ${m.content}`)

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
