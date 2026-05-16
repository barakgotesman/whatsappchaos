# Model: Relationship

Tracks the state between every pair of residents. Used by the escalation engine to determine who sides with whom and how conflicts spread.

## TypeScript Interface

```typescript
interface Relationship {
  id: string;                    // `${residentIdA}_${residentIdB}` (sorted)
  residentAId: string;
  residentBId: string;
  trust: number;                 // 0–100 (50 = neutral)
  alliance: AllianceState;
  sharedGrievances: string[];    // Issue IDs they both care about
  history: RelationshipEvent[];  // Last N events between them
}

type AllianceState =
  | "allied"        // Actively support each other, react together
  | "friendly"      // Positive but not coordinated
  | "neutral"       // No strong connection
  | "tense"         // Underlying conflict, not yet active
  | "feuding";      // Active ongoing conflict, amplify each other's anger

interface RelationshipEvent {
  tick: number;
  type: "support" | "disagreement" | "accusation" | "alliance_formed" | "alliance_broken" | "rumor";
  description: string;
  trustDelta: number;           // How much this changed their trust
}
```

## Alliance Rules

```
trust > 80 AND sharedGrievances.length >= 2  → allied
trust > 60                                    → friendly
trust 40–60                                   → neutral
trust 20–40                                   → tense
trust < 20                                    → feuding
```

## Propagation Rules

When resident A reacts to an event targeting resident B:
- If A and B are `allied`: A amplifies B's message, A anger += B anger * 0.5
- If A and B are `feuding`: A may opportunistically attack B, conflict spreads
- If A is `friendly` with the player's `support_resident` target: A trust +5

Alliances are checked during `escalation.ts` to create chain reactions.
