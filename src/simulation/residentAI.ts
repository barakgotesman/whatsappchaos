import type { Resident, SimulationEvent, Relationship, Sentiment, Grievance } from "@/types"
import { clamp } from "@/state/buildingState"
import { ALLIANCE, SENTIMENT, EVENT_TYPE } from "@/constants"

// ─── Reaction types ───────────────────────────────────────────

/**
 * Per-resident emotional and trust deltas for one tick.
 * Positive numbers = more anger/stress, negative = less.
 */
export interface ResidentReaction {
  residentId: string
  angerDelta: number      // added to mood.anger
  stressDelta: number     // added to mood.stress
  happinessDelta: number  // added to mood.happiness (usually negative)
  trustInPlayerDelta: number
  newGrievance?: Grievance
  newSentiment?: Sentiment  // override if the reaction tips them past a threshold
}

/** All reactions for this tick, keyed by resident id */
export type ReactionMap = Map<string, ResidentReaction>

// ─── Sentiment thresholds ────────────────────────────────────
// Trust score brackets that determine displayed sentiment toward the player.
const SENTIMENT_THRESHOLDS: Record<string, number> = {
  [SENTIMENT.SUPPORTIVE]: 70,  // trust >= 70
  [SENTIMENT.NEUTRAL]:    50,  // trust 50–69
  [SENTIMENT.SKEPTICAL]:  35,  // trust 35–49
  // HOSTILE: below 35
} as const

// ─── Main entry point ─────────────────────────────────────────

/**
 * Computes emotional reactions for all active residents given the events that fired this tick.
 * Each resident reacts based on their sensitivities, archetype, and relationships.
 * Allies amplify each other's reactions; peacemakers dampen theirs.
 *
 * @param residents - current resident array (all, including inactive)
 * @param events - SimulationEvents generated this tick
 * @param relationships - current inter-resident relationship graph
 * @returns ReactionMap with one entry per resident who reacted (others unchanged)
 */
export function react(
  residents: Resident[],
  events: SimulationEvent[],
  relationships: Relationship[],
): ReactionMap {
  const reactions = new Map<string, ResidentReaction>()

  // Ensure every active, unmuted resident has a baseline entry (mood decay)
  for (const resident of residents.filter((r) => r.isActive)) {
    reactions.set(resident.id, baselineDecay(resident))
  }

  // Process each event and accumulate deltas
  for (const event of events) {
    for (const resident of residents.filter((r) => r.isActive && !r.isMuted)) {
      const delta = computeEventReaction(resident, event, residents, relationships)
      if (delta) mergeReaction(reactions, resident.id, delta)
    }
  }

  // Derive new sentiment from accumulated trust delta + current trust
  for (const resident of residents.filter((r) => r.isActive)) {
    const reaction = reactions.get(resident.id)
    if (!reaction) continue
    const projectedTrust = clamp(resident.trustInPlayer + reaction.trustInPlayerDelta)
    const newSentiment = deriveSentiment(projectedTrust)
    if (newSentiment !== resident.currentSentiment) {
      reaction.newSentiment = newSentiment
    }
  }

  return reactions
}

// ─── Per-event reaction logic ─────────────────────────────────

/**
 * Computes how a single resident reacts to a single event.
 * Returns null if the event is irrelevant to this resident.
 *
 * @param resident - the resident doing the reacting
 * @param event - the event to react to
 * @param allResidents - needed to check if source/target is an ally/enemy
 * @param relationships - inter-resident graph for alliance amplification
 */
function computeEventReaction(
  resident: Resident,
  event: SimulationEvent,
  allResidents: Resident[],
  relationships: Relationship[],
): Partial<ResidentReaction> | null {
  const { sourceId, targetId, severity, type } = event

  // Peacemakers react less strongly to conflict events
  const archetypeMultiplier = resident.reactionMultiplier

  // ── Infrastructure events: everyone is affected equally ──────
  if (type === EVENT_TYPE.ELEVATOR_BROKEN || type === EVENT_TYPE.WATER_LEAK || type === EVENT_TYPE.POWER_OUTAGE) {
    const base = (severity / 100) * 20 * archetypeMultiplier
    const stressBase = (severity / 100) * 15
    return {
      angerDelta: base * resident.traits.aggressiveness / 100,
      stressDelta: stressBase * resident.traits.anxiety / 100,
      happinessDelta: -base * 0.5,
      trustInPlayerDelta: -severity / 20, // infrastructure failures hurt player trust
    }
  }

  // ── Complaint events: sensitivity-gated ──────────────────────
  if (isComplaintType(type)) {
    const sensitivity = getSensitivity(resident, type)
    if (sensitivity < 0.5) return null // this resident doesn't care about this topic

    const baseImpact = (severity / 100) * sensitivity * 15 * archetypeMultiplier
    const isSource = resident.id === sourceId
    const isTarget = resident.id === targetId

    let angerDelta = baseImpact
    let trustDelta = 0
    let grievance: Grievance | undefined

    if (isSource) {
      // The complaining resident is venting — feels heard if they are the source
      angerDelta *= 1.5
      grievance = {
        id: `griev_${event.id}_${resident.id}`,
        description: eventDescription(type),
        sourceEventId: event.id,
        intensity: Math.round(severity * sensitivity),
        createdAtTick: event.tick,
      }
    } else if (isTarget) {
      // Being accused raises stress and lowers trust in the person who accused them
      angerDelta *= 1.2
      trustDelta = -severity / 30
    } else {
      // Bystander: reacts based on their relationship with the source
      const rel = findRelationship(relationships, resident.id, sourceId)
      const allyBoost = rel?.alliance === ALLIANCE.ALLIED ? 1.4 : rel?.alliance === ALLIANCE.FEUDING ? 0.6 : 1.0
      angerDelta *= allyBoost
    }

    // High-gossip residents spread complaints further (amplified trust damage to player)
    if (resident.traits.gossipTendency > 70 && !isSource) {
      trustDelta -= (severity / 50) * (resident.traits.gossipTendency / 100)
    }

    return {
      angerDelta,
      stressDelta: angerDelta * 0.5,
      happinessDelta: -angerDelta * 0.3,
      trustInPlayerDelta: trustDelta,
      newGrievance: grievance,
    }
  }

  // ── Social events ────────────────────────────────────────────
  if (type === EVENT_TYPE.RUMOR_SPREAD) {
    // Rumors raise everyone's stress and distrust
    const base = (severity / 100) * 10
    return {
      angerDelta: base * (resident.traits.gossipTendency / 100),
      stressDelta: base * (resident.traits.anxiety / 100),
      happinessDelta: -base * 0.4,
      trustInPlayerDelta: -base * 0.3,
    }
  }

  if (type === EVENT_TYPE.PUBLIC_ACCUSATION) {
    if (resident.id === targetId) {
      // Accused resident: big anger spike, trust collapse
      return {
        angerDelta: severity * 0.4 * archetypeMultiplier,
        stressDelta: severity * 0.3,
        happinessDelta: -severity * 0.3,
        trustInPlayerDelta: -severity / 15,
      }
    }
    // Others: spectators get a stress bump from the drama
    return {
      angerDelta: severity * 0.1,
      stressDelta: severity * 0.15 * (resident.traits.anxiety / 100),
      happinessDelta: -severity * 0.1,
      trustInPlayerDelta: 0,
    }
  }

  if (type === EVENT_TYPE.NO_CONFIDENCE_SIGNAL) {
    // Contagious — high-anxiety residents are easily swayed toward the vote
    const susceptibility = (resident.traits.anxiety + (100 - resident.traits.authorityRespect)) / 200
    return {
      angerDelta: severity * 0.15 * susceptibility,
      stressDelta: severity * 0.2 * susceptibility,
      happinessDelta: -severity * 0.1,
      trustInPlayerDelta: -severity * 0.15 * susceptibility,
    }
  }

  if (type === EVENT_TYPE.SUPPORT_SIGNAL) {
    // Positive signal — reduces anger/stress for supporters
    const isSource = resident.id === sourceId
    const mult = isSource ? 1.5 : 0.5
    return {
      angerDelta: -severity * 0.1 * mult,
      stressDelta: -severity * 0.1 * mult,
      happinessDelta: severity * 0.15 * mult,
      trustInPlayerDelta: severity * 0.1 * mult,
    }
  }

  // Unknown event type — no reaction
  return null
}

// ─── Baseline mood decay ──────────────────────────────────────

/**
 * Every tick, anger decays and happiness slowly recovers, regardless of events.
 * This prevents emotions from staying permanently maxed.
 */
function baselineDecay(resident: Resident): ResidentReaction {
  return {
    residentId: resident.id,
    angerDelta: -2,       // anger drops 2/tick toward calm
    stressDelta: -1,      // stress drops 1/tick
    happinessDelta: 0.5,  // happiness nudges up slowly
    trustInPlayerDelta: 0,
  }
}

// ─── Utilities ────────────────────────────────────────────────

/**
 * Merges a partial reaction delta into an existing entry in the map.
 * All numeric fields are summed; newGrievance and newSentiment use last-write wins.
 */
function mergeReaction(
  reactions: Map<string, ResidentReaction>,
  id: string,
  delta: Partial<ResidentReaction>,
): void {
  const existing = reactions.get(id) ?? {
    residentId: id,
    angerDelta: 0,
    stressDelta: 0,
    happinessDelta: 0,
    trustInPlayerDelta: 0,
  }
  reactions.set(id, {
    residentId: id,
    angerDelta: existing.angerDelta + (delta.angerDelta ?? 0),
    stressDelta: existing.stressDelta + (delta.stressDelta ?? 0),
    happinessDelta: existing.happinessDelta + (delta.happinessDelta ?? 0),
    trustInPlayerDelta: existing.trustInPlayerDelta + (delta.trustInPlayerDelta ?? 0),
    newGrievance: delta.newGrievance ?? existing.newGrievance,
    newSentiment: delta.newSentiment ?? existing.newSentiment,
  })
}

/**
 * Finds the relationship record for two residents (order doesn't matter).
 */
function findRelationship(
  relationships: Relationship[],
  a: string,
  b: string,
): Relationship | undefined {
  return relationships.find(
    (r) => (r.residentAId === a && r.residentBId === b) ||
            (r.residentAId === b && r.residentBId === a),
  )
}

/**
 * Returns a resident's sensitivity multiplier for a given event type.
 * Unmapped event types return 1.0 (default sensitivity).
 */
function getSensitivity(resident: Resident, eventType: string): number {
  const map: Record<string, keyof typeof resident.sensitivities> = {
    [EVENT_TYPE.NOISE_COMPLAINT]:        "noise",
    [EVENT_TYPE.CLEANLINESS_COMPLAINT]:  "cleanliness",
    [EVENT_TYPE.PARKING_DISPUTE]:        "parking",
    [EVENT_TYPE.PET_COMPLAINT]:          "pets",
    [EVENT_TYPE.RENOVATION_NOISE]:       "renovations",
    [EVENT_TYPE.MAINTENANCE_FEE_DISPUTE]:"money",
  }
  const key = map[eventType]
  return key ? resident.sensitivities[key] : 1.0
}

/**
 * Returns true for event types that are building complaint categories.
 */
function isComplaintType(type: string): boolean {
  return [
    EVENT_TYPE.NOISE_COMPLAINT, EVENT_TYPE.CLEANLINESS_COMPLAINT, EVENT_TYPE.PARKING_DISPUTE,
    EVENT_TYPE.PET_COMPLAINT, EVENT_TYPE.RENOVATION_NOISE, EVENT_TYPE.MAINTENANCE_FEE_DISPUTE,
  ].includes(type as never)
}

/**
 * Returns a short Hebrew-style description for a grievance — used by LLM context.
 */
function eventDescription(eventType: string): string {
  const map: Record<string, string> = {
    [EVENT_TYPE.NOISE_COMPLAINT]:        "רעש בלתי נסבל",
    [EVENT_TYPE.CLEANLINESS_COMPLAINT]:  "ניקיון חצר וחדר מדרגות",
    [EVENT_TYPE.PARKING_DISPUTE]:        "בעיית חנייה",
    [EVENT_TYPE.PET_COMPLAINT]:          "בעיות עם חיות מחמד",
    [EVENT_TYPE.RENOVATION_NOISE]:       "רעש שיפוצים",
    [EVENT_TYPE.MAINTENANCE_FEE_DISPUTE]:"דמי ועד בית",
  }
  return map[eventType] ?? eventType
}

/**
 * Derives the current sentiment label from a trust score.
 * Used after each tick to check if a resident's displayed sentiment has changed.
 *
 * @param trust - 0–100 trust score
 */
export function deriveSentiment(trust: number): Sentiment {
  if (trust >= SENTIMENT_THRESHOLDS[SENTIMENT.SUPPORTIVE]) return SENTIMENT.SUPPORTIVE
  if (trust >= SENTIMENT_THRESHOLDS[SENTIMENT.NEUTRAL])    return SENTIMENT.NEUTRAL
  if (trust >= SENTIMENT_THRESHOLDS[SENTIMENT.SKEPTICAL])  return SENTIMENT.SKEPTICAL
  return SENTIMENT.HOSTILE
}
