import type {
  GenerateMessageRequest,
  AnalyzePlayerMessageRequest,
  GenerateMessageResponse,
  AnalyzePlayerMessageResponse,
  PlayerAction,
} from "@/types"

// ─── Circuit breaker ──────────────────────────────────────────────────────────

/**
 * HTTP status codes that indicate a permanent or severe failure.
 * 401/403 = bad API key (won't recover), 429 = quota exhausted, 5xx = server broken.
 */
const CRITICAL_STATUSES = new Set([401, 403, 429, 500, 502, 503])

/** After this many consecutive critical failures the circuit opens and all LLM calls stop. */
const FAILURE_THRESHOLD = 3

let consecutiveFailures = 0
let circuitOpen = false

/** Returns true once the circuit has opened — callers must check before sending requests. */
export function isLlmCircuitOpen(): boolean {
  return circuitOpen
}

/**
 * Records a critical HTTP failure.
 * Opens the circuit permanently once FAILURE_THRESHOLD is reached.
 */
function recordFailure(): void {
  consecutiveFailures++
  if (consecutiveFailures >= FAILURE_THRESHOLD) circuitOpen = true
}

/** Resets the failure counter on any successful response. */
function recordSuccess(): void {
  consecutiveFailures = 0
}

// ─── API calls ────────────────────────────────────────────────────────────────

/**
 * Calls /api/groq to generate a single resident WhatsApp message.
 * Returns null if the circuit is open (caller should skip, not fallback).
 * Returns a fallback response on transient network errors.
 *
 * @param req - generate request payload (resident persona + situation)
 * @returns message text + fallback flag, or null when the circuit is open
 */
export async function generateMessage(
  req: GenerateMessageRequest,
): Promise<GenerateMessageResponse | null> {
  if (circuitOpen) return null

  try {
    const res = await fetch("/api/groq", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    })

    if (CRITICAL_STATUSES.has(res.status)) {
      recordFailure()
      return null
    }

    if (!res.ok) {
      // Non-critical HTTP error (e.g. 400 bad request) — use fallback, don't trip circuit
      return { message: clientFallbackMessage(req.residentId, req.eventType), fallbackUsed: true }
    }

    recordSuccess()
    return res.json() as Promise<GenerateMessageResponse>
  } catch {
    // Network error (offline, DNS failure) — soft fallback, don't trip circuit
    return { message: clientFallbackMessage(req.residentId, req.eventType), fallbackUsed: true }
  }
}

/**
 * Calls /api/groq to classify a player's typed message into a PlayerAction.
 * Returns null if the circuit is open (caller should show fatal error, not fallback).
 * Returns a fallback action on transient network errors.
 *
 * @param req - analyze request payload (player message + game context)
 * @returns classified PlayerAction + fallback flag, or null when the circuit is open
 */
export async function analyzeMessage(
  req: AnalyzePlayerMessageRequest,
): Promise<AnalyzePlayerMessageResponse | null> {
  if (circuitOpen) return null

  try {
    const res = await fetch("/api/groq", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    })

    if (CRITICAL_STATUSES.has(res.status)) {
      recordFailure()
      return null
    }

    if (!res.ok) {
      return { action: ambiguousFallback(req.playerMessage), fallbackUsed: true }
    }

    recordSuccess()
    return res.json() as Promise<AnalyzePlayerMessageResponse>
  } catch {
    return { action: ambiguousFallback(req.playerMessage), fallbackUsed: true }
  }
}

/** Client-side fallback message when the server is unreachable */
function clientFallbackMessage(residentId: string, eventType: string): string {
  return `[${residentId}]: הגיב על ${eventType}`
}

/** Fallback action used when LLM analysis is unavailable */
function ambiguousFallback(rawMessage: string): PlayerAction {
  return { type: "ambiguous", intensity: 50, confidence: 0, rawMessage }
}
