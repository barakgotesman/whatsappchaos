import { describe, it, expect } from "vitest"
import { generate } from "../eventGenerator"
import { unansweredResidentCount, isAwaitingPlayer, isPositiveEvent } from "../pacing"
import { INITIAL_BUILDING_STATE } from "@/state/buildingState"
import { INITIAL_RESIDENTS } from "@/state/residents"
import { PHASE } from "@/constants"
import type { BuildingState, ChatMessage } from "@/types"

function msg(type: ChatMessage["type"], tick: number): ChatMessage {
  return { id: `${type}${tick}`, senderId: type, senderName: type, content: "x", tick, type }
}
function makeState(o: Partial<BuildingState> = {}): BuildingState {
  return { ...structuredClone(INITIAL_BUILDING_STATE), ...o }
}

describe("pacing", () => {
  it("counts trailing resident messages, stopping at the player and skipping system notices", () => {
    expect(unansweredResidentCount([msg("resident", 1), msg("player", 2), msg("resident", 3), msg("system", 4), msg("resident", 5)])).toBe(2)
    expect(unansweredResidentCount([msg("resident", 1), msg("player", 2)])).toBe(0)
  })

  it("waits for the player after 2 unanswered messages, until the window expires", () => {
    const chat = [msg("resident", 10), msg("resident", 11)]
    expect(isAwaitingPlayer(makeState({ tick: 12, chatMessages: chat }))).toBe(true)
    expect(isAwaitingPlayer(makeState({ tick: 40, chatMessages: chat }))).toBe(false)
    expect(isAwaitingPlayer(makeState({ tick: 12, chatMessages: [msg("resident", 11)] }))).toBe(false)
  })

  it("fires no negative events while the group waits for the player", () => {
    const chat = [msg("resident", 1), msg("resident", 2)]
    for (let tick = 3; tick < 11; tick++) {
      const evts = generate(makeState({ phase: PHASE.CRISIS, chaosLevel: 90, noiseLevel: 90, tick, chatMessages: chat }), structuredClone(INITIAL_RESIDENTS))
      expect(evts.every(isPositiveEvent)).toBe(true)
    }
  })

  it("respects the cooldown and emits at most one event per tick", () => {
    for (let tick = 100; tick < 400; tick++) {
      const s = makeState({ phase: PHASE.CRISIS, chaosLevel: 90, noiseLevel: 90, tick, lastEventTick: tick - 2 })
      const evts = generate(s, structuredClone(INITIAL_RESIDENTS))
      expect(evts.length).toBeLessThanOrEqual(1)
      expect(evts.every(isPositiveEvent)).toBe(true)
    }
  })
})
