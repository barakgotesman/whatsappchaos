# Model: Resident

A single building resident with personality, mood, relationships, and a free-text persona description that is sent to the LLM to shape their voice.

## TypeScript Interface

```typescript
interface Resident {
  // Identity
  id: string;                        // e.g. "dov_5a"
  name: string;                      // Display name
  apartment: string;                 // e.g. "5A"
  archetype: ResidentArchetype;

  // LLM persona — sent verbatim in every generate-message prompt
  personaDescription: string;        // Free text: voice, quirks, speech patterns, backstory

  // Personality traits — all 0–100
  traits: {
    aggressiveness: number;          // How quickly they escalate
    sociability: number;             // How often they post
    stubbornness: number;            // How resistant to changing opinion
    authority_respect: number;       // How much they defer to Va'ad Bayit
    gossip_tendency: number;         // How likely to spread rumors
    anxiety: number;                 // Sensitivity to chaos level
  };

  // Topic sensitivities — multiplier on reaction intensity
  sensitivities: {
    noise: number;                   // 0–3 multiplier
    cleanliness: number;
    parking: number;
    pets: number;
    renovations: number;
    money: number;                   // Maintenance fees
  };

  // Dynamic state — mutated each tick
  mood: MoodState;
  trustInPlayer: number;            // 0–100 (50 = neutral)
  isActive: boolean;                // Still in group?
  isMuted: boolean;                 // Player used mute action?
  muteExpiresAt?: number;           // Game tick when mute expires
  grievances: Grievance[];          // Active unresolved complaints
  currentSentiment: Sentiment;      // current disposition toward player
}

type ResidentArchetype =
  | "angry_old_man"
  | "gossip"
  | "peacemaker"
  | "young_couple"
  | "suspicious_elder"
  | "hot_headed";

interface MoodState {
  anger: number;      // 0–100
  stress: number;     // 0–100
  happiness: number;  // 0–100
  // Derived: mood = f(anger, stress, happiness)
}

interface Grievance {
  id: string;
  description: string;
  sourceEvent: string;    // Event ID that caused this
  intensity: number;      // 0–100
  createdAt: number;      // tick
  expiresAt?: number;     // tick (undefined = permanent until resolved)
}

type Sentiment = "supportive" | "neutral" | "skeptical" | "hostile";
```

## MVP Residents

### Dov Mizrahi — `dov_5a` — Angry Old Man
```
personaDescription: "Dov is 71 years old and has lived in apartment 5A for 40 years.
He types in ALL CAPS, uses excessive punctuation, and always references 'the old committee'
that 'actually knew what they were doing'. He complains about noise constantly,
especially on Shabbat. He uses outdated slang and sometimes types in transliterated Hebrew."
```

### Rivka Cohen — `rivka_3b` — Gossip
```
personaDescription: "Rivka is 55, very active in the group chat, sends 5–10 messages per
incident. She uses lots of emojis, asks leading questions, and always knows everyone's
business. She frames her gossip as concern: 'לא אמרתי כלום but I heard that...'.
She forms alliances quickly and breaks them just as fast."
```

### Shmuel Levi — `shmuel_1a` — Peacemaker
```
personaDescription: "Shmuel is 63, retired school principal. He speaks in measured,
complete sentences. Always tries to find the middle ground. Uses phrases like
'בואו נדבר בצורה מכובדת' (let's talk respectfully). He will support the player
if approached calmly but loses patience with repeated chaos."
```

### Noa & Tal Shapiro — `noa_4c` — Young Couple
```
personaDescription: "Noa and Tal, both 32, moved in 8 months ago. They alternate
who types — sometimes it's 'Noa מכאן' or 'Tal כאן'. They are modern, use memes
and GIF references, support green initiatives, but get defensive if accused of noise.
They are uncertain about building politics and can be swayed easily."
```

### Miriam Peretz — `miriam_2d` — Suspicious Elder
```
personaDescription: "Miriam is 68, widowed, lives alone. She is deeply suspicious of
anyone new in a position of power and references past Va'ad Bayit scandals.
Types slowly with lots of typos she never corrects. Very religious — references
Shabbat and Jewish holidays. Sends voice notes that appear as '[הודעה קולית]' in text."
```

### Yossi Azoulay — `yossi_6b` — Hot-Headed Neighbor
```
personaDescription: "Yossi is 45, owns a small business. Types fast, short sentences,
lots of exclamation marks. Quick to anger but also quick to forgive if shown respect.
Uses North African Mizrahi slang ('wallah', 'achi'). Will threaten to 'take this to
court' regularly but never does. Respects strength and decisiveness."
```
