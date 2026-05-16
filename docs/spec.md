# claude.md — Building WhatsApp Chaos (MVP)

## 🎮 Game Concept

A real-time browser-based social simulation game set in an Israeli residential building WhatsApp group.

The player is the new Building Committee leader (Va'ad Bayit) trying to survive political chaos inside the group.

Residents argue, form alliances, escalate conflicts, and may collectively turn against the player.

The game is a **simulation-first system**, where behavior emerges from rules and state changes. LLM is used only for message generation (flavor), not decision making.

---

## 🎯 Core Objective

The player must:
- Manage a chaotic WhatsApp group of residents
- Maintain majority trust and political support
- Survive a timed session (8–12 minutes recommended)
- Avoid being voted out or socially rejected

---

## 🏁 Win Condition

- Majority of influential residents support the player
- Chaos level remains under control
- No successful collective “vote of no confidence”

---

## 💀 Lose Conditions

- Majority of residents turn against the player
- Key influential residents leave the group
- Chaos level reaches critical threshold
- Player is effectively “removed” socially (game over state)

---

## 🔁 Core Gameplay Loop (Real-Time)

1. **Simulation Tick (every 2–5 seconds)**
   - Update all resident moods
   - Update trust relationships
   - Apply passive effects (stress decay, anger buildup)
   - Evaluate global building state (chaos, noise, stability)

2. **Event Generation (System-driven, not AI-driven)**
   - Noise complaints
   - Building issues (elevator, water, cleanliness)
   - Social triggers (misunderstandings, accusations)
   - Random tension amplifiers

3. **Resident Reaction Phase**
   - Each resident evaluates:
     - Personality traits
     - Mood
     - Topic sensitivities
     - Existing relationships
   - Generates internal reaction state (not text)

4. **Conflict Resolution & Escalation Engine**
   - Convert reactions into interactions:
     - support
     - disagreement
     - accusation
     - alliance formation
   - Escalate or de-escalate based on rules

5. **Player Interaction Phase**
   - Player can intervene in real time:
     - Support / oppose residents
     - De-escalate conflict
     - Shift blame
     - Make promises
     - Apply authority actions (mute, warn, etc.)

6. **Consequence Resolution**
   - Update:
     - Trust scores
     - Alliances
     - Mood states
     - Grievances
   - Potential chain reactions between residents

7. **Endgame Pressure System**
   - Increasing political tension over time
   - Informal “vote sentiment” emerges
   - Residents express support or opposition
   - Momentum shifts toward final outcome

---

## ⚙️ System Architecture Philosophy

### ✔ Simulation-first design
Game logic is deterministic and rule-based.

### ✔ LLM as presentation layer only
Used only to convert structured state into natural language messages.

### ❌ LLM must NOT:
- Decide events
- Control game logic
- Influence simulation outcomes directly

---

# 📌 MVP TODO LIST

---

## TODO 1 — Event Engine (Core Simulation System)

### 🎯 Goal
Build a deterministic system that generates conflict, events, and emotional pressure without using AI.

### 🧠 What it does
This is the “brain” of the building.

It:
- Maintains global building state
- Generates events based on thresholds and probabilities
- Triggers resident reactions
- Starts escalation chains between residents

### ⚙️ Core mechanics
- Noise level, chaos level, and stability metrics
- Threshold-based triggers (e.g. noise > 70 → complaints)
- Probability-based escalation
- Relationship-driven conflict selection

### 📦 Example event output
```json
{
  "type": "noise_complaint",
  "source": "rachel_3a",
  "target": "david_2b",
  "severity": 80
}