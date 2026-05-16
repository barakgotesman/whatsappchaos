import type { SimulationEvent, Resident, BuildingState, PlayerAction } from "@/types"

// ─── Trace Entry Types ────────────────────────────────────────

/** A single LLM call record — stored for the LLM Log tab */
export interface LLMTraceEntry {
  id: string
  callType: "generate" | "analyze"  // which of the two LLM contracts was used
  prompt: string                     // full prompt string sent to Groq
  rawResponse: string                // raw text Groq returned
  parsed: string | PlayerAction | null  // parsed result (message string or action object)
  latencyMs: number                  // round-trip time in milliseconds
  success: boolean                   // false if Groq call threw an error
  fallbackUsed: boolean              // true if we fell back to a template/ambiguous result
  tick: number
  timestamp: number                  // Date.now()
}

/** A per-tick state snapshot diff — stored for the State Diffs tab */
export interface StateDiffEntry {
  id: string
  tick: number
  timestamp: number
  // Only the fields that actually changed are stored here
  changedKeys: string[]
  before: Partial<BuildingState>
  after: Partial<BuildingState>
}

/** A resident state snapshot at a point in time — stored for the Residents tab */
export interface ResidentTraceEntry {
  id: string
  tick: number
  timestamp: number
  resident: Resident  // full snapshot of resident state at this tick
}

/** A simulation event record — stored for the Event Log tab */
export interface EventTraceEntry {
  id: string
  tick: number
  timestamp: number
  event: SimulationEvent
}

// ─── Store ────────────────────────────────────────────────────

/** Max entries kept per category — prevents memory bloat during long sessions */
const MAX_ENTRIES = 500

/**
 * Central dev trace singleton.
 * All simulation and LLM code calls trace.traceX() without knowing if dev mode is on.
 * When ?dev=1 is absent, all methods are no-ops — zero overhead in production.
 *
 * Read isDevMode() once; it never changes during a session.
 */
class TraceStore {
  /** True only when URL has ?dev=1. Computed once at startup. */
  private readonly devMode: boolean

  private events: EventTraceEntry[] = []
  private residents: ResidentTraceEntry[] = []
  private llmCalls: LLMTraceEntry[] = []
  private diffs: StateDiffEntry[] = []

  /** Subscribers — React components call subscribe() to re-render on new data */
  private listeners: Array<() => void> = []

  constructor() {
    this.devMode =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("dev") === "1"

    if (this.devMode) {
      console.info("[DevTrace] Dev mode active — tracing all game events")
    }
  }

  /** Returns true if ?dev=1 is present in the URL. Use this to conditionally render dev UI. */
  isDevMode(): boolean {
    return this.devMode
  }

  // ─── Trace methods — all are no-ops when devMode is false ───

  /**
   * Records a simulation event for the Event Log tab.
   * @param event - the SimulationEvent that just fired
   * @param tick - current simulation tick
   */
  traceEvent(event: SimulationEvent, tick: number): void {
    if (!this.devMode) return
    this.events = this.push(this.events, {
      id: crypto.randomUUID(),
      tick,
      timestamp: Date.now(),
      event,
    })
    this.notify()
  }

  /**
   * Records a resident state snapshot after an update.
   * @param resident - the full resident object after mutation
   * @param tick - current simulation tick
   */
  traceResident(resident: Resident, tick: number): void {
    if (!this.devMode) return
    this.residents = this.push(this.residents, {
      id: crypto.randomUUID(),
      tick,
      timestamp: Date.now(),
      resident: structuredClone(resident), // snapshot — don't hold a live reference
    })
    this.notify()
  }

  /**
   * Records a completed LLM call.
   * @param entry - full call details including prompt, response, latency, fallback status
   */
  traceLLM(entry: Omit<LLMTraceEntry, "id" | "timestamp">): void {
    if (!this.devMode) return
    this.llmCalls = this.push(this.llmCalls, {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    })
    this.notify()
  }

  /**
   * Records what changed in building state during one tick.
   * Only stores the keys that actually changed — not the full state each tick.
   * @param before - building state snapshot before the tick
   * @param after - building state snapshot after the tick
   * @param tick - the tick number
   */
  traceStateDiff(
    before: BuildingState,
    after: BuildingState,
    tick: number
  ): void {
    if (!this.devMode) return

    // Detect which top-level scalar keys changed
    const changedKeys = (Object.keys(before) as Array<keyof BuildingState>).filter(
      (k) => k !== "chatMessages" && k !== "activeIssues" && before[k] !== after[k]
    )

    if (changedKeys.length === 0) return // nothing changed — skip

    const beforeSlice: Partial<BuildingState> = {}
    const afterSlice: Partial<BuildingState> = {}
    changedKeys.forEach((k) => {
      // @ts-expect-error dynamic key assignment
      beforeSlice[k] = before[k]
      // @ts-expect-error dynamic key assignment
      afterSlice[k] = after[k]
    })

    this.diffs = this.push(this.diffs, {
      id: crypto.randomUUID(),
      tick,
      timestamp: Date.now(),
      changedKeys,
      before: beforeSlice,
      after: afterSlice,
    })
    this.notify()
  }

  // ─── Getters for React components ───────────────────────────

  getEvents(): EventTraceEntry[] { return this.events }
  getResidents(): ResidentTraceEntry[] { return this.residents }
  getLLMCalls(): LLMTraceEntry[] { return this.llmCalls }
  getDiffs(): StateDiffEntry[] { return this.diffs }

  /**
   * Registers a callback to run whenever new trace data arrives.
   * Returns an unsubscribe function — call it in useEffect cleanup.
   */
  subscribe(cb: () => void): () => void {
    this.listeners.push(cb)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb)
    }
  }

  // ─── Private helpers ─────────────────────────────────────────

  /** Appends an entry and trims to MAX_ENTRIES (oldest removed first) */
  private push<T>(arr: T[], entry: T): T[] {
    const next = [...arr, entry]
    return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next
  }

  private notify(): void {
    this.listeners.forEach((cb) => cb())
  }
}

/** Singleton instance — import this everywhere instead of creating new instances */
export const trace = new TraceStore()
