# WhatsApp Chaos — CLAUDE.md

## Game Concept

A real-time browser-based social simulation set in an Israeli residential building WhatsApp group. The player is the new Va'ad Bayit (Building Committee leader) trying to survive political chaos. Residents argue, form alliances, and may collectively vote the player out.

**Core rule**: The simulation is fully deterministic and rule-based. LLM is used ONLY for two things:
1. Generating resident message text from structured state
2. Analyzing player messages into structured action objects

LLM must NOT make game decisions, control logic, or influence simulation outcomes directly.

---

## Coding Standards

### Comments
Write meaningful comments throughout — not what the code does, but why and what:
- **Functions**: every function gets a comment describing its purpose, inputs, and what it returns or mutates
- **Parameters**: comment non-obvious parameters, units, and valid ranges (e.g. `// 0–100, higher = angrier`)
- **Variables**: comment any variable whose name alone doesn't fully explain its role or constraints
- **Complex logic**: comment the intent behind threshold checks, probability calculations, and state mutations

### Git
- **Never commit or push without explicit user instruction** — always wait to be told
- **Never sign commits** with Claude's name or any co-author tag
- Commit messages should be written by the user or confirmed by the user before running

---

## UX Philosophy

**No UI meters during gameplay.** The player has zero visible indicators of chaos level, trust scores, or vote sentiment. All feedback comes from resident behavior in the chat — tone shifts, silence, alliance formation, direct accusations. The simulation tracks numbers internally; the LLM translates them into human subtext.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite + TypeScript |
| UI Components | shadcn/ui |
| Design System | Stitch project "whatsappchaos" |
| Styling | Tailwind CSS (via shadcn) |
| LLM | Groq API (llama3 or mixtral) |
| LLM Gateway | Vercel Serverless Function (`/api/groq`) |
| Deploy | Vercel |
| Language | TypeScript throughout (strict mode) |

**Security**: The Groq API key lives only in Vercel environment variables. The browser calls `/api/groq` (serverless proxy) — the key never reaches the client bundle.

---

## File Structure

```
whatsappchaos/
├── CLAUDE.md
├── docs/
│   ├── spec.md                    # Game design spec
│   └── models/
│       ├── resident.md            # Resident entity schema
│       ├── building-state.md      # Global game state schema
│       ├── event.md               # Simulation event schema
│       ├── player-action.md       # Structured player action (LLM output)
│       ├── relationship.md        # Resident-to-resident relationship schema
│       └── llm-contracts.md       # Exact prompt contracts for both LLM calls
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── types/
│   │   └── index.ts               # All shared TypeScript interfaces
│   ├── simulation/                # Pure TS — zero React, zero side effects
│   │   ├── engine.ts              # Main tick loop, orchestrates everything
│   │   ├── eventGenerator.ts      # Deterministic event creation from state
│   │   ├── residentAI.ts          # Resident reaction logic (rule-based)
│   │   └── escalation.ts          # Conflict escalation / de-escalation rules
│   ├── state/
│   │   ├── buildingState.ts       # Initial building state + reducers
│   │   └── residents.ts           # All 6–8 named resident definitions
│   ├── llm/
│   │   └── groqClient.ts          # Calls /api/groq, typed request/response
│   ├── components/
│   │   ├── ChatWindow.tsx          # WhatsApp-style scrollable chat
│   │   ├── ResidentPanel.tsx       # Sidebar: resident moods + trust bars
│   │   └── StatusBar.tsx           # Top bar: chaos level, timer, phase
│   ├── dev/                           # Only active when ?dev=1 in URL
│   │   ├── traceStore.ts              # Singleton — no-op in prod, collects all trace data
│   │   ├── DevPanel.tsx               # Right-side drawer: Event Log / Residents / LLM / Diffs
│   │   └── DevBadge.tsx               # Floating [DEV] toggle button
│   ├── lib/
│   │   └── utils.ts               # shadcn cn() utility
│   └── styles/
│       └── globals.css
├── api/
│   └── groq.ts                    # Vercel serverless function — Groq proxy
├── public/
├── .env.example                   # GROQ_API_KEY=
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## Architecture

### Simulation Loop (every 2–5 seconds)
```
tick()
  → eventGenerator.generate(buildingState)   → Event[]
  → residentAI.react(residents, events)       → ReactionMap
  → escalation.resolve(reactions, relations)  → StateDeltas
  → applyDeltas(buildingState, residents)
  → triggerLLMMessages(selectedResidents)     → ChatMessage[]
```

### Player Turn
```
player types message
  → POST /api/groq { role: "analyze", message, gameState }
  → LLM returns PlayerAction { type, target, intensity }
  → applyPlayerAction(action, buildingState, residents)
  → POST /api/groq { role: "generate", resident, situation }  ← reactions from affected residents
  → append ChatMessage[]
```

### LLM Contract (summary — see docs/models/llm-contracts.md)
- **Analyze**: input = player message + game state → output = `PlayerAction` JSON
- **Generate**: input = resident persona + situation struct → output = Hebrew/Israeli WhatsApp message string

---

## Residents (MVP roster — 6 characters)

See `docs/models/resident.md` for full schema. Each has a `personaDescription` free-text field that is sent verbatim to the LLM to capture voice and character.

| ID | Name | Archetype |
|---|---|---|
| `dov_5a` | Dov Mizrahi | Angry Old Man |
| `rivka_3b` | Rivka Cohen | Gossip |
| `shmuel_1a` | Shmuel Levi | Peacemaker |
| `noa_4c` | Noa & Tal Shapiro | Young Couple |
| `miriam_2d` | Miriam Peretz | Suspicious Elder |
| `yossi_6b` | Yossi Azoulay | Hot-Headed Neighbor |

---

## Milestones

### M1 — Foundation ✅
- [x] Project scaffold: React + Vite + TypeScript, Tailwind v3, shadcn manual setup
- [x] All TypeScript interfaces in `src/types/index.ts`
- [x] Resident definitions in `src/state/residents.ts` (6 characters with Hebrew personas)
- [x] Initial building state in `src/state/buildingState.ts`
- [x] Dev trace store skeleton in `src/dev/traceStore.ts`
- [x] Serverless function stub in `api/groq.ts` (both generate + analyze handlers)
- [x] `.env.example`, `.gitignore`, git remote connected
- [x] `@` path alias wired in vite + tsconfig, zero TypeScript errors

### M2 — Simulation Engine ✅
- [x] `engine.ts` tick loop (setInterval, pause/resume)
- [x] `eventGenerator.ts` — threshold-based event creation
- [x] `residentAI.ts` — rule-based reactions per personality
- [x] `escalation.ts` — conflict resolution, alliance formation
- [x] Unit tests for simulation (Vitest) — 39 tests, all passing
- [x] `src/constants.ts` — all union-type string literals centralized (EVENT_TYPE, ALLIANCE, SENTIMENT, PHASE, ARCHETYPE, REL_EVENT_TYPE)
- [x] `reactionMultiplier` moved onto each resident definition (no archetype switch in logic)

### M3 — UI Shell
- [ ] WhatsApp-style `ChatWindow` (shadcn ScrollArea)
- [ ] `ResidentPanel` sidebar with resident names only (no stats — chat tells the story)
- [ ] Timer display
- [ ] Wire simulation tick to React state

### M4 — LLM Integration
- [ ] `src/llm/groqClient.ts` typed browser-side wrapper (calls `/api/groq`)
- [ ] Resident message generation flow wired to simulation
- [ ] Player message analysis flow wired to chat input
- [ ] Fallback to template messages if LLM fails
- [ ] Vercel project linked + `GROQ_API_KEY` set in Vercel env

### M5 — Game Loop
- [ ] Win/lose condition checks on each tick
- [ ] Endgame pressure system (vote sentiment — internal only, not shown to player)
- [ ] Game over / victory screens
- [ ] Difficulty tuning and balance pass

---

## Dev Tooling (`?dev=1`)

Append `?dev=1` to any URL to activate the dev panel. Zero impact in production — all trace calls are no-ops when the flag is absent.

**What appears:**
- A floating `[DEV]` badge in the bottom-right corner
- Click it → right-side drawer slides in (chat remains visible)

**Drawer tabs:**

| Tab | Contents |
|---|---|
| Event Log | Every `SimulationEvent` fired: tick, type, source → target, severity |
| Residents | Live cards per resident: anger/stress/happiness strips, trust score, sentiment badge |
| LLM Log | Every Groq call: prompt, raw response, parsed result, latency, fallback flag |
| State Diffs | Per-tick before/after snapshot — only changed fields shown |

**Architecture:** `src/dev/traceStore.ts` is a singleton. Simulation, residentAI, and groqClient call `trace.traceX()` without knowing about dev mode. The store decides whether to record or discard.

---

## LLM Usage Contract

| | Allowed | Forbidden |
|---|---|---|
| Generate resident message text | ✅ | |
| Analyze player message → PlayerAction | ✅ | |
| Decide game events | | ❌ |
| Control trust scores directly | | ❌ |
| Choose which resident reacts | | ❌ |
| Determine win/lose | | ❌ |
