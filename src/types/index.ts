// ============================================================
// Core shared types for WhatsApp Chaos simulation
// All game entities are defined here and imported everywhere else.
// LLM only reads these — never writes to them directly.
// ============================================================

// ─── Resident ───────────────────────────────────────────────

/** Personality archetype — drives default trait weights and reaction tendencies */
export type ResidentArchetype =
  | "angry_old_man"
  | "gossip"
  | "peacemaker"
  | "young_couple"
  | "suspicious_elder"
  | "hot_headed"

/** How much a resident cares about each topic — multiplies reaction intensity (0–3) */
export interface ResidentSensitivities {
  noise: number        // sensitivity to noise complaints
  cleanliness: number  // sensitivity to dirty common areas
  parking: number      // sensitivity to parking disputes
  pets: number         // sensitivity to pet-related issues
  renovations: number  // sensitivity to renovation noise / dust
  money: number        // sensitivity to maintenance fee disputes
}

/** Core personality traits — all 0–100, higher = more of that trait */
export interface ResidentTraits {
  aggressiveness: number      // how quickly they escalate a conflict
  sociability: number         // how often they post unprompted
  stubbornness: number        // resistance to changing their opinion
  authorityRespect: number    // how much they defer to the Va'ad Bayit
  gossipTendency: number      // likelihood of spreading rumors
  anxiety: number             // sensitivity to rising chaos level
}

/** Dynamic emotional state — updated every simulation tick */
export interface MoodState {
  anger: number      // 0–100, decays over time, spikes on bad events
  stress: number     // 0–100, rises with chaos, falls with stability
  happiness: number  // 0–100, rises with resolved issues and trust
}

/** An unresolved complaint the resident is holding against someone */
export interface Grievance {
  id: string
  description: string      // human-readable summary
  sourceEventId: string    // the SimulationEvent that caused this
  intensity: number        // 0–100, affects how angry they are about it
  createdAtTick: number
  expiresAtTick?: number   // undefined = permanent until resolved
}

/** Overall disposition toward the player — drives message tone and alliance behavior */
export type Sentiment = "supportive" | "neutral" | "skeptical" | "hostile"

/** A single building resident with full personality + dynamic state */
export interface Resident {
  // ── Identity ──────────────────────────────────────────────
  id: string           // e.g. "dov_5a" — stable, used as key everywhere
  name: string         // display name shown in chat
  apartment: string    // e.g. "5A"
  archetype: ResidentArchetype

  // ── LLM persona — sent verbatim in every generate-message prompt ──
  /** Free-text description of voice, quirks, speech patterns, backstory.
   *  Written by the designer. The LLM reads this to "feel" the character. */
  personaDescription: string

  // ── Static personality ────────────────────────────────────
  traits: ResidentTraits
  sensitivities: ResidentSensitivities

  // ── Dynamic state — mutated by simulation tick ────────────
  mood: MoodState
  trustInPlayer: number        // 0–100, 50 = neutral
  isActive: boolean            // false if they rage-quit the group
  isMuted: boolean             // true if player used mute action
  muteExpiresAtTick?: number   // tick when mute lifts
  grievances: Grievance[]
  currentSentiment: Sentiment
}

// ─── Building State ──────────────────────────────────────────

/** Which act of the game we are in */
export type GamePhase =
  | "intro"     // 0–30s: calm, introductory messages
  | "tension"   // normal gameplay — conflicts building
  | "crisis"    // chaosLevel > 70 — multiple issues active
  | "vote"      // final 60s — no-confidence vote forming
  | "ended"     // game is over (win or lose)

/** Type of building/social issue */
export type IssueType =
  | "elevator_broken"
  | "water_leak"
  | "power_outage"
  | "cleanliness_complaint"
  | "noise_complaint"
  | "parking_dispute"
  | "pet_complaint"
  | "renovation_noise"
  | "public_accusation"
  | "maintenance_fee_dispute"

/** An active unresolved building problem — shown to LLM as context */
export interface BuildingIssue {
  id: string
  type: IssueType
  severity: number           // 0–100
  reportedByResidentId: string
  createdAtTick: number
  resolvedAtTick?: number
  isResolved: boolean
}

/** Who said what in the chat */
export type MessageSender = "resident" | "player" | "system"

/** A single message in the WhatsApp group chat */
export interface ChatMessage {
  id: string
  senderId: string           // resident id, "player", or "system"
  senderName: string
  content: string            // text shown in the chat bubble
  tick: number
  type: MessageSender
  relatedEventId?: string    // links back to the SimulationEvent that caused this
}

/** Full global game state — source of truth for the simulation */
export interface BuildingState {
  // ── Simulation clock ──────────────────────────────────────
  tick: number                 // increments every simulation step
  gameTimeElapsedSeconds: number
  gameDurationSeconds: number  // total session length (480–720)
  phase: GamePhase

  // ── Building metrics — 0–100 ──────────────────────────────
  noiseLevel: number           // drives noise complaint events
  chaosLevel: number           // primary lose meter
  stabilityIndex: number       // inverse of chaos, decays passively

  // ── Political state ───────────────────────────────────────
  voteSentiment: number        // 0–100: low = no-confidence forming

  // ── Active issues ─────────────────────────────────────────
  activeIssues: BuildingIssue[]

  // ── Chat history ─────────────────────────────────────────
  chatMessages: ChatMessage[]

  // ── Game result ───────────────────────────────────────────
  isGameOver: boolean
  gameResult?: "win" | "lose"
  gameOverReason?: string
}

/** Tunable simulation constants — change these to adjust difficulty */
export const THRESHOLDS = {
  NOISE_COMPLAINT_TRIGGER: 60,   // noiseLevel above this fires noise events
  CHAOS_CRISIS_TRIGGER: 70,      // phase shifts to "crisis"
  CHAOS_LOSE_TRIGGER: 95,        // instant lose
  NO_CONFIDENCE_LOSE: 25,        // voteSentiment below this = lose
  STABILITY_DECAY_PER_TICK: 0.5, // stability drifts toward chaos each tick
  ANGER_DECAY_PER_TICK: 2,       // resident anger baseline decay each tick
  MAX_CHAT_HISTORY: 200,         // cap stored messages to avoid memory bloat
} as const

// ─── Simulation Events ───────────────────────────────────────

/** Every type of event the simulation can generate */
export type EventType =
  | "elevator_broken"
  | "water_leak"
  | "power_outage"
  | "cleanliness_complaint"
  | "noise_complaint"
  | "parking_dispute"
  | "pet_complaint"
  | "renovation_noise"
  | "public_accusation"
  | "rumor_spread"
  | "alliance_formed"
  | "alliance_broken"
  | "player_promise_made"
  | "player_promise_broken"
  | "player_muted_resident"
  | "player_public_message"
  | "no_confidence_signal"
  | "support_signal"
  | "resident_left_group"

/** A simulation event — generated by eventGenerator, never by LLM */
export interface SimulationEvent {
  id: string
  type: EventType
  sourceId: string           // resident id or "building" for infrastructure events
  targetId?: string          // resident id if this targets a specific person
  severity: number           // 0–100, scales emotional impact on residents
  tick: number
  metadata: Record<string, unknown>  // type-specific extra data
}

// ─── Relationships ───────────────────────────────────────────

/** Alliance state between two residents — determines conflict propagation */
export type AllianceState =
  | "allied"    // actively support each other, react in unison
  | "friendly"  // positive but not coordinated
  | "neutral"   // no strong connection
  | "tense"     // underlying conflict, not yet erupted
  | "feuding"   // active conflict, amplify each other's anger

/** A historical event between two residents — stored for context */
export interface RelationshipEvent {
  tick: number
  type: "support" | "disagreement" | "accusation" | "alliance_formed" | "alliance_broken" | "rumor"
  description: string
  trustDelta: number  // how much this shifted their trust
}

/** Trust and alliance between two specific residents */
export interface Relationship {
  id: string            // `${sortedIdA}_${sortedIdB}`
  residentAId: string
  residentBId: string
  trust: number         // 0–100, 50 = neutral
  alliance: AllianceState
  sharedGrievanceIds: string[]   // issues they both care about
  history: RelationshipEvent[]   // last N significant interactions
}

// ─── Player Actions ──────────────────────────────────────────

/** Structured action the LLM extracts from the player's typed message */
export type PlayerActionType =
  | "support_resident"       // player agrees with / defends someone
  | "oppose_resident"        // player disagrees with / calls out someone
  | "de_escalate"            // general calming message
  | "promise"                // commits to fixing something
  | "shift_blame"            // redirects blame to another party
  | "assert_authority"       // reminds group of Va'ad Bayit role
  | "acknowledge_complaint"  // validates complaint without committing
  | "ignore"                 // no meaningful game action
  | "ambiguous"              // LLM could not confidently classify

/** Output from the LLM after analyzing the player's message.
 *  The simulation applies this — the LLM does NOT apply it directly. */
export interface PlayerAction {
  type: PlayerActionType
  targetId?: string          // resident id this is directed at, if any
  intensity: number          // 0–100, how strongly the action is expressed
  topic?: IssueType          // the topic being addressed, if identifiable
  promiseDetails?: string    // if type === "promise": what was promised
  rawMessage: string         // original player text
  confidence: number         // 0–1: LLM confidence in this classification
}

// ─── LLM Contracts ───────────────────────────────────────────

/** Payload sent to /api/groq for generating a resident message */
export interface GenerateMessageRequest {
  callType: "generate"
  residentId: string
  personaDescription: string
  mood: MoodState
  trustInPlayer: number         // 0–100
  currentSentiment: Sentiment
  eventType: EventType
  sourceResidentName: string
  severity: number              // 0–100
  activeIssues: IssueType[]
  recentMessages: string[]      // last 5 chat messages as plain strings
}

/** Payload sent to /api/groq for analyzing a player message */
export interface AnalyzePlayerMessageRequest {
  callType: "analyze"
  playerMessage: string
  activeIssues: IssueType[]
  chaosLevel: number
  residents: Array<{ id: string; name: string; sentiment: Sentiment }>
  recentMessages: string[]      // last 5 chat messages as plain strings
}

/** What /api/groq returns for a generate call — plain message text */
export interface GenerateMessageResponse {
  message: string        // the WhatsApp message text to display
  fallbackUsed: boolean  // true if LLM failed and we used a template
}

/** What /api/groq returns for an analyze call */
export interface AnalyzePlayerMessageResponse {
  action: PlayerAction
  fallbackUsed: boolean  // true if LLM failed and we used ambiguous fallback
}
