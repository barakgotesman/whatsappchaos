import type {
  BuildingState, Resident, Relationship, SimulationEvent, PlayerAction,
} from "@/types"
import { THRESHOLDS } from "@/types"
import { INITIAL_BUILDING_STATE, clamp, derivePhase } from "@/state/buildingState"
import { INITIAL_RESIDENTS as RESIDENTS } from "@/state/residents"
import { ALLIANCE, PHASE } from "@/constants"
import { generate } from "./eventGenerator"
import { react } from "./residentAI"
import { resolve, applyDeltas, initRelationships } from "./escalation"
import { trace } from "@/dev/traceStore"

// ─── Callback signatures ──────────────────────────────────────

/** Called after every tick with fresh copies of state + residents */
export type OnTickCallback = (
  state: BuildingState,
  residents: Resident[],
  events: SimulationEvent[],
) => void

/** Called when the game ends (win or lose) */
export type OnGameOverCallback = (result: "win" | "lose", reason: string) => void

// ─── Engine class ─────────────────────────────────────────────

/**
 * The main simulation engine.
 * Owns the authoritative game state and drives the tick loop.
 * React components do NOT mutate state — they receive snapshots via onTick callbacks.
 *
 * Usage:
 *   const engine = new SimulationEngine()
 *   engine.onTick = (state, residents, events) => setGameState(...)
 *   engine.start()
 */
export class SimulationEngine {
  // ── Game state — mutated each tick, never shared by reference ──
  private state: BuildingState
  private residents: Resident[]
  private relationships: Relationship[]

  // ── Tick loop ─────────────────────────────────────────────────
  private intervalId: ReturnType<typeof setInterval> | null = null

  /** Milliseconds between ticks. 3000ms feels natural; lower for testing. */
  private tickIntervalMs: number

  // ── Callbacks wired up by React ───────────────────────────────
  onTick: OnTickCallback | null = null
  onGameOver: OnGameOverCallback | null = null

  /**
   * @param tickIntervalMs - how often the engine ticks, in milliseconds (default 3000)
   */
  constructor(tickIntervalMs = 3000) {
    this.tickIntervalMs = tickIntervalMs

    // Deep-clone initial state so restarts are clean
    this.state = structuredClone(INITIAL_BUILDING_STATE)
    this.residents = structuredClone(RESIDENTS)
    this.relationships = initRelationships(this.residents.map((r) => r.id))
  }

  /** Starts the tick loop. Safe to call after pause(). */
  start(): void {
    if (this.intervalId !== null) return  // already running
    this.intervalId = setInterval(() => this.tick(), this.tickIntervalMs)
  }

  /** Pauses the tick loop without resetting state. Resume with start(). */
  pause(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  /** Stops the loop and resets all state back to initial values. */
  reset(): void {
    this.pause()
    this.state = structuredClone(INITIAL_BUILDING_STATE)
    this.residents = structuredClone(RESIDENTS)
    this.relationships = initRelationships(this.residents.map((r) => r.id))
  }

  /** Returns true if the tick loop is currently running. */
  isRunning(): boolean {
    return this.intervalId !== null
  }

  /**
   * Appends messages into the engine's authoritative state and returns an
   * immutable snapshot of the full updated state for immediate React render.
   * This avoids a race condition where a tick fires between the engine write
   * and a React functional-update, which would duplicate the messages.
   * @param messages - ChatMessage[] to append
   */
  injectChatMessages(messages: import("@/types").ChatMessage[]): BuildingState {
    this.state.chatMessages = [...this.state.chatMessages, ...messages]
    return structuredClone(this.state)
  }

  /**
   * Applies a PlayerAction to the game state immediately (outside the tick loop).
   * Called when the player sends a message and the LLM has classified it.
   *
   * @param action - classified player action from /api/groq analyze
   */
  applyPlayerAction(action: PlayerAction): void {
    if (this.state.isGameOver) return

    const { type, targetId, intensity } = action
    const intensityFactor = intensity / 100

    // Find the target resident if specified
    const target = targetId ? this.residents.find((r) => r.id === targetId) : null

    switch (type) {
      case "support_resident":
        if (target) {
          // Supporting a resident raises their trust and lowers anger
          target.trustInPlayer = clamp(target.trustInPlayer + 8 * intensityFactor)
          target.mood.anger = clamp(target.mood.anger - 10 * intensityFactor)
          this.state.voteSentiment = clamp(this.state.voteSentiment + 3 * intensityFactor)
        }
        break

      case "oppose_resident":
        if (target) {
          // Opposing a resident lowers their trust; others may side with them
          target.trustInPlayer = clamp(target.trustInPlayer - 10 * intensityFactor)
          target.mood.anger = clamp(target.mood.anger + 8 * intensityFactor)
          // Allied residents of the target lose trust too
          this.penalizeAllies(target.id, 4 * intensityFactor)
        }
        break

      case "de_escalate":
        // Calms everyone down slightly
        for (const r of this.residents.filter((r) => r.isActive)) {
          r.mood.anger = clamp(r.mood.anger - 5 * intensityFactor)
          r.mood.stress = clamp(r.mood.stress - 4 * intensityFactor)
        }
        this.state.chaosLevel = clamp(this.state.chaosLevel - 3 * intensityFactor)
        break

      case "promise":
        // Promise raises vote sentiment and trust but creates a future expectation
        this.state.voteSentiment = clamp(this.state.voteSentiment + 5 * intensityFactor)
        for (const r of this.residents.filter((r) => r.isActive)) {
          r.trustInPlayer = clamp(r.trustInPlayer + 3 * intensityFactor)
        }
        break

      case "shift_blame":
        // Shifting blame reduces chaos but lowers trust for shrewd residents
        this.state.chaosLevel = clamp(this.state.chaosLevel - 2 * intensityFactor)
        for (const r of this.residents.filter((r) => r.traits.stubbornness > 60 && r.isActive)) {
          r.trustInPlayer = clamp(r.trustInPlayer - 4 * intensityFactor)
        }
        break

      case "assert_authority":
        // Authority assertion: authorityRespect-high residents calm down; others may push back
        for (const r of this.residents.filter((r) => r.isActive)) {
          const respectFactor = r.traits.authorityRespect / 100
          r.mood.anger = clamp(r.mood.anger - 8 * intensityFactor * respectFactor)
          r.trustInPlayer = clamp(r.trustInPlayer + 4 * intensityFactor * respectFactor - 2 * intensityFactor * (1 - respectFactor))
        }
        break

      case "acknowledge_complaint":
        if (target) {
          // Acknowledging validates the resident without fully committing
          target.trustInPlayer = clamp(target.trustInPlayer + 5 * intensityFactor)
          target.mood.anger = clamp(target.mood.anger - 6 * intensityFactor)
        }
        break

      case "ignore":
      case "ambiguous":
        // No mechanical effect — player wasted their turn
        this.state.voteSentiment = clamp(this.state.voteSentiment - 1)
        break
    }

    this.notifyTick([])  // push state update to React immediately after player action
  }

  // ─── Private ─────────────────────────────────────────────────

  /**
   * One full simulation step. Orchestrates event generation → reactions → escalation → apply.
   * Called on every timer tick; also manually callable in tests.
   */
  tick(): void {
    if (this.state.isGameOver) {
      this.pause()
      return
    }

    const beforeState = structuredClone(this.state)

    // ── Advance clock ──────────────────────────────────────────
    this.state.tick += 1
    this.state.gameTimeElapsedSeconds += this.tickIntervalMs / 1000

    // ── Phase update ───────────────────────────────────────────
    this.state.phase = derivePhase(
      this.state.gameTimeElapsedSeconds,
      this.state.gameDurationSeconds,
      this.state.chaosLevel,
    )

    // ── Event generation ───────────────────────────────────────
    const events = generate(this.state, this.residents)
    for (const evt of events) {
      trace.traceEvent(evt, this.state.tick)
    }

    // ── Resident reactions ─────────────────────────────────────
    const reactions = react(this.residents, events, this.relationships)

    // ── Escalation / de-escalation ────────────────────────────
    const deltas = resolve(reactions, this.relationships, this.residents, this.state, events)

    // ── Apply all deltas atomically ────────────────────────────
    applyDeltas(this.state, this.residents, this.relationships, deltas, reactions, this.state.tick)

    // ── Win/lose check ────────────────────────────────────────
    this.checkEndConditions()

    // ── Dev tracing ───────────────────────────────────────────
    trace.traceStateDiff(beforeState, this.state, this.state.tick)
    for (const r of this.residents) {
      trace.traceResident(r, this.state.tick)
    }

    // ── Notify React ──────────────────────────────────────────
    this.notifyTick(events)
  }

  /**
   * Checks all lose/win conditions and fires onGameOver if reached.
   * Conditions are checked in priority order — chaos instant-lose first.
   */
  private checkEndConditions(): void {
    const { chaosLevel, voteSentiment, gameTimeElapsedSeconds, gameDurationSeconds } = this.state

    if (chaosLevel >= THRESHOLDS.CHAOS_LOSE_TRIGGER) {
      this.endGame("lose", "הכאוס הגיע לרמה קריטית — קבוצת הווטסאפ התפוצצה")
      return
    }

    if (voteSentiment <= THRESHOLDS.NO_CONFIDENCE_LOSE) {
      this.endGame("lose", "הדיירים הצביעו להדחתך מתפקיד ועד הבית")
      return
    }

    // Time-based win: survive the full game duration
    if (gameTimeElapsedSeconds >= gameDurationSeconds && !this.state.isGameOver) {
      this.endGame("win", "שרדת את הכאוס! אתה ועד הבית!")
    }
  }

  /**
   * Marks the game as over and fires the onGameOver callback.
   */
  private endGame(result: "win" | "lose", reason: string): void {
    this.state.isGameOver = true
    this.state.gameResult = result
    this.state.gameOverReason = reason
    this.state.phase = PHASE.ENDED
    this.pause()
    this.onGameOver?.(result, reason)
  }

  /**
   * Penalizes residents who are allied with the target resident.
   * Used when the player opposes someone — their allies feel it.
   */
  private penalizeAllies(targetId: string, trustLoss: number): void {
    const alliedIds = this.relationships
      .filter(
        (r) =>
          r.alliance === ALLIANCE.ALLIED &&
          (r.residentAId === targetId || r.residentBId === targetId),
      )
      .map((r) => (r.residentAId === targetId ? r.residentBId : r.residentAId))

    for (const id of alliedIds) {
      const ally = this.residents.find((r) => r.id === id)
      if (ally) ally.trustInPlayer = clamp(ally.trustInPlayer - trustLoss)
    }
  }

  /**
   * Sends immutable snapshots to the onTick callback.
   * Snapshots are cloned so React can safely compare them.
   */
  private notifyTick(events: SimulationEvent[]): void {
    this.onTick?.(
      structuredClone(this.state),
      structuredClone(this.residents),
      events,
    )
  }

  // ─── Test helpers — not used in production ────────────────────

  /** Directly read state — for unit tests only */
  _getState(): BuildingState { return this.state }
  _getResidents(): Resident[] { return this.residents }
  _getRelationships(): Relationship[] { return this.relationships }
}
