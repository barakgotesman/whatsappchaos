import type { VercelRequest, VercelResponse } from "@vercel/node"
import type {
  GenerateMessageRequest,
  AnalyzePlayerMessageRequest,
  GenerateMessageResponse,
  AnalyzePlayerMessageResponse,
  PlayerAction,
} from "../src/types"

// ─── Constants ────────────────────────────────────────────────

/** Groq model — llama3-70b for quality, can switch to mixtral for speed */
const GROQ_MODEL = "llama3-70b-8192"

/** Groq API endpoint */
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"

// ─── System prompts (static — cached by Groq) ─────────────────

const GENERATE_SYSTEM_PROMPT = `You are a message generator for a social simulation game set in an Israeli apartment building WhatsApp group.
You receive structured data about a resident's personality, current emotional state, and the situation they are reacting to.
Your job is to write a single WhatsApp message as that resident — in Hebrew (using Israeli casual WhatsApp style), or a mix of Hebrew and English if it fits the character.
Rules:
- Output ONLY the message text. No quotes, no explanation, no prefix.
- Stay true to the persona description exactly — voice, speech patterns, quirks.
- The message should feel like a real WhatsApp message: short, emotional, sometimes typos, sometimes emoji.
- Do not resolve the situation or make game decisions. Just react authentically to what happened.`

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
      return res.status(200).json(result)
    } else if (body.callType === "analyze") {
      const result = await handleAnalyze(body, apiKey)
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
): Promise<GenerateMessageResponse> {
  const userPrompt = buildGeneratePrompt(req)

  const groqResponse = await callGroq(GENERATE_SYSTEM_PROMPT, userPrompt, apiKey, false)

  if (!groqResponse.ok) {
    return {
      message: generateFallbackMessage(req.residentId, req.eventType),
      fallbackUsed: true,
    }
  }

  const message = groqResponse.text.trim()
  return { message, fallbackUsed: false }
}

/**
 * Builds the dynamic user prompt for a generate-message call.
 * The persona description is sent verbatim so the LLM internalizes the character voice.
 */
function buildGeneratePrompt(req: GenerateMessageRequest): string {
  return `RESIDENT PERSONA:
${req.personaDescription}

CURRENT STATE:
- Mood: anger=${req.mood.anger}/100, stress=${req.mood.stress}/100, happiness=${req.mood.happiness}/100
- Trust in Va'ad Bayit (player): ${req.trustInPlayer}/100
- Sentiment toward player: ${req.currentSentiment}

SITUATION:
- Event type: ${req.eventType}
- Triggered by: ${req.sourceResidentName}
- Severity: ${req.severity}/100
- Active building issues: ${req.activeIssues.join(", ") || "none"}

RECENT CHAT (last 5 messages):
${req.recentMessages.join("\n") || "(no messages yet)"}

Write the resident's WhatsApp message now:`
}

/**
 * Returns a simple Hebrew fallback message when Groq is unavailable.
 * Keeps the game running even without LLM access.
 */
function generateFallbackMessage(residentId: string, eventType: string): string {
  return `[${residentId}]: הגיב על ${eventType}`
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
): Promise<AnalyzePlayerMessageResponse> {
  const userPrompt = buildAnalyzePrompt(req)

  const groqResponse = await callGroq(ANALYZE_SYSTEM_PROMPT, userPrompt, apiKey, true)

  if (!groqResponse.ok) {
    return {
      action: buildAmbiguousFallback(req.playerMessage),
      fallbackUsed: true,
    }
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
  ok: boolean  // false if request failed or non-2xx status
  text: string // response content, empty string on failure
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
      return { ok: false, text: "" }
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
