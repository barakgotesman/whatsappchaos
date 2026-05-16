import { describe, it, expect } from "vitest"
import { react, deriveSentiment } from "../residentAI"
import { INITIAL_RESIDENTS } from "@/state/residents"
import { initRelationships } from "../escalation"
import { SENTIMENT, EVENT_TYPE } from "@/constants"
import type { Resident, SimulationEvent } from "@/types"

function makeResidents(): Resident[] {
  return structuredClone(INITIAL_RESIDENTS)
}

function makeRelationships() {
  return initRelationships(INITIAL_RESIDENTS.map((r) => r.id))
}

function makeEvent(overrides: Partial<SimulationEvent> = {}): SimulationEvent {
  return {
    id: "test_evt",
    type: EVENT_TYPE.NOISE_COMPLAINT,
    sourceId: "dov_5a",
    severity: 60,
    tick: 1,
    metadata: {},
    ...overrides,
  }
}

describe("residentAI.react()", () => {
  it("returns a ReactionMap with entries for all active residents", () => {
    const residents = makeResidents()
    const map = react(residents, [], makeRelationships())
    const activeCount = residents.filter((r) => r.isActive).length
    expect(map.size).toBe(activeCount)
  })

  it("applies baseline anger decay when there are no events", () => {
    const residents = makeResidents()
    const map = react(residents, [], makeRelationships())
    for (const reaction of map.values()) {
      // Baseline decay subtracts anger
      expect(reaction.angerDelta).toBeLessThanOrEqual(0)
    }
  })

  it("increases anger for the source resident of a noise complaint", () => {
    const residents = makeResidents()
    const event = makeEvent({ type: EVENT_TYPE.NOISE_COMPLAINT, sourceId: "dov_5a", severity: 70 })
    const map = react(residents, [event], makeRelationships())
    const dovReaction = map.get("dov_5a")
    expect(dovReaction).toBeDefined()
    // Source resident has higher anger than baseline decay alone
    expect(dovReaction!.angerDelta).toBeGreaterThan(0)
  })

  it("creates a grievance for the source resident of a complaint", () => {
    const residents = makeResidents()
    const event = makeEvent({ type: EVENT_TYPE.NOISE_COMPLAINT, sourceId: "dov_5a", severity: 50 })
    const map = react(residents, [event], makeRelationships())
    const reaction = map.get("dov_5a")
    expect(reaction?.newGrievance).toBeDefined()
    expect(reaction?.newGrievance?.sourceEventId).toBe("test_evt")
  })

  it("peacemaker reacts less strongly than hot_headed resident", () => {
    const residents = makeResidents()
    const event = makeEvent({ type: EVENT_TYPE.NOISE_COMPLAINT, sourceId: "yossi_6b", severity: 70 })
    const map = react(residents, [event], makeRelationships())
    const shmuelReaction = map.get("shmuel_1a")  // peacemaker
    const yossiReaction = map.get("yossi_6b")    // hot_headed source
    // Shmuel's bystander anger should be less than Yossi's (source + archetype multiplier)
    expect(shmuelReaction!.angerDelta).toBeLessThan(yossiReaction!.angerDelta)
  })

  it("no_confidence_signal reduces trust in player for high-anxiety residents", () => {
    const residents = makeResidents()
    const event = makeEvent({ type: EVENT_TYPE.NO_CONFIDENCE_SIGNAL, sourceId: "miriam_2d", severity: 60 })
    const map = react(residents, [event], makeRelationships())
    // Miriam has anxiety=75 — should have a trust reduction
    const miriamReaction = map.get("miriam_2d")
    expect(miriamReaction!.trustInPlayerDelta).toBeLessThan(0)
  })

  it("infrastructure events reduce trust in player for all active residents", () => {
    const residents = makeResidents()
    const event = makeEvent({ type: EVENT_TYPE.ELEVATOR_BROKEN, sourceId: "building", severity: 80 })
    const map = react(residents, [event], makeRelationships())
    for (const reaction of map.values()) {
      // Every resident loses some trust when building infrastructure fails
      expect(reaction.trustInPlayerDelta).toBeLessThan(0)
    }
  })
})

describe("deriveSentiment()", () => {
  it("returns supportive at high trust", () => {
    expect(deriveSentiment(80)).toBe(SENTIMENT.SUPPORTIVE)
    expect(deriveSentiment(70)).toBe(SENTIMENT.SUPPORTIVE)
  })
  it("returns neutral mid-range", () => {
    expect(deriveSentiment(60)).toBe(SENTIMENT.NEUTRAL)
    expect(deriveSentiment(50)).toBe(SENTIMENT.NEUTRAL)
  })
  it("returns skeptical in low-mid range", () => {
    expect(deriveSentiment(40)).toBe(SENTIMENT.SKEPTICAL)
    expect(deriveSentiment(35)).toBe(SENTIMENT.SKEPTICAL)
  })
  it("returns hostile below 35", () => {
    expect(deriveSentiment(34)).toBe(SENTIMENT.HOSTILE)
    expect(deriveSentiment(0)).toBe(SENTIMENT.HOSTILE)
  })
})
