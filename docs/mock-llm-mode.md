# Mock LLM Mode

## Why This Exists

The Groq free tier has a 100k tokens/day limit. A single test session exhausts roughly 15–20k tokens. Once the daily limit hits, the game shows the "המשחק אינו זמין" error screen and becomes completely untestable.

Mock mode intercepts both LLM calls client-side and returns scripted Hebrew responses instantly — zero API calls, zero tokens consumed.

---

## What Mock Mode Tests (and What It Doesn't)

**Does test:**
- Resident message timing and flow (cooldown, inFlight gate, forceSpeak reply)
- Chat rendering — bubbles, scroll, timestamps, avatars
- Player action classification → trust/mood changes
- DEV panel trace entries (generate + analyze calls appear with correct fields)
- Game loop pacing — how fast chaos escalates, when events fire

**Does NOT test:**
- LLM response quality (persona fidelity, Hebrew tone, contextual awareness)
- Groq latency or rate-limit behavior
- Prompt correctness (changes to prompts in `api/groq.ts` are invisible to mock)
- JSON parse failures or Groq error paths

Use mock mode to develop and balance game mechanics. Use real LLM (with fresh daily quota) to validate conversation quality.

---

## Architecture — 3 Files

### 1. `src/dev/traceStore.ts`

Add `mockMode` state with getter + setter:

```ts
private mockMode = false

/** True only when BOTH ?dev=1 is present AND mock mode is toggled on */
isMockMode(): boolean { return this.devMode && this.mockMode }

/** Toggle mock mode; notifies all subscribers so DevPanel re-renders */
setMockMode(on: boolean): void { this.mockMode = on; this.notify() }
```

`isMockMode()` guards against mock mode accidentally activating in production — it requires dev mode to be active first.

---

### 2. `src/llm/groqClient.ts`

Intercept both exported functions before any network call:

```ts
// At the top of generateMessage():
if (trace.isMockMode()) return mockGenerate(req)

// At the top of analyzeMessage():
if (trace.isMockMode()) return mockAnalyze(req)
```

Both helpers are private functions at the bottom of the file. They call `trace.traceLLM()` so the DEV panel LLM tab shows entries exactly as it would for real calls.

#### `mockGenerate(req)` — Hebrew message per resident × event type

Uses a 2-level lookup `MOCK_MESSAGES[residentId][eventType]: string[]` with 2–3 messages per slot. Picks by `(Date.now() / 1000 | 0) % pool.length` so messages rotate over time without randomness that breaks reproducibility.

Falls back to a generic Hebrew pool for event types not explicitly mapped.

Traces with `latencyMs: 0`, `fallbackUsed: false`, `success: true`.

**Persona-appropriate messages per resident:**

| Resident | Archetype | Voice |
|---|---|---|
| `dov_5a` | Angry Old Man | Terse, complaining, biblical frustration |
| `rivka_3b` | Gossip | "שמעתם?", inclusive, adds own spin |
| `shmuel_1a` | Peacemaker | "בואו נדבר", calming, de-escalating |
| `noa_4c` | Young Couple | Modern Hebrew, short, occasional emoji |
| `miriam_2d` | Suspicious Elder | Questions motives, "לא סתם ש-" |
| `yossi_6b` | Hot-Headed | Emphatic "מספיק!!", demands action |

**Event types to cover** (minimum 2 messages per resident × event):

`noise_complaint`, `renovation_noise`, `water_leak`, `power_outage`, `elevator_broken`, `parking_dispute`, `cleanliness_complaint`, `public_accusation`, `support_signal`, `no_confidence_signal`, `rumor_spread`

Generic fallback pool for remaining event types.

#### `mockAnalyze(req)` — realistic PlayerAction classification

Simple keyword matching on `req.playerMessage` (Hebrew text):

| Hebrew keywords | PlayerAction type | intensity |
|---|---|---|
| `אני מבטיח` / `אטפל` / `אסדר` | `promise` | 70 |
| `נרגע` / `שקט` / `ביחד` / `כולנו` | `de_escalate` | 60 |
| `צודק` / `בסדר` / `מסכים` | `acknowledge_complaint` | 50 |
| `אני הוועד` / `סמכות` / `כוחי` | `assert_authority` | 75 |
| Default | rotate through 3 types by `message.length % 3` | 50 |

Always returns `confidence: 0.9`, `fallbackUsed: false` — so player actions have real game effect and trust/mood bars actually change.

---

### 3. `src/components/dev/DevPanel.tsx`

Add a toggle in the **LLM tab header** (above the log entries):

```tsx
const [mockOn, setMockOn] = useState(() => trace.isMockMode())

function toggleMock() {
  const next = !mockOn
  trace.setMockMode(next)
  setMockOn(next)
}

// Render:
<button onClick={toggleMock} className={mockOn ? "dev-mock-btn--on" : "dev-mock-btn--off"}>
  🤖 {mockOn ? "MOCK ON" : "MOCK OFF"}
</button>
```

Also add a **persistent indicator** visible from any tab when mock is active — so you can't accidentally forget it's on and interpret mock traces as real Groq data.

Style with a new `dev-mock-btn` class in `index.css` (green pill when on, dim when off).

---

## File Changes Summary

| File | Change |
|---|---|
| `src/dev/traceStore.ts` | Add `mockMode` field, `isMockMode()`, `setMockMode()` |
| `src/llm/groqClient.ts` | Add `mockGenerate()`, `mockAnalyze()`, intercept at top of both exported functions |
| `src/components/dev/DevPanel.tsx` | Toggle button in LLM tab + global "MOCK ACTIVE" indicator |

No changes to `api/groq.ts`, the simulation engine, or TypeScript types — mock is purely client-side.

---

## How to Use

1. Open `localhost:3000/?dev=1`
2. Start a game
3. Open DEV panel → LLM tab
4. Click `🤖 MOCK OFF` → turns green `🤖 MOCK ON`
5. Watch chat: resident messages appear instantly with real Hebrew text
6. DEV panel LLM tab: entries show `success: true`, no FALLBACK badge, latency 0ms
7. Type a player message → at least one resident replies immediately
8. Check Residents tab: trust/mood values change based on keyword-matched action type
9. Click `🤖 MOCK ON` → turns dim — game reverts to real Groq calls
