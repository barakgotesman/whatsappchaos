import type { VercelRequest, VercelResponse } from "@vercel/node"
import type {
  GenerateMessageRequest,
  AnalyzePlayerMessageRequest,
  GenerateMessageResponse,
  AnalyzePlayerMessageResponse,
  PlayerAction,
} from "../src/types/index"

// ─── Constants ────────────────────────────────────────────────

/** Groq model — llama-3.3-70b-versatile replaces the decommissioned llama3-70b-8192 */
const GROQ_MODEL = "llama-3.3-70b-versatile"

/** Groq API endpoint */
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"

// ─── System prompts (static — cached by Groq) ─────────────────

const GENERATE_SYSTEM_PROMPT = `You are a WhatsApp message writer for a social simulation game set in an Israeli apartment building group chat.
You receive a resident's persona, their emotional state, and the recent chat history.
Write ONE WhatsApp message as that resident — in Hebrew, casual Israeli style.

STRICT RULES:
1. Output ONLY the message text. No quotes, no labels, no explanation.
2. LENGTH: 1–2 sentences maximum. Real WhatsApp messages are short. Never write a paragraph.
3. REPLY TO THE CHAT: Look at the recent messages. React to what others just said — agree, challenge, add gossip, or pointedly ignore someone. Do NOT just narrate the triggering event as if nobody else has spoken.
4. If ועד הבית (the building manager) wrote something recently, address it directly — thank, question, mock, or express cautious hope — based on your persona.
5. EMOJIS: Only use emojis if the persona description explicitly mentions using them. If the persona does not mention emojis, use ZERO emojis. Never add emojis to sound expressive.
6. VOICE: Match the exact vocabulary, sentence structure, and quirks described in the persona. Every character must sound different.
7. Do NOT repeat phrases from recent messages. Say something new each time.`

const ANALYZE_SYSTEM_PROMPT = `You are an action classifier for a social simulation game.
The player is the Va'ad Bayit (Building Committee leader) in an Israeli apartment building WhatsApp group.
You receive the player's typed message and context about the current game state.
Classify the player's intent into one of these action types:
- support_resident: player agrees with or defends a specific resident
- oppose_resident: player disagrees with or calls out a specific resident
- de_escalate: general calming or mediating message
- promise: player commits to fixing something specific
- shift_blame: redirects blame to another party
- assert_authority: reminds group of Va'ad Bayit role and responsibilities
- acknowledge_complaint: validates a complaint without committing to action
- ignore: message has no meaningful game action
- ambiguous: cannot confidently classify

Output ONLY valid JSON matching this exact schema. No explanation, no markdown, no extra text:
{
  "type": "<action type>",
  "targetId": "<resident id or null>",
  "intensity": <0-100>,
  "topic": "<issue type or null>",
  "promiseDetails": "<one sentence or null>",
  "confidence": <0.0-1.0>
}`

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
  const moodLabel = req.mood.anger > 70 ? "כועס מאוד" : req.mood.anger > 40 ? "מתוח" : "רגוע יחסית"
  const trustLabel = req.trustInPlayer > 65 ? "סומך על הועד" : req.trustInPlayer > 40 ? "ספקן" : "לא סומך על הועד"
  // Surface only the most recent message as the primary thing to react to
  const lastMessage = req.recentMessages.at(-1) ?? "(שקט בקבוצה)"
  const olderMessages = req.recentMessages.slice(0, -1)

  return `WHO YOU ARE:
${req.personaDescription}

YOUR EMOTIONAL STATE:
- ${moodLabel} (anger ${req.mood.anger}/100) | ${trustLabel} (trust ${req.trustInPlayer}/100)

WHAT TRIGGERED YOU TO WRITE:
- ${req.eventType} (severity ${req.severity}/100)

RECENT CHAT CONTEXT:
${olderMessages.join("\n") || "(אין הודעות קודמות)"}

THE LAST MESSAGE YOU ARE REACTING TO:
>>> ${lastMessage}

Write your WhatsApp message now. React specifically to that last message — agree, challenge, add something, or address the sender by name. Pick ONE topic. Do not list everything.`
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
  const residentList = req.residents
    .map((r) => `${r.id} (${r.name}, sentiment: ${r.sentiment})`)
    .join(", ")

  return `PLAYER MESSAGE: "${req.playerMessage}"

GAME CONTEXT:
- Active issues: ${req.activeIssues.join(", ") || "none"}
- Current chaos level: ${req.chaosLevel}/100
- Residents in group: ${residentList}
- Recent chat (last 5 messages):
${req.recentMessages.join("\n") || "(no messages yet)"}

Classify the player's action:`
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
  try {
    const body: Record<string, unknown> = {
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.8,   // slightly creative for authentic resident voices
      max_tokens: 300,    // resident messages and action objects are short
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
