# Phase 10: Willingness System Migration - Context

**Gathered:** 2026-02-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the v1 willingness skeleton with the full v3-derived decay + heat + sigmoid algorithm. Per-channel willingness state, configurable parameters, pure algorithmic decision (no LLM judge). The v1 LLM-based WillingnessCalculator is removed; a new algorithm-driven calculator takes its place.

</domain>

<decisions>
## Implementation Decisions

### Decay & Heat Detection
- Default half-life: 300s (5 minutes), down from v3's 600s — bot cools faster
- Four-tier heat detection (new vs v3's three-tier):
  - Boiling (≤5s): ~90% decay reduction
  - Hot (≤15s): ~70% decay reduction
  - Warm (≤60s): ~30% decay reduction
  - Cold (>60s): normal decay
- Elastic decay preserved from v3: when willingness exceeds threshold, decay strength halved
- Willingness state is per-channel isolated — channels do not affect each other

### Fatigue Mechanism (new, not in v3)
- Sliding window counts bot's own messages in recent time period
- When count exceeds threshold, reply probability suppressed with exponential penalty
- The more messages sent beyond threshold, the stronger the suppression
- Replaces v3's S-curve negative feedback zone and reply cost deduction

### Gain & Keyword System
- Remove fixed attribute bonuses (@mention +100, quote +15, DM +40) from v3
- @mention uses probability boost formula: `P = base + (1 - base) * mentionBoost`
  - When mentionBoost config = 1.0, guarantees reply (P=1)
  - When mentionBoost config = 0, no effect (P=base)
- Keywords matched via regex (not substring)
- Base text message gain retained from v3

### S-Curve & Reply Decision
- Replace v3's three-segment piecewise function with smooth sigmoid curve
- No negative feedback zone in sigmoid — fatigue mechanism handles over-activity instead
- Reply cost (v3's -35 per reply) removed or greatly reduced — fatigue mechanism is the cooldown
- Willingness-to-probability conversion: linear mapping (not v3's threshold+amplifier)

### LLM Judge
- Remove LLM willingness judgment for now — pure algorithmic decision
- May add back later as optional fallback if algorithm proves too aggressive/passive

### Claude's Discretion
- Keyword influence method (multiplier vs additive boost)
- Fatigue sliding window duration and message count threshold defaults
- Sigmoid curve parameters (midpoint, steepness)
- Exact exponential penalty curve for fatigue

</decisions>

<specifics>
## Specific Ideas

- Fatigue mechanism is a deliberate departure from v3 — replaces both S-curve negative feedback and reply cost with a single unified concept
- The `P = base + (1 - base) * mentionBoost` formula ensures @mention boost is always relative to base probability and configurable up to guaranteed reply
- Per-channel isolation means bot can be active in one group while quiet in another

</specifics>

<deferred>
## Deferred Ideas

- LLM judge as optional fallback — revisit after testing pure algorithm behavior
- Cross-channel willingness influence (e.g., global fatigue) — future consideration

</deferred>

### Configuration Structure
- Nested sub-groups: `willingness.decay`, `willingness.gain`, `willingness.fatigue`, etc.
- Only core parameters exposed to user (not all ~15 from v3)
- No preset templates — users adjust core knobs directly

---

*Phase: 10-willingness-system-migration*
*Context gathered: 2026-02-20*
