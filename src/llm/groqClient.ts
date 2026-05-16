import type {
  GenerateMessageRequest,
  AnalyzePlayerMessageRequest,
  GenerateMessageResponse,
  AnalyzePlayerMessageResponse,
  PlayerAction,
} from "@/types"

/**
 * Calls /api/groq to generate a single resident WhatsApp message.
 * Never throws — returns a fallback response if the network or server fails.
 *
 * @param req - generate request payload (resident persona + situation)
 * @returns message text and a flag indicating whether a fallback was used
 */
export async function generateMessage(
  req: GenerateMessageRequest,
): Promise<GenerateMessageResponse> {
  try {
    const res = await fetch("/api/groq", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    })
    if (!res.ok) return { message: clientFallbackMessage(req.residentId, req.eventType), fallbackUsed: true }
    return res.json() as Promise<GenerateMessageResponse>
  } catch {
    return { message: clientFallbackMessage(req.residentId, req.eventType), fallbackUsed: true }
  }
}

/**
 * Calls /api/groq to classify a player's typed message into a PlayerAction.
 * Never throws — returns an ambiguous fallback action if the call fails.
 *
 * @param req - analyze request payload (player message + game context)
 * @returns classified PlayerAction and a flag indicating whether a fallback was used
 */
export async function analyzeMessage(
  req: AnalyzePlayerMessageRequest,
): Promise<AnalyzePlayerMessageResponse> {
  try {
    const res = await fetch("/api/groq", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    })
    if (!res.ok) return { action: ambiguousFallback(req.playerMessage), fallbackUsed: true }
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
