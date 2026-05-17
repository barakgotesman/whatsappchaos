import type {
  GenerateMessageRequest,
  AnalyzePlayerMessageRequest,
  GenerateMessageResponse,
  AnalyzePlayerMessageResponse,
  PlayerAction,
} from "@/types"
import { trace } from "@/dev/traceStore"

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
  if (trace.isMockMode()) return mockGenerate(req)
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
  if (trace.isMockMode()) return mockAnalyze(req)
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

/** Client-side fallback message when the server is unreachable (network failure) */
function clientFallbackMessage(_residentId: string, eventType: string): string {
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

/** Fallback action used when LLM analysis is unavailable */
function ambiguousFallback(rawMessage: string): PlayerAction {
  return { type: "ambiguous", intensity: 50, confidence: 0, rawMessage }
}

// ─── Mock LLM helpers ─────────────────────────────────────────────────────────

/**
 * Per-resident × per-event scripted Hebrew messages.
 * Each slot holds 2–3 strings; we rotate by time so messages vary without randomness.
 */
const MOCK_MESSAGES: Record<string, Record<string, string[]>> = {
  dov_5a: {
    noise_complaint:       ["שקט! אי אפשר לנוח פה!", "מה הרעש הזה?! זה לא מוסד"],
    renovation_noise:      ["שוב עובדים?! כבר שבוע זה נמשך", "עד מתי אנחנו צריכים לסבול את זה"],
    water_leak:            ["יש דליפה? ידעתי שזה יקרה", "מי אחראי על התחזוקה פה?!"],
    power_outage:          ["חשמל שוב אין. ממש בושה", "כל שבוע אותו סיפור"],
    elevator_broken:       ["המעלית שוב קלקלה. יש לי ברכיים!", "אני לא יכול לעלות שמונה קומות ברגל"],
    parking_dispute:       ["מי חנה במקום שלי?! אני רואה מי זה", "זה המקום שלי, שלשים שנה"],
    cleanliness_complaint: ["הלובי שוב מגעיל. מי אחראי?", "זה לא כבוד לבניין שלנו"],
    public_accusation:     ["אמרתי מלכתחילה שזה לא יעבוד", "מישהו צריך לקחת אחריות פה"],
    support_signal:        ["נכון. לפחות מישהו מבין", "סוף סוף מישהו אומר את האמת"],
    no_confidence_signal:  ["לא בטוח שאנחנו בידיים טובות", "זה ועד בית או מה?"],
    rumor_spread:          ["שמעתי גם. יש פה משהו", "לא סתם מה שאומרים"],
  },
  rivka_3b: {
    noise_complaint:       ["שמעתם?? שוב הרעש הנורא הזה!", "כולנו סובלים, לא רק אני"],
    renovation_noise:      ["אמרתי לשכנה שלי ממש עכשיו — זה בלתי נסבל", "מי נתן להם רשות לעשות שיפוצים שעה כזו?"],
    water_leak:            ["שמעתם על הדליפה?? כבר סיפרתי לכולם", "יש לי מידע — זה מהדירה למעלה"],
    power_outage:          ["אצלי גם אין חשמל, ואצל השכנה גם!", "כבר התקשרתי לחברת החשמל"],
    elevator_broken:       ["שמעתם?? המעלית שוב לא עובדת!", "ספרתי לאנשים בקומה שלי — כולם כועסים"],
    parking_dispute:       ["שמעתם מה קרה בחניה? אני יודעת מי זה", "יש פה סיפור שלם, תאמינו לי"],
    cleanliness_complaint: ["ראיתי אתמול, וגם שלשום — ממש לא בסדר", "מישהי אמרה לי שזה אותה משפחה כל פעם"],
    public_accusation:     ["שמעתם מה אומרים? יש פה בעיה אמיתית", "כבר סיפרתי לכמה שכנות — כולן מסכימות"],
    support_signal:        ["גם אני חושבת בדיוק ככה! ממש!!", "אמרתי לבעלי אותו דבר הלילה"],
    no_confidence_signal:  ["שמעתי שגם אחרים חושבים ככה...", "לא אני אמרתי, אבל כן, יש שמועות"],
    rumor_spread:          ["שמעתם?? יש שמועה!! תעדכנו אותי אם אתם יודעים יותר", "מישהי אמרה לי משהו שאתם חייבים לשמוע"],
  },
  shmuel_1a: {
    noise_complaint:       ["בואו נדבר על זה בשקט, אני בטוח שנמצא פתרון", "אני מציע שנסדר את זה בצורה נעימה לכולם"],
    renovation_noise:      ["אולי אפשר לבקש שיעשו את זה בשעות סבירות?", "בטח אפשר להסדיר את זה יחד בצורה טובה"],
    water_leak:            ["בואו נדווח לועד ויטפלו בזה — זה הדרך הנכונה", "ביחד נמצא פתרון, לא צריך להתעצבן"],
    power_outage:          ["קורה לפעמים, בואו נתאזר בסבלנות", "ודאי שיתקנו בקרוב — יש לנו ועד טוב"],
    elevator_broken:       ["מצב לא נוח, אני מסכים. אבל ביחד נפתור", "בואו נשלח הודעה מסודרת למנהל הבניין"],
    parking_dispute:       ["בואו נדבר ישירות עם מי שמעורב, בלי לריב", "אני מציע לפתור את זה בשיחה שקטה"],
    cleanliness_complaint: ["אפשר לארגן תורנות ניקיון, מה אתם חושבים?", "בואו נציע פתרון במקום להתלונן"],
    public_accusation:     ["אני מציע שנירגע ונדבר — האשמות לא עוזרות", "ביחד אנחנו חזקים יותר מאשר בריב"],
    support_signal:        ["שמח לשמוע שיש הסכמה, בואו נמשיך ככה", "כשכולנו ביחד, הכל מסתדר"],
    no_confidence_signal:  ["אני מבין את החשש, אבל בואו נתן הזדמנות", "בואו נשמע את כולם לפני שמחליטים"],
    rumor_spread:          ["בואו נוודא עובדות לפני שמפיצים שמועות", "אני בטוח שיש הסבר הגיוני"],
  },
  noa_4c: {
    noise_complaint:       ["אאא זה לא נורמלי 😤", "שקט כבר!! אנחנו עובדים מהבית"],
    renovation_noise:      ["רציני?? שוב?? 😩", "מישהו יכול לטפל בזה?"],
    water_leak:            ["דליפה?? אוי לא 😰 מישהו קורא לאינסטלטור?", "יש לנו את הביטוח הזה בגלל זה בדיוק"],
    power_outage:          ["אין חשמל?! אני באמצע ישיבת זום 😭", "חייבים לפתור את זה"],
    elevator_broken:       ["שוב?! אנחנו בקומה 7 😑", "טל!! המעלית שוב לא עובדת"],
    parking_dispute:       ["מי עשה את זה?! יש מצלמות פה", "הייתי לוקחת תמונה ומעלה לקבוצה"],
    cleanliness_complaint: ["נכון זה ממש לא בסדר 😬", "צריך מישהו שיתאמן על הנושא הזה"],
    public_accusation:     ["וואו אוקיי, יש פה עניין", "מחכים לתגובה רשמית 👀"],
    support_signal:        ["👍 בדיוק ככה!", "אנחנו תומכים בזה"],
    no_confidence_signal:  ["אמרנו את זה מהתחלה 😕", "קצת מאכזב"],
    rumor_spread:          ["וואו מה?? 👀 ספרו עוד", "סטורי מטורף לקבוצה הזאת"],
  },
  miriam_2d: {
    noise_complaint:       ["לא סתם שזה קורה דווקא עכשיו...", "מעניין מי עומד מאחורי זה"],
    renovation_noise:      ["בדיוק שאלתי את עצמי — מי נתן לזה אישור?", "לא סתם שהחלו בשיפוצים ממש עכשיו"],
    water_leak:            ["לא סתם שהדליפה קורית דווקא בחלק הזה של הבניין", "מעניין מתי בדיוק זה התחיל"],
    power_outage:          ["מקרי? לא בטוחה...", "צריך לבדוק מה קרה בדיוק לפני שהחשמל נכבה"],
    elevator_broken:       ["כבר פעם שלישית החודש. לא במקרה", "מישהו צריך לבדוק את החוזה עם חברת המעליות"],
    parking_dispute:       ["יש לי חשד מי זה, אבל לא אגיד עדיין", "לא סתם שזה קרה שוב דווקא הלילה"],
    cleanliness_complaint: ["מי שאחראי — יודע מי הוא", "לא סתם שהנושא הזה חוזר"],
    public_accusation:     ["לא מפתיע אותי בכלל. ידעתי", "מי שמכיר את הבניין — מבין"],
    support_signal:        ["כן. יש אנשים שמבינים מה באמת קורה פה", "סוף סוף מישהו פותח את העיניים"],
    no_confidence_signal:  ["לא סתם שאני שואלת את עצמי שאלות", "מי באמת מנהל פה את הענינים?"],
    rumor_spread:          ["אני כבר ידעתי. לא סתם ש...", "שמועות לא יוצאות מאין — מישהו מפיץ בכוונה"],
  },
  yossi_6b: {
    noise_complaint:       ["מספיק!! אני לא יכול יותר!!", "עכשיו!! מישהו יטפל בזה עכשיו!"],
    renovation_noise:      ["זה מעל ומעבר!! עוצרים את זה היום!", "אני הולך לדפוק על הדלת שלהם!"],
    water_leak:            ["מה זה?!! קוראים לשרברב עכשיו!!", "מישהו יעשה משהו כבר!!"],
    power_outage:          ["מה זה הבניין הזה?! חוזרים ל-1960?!", "דורש שיתקנו את זה עכשיו!!"],
    elevator_broken:       ["שוב?!! אני לא מקבל את זה!!", "מישהו ישלח טכנאי עכשיו או שאני מתקשר לעירייה!"],
    parking_dispute:       ["מי עשה את זה?! תצאו ותזיזו את הרכב!!", "אני לא אוכל את זה שוב!!"],
    cleanliness_complaint: ["מספיק!! זה בניין, לא פח אשפה!!", "מישהו יקח אחריות כבר!!"],
    public_accusation:     ["אמרתי!! אמרתי שזה יקרה!! עכשיו מה?!", "מישהו חייב לשלם על זה!!"],
    support_signal:        ["נכון!! כך צריך להגיד!!", "סוף סוף!! עוד אחד מבין!!"],
    no_confidence_signal:  ["מספיק!! זה לא עובד!!", "דורש שינוי עכשיו!!"],
    rumor_spread:          ["מה שמעתי זה עוד יותר גרוע!!", "אני לא מופתע — ידעתי שיהיה ככה!!"],
  },
}

/** Generic fallback pool used when the resident or event type isn't explicitly mapped */
const GENERIC_MOCK: string[] = [
  "יש מה לדון פה בקבוצה",
  "צריך לטפל בזה בהקדם",
  "מישהו יכול לתת עדכון?",
]

/**
 * Returns a scripted Hebrew resident message without making any API call.
 * Picks from a pool by time-division so messages rotate without non-determinism.
 * Traces the call so the DEV LLM tab shows an entry identical to real calls.
 */
function mockGenerate(req: GenerateMessageRequest): GenerateMessageResponse {
  const start = Date.now()
  const residentPool = MOCK_MESSAGES[req.residentId]
  const eventPool = residentPool?.[req.eventType] ?? GENERIC_MOCK
  // Rotate through the pool by seconds elapsed — deterministic but varying
  const idx = (Math.floor(Date.now() / 1000)) % eventPool.length
  const message = eventPool[idx]

  trace.traceLLM({
    callType: "generate",
    prompt: `[MOCK] residentId=${req.residentId} eventType=${req.eventType}`,
    rawResponse: message,
    parsed: message,
    latencyMs: 0,
    success: true,
    fallbackUsed: false,
    tick: 0,
  })

  void start // suppress unused warning
  return { message, fallbackUsed: false }
}

/**
 * Classifies a player message via keyword matching — no API call.
 * Produces realistic PlayerAction objects so trust/mood actually shift during mock sessions.
 * Traces the call so the DEV LLM tab shows an entry identical to real calls.
 */
function mockAnalyze(req: AnalyzePlayerMessageRequest): AnalyzePlayerMessageResponse {
  const msg = req.playerMessage

  let type: PlayerAction["type"]
  let intensity: number

  if (/אני מבטיח|אטפל|אסדר|אטפל בזה/.test(msg)) {
    type = "promise"; intensity = 70
  } else if (/נרגע|שקט|ביחד|כולנו|ננסה/.test(msg)) {
    type = "de_escalate"; intensity = 60
  } else if (/צודק|בסדר|מסכים|מבין אתכם/.test(msg)) {
    type = "acknowledge_complaint"; intensity = 50
  } else if (/אני הוועד|סמכות|כוחי|בסמכותי/.test(msg)) {
    type = "assert_authority"; intensity = 75
  } else {
    // Rotate through 3 fallback types by message length for variety
    const types: PlayerAction["type"][] = ["acknowledge_complaint", "de_escalate", "ambiguous"]
    type = types[msg.length % 3]
    intensity = 50
  }

  const action: PlayerAction = { type, intensity, confidence: 0.9, rawMessage: msg }

  trace.traceLLM({
    callType: "analyze",
    prompt: `[MOCK] playerMessage=${msg}`,
    rawResponse: JSON.stringify(action),
    parsed: action,
    latencyMs: 0,
    success: true,
    fallbackUsed: false,
    tick: 0,
  })

  return { action, fallbackUsed: false }
}
