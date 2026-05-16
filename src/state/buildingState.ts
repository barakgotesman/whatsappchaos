import type { BuildingState } from "@/types"
import { PHASE } from "@/constants"

/**
 * The starting state of the building at tick 0.
 * Everything is calm — the storm hasn't started yet.
 * Clone this with structuredClone() to avoid mutating the original.
 */
export const INITIAL_BUILDING_STATE: BuildingState = {
  tick: 0,
  gameTimeElapsedSeconds: 0,
  gameDurationSeconds: 600, // 10 minutes default session

  phase: PHASE.INTRO,

  // Building starts stable — will degrade over time
  noiseLevel: 20,
  chaosLevel: 15,
  stabilityIndex: 80,

  // Neutral political standing at start
  voteSentiment: 65, // slightly positive — player has the benefit of the doubt

  activeIssues: [],
  chatMessages: [],

  isGameOver: false,
}

/**
 * Clamps a number between min and max (inclusive).
 * Used everywhere state values are updated to prevent out-of-bounds.
 * @param value - the value to clamp
 * @param min - lower bound (default 0)
 * @param max - upper bound (default 100)
 */
export function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Derives the current game phase from elapsed time and chaos level.
 * Phase determines event frequency and resident aggression multipliers.
 * @param elapsedSeconds - how many seconds have passed since game start
 * @param durationSeconds - total game length
 * @param chaosLevel - current chaos level (0–100)
 */
export function derivePhase(
  elapsedSeconds: number,
  durationSeconds: number,
  chaosLevel: number
): BuildingState["phase"] {
  if (elapsedSeconds < 30) return PHASE.INTRO

  const remainingSeconds = durationSeconds - elapsedSeconds
  if (remainingSeconds <= 60) return PHASE.VOTE  // final minute = vote phase

  if (chaosLevel >= 70) return PHASE.CRISIS

  return PHASE.TENSION
}
