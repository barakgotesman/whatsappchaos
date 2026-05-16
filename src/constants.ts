// ============================================================
// Game-wide string constants — every union-type literal lives here.
// Import from this file instead of writing string literals directly.
// ============================================================

import type { AllianceState, Sentiment, GamePhase, ResidentArchetype, EventType, RelationshipEventType } from "@/types"

// ─── Alliance states ─────────────────────────────────────────
/** Residents who actively back each other and react in unison */
export const ALLIANCE = {
  ALLIED:   "allied",
  FRIENDLY: "friendly",
  NEUTRAL:  "neutral",
  TENSE:    "tense",    // simmering — not yet erupted
  FEUDING:  "feuding",  // active conflict, amplify each other's anger
} as const satisfies Record<string, AllianceState>

// ─── Player-trust sentiments ──────────────────────────────────
export const SENTIMENT = {
  SUPPORTIVE: "supportive",
  NEUTRAL:    "neutral",
  SKEPTICAL:  "skeptical",
  HOSTILE:    "hostile",
} as const satisfies Record<string, Sentiment>

// ─── Game phases ──────────────────────────────────────────────
export const PHASE = {
  INTRO:   "intro",    // 0–30s, calm
  TENSION: "tension",  // normal gameplay
  CRISIS:  "crisis",   // chaosLevel > 70
  VOTE:    "vote",     // final 60s, no-confidence forming
  ENDED:   "ended",    // game over
} as const satisfies Record<string, GamePhase>

// ─── Simulation event types ───────────────────────────────────
export const EVENT_TYPE = {
  // Infrastructure — building-level failures
  ELEVATOR_BROKEN:        "elevator_broken",
  WATER_LEAK:             "water_leak",
  POWER_OUTAGE:           "power_outage",
  // Complaints — resident-driven issues
  CLEANLINESS_COMPLAINT:  "cleanliness_complaint",
  NOISE_COMPLAINT:        "noise_complaint",
  PARKING_DISPUTE:        "parking_dispute",
  PET_COMPLAINT:          "pet_complaint",
  RENOVATION_NOISE:       "renovation_noise",
  PUBLIC_ACCUSATION:      "public_accusation",
  MAINTENANCE_FEE_DISPUTE:"maintenance_fee_dispute",
  // Social — emergent group dynamics
  RUMOR_SPREAD:           "rumor_spread",
  ALLIANCE_FORMED:        "alliance_formed",
  ALLIANCE_BROKEN:        "alliance_broken",
  NO_CONFIDENCE_SIGNAL:   "no_confidence_signal",
  SUPPORT_SIGNAL:         "support_signal",
  RESIDENT_LEFT_GROUP:    "resident_left_group",
  // Player actions recorded as events
  PLAYER_PROMISE_MADE:    "player_promise_made",
  PLAYER_PROMISE_BROKEN:  "player_promise_broken",
  PLAYER_MUTED_RESIDENT:  "player_muted_resident",
  PLAYER_PUBLIC_MESSAGE:  "player_public_message",
} as const satisfies Record<string, EventType>

// ─── Relationship history event types ────────────────────────
export const REL_EVENT_TYPE = {
  SUPPORT:          "support",
  DISAGREEMENT:     "disagreement",
  ACCUSATION:       "accusation",
  ALLIANCE_FORMED:  "alliance_formed",
  ALLIANCE_BROKEN:  "alliance_broken",
  RUMOR:            "rumor",
} as const satisfies Record<string, RelationshipEventType>

// ─── Resident archetypes ──────────────────────────────────────
export const ARCHETYPE = {
  ANGRY_OLD_MAN:    "angry_old_man",
  GOSSIP:           "gossip",
  PEACEMAKER:       "peacemaker",
  YOUNG_COUPLE:     "young_couple",
  SUSPICIOUS_ELDER: "suspicious_elder",
  HOT_HEADED:       "hot_headed",
} as const satisfies Record<string, ResidentArchetype>
