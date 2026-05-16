# Model: PlayerAction

The player only types free-text messages. The LLM analyzes each message and returns a structured `PlayerAction` object. The simulation then applies this action to the game state deterministically.

The LLM does NOT apply the action — it only classifies it.

## TypeScript Interface

```typescript
interface PlayerAction {
  type: PlayerActionType;
  targetId?: string;            // Resident ID this is directed at (if any)
  intensity: number;            // 0–100: how strongly the action is expressed
  topic?: IssueType;            // The topic being addressed (if identifiable)
  promiseDetails?: string;      // If type is "promise" — what was promised (1 sentence)
  rawMessage: string;           // Original player text
  confidence: number;           // 0–1: LLM confidence in classification
}

type PlayerActionType =
  | "support_resident"          // Player agrees with / defends a resident
  | "oppose_resident"           // Player disagrees with / calls out a resident
  | "de_escalate"               // General calming message
  | "promise"                   // Player commits to fixing something
  | "shift_blame"               // Player redirects blame to another party
  | "assert_authority"          // Player reminds group of their Va'ad Bayit role
  | "acknowledge_complaint"     // Player validates a complaint without committing
  | "ignore"                    // Message doesn't map to a meaningful game action
  | "ambiguous";                // LLM cannot confidently classify
```

## Effect Map (applied by simulation, not LLM)

| Action Type | State Effect |
|---|---|
| `support_resident` | +trust with target, ±trust with residents who oppose target |
| `oppose_resident` | -trust with target, +trust with residents who dislike target |
| `de_escalate` | -chaosLevel by intensity/10, -anger for all residents by small amount |
| `promise` | +trust temporarily, creates tracked promise, -trust if broken |
| `shift_blame` | redirect grievance from player to target resident |
| `assert_authority` | +trust with high authority_respect residents, -trust with low |
| `acknowledge_complaint` | -anger for complaining resident, no lasting effect |
| `ignore` | no state change |
| `ambiguous` | no state change, possibly show player a hint |

## LLM Prompt Contract (Analyze)

See `docs/models/llm-contracts.md` for the full prompt template.

Input sent to LLM:
```json
{
  "role": "analyze_player_message",
  "playerMessage": "<raw text>",
  "context": {
    "activeIssues": ["elevator_broken", "noise_complaint"],
    "recentMessages": ["<last 5 chat messages>"],
    "residents": [{ "id": "dov_5a", "name": "Dov", "sentiment": "hostile" }]
  }
}
```

Expected LLM output (JSON):
```json
{
  "type": "de_escalate",
  "targetId": null,
  "intensity": 60,
  "topic": "noise_complaint",
  "confidence": 0.85
}
```
