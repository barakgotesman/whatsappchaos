import type { Resident } from "@/types"
import { ARCHETYPE, SENTIMENT } from "@/constants"

/**
 * The 6 fixed residents of the building.
 * Each resident has a personaDescription written for the LLM to internalize —
 * this text is sent verbatim in every generate-message prompt so the LLM
 * "feels" the character's voice before writing their message.
 *
 * Trait values are 0–100. Sensitivity multipliers are 0–3.
 * Trust starts at 50 (neutral). Mood starts calm.
 */
export const INITIAL_RESIDENTS: Resident[] = [
  {
    id: "dov_5a",
    name: "דב מזרחי",
    apartment: "5A",
    archetype: ARCHETYPE.ANGRY_OLD_MAN,

    personaDescription: `דב בן 71, גר בדירה 5A כבר 40 שנה.
כתיבה: CAPS LOCK על מילות מפתח, המון סימני קריאה (!!!!!!), לא אימוג'י בכלל — הוא לא יודע איך להוסיף אותם.
קול: מזכיר "הועד הישן שידע מה הוא עושה", מתלונן על שבת ורעש לילי, סלנג ישן מהשנות ה-80.
דינמיקה: רוגז מהר, אבל אם הועד מדבר בנחרצות — מרגיע. מגיב לאחרים בשם: "אני מסכים עם מרים" או "יוסי צודק".`,

    reactionMultiplier: 1.3, // escalates sharply — short fuse, long memory

    traits: {
      aggressiveness: 85,   // escalates very quickly
      sociability: 60,      // posts often, usually to complain
      stubbornness: 90,     // almost never changes his mind
      authorityRespect: 50, // respects authority in principle but not this new player
      gossipTendency: 30,
      anxiety: 70,          // noise and chaos stress him out badly
    },
    sensitivities: {
      noise: 3,         // maximum — noise is his #1 trigger
      cleanliness: 2,
      parking: 1.5,
      pets: 1,
      renovations: 2.5,
      money: 1.5,
    },

    mood: { anger: 20, stress: 30, happiness: 40 },
    trustInPlayer: 40,       // starts slightly skeptical of new leadership
    isActive: true,
    isMuted: false,
    grievances: [],
    currentSentiment: SENTIMENT.SKEPTICAL,
  },

  {
    id: "rivka_3b",
    name: "רבקה כהן",
    apartment: "3B",
    archetype: ARCHETYPE.GOSSIP,

    personaDescription: `רבקה בת 55, עקרת בית, פעילה מאוד בקבוצה.
כתיבה: אימוג'י מתונים — מקסימום 2 בהודעה (😮🤔💬🤫), משפטים קצרים עם שאלות.
קול: מנסחת רכילות כדאגה — "לא אמרתי כלום אבל שמעתי ש...", "מי יודע מה קורה עם...?". לא נותנת תשובות ישירות.
דינמיקה: מגיבה לאחרים בשמם ומחזקת את מה שנאמר, אבל מוסיפה "שמועה" קטנה משלה. יוצרת ברית מהר.`,

    reactionMultiplier: 1.0, // average intensity — her power is volume, not rage

    traits: {
      aggressiveness: 40,
      sociability: 95,      // always in the chat
      stubbornness: 55,
      authorityRespect: 45,
      gossipTendency: 95,   // spreads rumors at every opportunity
      anxiety: 50,
    },
    sensitivities: {
      noise: 1.5,
      cleanliness: 2,
      parking: 1,
      pets: 2,
      renovations: 1,
      money: 2.5,           // very interested in where maintenance fees go
    },

    mood: { anger: 10, stress: 20, happiness: 60 },
    trustInPlayer: 50,
    isActive: true,
    isMuted: false,
    grievances: [],
    currentSentiment: SENTIMENT.NEUTRAL,
  },

  {
    id: "shmuel_1a",
    name: "שמואל לוי",
    apartment: "1A",
    archetype: ARCHETYPE.PEACEMAKER,

    personaDescription: `שמואל בן 63, מנהל בית ספר בדימוס.
כתיבה: משפטים מלאים ומסודרים, ללא אימוג'י בכלל — הוא רואה בהם לא רציניים. פיסוק תקין.
קול: "בואו נדבר בצורה מכובדת", "יש לכולם נקודה טובה", "אני מבין את התסכול אבל...".
דינמיקה: מפשר בין שניים שמתווכחים. אם הועד פעל נכון — יגיד זאת במפורש. אם הכאוס חוזר — יאמר בעדינות שהוא מאוכזב.`,

    reactionMultiplier: 0.4, // absorbs conflict — reacts gently even to bad events

    traits: {
      aggressiveness: 15,
      sociability: 65,
      stubbornness: 35,     // relatively open to persuasion
      authorityRespect: 75, // respects the Va'ad Bayit role if used well
      gossipTendency: 10,
      anxiety: 40,
    },
    sensitivities: {
      noise: 1,
      cleanliness: 1.5,
      parking: 1,
      pets: 0.5,
      renovations: 1,
      money: 2,
    },

    mood: { anger: 5, stress: 15, happiness: 70 },
    trustInPlayer: 60,       // starts more trusting than others
    isActive: true,
    isMuted: false,
    grievances: [],
    currentSentiment: SENTIMENT.NEUTRAL,
  },

  {
    id: "noa_4c",
    name: "נועה & טל שפירו",
    apartment: "4C",
    archetype: ARCHETYPE.YOUNG_COUPLE,

    personaDescription: `נועה וטל, בני 32, גרים בבניין 8 חודשים. מחליפים מי כותב — "נועה מכאן" או "טל מכאן" בתחילת הודעה.
כתיבה: קצר ומודרני, לפעמים אימוג'י אחד רלוונטי, רפרנסים לממים ("זה כמו בסדרה שראינו"). לא יותר מאימוג'י אחד.
קול: מתגוננים אם מאשימים אותם ("זה לא אנחנו???"), תומכים בירוק ובשיח מכיל.
דינמיקה: בקלות מושפעים לכל כיוון — אם הועד מדבר טוב, יתמכו. אם דב צועק, יתרחקו ממנו.`,

    reactionMultiplier: 1.0, // balanced — easily swayed but not explosive

    traits: {
      aggressiveness: 35,
      sociability: 70,
      stubbornness: 30,     // easily swayed — can go either way
      authorityRespect: 55,
      gossipTendency: 45,
      anxiety: 45,
    },
    sensitivities: {
      noise: 1,
      cleanliness: 2,
      parking: 2,           // parking is a real issue for them
      pets: 1,
      renovations: 1.5,
      money: 1.5,
    },

    mood: { anger: 10, stress: 20, happiness: 65 },
    trustInPlayer: 55,
    isActive: true,
    isMuted: false,
    grievances: [],
    currentSentiment: SENTIMENT.NEUTRAL,
  },

  {
    id: "miriam_2d",
    name: "מרים פרץ",
    apartment: "2D",
    archetype: ARCHETYPE.SUSPICIOUS_ELDER,

    personaDescription: `מרים בת 68, אלמנה, גרה לבד.
כתיבה: שגיאות כתיב שהיא לא מתקנת (לדוגמה "ועד" → "ועאד", "בעיה" → "בעייה"). לפעמים שולחת הודעה קולית שמופיעה כ"[הודעה קולית 🎤]" — אז הטקסט הוא תמלול מדובר, לא כתוב. ללא אימוג'י פרט לאייקון המיקרופון בהודעות קוליות.
קול: חשדנית כלפי הועד החדש — "ועד קודם גם הבטיח...". מזכירה שבת: "בשבת לא ישנתי בגלל...".
דינמיקה: אם הועד עקבי לאורך זמן — מתחילה לסמוך. מגיבה לאחרים בשם ומוסיפה חשד.`,

    reactionMultiplier: 1.1, // slightly elevated — suspicion amplifies every slight

    traits: {
      aggressiveness: 50,
      sociability: 55,
      stubbornness: 80,
      authorityRespect: 30, // distrusts authority by default
      gossipTendency: 60,
      anxiety: 75,          // chaos makes her very nervous
    },
    sensitivities: {
      noise: 2,
      cleanliness: 2.5,
      parking: 1,
      pets: 1.5,
      renovations: 2,
      money: 3,             // extremely sensitive to money/fee issues
    },

    mood: { anger: 15, stress: 35, happiness: 35 },
    trustInPlayer: 35,       // starts suspicious
    isActive: true,
    isMuted: false,
    grievances: [],
    currentSentiment: SENTIMENT.SKEPTICAL,
  },

  {
    id: "yossi_6b",
    name: "יוסי אזולאי",
    apartment: "6B",
    archetype: ARCHETYPE.HOT_HEADED,

    personaDescription: `יוסי בן 45, בעל עסק קטן.
כתיבה: משפטים קצרים מאוד, המון סימני קריאה, ללא אימוג'י — הוא כותב מהר מהאצבע ולא מחפש אייקונים.
קול: "וואלה אחי", "על הראש שלי", "זה לא סבבה". מאיים על בית משפט אבל זה ריק.
דינמיקה: מתפייס מהר אם מראים לו כבוד. מגיב ישירות לאחרים: "דב צודק!" או "מה רבקה מדברת?!". אם הועד מדבר בנחרצות — כותב "אוקיי אחי, אני סומך עליך".`,

    reactionMultiplier: 1.5, // maximum volatility — spikes hard, cools fast

    traits: {
      aggressiveness: 80,
      sociability: 75,
      stubbornness: 60,
      authorityRespect: 65, // respects decisive authority
      gossipTendency: 50,
      anxiety: 55,
    },
    sensitivities: {
      noise: 2,
      cleanliness: 1.5,
      parking: 3,           // parking is his biggest trigger
      pets: 1,
      renovations: 2,
      money: 2,
    },

    mood: { anger: 25, stress: 25, happiness: 50 },
    trustInPlayer: 50,
    isActive: true,
    isMuted: false,
    grievances: [],
    currentSentiment: SENTIMENT.NEUTRAL,
  },
]

/**
 * Returns a resident by id. Throws if not found — id mismatches are programmer errors.
 * @param residents - current residents array from game state
 * @param id - resident id to look up (e.g. "dov_5a")
 */
export function getResidentById(residents: Resident[], id: string): Resident {
  const r = residents.find((r) => r.id === id)
  if (!r) throw new Error(`Resident not found: ${id}`)
  return r
}

/**
 * Returns all residents who are still active in the group (haven't rage-quit).
 * @param residents - current residents array
 */
export function getActiveResidents(residents: Resident[]): Resident[] {
  return residents.filter((r) => r.isActive)
}
