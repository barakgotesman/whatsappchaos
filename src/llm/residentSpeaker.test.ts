import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { INITIAL_BUILDING_STATE } from "@/state/buildingState"
import { INITIAL_RESIDENTS } from "@/state/residents"
import type { SimulationEvent } from "@/types"

// No network: every generate call returns a fixed line
vi.mock("./groqClient", () => ({
  generateMessage: vi.fn(async () => ({ message: "הודעה", fallbackUsed: false })),
}))

import { generateResidentMessages, hasPendingEvents } from "./residentSpeaker"

function evt(id: string, tick: number, sourceId = "dov_5a"): SimulationEvent {
  return { id, type: "pet_complaint", sourceId, severity: 50, tick, metadata: {} }
}

describe("residentSpeaker event queue", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T00:00:00Z")) })
  afterEach(() => vi.useRealTimers())

  it("voices an event that fired while the message gap was closed, once the gap opens", async () => {
    const residents = structuredClone(INITIAL_RESIDENTS)
    const at = (tick: number) => ({ ...structuredClone(INITIAL_BUILDING_STATE), tick })

    // First event is voiced immediately and opens the 12s gap
    const first = await generateResidentMessages([evt("A", 10)], residents, at(10))
    expect(first).toHaveLength(1)

    // Second event fires inside the gap: nothing is said, but it must stay queued
    expect(await generateResidentMessages([evt("B", 11, "rivka_3b")], residents, at(11))).toHaveLength(0)
    expect(hasPendingEvents(11)).toBe(true)

    // Gap passes; a tick with NO new events still voices the queued one
    vi.advanceTimersByTime(13_000)
    const later = await generateResidentMessages([], residents, at(15))
    expect(later).toHaveLength(1)
    expect(later[0].relatedEventId).toBe("B")
    expect(hasPendingEvents(15)).toBe(false)
  })

  it("drops events that went stale instead of voicing old news", async () => {
    const residents = structuredClone(INITIAL_RESIDENTS)
    vi.advanceTimersByTime(60_000) // clear any gap/cooldowns left by the previous test
    await generateResidentMessages([evt("C", 100)], residents, { ...structuredClone(INITIAL_BUILDING_STATE), tick: 100 })
    vi.advanceTimersByTime(60_000)
    expect(hasPendingEvents(200)).toBe(false)
  })
})
