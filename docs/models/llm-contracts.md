# LLM Contracts

Two distinct LLM call types. Both are sent to the Groq API via the Vercel serverless function at `/api/groq`. The LLM model is `llama3-70b-8192` (or `mixtral-8x7b-32768` as fallback).

All responses must be valid JSON. The serverless function retries once on parse failure, then falls back to a template string.

---

## Call 1: Generate Resident Message

**When**: Simulation tick selects a resident to post a message in response to an event.

**Goal**: Turn structured state into an authentic WhatsApp message in that resident's voice.

### System Prompt (static, cached)

```
You are a message generator for a social simulation game set in an Israeli apartment building WhatsApp group.
You receive structured data about a resident's personality, current emotional state, and the situation they are reacting to.
Your job is to write a single WhatsApp message as that resident — in Hebrew (using Israeli casual WhatsApp style), or a mix of Hebrew and English if it fits the character.
Rules:
- Output ONLY the message text. No quotes, no explanation.
- Stay true to the persona description exactly.
- The message should feel like a real WhatsApp message: short, emotional, sometimes typos.
- Do not resolve the situation or make game decisions. Just react authentically.
```

### User Prompt (dynamic per call)

```
RESIDENT PERSONA:
{personaDescription}

CURRENT STATE:
- Mood: anger={anger}, stress={stress}, happiness={happiness}
- Trust in Va'ad Bayit (player): {trustInPlayer}/100
- Sentiment toward player: {currentSentiment}

SITUATION:
- Event type: {eventType}
- Triggered by: {sourceResidentName} (apartment {apartment})
- Severity: {severity}/100
- Active building issues: {activeIssues}

RECENT CHAT (last 5 messages):
{recentMessages}

Write the resident's WhatsApp message now:
```

### Expected Response

Plain text string — the message to display in the chat. No JSON wrapper.

---

## Call 2: Analyze Player Message

**When**: Player submits a message in the chat input.

**Goal**: Classify the player's intent into a structured `PlayerAction` object.

### System Prompt (static, cached)

```
You are an action classifier for a social simulation game.
The player is the Va'ad Bayit (Building Committee leader) in an Israeli apartment building WhatsApp group.
You receive the player's typed message and some context about the current game state.
Your job is to classify the player's message into a structured action object.
Output ONLY valid JSON matching the schema below. No explanation, no markdown.

Schema:
{
  "type": "support_resident" | "oppose_resident" | "de_escalate" | "promise" | "shift_blame" | "assert_authority" | "acknowledge_complaint" | "ignore" | "ambiguous",
  "targetId": "<resident id> or null",
  "intensity": <0-100>,
  "topic": "<issue type> or null",
  "promiseDetails": "<one sentence> or null",
  "confidence": <0.0-1.0>
}
```

### User Prompt (dynamic per call)

```
PLAYER MESSAGE: "{playerMessage}"

GAME CONTEXT:
- Active issues: {activeIssues}
- Current chaos level: {chaosLevel}/100
- Residents in group: {residentList}  // [{id, name, sentiment}]
- Recent chat (last 5 messages): {recentMessages}

Classify the player's action:
```

### Expected Response

```json
{
  "type": "de_escalate",
  "targetId": null,
  "intensity": 55,
  "topic": "noise_complaint",
  "promiseDetails": null,
  "confidence": 0.88
}
```

---

## Tracing

Every call to `/api/groq` is recorded by `traceStore.traceLLM()` with:
- `callType`: `"generate"` or `"analyze"`
- `prompt`: full string sent
- `rawResponse`: raw string from Groq
- `parsed`: the JS object after JSON.parse (or null on failure)
- `latencyMs`: round-trip time
- `fallbackUsed`: true if JSON parse failed or request errored

Visible in dev panel → LLM Log tab when `?dev=1`.

---

## Fallback Behavior

If LLM call fails or returns invalid JSON:

| Call Type | Fallback |
|---|---|
| Generate message | Use template: `"[שם] הגיב/ה על {eventType}"` |
| Analyze player | Return `{ type: "ambiguous", intensity: 50, confidence: 0 }` |

Fallbacks must never crash the simulation.
