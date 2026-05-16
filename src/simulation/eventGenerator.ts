import type { BuildingState, Resident, SimulationEvent, EventType } from "@/types"
import { THRESHOLDS } from "@/types"
import { PHASE, EVENT_TYPE } from "@/constants"

// ─── Event probability tables ─────────────────────────────────
// Per-tick base probabilities for each event class, by game phase.
// These are multiplied by state modifiers before rolling.

const BASE_PROB = {
  infrastructure: { intro: 0.01, tension: 0.04, crisis: 0.10, vote: 0.05 },
  complaint:      { intro: 0.05, tension: 0.12, crisis: 0.20, vote: 0.08 },
  social:         { intro: 0.02, tension: 0.06, crisis: 0.12, vote: 0.15 },
} as const

// Infrastructure events are building-level; they pick a random issue type
const INFRASTRUCTURE_TYPES: EventType[] = [
  EVENT_TYPE.ELEVATOR_BROKEN, EVENT_TYPE.WATER_LEAK, EVENT_TYPE.POWER_OUTAGE,
]

// Complaint events are driven by noise/chaos; the source resident is the angriest
const COMPLAINT_TYPES: EventType[] = [
  EVENT_TYPE.NOISE_COMPLAINT, EVENT_TYPE.CLEANLINESS_COMPLAINT, EVENT_TYPE.PARKING_DISPUTE,
  EVENT_TYPE.PET_COMPLAINT, EVENT_TYPE.RENOVATION_NOISE,
]

// Social events emerge from resident relationships and chaos
const SOCIAL_TYPES: EventType[] = [
  EVENT_TYPE.RUMOR_SPREAD, EVENT_TYPE.PUBLIC_ACCUSATION,
  EVENT_TYPE.NO_CONFIDENCE_SIGNAL, EVENT_TYPE.SUPPORT_SIGNAL,
]

/**
 * Deterministically generates simulation events for one tick.
 * Uses state thresholds and per-phase probabilities to decide what fires.
 * The tick number seeds the random rolls so event patterns are reproducible
 * within a session but feel organic.
 *
 * @param state - current building state
 * @param residents - active residents array
 * @returns array of SimulationEvents to process (may be empty)
 */
export function generate(
  state: BuildingState,
  residents: Resident[],
): SimulationEvent[] {
  if (state.phase === PHASE.ENDED) return []

  const events: SimulationEvent[] = []
  const phase = state.phase === PHASE.VOTE ? PHASE.VOTE
    : state.phase === PHASE.CRISIS ? PHASE.CRISIS
    : state.phase === PHASE.INTRO  ? PHASE.INTRO
    : PHASE.TENSION

  // Seed a lightweight PRNG from tick so rolls are deterministic per tick
  const rng = makeRng(state.tick)

  // ── Infrastructure events ────────────────────────────────────
  // More likely when chaos is high; capped to 1 infrastructure event per tick
  const infraMod = 1 + (state.chaosLevel / 100)
  if (rng() < BASE_PROB.infrastructure[phase] * infraMod) {
    const type = pick(INFRASTRUCTURE_TYPES, rng)
    // Only fire if not already an active issue of the same type
    const alreadyActive = state.activeIssues.some((i) => i.type === type && !i.isResolved)
    if (!alreadyActive) {
      events.push(makeEvent(type, "building", undefined, scaledSeverity(state.chaosLevel, rng), state.tick))
    }
  }

  // ── Complaint events ─────────────────────────────────────────
  // Triggered by noisy/chaotic conditions; source = angriest active resident
  const complaintMod = 1 + (state.noiseLevel / 100) + (state.chaosLevel / 200)
  if (rng() < BASE_PROB.complaint[phase] * complaintMod) {
    const source = angiestResident(residents, rng)
    if (source) {
      // Resident picks the complaint type that matches their highest sensitivity
      const type = pickComplaintByResident(source, rng)
      const target = pickTarget(residents, source.id, rng)
      events.push(makeEvent(type, source.id, target?.id, scaledSeverity(source.mood.anger, rng), state.tick))
    }
  }

  // ── Social events ────────────────────────────────────────────
  // Rumors and accusations emerge when chaos is elevated; vote signals dominate in vote phase
  const socialMod = phase === PHASE.VOTE ? 3 : 1 + (state.chaosLevel / 150)
  if (rng() < BASE_PROB.social[phase] * socialMod) {
    const type = pickSocialEvent(state, phase, rng)
    const source = pick(residents.filter((r) => r.isActive), rng)
    if (source) {
      const target = pickTarget(residents, source.id, rng)
      events.push(makeEvent(type, source.id, target?.id, scaledSeverity(state.chaosLevel, rng), state.tick))
    }
  }

  return events
}

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Creates a SimulationEvent with a unique id.
 */
function makeEvent(
  type: EventType,
  sourceId: string,
  targetId: string | undefined,
  severity: number,
  tick: number,
): SimulationEvent {
  return {
    id: `evt_${tick}_${type}_${sourceId}`,
    type,
    sourceId,
    targetId,
    severity,
    tick,
    metadata: {},
  }
}

/**
 * Returns a severity in 20–100 range, biased upward by the base value.
 * @param base - 0–100 base that shifts the severity up (e.g. anger level)
 */
function scaledSeverity(base: number, rng: () => number): number {
  const min = 20 + base * 0.3
  const max = 40 + base * 0.6
  return Math.round(min + rng() * (max - min))
}

/**
 * Returns the angriest active resident, or a random one if all are calm.
 */
function angiestResident(residents: Resident[], rng: () => number): Resident | undefined {
  const active = residents.filter((r) => r.isActive && !r.isMuted)
  if (active.length === 0) return undefined
  const angry = active.filter((r) => r.mood.anger > 40)
  if (angry.length > 0) {
    return angry.reduce((a, b) => (a.mood.anger > b.mood.anger ? a : b))
  }
  return pick(active, rng)
}

/**
 * Picks the complaint type most relevant to the resident's highest sensitivity.
 * Falls back to a random complaint type if no clear winner.
 */
function pickComplaintByResident(resident: Resident, rng: () => number): EventType {
  const s = resident.sensitivities
  const candidates: Array<[EventType, number]> = [
    [EVENT_TYPE.NOISE_COMPLAINT,       s.noise],
    [EVENT_TYPE.CLEANLINESS_COMPLAINT, s.cleanliness],
    [EVENT_TYPE.PARKING_DISPUTE,       s.parking],
    [EVENT_TYPE.PET_COMPLAINT,         s.pets],
    [EVENT_TYPE.RENOVATION_NOISE,      s.renovations],
  ]
  // Weighted random pick based on sensitivity values
  const total = candidates.reduce((sum, [, w]) => sum + w, 0)
  let roll = rng() * total
  for (const [type, weight] of candidates) {
    roll -= weight
    if (roll <= 0) return type
  }
  return pick(COMPLAINT_TYPES, rng) as EventType
}

/**
 * Picks an appropriate social event type based on current game state.
 * In vote phase, strongly biases toward no_confidence signals.
 */
function pickSocialEvent(
  state: BuildingState,
  phase: string,
  rng: () => number,
): EventType {
  if (phase === PHASE.VOTE) {
    // 70% chance of no_confidence, 30% support (drama moment)
    return rng() < 0.7 ? EVENT_TYPE.NO_CONFIDENCE_SIGNAL : EVENT_TYPE.SUPPORT_SIGNAL
  }
  if (state.chaosLevel > THRESHOLDS.NOISE_COMPLAINT_TRIGGER) {
    // High chaos favors accusations and rumors
    return rng() < 0.6 ? EVENT_TYPE.PUBLIC_ACCUSATION : EVENT_TYPE.RUMOR_SPREAD
  }
  return pick(SOCIAL_TYPES, rng) as EventType
}

/**
 * Picks a random target resident that is not the source.
 */
function pickTarget(
  residents: Resident[],
  excludeId: string,
  rng: () => number,
): Resident | undefined {
  const candidates = residents.filter((r) => r.isActive && r.id !== excludeId)
  if (candidates.length === 0) return undefined
  return pick(candidates, rng)
}

/**
 * Picks a random element from an array using the provided RNG.
 */
function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]
}

/**
 * Minimal mulberry32 PRNG seeded by tick number.
 * Deterministic within a tick; different enough tick-to-tick to feel organic.
 */
function makeRng(seed: number): () => number {
  let s = (seed + 1) * 2654435761
  return () => {
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b)
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b)
    s ^= s >>> 16
    return (s >>> 0) / 0xffffffff
  }
}
