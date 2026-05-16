import type {
  Resident, BuildingState, Relationship, SimulationEvent, BuildingIssue,
} from "@/types"
import type { ReactionMap } from "./residentAI"
import { clamp } from "@/state/buildingState"
import { THRESHOLDS } from "@/types"
import { ALLIANCE, PHASE, EVENT_TYPE } from "@/constants"

// ─── Output types ─────────────────────────────────────────────

/**
 * All state changes that escalation wants to apply for this tick.
 * The engine calls applyDeltas with this to mutate state atomically.
 */
export interface StateDeltas {
  // Building-level metric changes (added to current values)
  chaosDelta: number
  noiseDelta: number
  stabilityDelta: number
  voteSentimentDelta: number

  // New issues to add (not duplicates of existing active issues)
  newIssues: BuildingIssue[]

  // IDs of issues that should be marked resolved this tick
  resolvedIssueIds: string[]

  // Relationship trust updates (replace existing entry)
  relationshipUpdates: RelationshipUpdate[]
}

/** Change to apply to a single inter-resident relationship */
export interface RelationshipUpdate {
  id: string  // matches Relationship.id
  trustDelta: number
  newAlliance?: Relationship["alliance"]
}

// ─── Main entry point ─────────────────────────────────────────

/**
 * Determines building-level and relationship consequences of this tick's reactions.
 * Handles alliance formation/breaking, building metric changes, and issue lifecycle.
 * Does NOT apply changes — returns StateDeltas for the engine to apply.
 *
 * @param reactions - per-resident deltas from residentAI.react()
 * @param relationships - current inter-resident relationship graph
 * @param residents - current resident states (pre-delta, read-only here)
 * @param state - current building state (read-only here)
 * @param events - events that fired this tick (used to open/close issues)
 */
export function resolve(
  reactions: ReactionMap,
  relationships: Relationship[],
  residents: Resident[],
  state: BuildingState,
  events: SimulationEvent[],
): StateDeltas {
  const deltas: StateDeltas = {
    chaosDelta: 0,
    noiseDelta: 0,
    stabilityDelta: 0,
    voteSentimentDelta: 0,
    newIssues: [],
    resolvedIssueIds: [],
    relationshipUpdates: [],
  }

  // ── Passive decay — stability drifts toward chaos each tick ──
  deltas.stabilityDelta -= THRESHOLDS.STABILITY_DECAY_PER_TICK

  // ── Aggregate anger → chaos ──────────────────────────────────
  // Total anger across all residents pushes chaos up; happiness pushes it down
  let totalAngerDelta = 0
  let totalHappinessDelta = 0
  for (const reaction of reactions.values()) {
    totalAngerDelta += Math.max(0, reaction.angerDelta)
    totalHappinessDelta += Math.max(0, reaction.happinessDelta)
  }
  const activeCount = residents.filter((r) => r.isActive).length || 1
  deltas.chaosDelta += (totalAngerDelta / activeCount) * 0.8
  deltas.chaosDelta -= (totalHappinessDelta / activeCount) * 0.3

  // ── Phase-based chaos pressure ────────────────────────────────
  // Crisis phase escalates chaos faster; intro phase is damped
  if (state.phase === PHASE.CRISIS) deltas.chaosDelta += 1.5
  if (state.phase === PHASE.INTRO)  deltas.chaosDelta -= 1.0

  // ── Vote sentiment ───────────────────────────────────────────
  // Average trust delta across residents shifts collective vote sentiment.
  // A resident with stubbornness > 70 contributes half as much (hard to move).
  let weightedTrustDelta = 0
  for (const resident of residents.filter((r) => r.isActive)) {
    const reaction = reactions.get(resident.id)
    if (!reaction) continue
    const stubbornFactor = resident.traits.stubbornness > 70 ? 0.5 : 1.0
    weightedTrustDelta += reaction.trustInPlayerDelta * stubbornFactor
  }
  deltas.voteSentimentDelta += weightedTrustDelta / activeCount

  // ── Issue lifecycle from events ──────────────────────────────
  for (const event of events) {
    // Infrastructure and complaint events open building issues if not already active
    if (isIssueOpener(event.type)) {
      const alreadyOpen = state.activeIssues.some(
        (i) => i.type === event.type && !i.isResolved,
      )
      if (!alreadyOpen) {
        deltas.newIssues.push({
          id: `issue_${event.id}`,
          type: event.type as BuildingIssue["type"],
          severity: event.severity,
          reportedByResidentId: event.sourceId,
          createdAtTick: event.tick,
          isResolved: false,
        })
        // Opening a new issue raises noise level and chaos
        deltas.noiseDelta += event.severity * 0.1
        deltas.chaosDelta += event.severity * 0.05
      } else {
        // Re-triggering an existing open issue escalates severity → more chaos
        deltas.chaosDelta += event.severity * 0.03
      }
    }
  }

  // ── Alliance formation / breakdown ───────────────────────────
  // Two residents sharing a grievance category and both angry may form an alliance.
  // Existing allied residents who disagree on this tick's event may see trust erode.
  const angryCutoff = 60  // residents above this anger are "activated"
  const angryResidents = residents.filter((r) => {
    if (!r.isActive) return false
    const reaction = reactions.get(r.id)
    const projectedAnger = clamp(r.mood.anger + (reaction?.angerDelta ?? 0))
    return projectedAnger > angryCutoff
  })

  for (let i = 0; i < angryResidents.length; i++) {
    for (let j = i + 1; j < angryResidents.length; j++) {
      const a = angryResidents[i]
      const b = angryResidents[j]
      const rel = relationships.find(
        (r) => (r.residentAId === a.id && r.residentBId === b.id) ||
                (r.residentAId === b.id && r.residentBId === a.id),
      )
      if (!rel) continue

      // Residents with similar sensitivities who are both angry bond
      const similaritySentiment = computeSensitivitySimilarity(a, b)
      if (similaritySentiment > 0.6 && rel.alliance === ALLIANCE.NEUTRAL) {
        deltas.relationshipUpdates.push({
          id: rel.id,
          trustDelta: 8,
          newAlliance: ALLIANCE.TENSE,
        })
      } else if (similaritySentiment > 0.6 && rel.alliance === ALLIANCE.TENSE) {
        // Tense pair angry together → escalates to full alliance
        deltas.relationshipUpdates.push({
          id: rel.id,
          trustDelta: 5,
          newAlliance: ALLIANCE.ALLIED,
        })
        deltas.voteSentimentDelta -= 3  // allied angry pair is bad for the player
      }

      // Feuding residents who are both angry deepen hostility → chaos spike
      if (rel.alliance === ALLIANCE.FEUDING) {
        deltas.chaosDelta += 2
        deltas.voteSentimentDelta -= 2
      }
    }
  }

  // ── Trust decay between previously allied residents ───────────
  // Alliances break when one resident's trust in the other drops too far
  for (const rel of relationships) {
    if (rel.alliance === ALLIANCE.ALLIED && rel.trust < 40) {
      deltas.relationshipUpdates.push({
        id: rel.id,
        trustDelta: 0,
        newAlliance: ALLIANCE.NEUTRAL,
      })
    }
  }

  return deltas
}

// ─── Applying deltas to state ─────────────────────────────────

/**
 * Mutates buildingState and residents in place using the StateDeltas and ReactionMap.
 * Called by the engine after resolve() — this is the only place state is written.
 *
 * @param state - building state to mutate
 * @param residents - resident array to mutate
 * @param relationships - relationship array to mutate
 * @param deltas - output from resolve()
 * @param reactions - output from residentAI.react()
 * @param tick - current tick number (for grievance timestamps)
 */
export function applyDeltas(
  state: BuildingState,
  residents: Resident[],
  relationships: Relationship[],
  deltas: StateDeltas,
  reactions: ReactionMap,
  tick: number,
): void {
  // ── Building state ────────────────────────────────────────────
  state.chaosLevel = clamp(state.chaosLevel + deltas.chaosDelta)
  state.noiseLevel = clamp(state.noiseLevel + deltas.noiseDelta)
  state.stabilityIndex = clamp(state.stabilityIndex + deltas.stabilityDelta)
  state.voteSentiment = clamp(state.voteSentiment + deltas.voteSentimentDelta)

  // ── Issue lifecycle ───────────────────────────────────────────
  for (const issue of deltas.newIssues) {
    state.activeIssues.push(issue)
  }
  for (const issueId of deltas.resolvedIssueIds) {
    const issue = state.activeIssues.find((i) => i.id === issueId)
    if (issue) {
      issue.isResolved = true
      issue.resolvedAtTick = tick
    }
  }

  // ── Resident emotional states ─────────────────────────────────
  for (const resident of residents.filter((r) => r.isActive)) {
    const reaction = reactions.get(resident.id)
    if (!reaction) continue

    resident.mood.anger = clamp(resident.mood.anger + reaction.angerDelta)
    resident.mood.stress = clamp(resident.mood.stress + reaction.stressDelta)
    resident.mood.happiness = clamp(resident.mood.happiness + reaction.happinessDelta)
    resident.trustInPlayer = clamp(resident.trustInPlayer + reaction.trustInPlayerDelta)

    if (reaction.newSentiment) {
      resident.currentSentiment = reaction.newSentiment
    }
    if (reaction.newGrievance) {
      resident.grievances.push(reaction.newGrievance)
    }

    // Mute expiry: unmute residents whose mute has run out
    if (resident.isMuted && resident.muteExpiresAtTick !== undefined && tick >= resident.muteExpiresAtTick) {
      resident.isMuted = false
      resident.muteExpiresAtTick = undefined
    }
  }

  // ── Relationship updates ──────────────────────────────────────
  for (const update of deltas.relationshipUpdates) {
    const rel = relationships.find((r) => r.id === update.id)
    if (!rel) continue
    rel.trust = clamp(rel.trust + update.trustDelta)
    if (update.newAlliance) rel.alliance = update.newAlliance
  }
}

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Returns true for event types that should open a BuildingIssue.
 */
function isIssueOpener(type: string): boolean {
  return [
    EVENT_TYPE.ELEVATOR_BROKEN, EVENT_TYPE.WATER_LEAK, EVENT_TYPE.POWER_OUTAGE,
    EVENT_TYPE.NOISE_COMPLAINT, EVENT_TYPE.CLEANLINESS_COMPLAINT, EVENT_TYPE.PARKING_DISPUTE,
    EVENT_TYPE.PET_COMPLAINT, EVENT_TYPE.RENOVATION_NOISE, EVENT_TYPE.MAINTENANCE_FEE_DISPUTE,
  ].includes(type as never)
}

/**
 * Computes a 0–1 score for how similar two residents' sensitivity profiles are.
 * Used to determine if they are likely to form a grievance alliance.
 */
function computeSensitivitySimilarity(a: Resident, b: Resident): number {
  const keys = Object.keys(a.sensitivities) as Array<keyof typeof a.sensitivities>
  let totalDiff = 0
  for (const k of keys) {
    totalDiff += Math.abs(a.sensitivities[k] - b.sensitivities[k])
  }
  const maxPossibleDiff = keys.length * 3  // max sensitivity is 3
  return 1 - totalDiff / maxPossibleDiff
}

/**
 * Initializes a neutral relationship between two residents.
 * Called by the engine at game start to set up the full relationship graph.
 *
 * @param idA - first resident id (will be sorted lexicographically)
 * @param idB - second resident id
 */
export function makeRelationship(idA: string, idB: string): Relationship {
  const [a, b] = [idA, idB].sort()
  return {
    id: `${a}_${b}`,
    residentAId: a,
    residentBId: b,
    trust: 50,
    alliance: ALLIANCE.NEUTRAL,
    sharedGrievanceIds: [],
    history: [],
  }
}

/**
 * Builds the initial full relationship graph for all resident pairs.
 * Called once at game start; returned array is mutated throughout the game.
 *
 * @param residentIds - all resident ids in the game
 */
export function initRelationships(residentIds: string[]): Relationship[] {
  const relationships: Relationship[] = []
  for (let i = 0; i < residentIds.length; i++) {
    for (let j = i + 1; j < residentIds.length; j++) {
      relationships.push(makeRelationship(residentIds[i], residentIds[j]))
    }
  }
  return relationships
}
