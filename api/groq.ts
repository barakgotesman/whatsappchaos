import type { VercelRequest, VercelResponse } from "@vercel/node"
import type {
  GenerateMessageRequest,
  AnalyzePlayerMessageRequest,
  GenerateMessageResponse,
  AnalyzePlayerMessageResponse,
  PlayerAction,
} from "../src/types/index"

// ─── Constants ────────────────────────────────────────────────

/** Groq model — llama-3.3-70b-versatile was withdrawn from our account; gpt-oss-120b has the
 *  best Hebrew of the models still available (qwen3.8-27b broke length rules, gpt-oss-20b truncated). */
const GROQ_MODEL = "openai/gpt-oss-120b"

/** Groq API endpoint */
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"

/** Chat lines of context sent per generate call — each Hebrew line costs ~30-60 tokens */
const CONTEXT_MESSAGES = 3

/** Max characters per chat line sent to the LLM (Hebrew tokenizes ~1 token per 1-2 chars) */
const MAX_LINE_CHARS = 140

/** Output caps. Groq counts max_tokens against the per-minute budget up front, so keep tight.
 *  gpt-oss is a reasoning model: reasoning tokens (~60-100 at "low" effort) come out of this
 *  budget, and anything below ~150 can return an EMPTY message. Measured outputs: ~100-140. */
const GENERATE_MAX_TOKENS = 200
const ANALYZE_MAX_TOKENS = 200

/** Minimal reasoning: this is style transfer / classification, not a problem to think through */
const REASONING_EFFORT = "low"

// ─── System prompts (static) ─────────────────

const GENERATE_SYSTEM_PROMPT = `Write ONE Hebrew WhatsApp message from an Israeli building-group resident, in the voice of the given persona.
Rules: output only the message text; 1-2 short sentences; react to the last message (agree, challenge, gossip, or address the sender by name); if ועד הבית spoke, address it; emojis only if the persona says so; don't repeat phrases from the chat.`

const ANALYZE_SYSTEM_PROMPT = `Classify a Va'ad Bayit (building committee leader) chat message into one action type:
support_resident, oppose_resident, de_escalate, promise, shift_blame, assert_authority, acknowledge_complaint, ignore, ambiguous.
Output ONLY JSON: {"type":"<type>","targetId":"<resident id or null>","intensity":<0-100>,"topic":"<issue or null>","promiseDetails":"<one sentence or null>","confidence":<0.0-1.0>}`

// ─── Main handler ─────────────────────────────────────────────

/**
 * Vercel serverless function — proxies requests to Groq API.
 * The Groq API key never leaves this server function; the browser only calls /api/groq.
 *
 * Accepts POST with body: GenerateMessageRequest | AnalyzePlayerMessageRequest
 * Returns: GenerateMessageResponse | AnalyzePlayerMessageResponse
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: "GROQ_API_KEY not configured" })
  }

  const body = req.body as GenerateMessageRequest | AnalyzePlayerMessageRequest

  try {
    if (body.callType === "generate") {
      const result = await handleGenerate(body, apiKey)
      // Propagate critical Groq errors (rate limit, auth) so the client circuit breaker trips
      if (result.groqStatus) return res.status(result.groqStatus).json({ error: "Groq error" })
      return res.status(200).json(result)
    } else if (body.callType === "analyze") {
      const result = await handleAnalyze(body, apiKey)
      if (result.groqStatus) return res.status(result.groqStatus).json({ error: "Groq error" })
      return res.status(200).json(result)
    } else {
      return res.status(400).json({ error: "Unknown callType" })
    }
  } catch (err) {
    console.error("[groq api] Unhandled error:", err)
    return res.status(500).json({ error: "Internal server error" })
  }
}

// ─── Generate handler ─────────────────────────────────────────

/**
 * Builds the user prompt for a resident message generation call,
 * sends it to Groq, and returns the message text.
 * Falls back to a template string if Groq fails.
 *
 * @param req - generate request payload
 * @param apiKey - Groq API key from env
 */
async function handleGenerate(
  req: GenerateMessageRequest,
  apiKey: string
): Promise<GenerateMessageResponse & { groqStatus?: number }> {
  const userPrompt = buildGeneratePrompt(req)

  const groqResponse = await callGroq(GENERATE_SYSTEM_PROMPT, userPrompt, apiKey, false)

  if (!groqResponse.ok) {
    // Surface critical Groq errors (429 rate limit, 401 bad key) to the client
    // so the circuit breaker can trip and the game shows a proper error screen.
    if (groqResponse.status && groqResponse.status >= 400) {
      return { message: "", fallbackUsed: true, groqStatus: groqResponse.status }
    }
    return { message: generateFallbackMessage(req.residentId, req.eventType), fallbackUsed: true }
  }

  const message = groqResponse.text.trim()
  return { message, fallbackUsed: false }
}

/**
 * Builds the dynamic user prompt for a generate-message call.
 * The persona description is sent verbatim so the LLM internalizes the character voice.
 */
function buildGeneratePrompt(req: GenerateMessageRequest): string {
  const moodLabel = req.mood.anger > 70 ? "כועס מאוד" : req.mood.anger > 40 ? "מתוח" : "רגוע"
  const trustLabel = req.trustInPlayer > 65 ? "סומך על הועד" : req.trustInPlayer > 40 ? "ספקן" : "לא סומך על הועד"
  // Cap each line: Hebrew is token-expensive and long messages add little signal
  const clip = (m: string) => (m.length > MAX_LINE_CHARS ? m.slice(0, MAX_LINE_CHARS) + "…" : m)
  const lines = req.recentMessages.slice(-CONTEXT_MESSAGES).map(clip)
  const lastMessage = lines.at(-1) ?? "(שקט בקבוצה)"
  const older = lines.slice(0, -1)

  return `${req.personaDescription}
מצב: ${moodLabel}, ${trustLabel}. נושא: ${req.eventType}.
${older.map((l) => l + "\n").join("")}>>> ${lastMessage}`
}

/**
 * Returns a generic Hebrew message per event type when Groq is unavailable.
 * These read like real WhatsApp messages so the game stays immersive even in degraded mode.
 */
function generateFallbackMessage(_residentId: string, eventType: string): string {
  const fallbacks: Record<string, string> = {
    noise_complaint:       "מה הרעש הזה?? אי אפשר לנוח בשקט",
    renovation_noise:      "שוב עובדים?! עד מתי זה יימשך",
    water_leak:            "יש דליפה? מישהו כבר טיפל בזה?",
    power_outage:          "חשמל יש? אצלי חשוך לגמרי",
    elevator_broken:       "המעלית שוב לא עובדת... כמה פעמים כבר",
    parking_dispute:       "מי חנה שוב במקום שלי?!",
    pet_complaint:         "הכלב הזה שוב מפריע לכולם",
    cleanliness_complaint: "הלובי שוב מלוכלך, מי אחראי פה",
    public_accusation:     "מחפשים אשמים כרגיל במקום לפתור",
    support_signal:        "נכון, גם אני חושב בדיוק ככה",
    no_confidence_signal:  "לא בטוח שאנחנו בידיים טובות כרגע",
    rumor_spread:          "שמעתם מה אומרים? יש פה סיפור",
  }
  return fallbacks[eventType] ?? "יש מה לדון פה בקבוצה"
}

// ─── Analyze handler ──────────────────────────────────────────

/**
 * Sends the player's message to Groq for classification into a PlayerAction.
 * Falls back to { type: "ambiguous" } if Groq fails or returns invalid JSON.
 *
 * @param req - analyze request payload
 * @param apiKey - Groq API key from env
 */
async function handleAnalyze(
  req: AnalyzePlayerMessageRequest,
  apiKey: string
): Promise<AnalyzePlayerMessageResponse & { groqStatus?: number }> {
  const userPrompt = buildAnalyzePrompt(req)

  const groqResponse = await callGroq(ANALYZE_SYSTEM_PROMPT, userPrompt, apiKey, true)

  if (!groqResponse.ok) {
    if (groqResponse.status && groqResponse.status >= 400) {
      return { action: buildAmbiguousFallback(req.playerMessage), fallbackUsed: true, groqStatus: groqResponse.status }
    }
    return { action: buildAmbiguousFallback(req.playerMessage), fallbackUsed: true }
  }

  try {
    const parsed = JSON.parse(groqResponse.text) as Omit<PlayerAction, "rawMessage">
    return {
      action: { ...parsed, rawMessage: req.playerMessage },
      fallbackUsed: false,
    }
  } catch {
    // JSON parse failed — fall back gracefully
    return {
      action: buildAmbiguousFallback(req.playerMessage),
      fallbackUsed: true,
    }
  }
}

/**
 * Builds the dynamic user prompt for a player-message analysis call.
 */
function buildAnalyzePrompt(req: AnalyzePlayerMessageRequest): string {
  // Only ids + names: sentiment doesn't affect classification, and ids are needed for targetId
  const residentList = req.residents.map((r) => `${r.id}=${r.name}`).join(", ")
  const recent = req.recentMessages.slice(-2).map((m) => (m.length > MAX_LINE_CHARS ? m.slice(0, MAX_LINE_CHARS) + "…" : m))

  return `Message: "${req.playerMessage}"
Issues: ${req.activeIssues.join(", ") || "none"}
Residents: ${residentList}
Recent:
${recent.join("\n") || "(none)"}`
}

/**
 * Fallback PlayerAction used when LLM analysis fails.
 * Ambiguous actions have no effect on game state.
 */
function buildAmbiguousFallback(rawMessage: string): PlayerAction {
  return {
    type: "ambiguous",
    intensity: 50,
    confidence: 0,
    rawMessage,
  }
}

// ─── Groq API call ────────────────────────────────────────────

interface GroqResult {
  ok: boolean     // false if request failed or non-2xx status
  text: string    // response content, empty string on failure
  status?: number // HTTP status from Groq when not ok (e.g. 429, 401)
}

/**
 * Makes a single chat completion request to the Groq API.
 * Returns { ok: false, text: "" } on any error — callers handle fallback.
 *
 * @param systemPrompt - the static system instruction
 * @param userPrompt - the dynamic per-call user message
 * @param apiKey - Groq API key
 * @param jsonMode - if true, sets response_format to json_object for structured output
 */
async function callGroq(
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  jsonMode: boolean
): Promise<GroqResult> {
  const maxTokens = jsonMode ? ANALYZE_MAX_TOKENS : GENERATE_MAX_TOKENS
  try {
    const body: Record<string, unknown> = {
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.8,   // slightly creative for authentic resident voices
      max_tokens: maxTokens,
      reasoning_effort: REASONING_EFFORT,
    }

    if (jsonMode) {
      body.response_format = { type: "json_object" }
    }

    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      console.error("[groq api] Non-2xx response:", response.status)
      // Preserve the status so the client's circuit breaker can see rate-limit (429) errors
      return { ok: false, text: "", status: response.status }
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>
    }
    const text = data.choices?.[0]?.message?.content ?? ""
    return { ok: true, text }
  } catch (err) {
    console.error("[groq api] Fetch error:", err)
    return { ok: false, text: "" }
  }
}
