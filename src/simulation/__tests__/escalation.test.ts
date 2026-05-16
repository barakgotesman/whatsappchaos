import { describe, it, expect } from "vitest"
import { resolve, applyDeltas, initRelationships, makeRelationship } from "../escalation"
import { react } from "../residentAI"
import { INITIAL_RESIDENTS } from "@/state/residents"
import { INITIAL_BUILDING_STATE } from "@/state/buildingState"
import { ALLIANCE, PHASE, EVENT_TYPE } from "@/constants"
import type { BuildingState, Resident, SimulationEvent } from "@/types"

function makeResidents(): Resident[] {
  return structuredClone(INITIAL_RESIDENTS)
}

function makeState(overrides: Partial<BuildingState> = {}): BuildingState {
  return { ...structuredClone(INITIAL_BUILDING_STATE), ...overrides }
}

function noEvents(): SimulationEvent[] { return [] }

describe("initRelationships()", () => {
  it("creates N*(N-1)/2 relationships for N residents", () => {
    const ids = ["a", "b", "c", "d"]
    const rels = initRelationships(ids)
    expect(rels).toHaveLength(6)  // 4*3/2
  })

  it("all relationships start neutral with trust=50", () => {
    const rels = initRelationships(["a", "b", "c"])
    for (const r of rels) {
      expect(r.trust).toBe(50)
      expect(r.alliance).toBe(ALLIANCE.NEUTRAL)
    }
  })

  it("relationship ids are stable regardless of argument order", () => {
    const r1 = makeRelationship("dov_5a", "rivka_3b")
    const r2 = makeRelationship("rivka_3b", "dov_5a")
    expect(r1.id).toBe(r2.id)
  })
})

describe("resolve()", () => {
  it("always subtracts stability each tick (passive decay)", () => {
    const residents = makeResidents()
    const state = makeState()
    const rels = initRelationships(residents.map((r) => r.id))
    const reactions = react(residents, [], rels)
    const deltas = resolve(reactions, rels, residents, state, noEvents())
    expect(deltas.stabilityDelta).toBeLessThan(0)
  })

  it("chaos rises when residents are angry", () => {
    const residents = makeResidents()
    // Set all residents to maximum anger
    for (const r of residents) r.mood.anger = 100
    const state = makeState({ phase: PHASE.TENSION })
    const rels = initRelationships(residents.map((r) => r.id))
    // Generate events that would make them angrier
    const events: SimulationEvent[] = [{
      id: "e1", type: EVENT_TYPE.NOISE_COMPLAINT, sourceId: "dov_5a",
      severity: 90, tick: 1, metadata: {},
    }]
    const reactions = react(residents, events, rels)
    const deltas = resolve(reactions, rels, residents, state, events)
    expect(deltas.chaosDelta).toBeGreaterThan(0)
  })

  it("opening a new issue adds it to newIssues", () => {
    const residents = makeResidents()
    const state = makeState()
    const rels = initRelationships(residents.map((r) => r.id))
    const events: SimulationEvent[] = [{
      id: "e1", type: EVENT_TYPE.ELEVATOR_BROKEN, sourceId: "building",
      severity: 60, tick: 1, metadata: {},
    }]
    const reactions = react(residents, events, rels)
    const deltas = resolve(reactions, rels, residents, state, events)
    expect(deltas.newIssues).toHaveLength(1)
    expect(deltas.newIssues[0].type).toBe(EVENT_TYPE.ELEVATOR_BROKEN)
  })

  it("does not re-open an already active issue", () => {
    const residents = makeResidents()
    const state = makeState({
      activeIssues: [{
        id: "issue_old",
        type: EVENT_TYPE.ELEVATOR_BROKEN,
        severity: 50,
        reportedByResidentId: "dov_5a",
        createdAtTick: 0,
        isResolved: false,
      }],
    })
    const rels = initRelationships(residents.map((r) => r.id))
    const events: SimulationEvent[] = [{
      id: "e1", type: EVENT_TYPE.ELEVATOR_BROKEN, sourceId: "building",
      severity: 60, tick: 2, metadata: {},
    }]
    const reactions = react(residents, events, rels)
    const deltas = resolve(reactions, rels, residents, state, events)
    expect(deltas.newIssues).toHaveLength(0)
  })
})

describe("applyDeltas()", () => {
  it("clamps chaos between 0 and 100", () => {
    const state = makeState({ chaosLevel: 98 })
    const residents = makeResidents()
    const rels = initRelationships(residents.map((r) => r.id))
    const reactions = react(residents, [], rels)
    const deltas = resolve(reactions, rels, residents, state, noEvents())
    // Force a huge chaos delta
    deltas.chaosDelta = 1000
    applyDeltas(state, residents, rels, deltas, reactions, 1)
    expect(state.chaosLevel).toBe(100)
  })

  it("clamps resident anger between 0 and 100", () => {
    const residents = makeResidents()
    for (const r of residents) r.mood.anger = 5
    const state = makeState()
    const rels = initRelationships(residents.map((r) => r.id))
    const reactions = react(residents, [], rels)
    // Force all anger deltas to -1000
    for (const [, reaction] of reactions) reaction.angerDelta = -1000
    const deltas = resolve(reactions, rels, residents, state, noEvents())
    applyDeltas(state, residents, rels, deltas, reactions, 1)
    for (const r of residents) {
      expect(r.mood.anger).toBeGreaterThanOrEqual(0)
    }
  })

  it("marks a resolved issue and sets resolvedAtTick", () => {
    const state = makeState({
      activeIssues: [{
        id: "issue_abc",
        type: EVENT_TYPE.ELEVATOR_BROKEN,
        severity: 50,
        reportedByResidentId: "dov_5a",
        createdAtTick: 1,
        isResolved: false,
      }],
    })
    const residents = makeResidents()
    const rels = initRelationships(residents.map((r) => r.id))
    const reactions = react(residents, [], rels)
    const deltas = resolve(reactions, rels, residents, state, noEvents())
    deltas.resolvedIssueIds = ["issue_abc"]
    applyDeltas(state, residents, rels, deltas, reactions, 5)
    const issue = state.activeIssues.find((i) => i.id === "issue_abc")!
    expect(issue.isResolved).toBe(true)
    expect(issue.resolvedAtTick).toBe(5)
  })

  it("unmutes a resident when muteExpiresAtTick is reached", () => {
    const residents = makeResidents()
    const dov = residents.find((r) => r.id === "dov_5a")!
    dov.isMuted = true
    dov.muteExpiresAtTick = 3
    const state = makeState()
    const rels = initRelationships(residents.map((r) => r.id))
    const reactions = react(residents, [], rels)
    const deltas = resolve(reactions, rels, residents, state, noEvents())
    applyDeltas(state, residents, rels, deltas, reactions, 3)
    expect(dov.isMuted).toBe(false)
    expect(dov.muteExpiresAtTick).toBeUndefined()
  })
})
