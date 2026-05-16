import { describe, it, expect } from "vitest"
import { generate } from "../eventGenerator"
import { INITIAL_BUILDING_STATE } from "@/state/buildingState"
import { INITIAL_RESIDENTS } from "@/state/residents"
import { PHASE, EVENT_TYPE } from "@/constants"
import type { BuildingState, Resident } from "@/types"

function makeState(overrides: Partial<BuildingState> = {}): BuildingState {
  return { ...structuredClone(INITIAL_BUILDING_STATE), ...overrides }
}

function makeResidents(overrides: Partial<Resident> = {}): Resident[] {
  return structuredClone(INITIAL_RESIDENTS).map((r) => ({ ...r, ...overrides }))
}

describe("eventGenerator.generate()", () => {
  it("returns no events during ended phase", () => {
    const state = makeState({ phase: PHASE.ENDED })
    const events = generate(state, makeResidents())
    expect(events).toHaveLength(0)
  })

  it("returns an array (may be empty) during intro phase", () => {
    const state = makeState({ phase: PHASE.INTRO, tick: 1 })
    const events = generate(state, makeResidents())
    expect(Array.isArray(events)).toBe(true)
  })

  it("generates more events at higher chaos levels", () => {
    // Run 100 ticks and count events for low vs high chaos
    let lowCount = 0
    let highCount = 0
    for (let tick = 0; tick < 100; tick++) {
      lowCount += generate(makeState({ phase: PHASE.TENSION, chaosLevel: 10, noiseLevel: 10, tick }), makeResidents()).length
      highCount += generate(makeState({ phase: PHASE.CRISIS, chaosLevel: 90, noiseLevel: 80, tick }), makeResidents()).length
    }
    expect(highCount).toBeGreaterThan(lowCount)
  })

  it("never generates events for the same infrastructure type twice", () => {
    // If elevator_broken is already active, it should not generate again
    const state = makeState({
      phase: PHASE.CRISIS,
      chaosLevel: 90,
      noiseLevel: 80,
      tick: 42,
      activeIssues: [{
        id: "issue_1",
        type: EVENT_TYPE.ELEVATOR_BROKEN,
        severity: 80,
        reportedByResidentId: "dov_5a",
        createdAtTick: 1,
        isResolved: false,
      }],
    })
    // Run many ticks — elevator_broken should never appear again
    for (let tick = 0; tick < 50; tick++) {
      const events = generate({ ...state, tick }, makeResidents())
      const infraEvents = events.filter((e) => e.type === EVENT_TYPE.ELEVATOR_BROKEN)
      expect(infraEvents).toHaveLength(0)
    }
  })

  it("events have required fields", () => {
    // Use high chaos/noise to increase event probability
    for (let tick = 0; tick < 30; tick++) {
      const events = generate(makeState({ phase: "crisis", chaosLevel: 85, noiseLevel: 80, tick }), makeResidents())
      for (const evt of events) {
        expect(evt.id).toBeTruthy()
        expect(evt.type).toBeTruthy()
        expect(evt.sourceId).toBeTruthy()
        expect(evt.severity).toBeGreaterThanOrEqual(0)
        expect(evt.severity).toBeLessThanOrEqual(100)
        expect(evt.tick).toBe(tick)
      }
    }
  })

  it("does not generate events for muted inactive residents as source", () => {
    const residents = makeResidents({ isActive: false })
    const state = makeState({ phase: PHASE.TENSION, chaosLevel: 60, noiseLevel: 60, tick: 5 })
    // With all residents inactive, complaint events should have no source
    const events = generate(state, residents)
    // Complaint events pick from active residents — none should come from residents here
    const residentIds = new Set(residents.map((r) => r.id))
    const invalidSources = events.filter((e) => residentIds.has(e.sourceId))
    expect(invalidSources).toHaveLength(0)
  })
})
