---
phase: 25-optimization
verified: 2026-02-26T00:00:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
gaps: []
human_verification:
  - test: "Anthropic cache hit/miss in live call"
    expected: "Debug log shows write=N read=N with non-zero values on second call with same stable block"
    why_human: "Requires live Anthropic API key and two sequential calls to observe cache read tokens"
---

# Phase 25: Optimization Verification Report

**Phase Goal:** The agent's working memory is temporally coherent and the system prompt is cached at the provider level to reduce token costs
**Verified:** 2026-02-26T00:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | History messages use XML format `<msg id="N" sender="name" senderId="uid">content</msg>` | VERIFIED | `service.ts:270` — `return \`<msg ${attrs}>${obs.content}</msg>\`` |
| 2 | Working memory entries include `triggered by #N` linking to preceding message short ID | VERIFIED | `loop.ts:161` — `triggerLabel = \` (triggered by #${shortId})\`` |
| 3 | `send_message` entries show `send_message({}) -> sent, ok` without content param | VERIFIED | `loop.ts:174` — `lines.push("  - send_message({}) -> sent, ok")` |
| 4 | Short-ID map lives in HorizonService, assigns 1-999 cycling integers per channel | VERIFIED | `service.ts:213-235` — `assignShortId()` with `% 999 + 1` cycling, bounded at 100 entries |
| 5 | On Anthropic providers, system prompt is `SystemModelMessage[]` with `cacheControl` on stable block | VERIFIED | `loop.ts:129-142` — `providerType === "anthropic"` branch builds `SystemModelMessage[]` with `providerOptions.anthropic.cacheControl.type = "ephemeral"` |
| 6 | On non-Anthropic providers, system prompt falls back to plain string concatenation | VERIFIED | `loop.ts:143-145` — `else { systemParam = systemPromptString; }` |
| 7 | Provider detection uses `IModelProvider.providerType` field, not model ID inference | VERIFIED | `loop.ts:124-126` — `modelService.getProvider(...).providerType`; `provider-anthropic/index.ts:73` — `readonly providerType = "anthropic"` |
| 8 | Cache hit/miss logged at debug level when `cacheWriteTokens` or `cacheReadTokens` > 0 | VERIFIED | `service.ts:170-176` — reads `inputTokenDetails.cacheWriteTokens/cacheReadTokens`, logs when either > 0 |
| 9 | System prompt sections ordered stable-first (soul+instructions) then dynamic (memory+extra) | VERIFIED | `loop.ts:114-121` — filter by name `soul\|instructions` then `memory\|extra` |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `core/src/services/horizon/service.ts` | Short-ID map + XML formatObservation | VERIFIED | `assignShortId()`, `getShortId()`, XML branch in `formatObservation()`, `channelKey` derivation in `formatHorizonText()` |
| `core/src/services/horizon/types.ts` | `replyTo?: string` on `MessageObservation` | VERIFIED | Line 121 — `replyTo?: string` present |
| `core/src/services/horizon/manager.ts` | `replyTo` passthrough in `toObservations()` | VERIFIED | Line 86 — `...(entry.data.replyTo !== undefined && { replyTo: entry.data.replyTo })` |
| `core/src/services/agent/loop.ts` | `render()` call, stable/dynamic split, triggered-by, send_message trimming | VERIFIED | Lines 113-189 — all four behaviors present |
| `core/src/services/model/service.ts` | Cache token logging after `generateText()` | VERIFIED | Lines 169-176 — reads `inputTokenDetails`, logs when non-zero |
| `providers/provider-anthropic/src/index.ts` | `AnthropicProvider` with `providerType = "anthropic"` | VERIFIED | Line 73 — `readonly providerType = "anthropic"` |
| `providers/provider-anthropic/package.json` | Package config with `@ai-sdk/anthropic` dependency | VERIFIED | `@ai-sdk/anthropic: ^3.0.47` present |
| `providers/provider-anthropic/tsconfig.json` | TypeScript config mirroring provider-openai | VERIFIED | Extends `../../tsconfig.base.json`, references `shared-model` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `loop.ts` | `prompt.render()` | `Section[]` return | WIRED | `loop.ts:113` calls `prompt.render("system", ...)`, result split by section name |
| `loop.ts` | `modelService.getProvider()` | `providerType` field | WIRED | `loop.ts:124-126` — provider name extracted from `this.config.model`, `providerType` read |
| `loop.ts` | `SystemModelMessage[]` | Anthropic branch | WIRED | `loop.ts:129-142` — `cacheControl: { type: "ephemeral" }` on stable block |
| `loop.ts` | `horizon.getShortId()` | triggered-by label | WIRED | `loop.ts:159` — `horizon.getShortId(channelKey, prev.messageId)` |
| `HorizonService.assignShortId()` | `formatObservation()` | `channelKey` param | WIRED | `service.ts:256` — `this.assignShortId(channelKey, obs.messageId)` |
| `formatHorizonText()` | `formatObservation()` | `channelKey` derived from `view.environment` | WIRED | `service.ts:313-317` — channelKey derived and passed as third arg |
| `manager.ts toObservations()` | `MessageObservation.replyTo` | spread passthrough | WIRED | `manager.ts:86` — conditional spread of `entry.data.replyTo` |
| `ModelService.executeCall()` | cache log | `result.usage.inputTokenDetails` | WIRED | `service.ts:170-176` — reads AI SDK normalized fields, logs when > 0 |
| `AnthropicProvider` | `ModelService.registerProvider()` | `apply()` function | WIRED | `provider-anthropic/index.ts:104-107` — `ctx["yesimbot.model"].registerProvider(config.id, provider)` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| OPT-01 | 25-02-PLAN | System prompt split into `SystemModelMessage[]` content blocks, stable part (soul+instructions) marked with cache breakpoint | SATISFIED | `loop.ts:113-145` — `render()` call, stable/dynamic split, `cacheControl: ephemeral` on stable block |
| OPT-02 | 25-02-PLAN | ModelService supports provider detection; Anthropic auto-injects `providerOptions` cache control, others fall back to string | SATISFIED | `loop.ts:124-145` — `providerType` detection; `provider-anthropic/index.ts:73` — sentinel field |
| OPT-03 | 25-01-PLAN | Working memory tool entries annotated with trigger position (message ID association) | SATISFIED | `loop.ts:154-165` — backward scan for preceding message, `getShortId()` lookup, `triggered by #N` label |
| OPT-04 | 25-01-PLAN | `send_message` in working memory omits content param, retains only execution result summary | SATISFIED | `loop.ts:169-178` — `send_message({}) -> sent, ok` / `sent, failed: reason` |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | No anti-patterns found |

No TODOs, FIXMEs, placeholders, empty implementations, or console.log statements in any modified production file. Test fixtures in `json-parser.test.ts` contain `console.log` inside string literals (test data), not production code.

### Human Verification Required

#### 1. Anthropic Cache Hit Observable in Live Call

**Test:** Configure provider-anthropic with a real API key, send two sequential messages to the same channel, observe debug logs
**Expected:** Second call shows `cache provider=anthropic model=... write=0 read=N` with non-zero `read` value, confirming the stable block was served from cache
**Why human:** Requires live Anthropic API credentials and a running Koishi instance; cache read tokens only appear on the second call after the first populates the cache

### Gaps Summary

No gaps. All 9 observable truths verified against actual code. Both TypeScript compilations pass cleanly (`core` and `provider-anthropic`). All 4 requirement IDs (OPT-01 through OPT-04) are satisfied with direct code evidence. All key wiring links confirmed present and connected.

---

_Verified: 2026-02-26T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
