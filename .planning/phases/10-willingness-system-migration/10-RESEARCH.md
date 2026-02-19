# Phase 10: Willingness System Migration - Research

**Researched:** 2026-02-20
**Domain:** Algorithmic willingness/reply-decision system (exponential decay, heat detection, sigmoid gain, fatigue)
**Confidence:** HIGH

## Summary

This phase replaces the v1 `WillingnessCalculator` (a simple score+LLM-judge hybrid in `plugins/core/src/services/agent/willingness.ts`) with a full algorithmic willingness system derived from v3's `WillingnessManager`. The v3 reference code (`references/YesImBot-v3/packages/core/src/agent/willing.ts` and `references/YesImBot-dev/packages/core/src/agent/willing.ts`) provides the proven decay+heat+S-curve foundation. The CONTEXT.md decisions modify this foundation significantly: four-tier heat (vs v3's three), smooth sigmoid (vs v3's piecewise), a new fatigue mechanism (replacing v3's reply cost + negative feedback zone), and removal of fixed attribute bonuses in favor of a probability-boost formula for @mentions.

The v1 code is ~80 lines with flat config fields on `AgentCoreConfig`. The new system requires per-channel state management, a periodic decay timer, configurable parameters exposed via Koishi Schema nested groups, and integration with the existing `AgentCore.gateAndEnqueue` flow. No external libraries are needed — this is pure math/state management.

**Primary recommendation:** Build a new `WillingnessEngine` class that owns per-channel state maps and a decay interval, replacing the current `WillingnessCalculator`. Expose config via a dedicated `WillingnessConfig` interface with nested Schema groups. Wire into `AgentCore` at the same integration point (`gateAndEnqueue`).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Default half-life: 300s (5 minutes), down from v3's 600s
- Four-tier heat detection: Boiling (≤5s, ~90% decay reduction), Hot (≤15s, ~70%), Warm (≤60s, ~30%), Cold (>60s, normal)
- Elastic decay preserved: when willingness exceeds threshold, decay strength halved
- Per-channel isolated willingness state
- Fatigue mechanism: sliding window of bot's own messages, exponential penalty when exceeding threshold
- Remove fixed attribute bonuses (@mention +100, quote +15, DM +40)
- @mention uses probability boost: `P = base + (1 - base) * mentionBoost`
- Keywords matched via regex (not substring)
- Base text message gain retained from v3
- Smooth sigmoid curve replaces v3's three-segment piecewise function
- No negative feedback zone in sigmoid — fatigue handles over-activity
- Reply cost removed or greatly reduced — fatigue is the cooldown
- Willingness-to-probability: linear mapping (not threshold+amplifier)
- Remove LLM willingness judgment — pure algorithmic decision
- Nested config sub-groups: `willingness.decay`, `willingness.gain`, `willingness.fatigue`, etc.
- Only core parameters exposed (not all ~15 from v3)
- No preset templates

### Claude's Discretion
- Keyword influence method (multiplier vs additive boost)
- Fatigue sliding window duration and message count threshold defaults
- Sigmoid curve parameters (midpoint, steepness)
- Exact exponential penalty curve for fatigue

### Deferred Ideas (OUT OF SCOPE)
- LLM judge as optional fallback
- Cross-channel willingness influence (e.g., global fatigue)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| WILLING-01 | 意愿值衰减 — 指数衰减算法，支持半衰期配置，对话热度检测（hot/warm/cold） | Decay algorithm with four-tier heat detection, elastic decay, 300s default half-life. v3 reference code provides proven base formula. |
| WILLING-02 | S 曲线增益 — activation → saturation → negative feedback，防止过度活跃 | Smooth sigmoid replaces v3 piecewise. Fatigue mechanism replaces negative feedback zone. Sigmoid maps willingness→gain multiplier. |
| WILLING-03 | 回复成本与关键词兴趣 — 回复后意愿值扣减，关键词匹配提升兴趣乘数 | Reply cost removed/minimal (fatigue replaces it). Keywords use regex matching. Keyword influence via multiplier (recommended). |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| koishi | 4.18.x | Framework, Schema API, Service pattern, ctx.setTimeout/setInterval | Already in use, provides lifecycle management |
| TypeScript | 5.x | Type safety for config interfaces and state | Already in use |

### Supporting
No additional libraries needed. This is pure algorithmic code using:
- `Math.pow`, `Math.exp`, `Math.log` for decay/sigmoid
- `Map<string, ChannelState>` for per-channel isolation
- `RegExp` for keyword matching
- Koishi `ctx.setInterval` / `ctx.on('dispose')` for decay timer lifecycle

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-memory Maps | Database persistence | Unnecessary — willingness is ephemeral, resets on restart are fine |
| setInterval decay | Event-driven lazy decay | setInterval is simpler, v3 proven pattern, 1s tick is negligible overhead |

## Architecture Patterns

### Recommended Project Structure
```
plugins/core/src/services/agent/
├── willingness.ts          # WillingnessEngine class (replaces current file)
├── willingness-config.ts   # WillingnessConfig interface + Schema
├── config.ts               # AgentCoreConfig (updated, willingness fields removed)
├── service.ts              # AgentCore (updated integration)
├── loop.ts                 # ThinkActLoop (unchanged)
├── tools.ts                # (unchanged)
└── index.ts                # exports (updated)
```

### Pattern 1: Per-Channel State Isolation
**What:** Each channel gets its own `ChannelWillingnessState` object stored in a `Map<string, state>`.
**When to use:** Always — this is a locked decision.
**Key state per channel:**
```typescript
interface ChannelState {
  willingness: number;        // current willingness value [0, max]
  lastMessageAt: number;      // timestamp of last message in channel (for heat)
  botReplyTimestamps: number[]; // sliding window for fatigue tracking
}
```

### Pattern 2: Decay Timer with Koishi Lifecycle
**What:** Use `ctx.setInterval` (not raw `setInterval`) so the timer auto-disposes with the plugin.
**When to use:** For the 1-second decay tick.
**Why:** v3 used raw `setInterval` + manual `ctx.on('dispose')` cleanup. Koishi's `ctx.setInterval` handles this automatically and is the idiomatic pattern.

### Pattern 3: Separation of Concerns in Decision Flow
**What:** The willingness engine handles state + math only. The `AgentCore.gateAndEnqueue` method calls the engine and makes the final reply/skip decision.
**When to use:** Always — keeps the engine testable and the integration point clear.
**Flow:**
1. Message arrives → `horizon/percept` event
2. `AgentCore.gateAndEnqueue` calls `engine.processMessage(channelKey, percept)` → returns `{ probability, shouldReply }`
3. AgentCore acts on the decision
4. After reply: `engine.recordBotReply(channelKey)` updates fatigue window

### Anti-Patterns to Avoid
- **Storing Koishi Session in state maps:** v3 stored `Session` objects in the willingness manager. This is a memory leak risk and couples the engine to Koishi. The v4 engine should only store primitive state (numbers, timestamps).
- **Resolving Computed config per-tick:** v3 called `session.resolve()` on every decay tick for every channel. v4 doesn't use `Computed` fields (locked decision: no preset templates), so config is plain values.
- **Mixing gain calculation with probability conversion:** Keep these as separate pure functions for testability.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Timer lifecycle | Manual setInterval + dispose handler | `ctx.setInterval()` | Koishi auto-disposes, prevents leaks |
| Regex compilation | Compile regex on every message | Pre-compile on config load, cache in engine | Performance: regex compilation is expensive |

## Common Pitfalls

### Pitfall 1: Decay Factor Formula Inversion
**What goes wrong:** The decay factor `0.5^(1/halfLife)` is applied per-second. Getting the exponent wrong (e.g., `0.5^(halfLife)`) produces wildly incorrect decay rates.
**Why it happens:** The formula is unintuitive. With halfLife=300, the per-second factor should be `0.5^(1/300) ≈ 0.99769` (very close to 1, slow decay).
**How to avoid:** Use the exact formula from v3: `baseFactor = Math.pow(0.5, 1 / halfLifeSeconds)`. Verify: after `halfLifeSeconds` ticks, `value * baseFactor^halfLifeSeconds` should equal `value * 0.5`.
**Warning signs:** Willingness drops to 0 in seconds, or never decays at all.

### Pitfall 2: Heat Detection Using Wrong Timestamp
**What goes wrong:** Heat detection compares `now - lastMessageAt`, but if `lastMessageAt` tracks the bot's own messages instead of any channel message, heat detection breaks.
**Why it happens:** Confusion between "last message in channel" and "last bot reply".
**How to avoid:** `lastMessageAt` must be updated on EVERY incoming message (user or bot). `botReplyTimestamps` is a separate array for fatigue only.

### Pitfall 3: Fatigue Window Not Pruned
**What goes wrong:** The `botReplyTimestamps` array grows unbounded if old entries aren't pruned.
**Why it happens:** Forgetting to filter out timestamps older than the sliding window.
**How to avoid:** Prune on every access: `timestamps.filter(t => now - t < windowMs)`.

### Pitfall 4: Sigmoid Midpoint Miscalibration
**What goes wrong:** If the sigmoid midpoint is set too high relative to maxWillingness, the bot almost never gains enough willingness to reply. Too low, and it replies to everything.
**Why it happens:** The sigmoid `1 / (1 + exp(-k * (x - midpoint)))` is sensitive to midpoint placement.
**How to avoid:** Default midpoint at 50% of maxWillingness. Steepness `k` around 0.1 gives a gradual curve. Test with simulated message sequences.

### Pitfall 5: Config Migration — Old Fields Left in AgentCoreConfig
**What goes wrong:** The old `willingnessModel`, `willingnessRejectThreshold`, `willingnessAcceptThreshold`, `willingCooldownMessages`, `willingCooldownMs`, `willingSoftDecayMs` fields remain in `AgentCoreConfig` and `Config`, causing confusion.
**Why it happens:** Incomplete cleanup when replacing the old system.
**How to avoid:** Remove ALL old willingness fields from `AgentCoreConfig` and the root `Config` interface/schema. Replace with the new nested `WillingnessConfig`.

## Code Examples

### Exponential Decay with Four-Tier Heat (from v3, adapted)
```typescript
// Source: references/YesImBot-v3/packages/core/src/agent/willing.ts (adapted)
function computeDecayFactor(
  baseFactor: number,
  willingness: number,
  elasticThreshold: number,
  silenceMs: number,
): number {
  let factor = baseFactor;

  // Elastic decay: halve decay strength when above threshold
  if (willingness > elasticThreshold) {
    factor = 1.0 - (1.0 - factor) * 0.5;
  }

  // Four-tier heat detection (new in v4)
  if (silenceMs <= 5000) {
    // Boiling: ~90% decay reduction
    factor = 1.0 - (1.0 - factor) * 0.1;
  } else if (silenceMs <= 15000) {
    // Hot: ~70% decay reduction
    factor = 1.0 - (1.0 - factor) * 0.3;
  } else if (silenceMs <= 60000) {
    // Warm: ~30% decay reduction
    factor = 1.0 - (1.0 - factor) * 0.7;
  }
  // Cold (>60s): factor unchanged

  return factor;
}
```

### Smooth Sigmoid Gain Multiplier (replaces v3 piecewise)
```typescript
// Sigmoid: maps willingness ratio [0,1] to gain multiplier [0, ~2]
// At low willingness: multiplier > 1 (positive feedback, ramp up)
// At midpoint: multiplier = 1 (neutral)
// At high willingness: multiplier < 1 (diminishing returns)
// No negative zone — fatigue handles over-activity separately
function sigmoidGainMultiplier(
  current: number,
  max: number,
  midpoint: number,  // e.g., 0.5
  steepness: number, // e.g., 10
): number {
  const ratio = current / max;
  // Inverted sigmoid: high multiplier at low ratio, low at high ratio
  const raw = 1 / (1 + Math.exp(steepness * (ratio - midpoint)));
  // Scale to [0, 2] range so midpoint maps to ~1.0
  return raw * 2;
}
```

### Fatigue Exponential Penalty
```typescript
// Sliding window fatigue: count bot replies in recent window
// When count exceeds threshold, apply exponential suppression
function computeFatiguePenalty(
  botReplyTimestamps: number[],
  now: number,
  windowMs: number,     // e.g., 120000 (2 minutes)
  threshold: number,    // e.g., 3 replies
  penaltyBase: number,  // e.g., 0.5 (each excess reply halves probability)
): number {
  const recent = botReplyTimestamps.filter(t => now - t < windowMs);
  const excess = recent.length - threshold;
  if (excess <= 0) return 1.0; // no penalty
  return Math.pow(penaltyBase, excess); // 0.5^1=0.5, 0.5^2=0.25, etc.
}
```

### @Mention Probability Boost
```typescript
// Locked formula from CONTEXT.md
// P = base + (1 - base) * mentionBoost
// mentionBoost=1 → P=1 (guaranteed), mentionBoost=0 → P=base (no effect)
function applyMentionBoost(baseProbability: number, mentionBoost: number): number {
  return baseProbability + (1 - baseProbability) * mentionBoost;
}
```

### Linear Willingness-to-Probability Mapping
```typescript
// Linear mapping: willingness [0, max] → probability [0, 1]
// Replaces v3's threshold+amplifier approach
function willingnessToProbability(willingness: number, max: number): number {
  return Math.max(0, Math.min(1, willingness / max));
}
```

## Discretion Recommendations

### Keyword Influence: Multiplier (recommended)
**Recommendation:** Use multiplier, not additive boost.
**Rationale:** v3 used multiplier (`keywordMultiplier: 1.2`). Multiplier scales with base gain, so keywords are proportionally more impactful when base gain is higher. Additive would be a fixed bonus regardless of context. Multiplier is more natural.
**Default:** `keywordMultiplier: 1.5` (slightly higher than v3's 1.2 to compensate for removed attribute bonuses).

### Fatigue Sliding Window Defaults
**Recommendation:** `windowMs: 120000` (2 minutes), `threshold: 3` replies.
**Rationale:** In a typical group chat, 3 replies in 2 minutes is already quite active for a bot. Beyond that, suppression kicks in. This is more granular than v3's single reply cost (-35) which was a one-shot penalty.
**Penalty base:** `0.5` — each excess reply halves the probability. 4th reply in window: 50%, 5th: 25%, 6th: 12.5%.

### Sigmoid Curve Parameters
**Recommendation:** `midpoint: 0.5`, `steepness: 10`.
**Rationale:** Midpoint at 50% of max willingness means the gain multiplier transitions from amplification to diminishment at the halfway point. Steepness of 10 gives a smooth but decisive transition (not too gradual, not a step function). The sigmoid output scaled to [0, 2] means: at 0% willingness, gain multiplier ≈ 2.0 (strong ramp-up); at 50%, ≈ 1.0 (neutral); at 100%, ≈ 0.0 (near-zero gain).

### Exponential Penalty Curve
**Recommendation:** `penaltyBase: 0.5` (each excess reply halves probability).
**Rationale:** Exponential with base 0.5 is aggressive enough to prevent spam (3 excess = 12.5% of original probability) but recoverable as the window slides. More aggressive than linear, less aggressive than `0.3^n`.

## State of the Art

| Old Approach (v3) | New Approach (v4) | Why Changed |
|---|---|---|
| Three-tier heat (hot/warm/cold) | Four-tier (boiling/hot/warm/cold) | Finer granularity for rapid-fire conversations |
| Three-segment piecewise S-curve | Smooth sigmoid | Simpler, no discontinuities, easier to tune |
| Reply cost (-35 per reply) + S-curve negative zone | Fatigue mechanism (sliding window + exponential penalty) | Unified concept, more intuitive, time-aware |
| Fixed attribute bonuses (+100 @mention, +15 quote, +40 DM) | Probability boost formula for @mention only | Simpler, configurable, no magic numbers |
| Threshold + amplifier probability conversion | Linear mapping willingness→probability | Simpler, more predictable |
| LLM judge for ambiguous zone | Pure algorithm | Cost reduction, latency reduction, deterministic |
| 600s half-life default | 300s half-life default | Bot cools faster, more natural |
| Substring keyword matching | Regex keyword matching | More powerful, supports patterns |

## Integration Points

### Current v1 Integration (to be replaced)
```
EventListener → horizon/percept event → AgentCore.gateAndEnqueue()
  → WillingnessCalculator.shouldReply(percept, config, modelService)
  → if allowed: enqueue → ThinkActLoop.run()
  → WillingnessCalculator.recordReply(channelKey)
```

### Target v4 Integration
```
EventListener → horizon/percept event → AgentCore.gateAndEnqueue()
  → WillingnessEngine.processMessage(channelKey, triggerType, content)
  → returns { probability, shouldReply }
  → if mention: apply mentionBoost to probability
  → if shouldReply: enqueue → ThinkActLoop.run()
  → WillingnessEngine.recordBotReply(channelKey)
```

### Key Differences
1. No `modelService` dependency (LLM judge removed)
2. `shouldReply` is synchronous (no async LLM call)
3. Engine needs to be notified of ALL messages (not just ones that pass gating) for heat detection
4. Engine needs `recordBotReply` called after successful reply for fatigue tracking
5. Config comes from dedicated `WillingnessConfig`, not flat fields on `AgentCoreConfig`

### Files That Must Change
| File | Change |
|------|--------|
| `plugins/core/src/services/agent/willingness.ts` | Complete rewrite — new `WillingnessEngine` |
| `plugins/core/src/services/agent/config.ts` | Remove old willingness fields, add `WillingnessConfig` reference |
| `plugins/core/src/services/agent/service.ts` | Update `AgentCore` to use new engine, pass new config |
| `plugins/core/src/services/agent/index.ts` | Update exports |
| `plugins/core/src/index.ts` | Replace flat willingness Schema fields with nested group, update `Config` interface |
| NEW: `plugins/core/src/services/agent/willingness-config.ts` | `WillingnessConfig` interface + Koishi Schema |

## Open Questions

1. **Reply cost: remove entirely or keep minimal?**
   - CONTEXT.md says "removed or greatly reduced"
   - Recommendation: Remove entirely. Fatigue mechanism is the replacement. A small reply cost would be redundant and harder to tune.
   - If needed later, easy to add back as a config field.

2. **Should `processMessage` update `lastMessageAt` for bot's own messages too?**
   - Heat detection should track ALL channel activity (user + bot) for accurate silence measurement.
   - Recommendation: Yes, update `lastMessageAt` on bot messages too. The `after-send` event in `EventListener` already records bot messages — the engine should also be notified.

## Sources

### Primary (HIGH confidence)
- `references/YesImBot-v3/packages/core/src/agent/willing.ts` — v3 WillingnessManager with decay, heat, S-curve, reply cost
- `references/YesImBot-v3/packages/core/src/agent/config.ts` — v3 WillingnessConfig with all parameters
- `references/YesImBot-dev/packages/core/src/agent/willing.ts` — v3-dev version (identical algorithm to v3)
- `plugins/core/src/services/agent/willingness.ts` — current v1 WillingnessCalculator to be replaced
- `plugins/core/src/services/agent/service.ts` — current AgentCore integration point
- `plugins/core/src/index.ts` — current root Config and Schema
- `.planning/phases/10-willingness-system-migration/10-CONTEXT.md` — locked decisions

### Secondary (MEDIUM confidence)
- Koishi Schema API patterns observed in codebase (`Schema.object`, `Schema.number`, `Schema.intersect`)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no external deps, pure TypeScript math
- Architecture: HIGH — clear v3 reference, clear v4 integration points, well-understood patterns
- Pitfalls: HIGH — derived from actual v3 code analysis and known mathematical properties
- Discretion recommendations: MEDIUM — reasonable defaults but may need tuning in practice

**Research date:** 2026-02-20
**Valid until:** 2026-03-20 (stable domain, no external dependency changes expected)
