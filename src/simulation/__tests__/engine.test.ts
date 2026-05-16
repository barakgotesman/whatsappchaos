import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { SimulationEngine } from "../engine"
import { PHASE } from "@/constants"

describe("SimulationEngine", () => {
  let engine: SimulationEngine

  beforeEach(() => {
    // Use a very short tick interval for tests
    engine = new SimulationEngine(50)
  })

  afterEach(() => {
    engine.pause()
  })

  it("starts at tick 0 with intro phase", () => {
    const state = engine._getState()
    expect(state.tick).toBe(0)
    expect(state.phase).toBe(PHASE.INTRO)
    expect(state.isGameOver).toBe(false)
  })

  it("increments tick on each tick() call", () => {
    engine.tick()
    expect(engine._getState().tick).toBe(1)
    engine.tick()
    expect(engine._getState().tick).toBe(2)
  })

  it("fires onTick callback with state snapshots", () => {
    const ticks: number[] = []
    engine.onTick = (state) => ticks.push(state.tick)
    engine.tick()
    engine.tick()
    expect(ticks).toEqual([1, 2])
  })

  it("does not mutate state after game is over", () => {
    // Force chaos to max to trigger game over
    engine._getState().chaosLevel = 99
    engine.tick()
    const stateAfterGameOver = structuredClone(engine._getState())
    engine.tick()  // this should be a no-op
    expect(engine._getState().tick).toBe(stateAfterGameOver.tick)
  })

  it("fires onGameOver when chaos hits the lose threshold", () => {
    let resultFired: string | null = null
    engine.onGameOver = (result) => { resultFired = result }
    engine._getState().chaosLevel = 99
    engine.tick()
    expect(resultFired).toBe("lose")
  })

  it("fires onGameOver win when game duration is reached", () => {
    let resultFired: string | null = null
    engine.onGameOver = (result) => { resultFired = result }
    // Force time to just past duration
    engine._getState().gameTimeElapsedSeconds = engine._getState().gameDurationSeconds
    engine.tick()
    expect(resultFired).toBe("win")
  })

  it("apply support_resident raises target trust", () => {
    const before = engine._getResidents().find((r) => r.id === "dov_5a")!.trustInPlayer
    engine.applyPlayerAction({
      type: "support_resident",
      targetId: "dov_5a",
      intensity: 100,
      confidence: 1,
      rawMessage: "test",
    })
    const after = engine._getResidents().find((r) => r.id === "dov_5a")!.trustInPlayer
    expect(after).toBeGreaterThan(before)
  })

  it("apply de_escalate reduces anger for all residents", () => {
    // First raise anger for all residents
    for (const r of engine._getResidents()) r.mood.anger = 70
    engine.applyPlayerAction({
      type: "de_escalate",
      intensity: 100,
      confidence: 1,
      rawMessage: "test",
    })
    for (const r of engine._getResidents()) {
      expect(r.mood.anger).toBeLessThan(70)
    }
  })

  it("pause() stops the loop and resume (start()) restarts it", async () => {
    const ticks: number[] = []
    engine.onTick = (s) => ticks.push(s.tick)
    engine.start()
    await new Promise((r) => setTimeout(r, 120))
    engine.pause()
    const countAfterPause = ticks.length
    await new Promise((r) => setTimeout(r, 120))
    // No new ticks should have fired while paused
    expect(ticks.length).toBe(countAfterPause)
    // Resume and verify ticks continue
    engine.start()
    await new Promise((r) => setTimeout(r, 120))
    expect(ticks.length).toBeGreaterThan(countAfterPause)
  })

  it("reset() returns engine to tick 0", () => {
    engine.tick()
    engine.tick()
    engine.reset()
    expect(engine._getState().tick).toBe(0)
    expect(engine._getState().chaosLevel).toBe(15)
  })

  it("relationships are initialized for all resident pairs", () => {
    const rels = engine._getRelationships()
    const residents = engine._getResidents()
    const expectedCount = (residents.length * (residents.length - 1)) / 2
    expect(rels.length).toBe(expectedCount)
  })
})
