---
phase: 10-willingness-system-migration
verified: 2026-02-20T00:00:00Z
status: passed
score: 12/12 must-haves verified
gaps: []
---

# Phase 10: Willingness System Migration Verification Report

**Phase Goal:** Replace the v1 willingness skeleton with the full v3-derived algorithmic willingness system (decay + heat + sigmoid + fatigue)
**Verified:** 2026-02-20
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Willingness decays exponentially per-second with configurable half-life (default 300s) | VERIFIED | `baseFactor = Math.pow(0.5, 1 / config.decay.halfLife)` in constructor; `tick()` multiplies each channel's willingness by factor every 1s via `ctx.setInterval` |
| 2 | Four-tier heat detection (boiling/hot/warm/cold) reduces decay based on channel activity | VERIFIED | `computeDecayFactor` applies tiered silence thresholds: ≤5s → 10% decay rate, ≤15s → 30%, ≤60s → 70%, >60s → 100% |
| 3 | Sigmoid gain multiplier amplifies willingness gain at low values, diminishes at high values | VERIFIED | `sigmoidGainMultiplier` uses `1 / (1 + exp(steepness * (ratio - midpoint))) * 2` — smooth inverted sigmoid scaled to [0,2] |
| 4 | Fatigue mechanism suppresses reply probability when bot sends too many messages in sliding window | VERIFIED | `computeFatiguePenalty` prunes timestamps to window, computes `penaltyBase^excess`; `recordBotReply` pushes timestamps; pruning also runs in `tick()` |
| 5 | Keywords matched via regex boost willingness gain with multiplier | VERIFIED | Regex matching works with pre-compiled `keywordRegexes` array cached in constructor; multiplier applied via `config.gain.keywordMultiplier` |
| 6 | Linear willingness-to-probability mapping, @mention probability boost formula | VERIFIED | `probability = state.willingness / config.maxWillingness`; mention boost: `base + (1 - base) * mentionBoost` — exact locked formula |
| 7 | AgentCore creates WillingnessEngine on start and runs decay timer via ctx.setInterval | VERIFIED | `service.ts` line 29-37: `new WillingnessEngine(...)` in `start()`, `this.ctx.setInterval(() => this.willingness.tick(), 1000)` |
| 8 | Every incoming percept updates willingness state for accurate heat detection | VERIFIED | `gateAndEnqueue` calls `processMessage` on every percept before gating decision |
| 9 | After successful reply, AgentCore calls engine.recordBotReply for fatigue tracking | VERIFIED | `runLoop` calls `this.willingness.recordBotReply(channelKey)` after `this.loop.run(percept, this.config)` succeeds |
| 10 | Old willingness config fields removed from AgentCoreConfig and root Config | VERIFIED | No references to `willingnessModel`, `willingnessRejectThreshold`, `willingnessAcceptThreshold`, `willingCooldownMessages`, `willingCooldownMs`, `willingSoftDecayMs` anywhere in `plugins/core/src/` |
| 11 | New nested willingness Schema group appears in root Config | VERIFIED | `index.ts` line 54: `willingness: WillingnessSchema` in `Schema.object`; `WillingnessSchema` uses `Schema.intersect` with labeled sub-groups |
| 12 | processMessage is synchronous — no async LLM call in gating path | VERIFIED | `processMessage` returns `{ probability, shouldReply }` directly; no `await`, no LLM imports in `willingness.ts` |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `plugins/core/src/services/agent/willingness-config.ts` | WillingnessConfig interface and Koishi Schema with nested groups | VERIFIED | Exports `WillingnessConfig` interface and `WillingnessSchema` via `Schema.intersect` with 5 labeled sub-groups |
| `plugins/core/src/services/agent/willingness.ts` | WillingnessEngine class with per-channel state, decay timer, all algorithms | VERIFIED | Exports `WillingnessEngine` with `tick()`, `processMessage()`, `recordBotReply()`; all 4 helper functions present; keyword regexes pre-compiled in constructor |
| `plugins/core/src/services/agent/config.ts` | AgentCoreConfig with willingness field referencing WillingnessConfig | VERIFIED | `willingness?: WillingnessConfig` present; all old fields absent |
| `plugins/core/src/services/agent/service.ts` | AgentCore using WillingnessEngine | VERIFIED | Imports and instantiates `WillingnessEngine`; wired in `start()`, `gateAndEnqueue()`, `runLoop()` |
| `plugins/core/src/services/agent/index.ts` | Updated exports | VERIFIED | Exports `WillingnessEngine` and `WillingnessConfig` |
| `plugins/core/src/index.ts` | Root Config with nested willingness Schema | VERIFIED | `WillingnessSchema` imported and used in `Schema.object`; `config.willingness` passed to `AgentCore` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `willingness.ts` | `willingness-config.ts` | `import WillingnessConfig` | WIRED | Line 2: `import type { WillingnessConfig } from "./willingness-config"` |
| `service.ts` | `willingness.ts` | `new WillingnessEngine(config.willingness)` | WIRED | Line 29: `new WillingnessEngine(this.config.willingness ?? {...})` in `start()` |
| `service.ts` | `willingness.ts` | `engine.processMessage in gateAndEnqueue` | WIRED | Line 51: `this.willingness.processMessage(channelKey, up.triggerType, up.payload?.content ?? "")` |
| `index.ts` | `willingness-config.ts` | `WillingnessSchema in root Schema` | WIRED | Line 4 import + line 54 usage: `willingness: WillingnessSchema` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| WILLING-01 | 10-01, 10-02 | 意愿值衰减 — 指数衰减算法，支持半衰期配置，对话热度检测 | SATISFIED | `computeDecayFactor` with `baseFactor = Math.pow(0.5, 1/halfLife)` and four-tier silence thresholds |
| WILLING-02 | 10-01, 10-02 | S 曲线增益 — activation → saturation → negative feedback | SATISFIED | `sigmoidGainMultiplier` uses smooth sigmoid formula scaled to [0,2]; no piecewise approximation |
| WILLING-03 | 10-01, 10-02 | 回复成本与关键词兴趣 — 回复后意愿值扣减，关键词匹配提升兴趣乘数 | SATISFIED | `recordBotReply` + `computeFatiguePenalty` for reply cost; keyword regex matching with `keywordMultiplier` |

### Anti-Patterns Found

None.

### Human Verification Required

None — all behaviors are verifiable programmatically.

### Gaps Summary

No gaps found. All 12/12 must-haves verified. The keyword regex pre-compilation gap identified in initial verification was fixed in commit `38eba3b`.

---

_Verified: 2026-02-20_
_Verifier: Kiro (gsd-verifier)_
