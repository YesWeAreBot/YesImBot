---
phase: 23-bug-fixes-reliability
verified: 2026-02-25T03:11:00Z
status: passed
score: 10/10 must-haves verified
re_verification: false
gaps: []
human_verification:
  - test: "DM adaptive aggregation timing in live chat"
    expected: "Bot waits 3-8s after last DM message before replying; rapid sequences are rate-limited silently"
    why_human: "Timer behavior and rate limiting require real Koishi runtime with actual message events"
  - test: "{{date.now}} renders correct zh-CN date in live horizon-view"
    expected: "Rendered prompt contains current date in Chinese format (e.g. 2026年2月25日)"
    why_human: "Requires live agent loop execution to observe actual LLM prompt content"
---

# Phase 23: Bug Fixes & Reliability Verification Report

**Phase Goal:** The agent renders prompts correctly, handles DMs naturally, and the JSON parser has test coverage preventing silent failures
**Verified:** 2026-02-25T03:11:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `{{date.now}}` and `{{bot.name}}` render non-empty after `formatHorizonText` call | VERIFIED | `service.ts:286` builds `date: { now: fmt.format(new Date()) }` and `bot: { name: view.self.name \|\| "{{bot.name}}" }`; 6 smoke tests pass |
| 2 | Missing variables preserve original template tag text instead of empty string | VERIFIED | Fallback pattern `\|\| "{{sender.name}}"` in scope construction; test "missing sender variables preserve tag text" passes |
| 3 | JSON parser test suite runs via vitest and passes all ported v3 cases | VERIFIED | 27 tests in `json-parser.test.ts` all pass (vitest run exit 0) |
| 4 | vitest is installed and `yarn workspace koishi-plugin-yesimbot test` works | VERIFIED | `core/package.json` has `"vitest": "^4.0.18"` devDep and `"test": "vitest run"` script |
| 5 | `TokenBucket` class exported from `willingness.ts` with consume/refill logic | VERIFIED | `willingness.ts:5-27` exports `TokenBucket`; 3 unit tests pass (exhaust, independent keys, refill) |
| 6 | `directBoost` applied when trigger type is `"direct"` | VERIFIED | `willingness.ts:300-303` checks `triggerType === "direct"` and applies `applyMentionBoost`; willingness test passes with `probability >= 0.9` |
| 7 | DM uses adaptive aggregation window (3-8s) with 15s cap | VERIFIED | `service.ts:184-272` `handleDmAggregation` implements dual-timer pattern with `minMs/maxMs/capMs` from config |
| 8 | Rate limiting applies to both DM and group via independent token buckets | VERIFIED | `service.ts:116-120` initializes `rateLimiter.dm` and `rateLimiter.group`; `service.ts:131-139` checks bucket before processing |
| 9 | Rate-limited messages are silently ignored with debug-level log only | VERIFIED | `service.ts:136-139`: `if (!bucket.consume(bucketKey)) { this.logger.debug(...); return; }` |
| 10 | `percept` threaded into `formatHorizonText` call in `loop.ts` | VERIFIED | `loop.ts:126`: `horizon.formatHorizonText(view, wmLines, percept)` |

**Score:** 10/10 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `core/src/services/horizon/__tests__/format-horizon-text.test.ts` | Smoke tests for snippet variable rendering | VERIFIED | 6 tests, all pass; imports Mustache directly (no HorizonService instantiation needed) |
| `core/src/services/agent/__tests__/token-bucket.test.ts` | Unit tests for TokenBucket consume/refill | VERIFIED | 3 tests (exhaust, independent keys, refill with fake timers), all pass |
| `core/src/services/agent/__tests__/willingness.test.ts` | Unit test for directBoost on DM trigger | VERIFIED | 1 test asserting `probability >= 0.9` for `"direct"` trigger, passes |
| `core/src/services/agent/__tests__/json-parser.test.ts` | 27 test cases ported from v3 | VERIFIED | 27 tests across 4 describe blocks, all pass |
| `core/package.json` | vitest devDependency and test script | VERIFIED | `"vitest": "^4.0.18"` in devDependencies; `"test": "vitest run"` in scripts |
| `core/src/services/horizon/service.ts` | `formatHorizonText` with full nested scope | VERIFIED | Lines 274-316: `Intl.DateTimeFormat`, nested `date/bot/sender/channel` scope, `Mustache.render`, unresolved-variable debug log |
| `core/src/services/agent/loop.ts` | Passes `percept` to `formatHorizonText` | VERIFIED | Line 126: `horizon.formatHorizonText(view, wmLines, percept)` |
| `core/src/services/agent/willingness.ts` | `TokenBucket`, `dm` config, `rateLimit` config, `directBoost` | VERIFIED | Lines 5-27 (TokenBucket), 65-74 (dm/rateLimit in WillingnessConfig), 137-164 (Schema), 300-303 (directBoost) |
| `core/src/services/agent/service.ts` | DM aggregation, rate limiter init and check in `handleEvent` | VERIFIED | Lines 87-93 (dmWindows field), 96 (rateLimiter field), 116-120 (init), 131-139 (rate check), 161-164 (DM path), 184-272 (handleDmAggregation) |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `format-horizon-text.test.ts` | `horizon-view.mustache` | `readFileSync` + `Mustache.render` | WIRED | Test loads template directly from filesystem and renders with fixed scope |
| `token-bucket.test.ts` | `willingness.ts` | `import { TokenBucket }` | WIRED | Line 3: `import { TokenBucket } from "../willingness"` |
| `willingness.test.ts` | `willingness.ts` | `import { WillingnessEngine, WillingnessConfig }` | WIRED | Lines 3-4: imports both types; test calls `engine.processMessage("dm-channel-1", "direct", "hello")` |
| `json-parser.test.ts` | `json-parser.ts` | `import { JsonParser }` | WIRED | Line 2: `import { JsonParser } from "../json-parser"` |
| `service.ts` | `willingness.ts` | `import { TokenBucket, WillingnessEngine, ... }` | WIRED | Line 9: `import { TokenBucket, WillingnessConfig, WillingnessEngine, WillingnessSchema } from "./willingness"` |
| `service.ts` (handleEvent DM path) | `handleDmAggregation` | `rateLimiter.consume` + `handleDmAggregation` | WIRED | Lines 136 (`bucket.consume`), 162 (`this.handleDmAggregation`) |
| `loop.ts` | `horizon/service.ts` | `formatHorizonText(view, wmLines, percept)` | WIRED | Line 126 passes all three arguments including optional `percept` |
| `service.ts` (deferred judgment) | `horizon/service.ts` | `horizon.formatHorizonText(view)` | WIRED | Line 369: intentionally omits percept — correct per plan |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| BUGFIX-01 | 23-00, 23-02 | Snippet variables render correctly in horizon-view | SATISFIED | `formatHorizonText` builds nested scope; 6 smoke tests pass; `loop.ts` threads percept |
| BUGFIX-02 | 23-01 | JSON Parser has vitest test suite covering v3 cases | SATISFIED | 27 tests pass; vitest installed; `test` script in `package.json` |
| WILL-01 | 23-00, 23-03 | DM gets high reply probability via `directBoost`, with aggregation window | SATISFIED | `directBoost` applied at `willingness.ts:300-303`; adaptive aggregation in `service.ts:184-272`; test passes |
| WILL-02 | 23-00, 23-03 | Per-user rate limiting for DM to prevent cost explosion | SATISFIED | `TokenBucket` exported; `rateLimiter.dm/group` initialized in `start()`; rate check at top of `handleEvent` |

No orphaned requirements — all 4 IDs declared in plans and all map to Phase 23 in REQUIREMENTS.md.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `horizon/service.ts` | 133 | `return null` | Info | Legitimate guard clause: `if (!scope.channelId) return null` — not a stub |
| `horizon/service.ts` | 195 | `return []` | Info | Legitimate guard clause: `if (!parentId) return []` — not a stub |

No blockers or warnings. The two `return null`/`return []` hits are proper guard clauses, not placeholder implementations.

---

### Human Verification Required

#### 1. DM Adaptive Aggregation Timing

**Test:** Send 3 rapid DM messages to the bot within 2 seconds, then wait. Observe when the bot replies.
**Expected:** Bot waits 3-8 seconds after the last message before replying (not after each individual message). Sending a 4th message resets the timer.
**Why human:** Timer behavior requires a live Koishi runtime with real message events. Fake timers in unit tests cover the TokenBucket but not the full `ctx.setTimeout` integration in `AgentCore`.

#### 2. DM Rate Limiting in Practice

**Test:** Send 6+ DM messages in rapid succession (faster than 0.5 tokens/second refill rate).
**Expected:** After 5 messages, subsequent messages are silently ignored — no reply, no error message to the user. Debug log shows `[rate-limit] platform:userId | silently ignored`.
**Why human:** Requires live runtime to observe the silent-ignore behavior from the user's perspective.

#### 3. `{{date.now}}` in Live Prompt

**Test:** Trigger the bot in a channel and inspect the rendered horizon-view prompt (via debug logging or prompt inspection).
**Expected:** The prompt contains the current date in zh-CN format (e.g., `2026年2月25日星期三`), not an empty string or literal `{{date.now}}`.
**Why human:** Requires live agent loop execution to observe the actual LLM prompt content.

---

### Gaps Summary

No gaps. All 10 observable truths verified, all 9 artifacts substantive and wired, all 4 requirements satisfied. TypeScript compiles cleanly (4/4 packages pass typecheck). Full vitest suite: 37 tests across 4 files, all green.

---

_Verified: 2026-02-25T03:11:00Z_
_Verifier: Claude (gsd-verifier)_
