import type { BuildingState, ChatMessage, SimulationEvent } from "@/types"
import { THRESHOLDS } from "@/types"
import { EVENT_TYPE } from "@/constants"

/**
 * Counts resident messages at the end of the chat that the player has not yet answered.
 * Walks backwards over the history, ignoring system notices, and stops at the first
 * player message. Pure — derived from chat history only, so no extra state to keep in sync.
 *
 * @param messages - full chat history, oldest first
 * @returns number of trailing resident messages since the player last spoke
 */
export function unansweredResidentCount(messages: ChatMessage[]): number {
  let count = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.type === "system") continue
    if (m.type === "player") break
    count++
  }
  return count
}

/**
 * True while the group should "wait for the player": several residents have spoken
 * without a reply AND that happened recently. After AWAIT_PLAYER_WINDOW_TICKS of player
 * silence the wait expires, so an idle player still feels mounting pressure.
 *
 * @param state - current building state (uses tick + chatMessages)
 */
export function isAwaitingPlayer(state: BuildingState): boolean {
  if (unansweredResidentCount(state.chatMessages) < THRESHOLDS.AWAIT_PLAYER_UNANSWERED) return false
  const last = state.chatMessages.at(-1)
  return !!last && state.tick - last.tick < THRESHOLDS.AWAIT_PLAYER_WINDOW_TICKS
}

/** Support signals are the only "good news" event — everything else adds pressure. */
export function isPositiveEvent(evt: SimulationEvent): boolean {
  return evt.type === EVENT_TYPE.SUPPORT_SIGNAL
}
