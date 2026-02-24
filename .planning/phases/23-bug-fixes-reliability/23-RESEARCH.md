# Phase 23: Bug Fixes & Reliability - Research

**Researched:** 2026-02-25
**Domain:** Template rendering, JSON parser testing, DM aggregation & rate limiting
**Confidence:** HIGH

## Summary

Phase 23 addresses four concrete, well-scoped problems. The root causes are already identified from live code inspection. No new libraries are needed for BUGFIX-01 or BUGFIX-02. WILL-01 and WILL-02 require adding new config fields and logic to `WillingnessEngine` and `AgentCore`.

The snippet rendering bug (BUGFIX-01) is a clear architectural gap: `HorizonService.formatHorizonText()` calls `Mustache.render()` directly, bypassing `PromptService.buildScope()` entirely. The snippets (`date.now`, `bot.name`, etc.) are registered in `MemoryService.registerSnippets()` and only flow through `PromptService.render()` — they never reach `formatHorizonText`. The fix is to pass a pre-built scope into `formatHorizonText` rather than calling Mustache directly with a bare data object.

The JSON parser test suite (BUGFIX-02) is a straightforward port: the v3 test file at `references/YesImBot-v3/packages/core/tests/utils-json-parser.test.ts` contains exactly 18 cases using `bun:test`. These must be ported to vitest (the project's chosen framework per CONTEXT.md). The v4 `JsonParser` interface is compatible — same `parse()` method, same `ParseResult<T>` shape — but some log message strings differ and must be updated to match v4's actual log output.

WILL-01 and WILL-02 require extending `AgentCore` with DM-specific aggregation window logic and a token bucket rate limiter. The current code already has a group aggregation window (last-event-wins, `ctx.setTimeout`). DM needs a different strategy: adaptive timeout that resets on each new message, with a max cap. The token bucket is a pure in-memory data structure — no library needed.

**Primary recommendation:** Fix BUGFIX-01 by threading scope into `formatHorizonText`; port v3 tests to vitest for BUGFIX-02; extend `WillingnessEngine`/`AgentCore` config for WILL-01/WILL-02.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**DM 聚合窗口行为**
- 自适应超时：根据用户发送节奏动态调整等待时间，范围 3-8 秒
- 每收到新消息重置计时器，但设最大聚合上限（防止无限等待）
- 聚合后的多条消息保留多条结构传给模型，不合并为单条文本
- 模型能看到用户是分段发送的，保留对话的自然节奏感

**DM 速率限制策略**
- Token bucket 算法，允许短时突发但长期平均受控
- 全场景 per-user 限制（私聊和群聊都生效），私聊和群聊参数可独立配置
- 参数可配置，提供合理默认值（桶容量、补充速率由研究阶段确定）
- 触发限制后静默忽略，不回复也不提示

**Snippet 渲染修复范围**
- 修复现有变量（`{{date.now}}`、`{{bot.name}}` 等）的渲染 bug，同时补充新的模板变量
- 重新设计 renderFn 的 `currentScope` 上下文参数结构：采用嵌套对象（`{ bot: { name }, date: { now }, percept: { ... } }`），模板中用点号路径访问
- 变量不可用时保留原始模板标记（如 `{{bot.name}}`），不输出空字符串
- 渲染失败时输出 debug 级别日志，方便排查哪些变量未解析

**JSON Parser 测试边界**
- 严格复刻 v3 的 18 个测试用例，不新增 v4 特有边界场景
- 从 v3 代码直接迁移测试 fixture 和数据，保证一致性
- v4 parser 接口与 v3 一致，迁移无需适配
- 解析失败的用例（截断字符串、悬垂键等）期望容错返回 null，不抛异常

### Claude's Discretion
- 自适应超时的具体算法（节奏检测逻辑）
- 最大聚合上限的具体数值
- Token bucket 的默认参数（桶容量、补充速率）
- currentScope 中具体包含哪些新变量（基于 Percept 字段分析）

### Deferred Ideas (OUT OF SCOPE)
- "正在输入"状态检测：某些平台暴露单聊用户输入状态，可用于精确控制聚合窗口的回复时机
- 异常中断提醒：速率限制、LLM 输出格式错误、工具调用失败等导致循环中断时，发消息提醒用户
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BUGFIX-01 | Snippet variables (`{{date.now}}`, `{{bot.name}}` etc.) render correctly in horizon-view — no empty strings | Root cause identified: `formatHorizonText` bypasses `PromptService.buildScope()`. Fix: pass built scope into the method. |
| BUGFIX-02 | JSON Parser has complete vitest test suite covering v3's 18 cases | v3 test file located at `references/YesImBot-v3/packages/core/tests/utils-json-parser.test.ts`. Port from `bun:test` to vitest. |
| WILL-01 | DM gets high reply probability (`directBoost`) + longer aggregation window waiting for user to finish | Extend `WillingnessConfig` with `directBoost` field; add DM-specific adaptive aggregation window in `AgentCore.handleEvent`. |
| WILL-02 | DM replies have per-user rate limiting to prevent cost explosion | Add `TokenBucket` class to `willingness.ts`; add `rateLimit` config block to `WillingnessConfig`; check in `handleEvent` before enqueue. |
</phase_requirements>

---

## Standard Stack

### Core (no new dependencies needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | to be installed | Test runner for BUGFIX-02 | Project decision per CONTEXT.md; turbo `test` task already wired |
| mustache | ^4.2.0 (already installed) | Template rendering | Already in use |
| jsonrepair | ^3.13.2 (already installed) | JSON repair in parser | Already in use |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @vitest/coverage-v8 | latest | Coverage reporting | Optional, add if 80% coverage gate needed |

**Installation (vitest only):**
```bash
yarn workspace koishi-plugin-yesimbot add -D vitest
```

No other new dependencies. Token bucket is a pure in-memory algorithm (~20 lines). Mustache scope threading requires no new packages.

---

## Architecture Patterns

### BUGFIX-01: Snippet Rendering Root Cause

The bug is in `HorizonService.formatHorizonText()` at `/home/workspace/Athena/core/src/services/horizon/service.ts:274`:

```typescript
// CURRENT (broken) — scope has no date.now, bot.name, etc.
return Mustache.render(this.horizonViewTpl, {
  environment,
  activeMembers,
  hasHistory: historyObs.length > 0,
  history: historyObs,
  // ...
}).trim();
```

The snippets are registered in `MemoryService.registerSnippets()` and resolved only inside `PromptService.buildScope()`. `formatHorizonText` never calls `buildScope`, so `{{date.now}}` renders as empty string.

**Fix pattern:** `formatHorizonText` must accept a pre-built scope (or build it inline) that includes the nested structure the CONTEXT.md requires:

```typescript
// Target scope structure (nested objects, dot-path access in templates)
const scope = {
  date: { now: fmt.format(new Date()) },
  bot: { name: view.self.name, id: view.self.id },
  percept: { /* from Percept if available */ },
  environment,
  activeMembers,
  hasHistory: historyObs.length > 0,
  history: historyObs,
  // ...
}
```

**Mustache dot-path access:** Mustache natively supports `{{date.now}}` as nested object access when the scope contains `{ date: { now: "..." } }`. This is standard Mustache behavior — no changes to the template syntax needed.

**Preserve-on-missing behavior:** Mustache renders missing variables as empty string by default. To preserve the original tag (e.g., `{{bot.name}}` stays as-is when unavailable), the renderer must use a custom escape or a pre-pass that detects unresolved variables. The simplest approach: check if the rendered output contains the original tag text — if so, log at debug level. Alternatively, populate the scope with the original tag string as fallback value.

The cleanest implementation: `formatHorizonText` receives `view: HorizonView` (already has `self.name`, `self.id`, `environment`) and builds the full scope inline. No need to thread `PromptService` into `HorizonService`.

**Where `formatHorizonText` is called:**
- `loop.ts:126` — `horizon.formatHorizonText(view, wmLines)` — has access to `percept` and `toolCtx`
- `service.ts:256` — `horizon.formatHorizonText(view)` — deferred judgment path, no percept

The method signature should be extended to accept an optional `percept` parameter for the `percept.*` variables.

### BUGFIX-02: Vitest Test Suite Structure

The v3 test file has 18 test cases across two `describe` blocks:

**`describe("ParseResult")` — 6 cases** (agent response format):
1. Perfect JSON object
2. Code block extraction
3. Nested code block (JS inside JSON)
4. Nested JSON code block + `[OBSERVE]` prefix
5. Complex format (long thoughts + embedded code block)
6. Unbalanced markdown code block

**`describe("JsonParser")` — 12 cases** across 3 sub-describes:
- `describe("基本解析")` — 3 cases: formatted object, array, empty object/array
- `describe("处理 LLM 特有的脏数据")` — 6 cases: markdown block, no-lang block, preamble discard, postamble trim, both, JSON-inside-string
- `describe("JSON 语法修复能力")` — 3 cases: missing brace, missing bracket, nested unclosed
- `describe("边界情况和失败用例")` — 4 cases (but one is commented out): no JSON, empty input, string result, number result, incomplete JSON

**Key adaptation from bun:test to vitest:**
- Replace `import { describe, it, expect } from "bun:test"` with `import { describe, it, expect } from "vitest"`
- `expect(result.logs).toContainValue(...)` — this is a bun-specific matcher. Vitest uses `expect(result.logs).toContain(...)` for arrays
- Log message strings in v4 differ from v3 (v4 uses English, v3 uses Chinese). Tests that assert specific log strings must use v4's actual log output

**v4 log strings to verify** (from `json-parser.ts`):
- `"Start parsing, input length: N"`
- `"Extracted from code block, length: N"`
- `"Found JSON start at index N, discarding N leading chars"`
- `"Balanced structure, trimming trailing text"`
- `"No JSON start symbol found, will attempt repair on full string"`
- `"Parse completed successfully"`
- `"Final parse failed: ..."`

The v3 tests that assert Chinese log strings must be updated to match v4's English strings, or the log assertions can be dropped for cases where the behavior (not the log) is what matters.

**Test file location:** `/home/workspace/Athena/core/src/services/agent/__tests__/json-parser.test.ts`

### WILL-01: DM Adaptive Aggregation Window

Current group aggregation in `AgentCore.handleEvent()` (line 143-155):
```typescript
// Group: aggregation window — last event wins
const existing = this.pendingWindows.get(channelKey);
if (existing) existing.cancel();
const cancel = this.ctx.setTimeout(() => { ... }, this.config.aggregationWindow ?? 1500);
this.pendingWindows.set(channelKey, { cancel, lastEvent: event });
```

DM path (line 134-141) currently bypasses aggregation entirely — it enqueues immediately.

**Required DM behavior:**
- Adaptive timeout: 3-8 seconds, resets on each new message
- Max aggregation cap: prevents infinite waiting if user keeps typing
- Multi-message structure preserved (not merged)
- `directBoost`: probability boost for DM trigger type

**Adaptive timeout algorithm (Claude's discretion):**
Track inter-message interval for the user. If messages arrive quickly (< 2s apart), use shorter timeout (3s). If messages arrive slowly (> 4s apart), use longer timeout (8s). Simple linear interpolation between min/max based on last interval.

```typescript
// Adaptive timeout: clamp(lastInterval * 1.5, minMs, maxMs)
const lastInterval = now - lastDmTimestamp.get(userKey);
const adaptiveTimeout = Math.min(Math.max(lastInterval * 1.5, dmMinMs), dmMaxMs);
```

**Max aggregation cap (Claude's discretion):** 15 seconds. If the first message arrived more than 15 seconds ago and the timer keeps resetting, fire anyway.

**Config additions to `WillingnessConfig`:**
```typescript
dm?: {
  directBoost: number;       // default: 0.95 — high probability for DMs
  aggregationMinMs: number;  // default: 3000
  aggregationMaxMs: number;  // default: 8000
  aggregationCapMs: number;  // default: 15000 — max wait before forced fire
}
```

**Multi-message structure:** The current `buildPercept` captures only the triggering event. For DM aggregation, the percept should reflect the latest event (last message wins for content), but the horizon view will naturally show all messages since it queries the timeline. No special multi-message bundling needed — the timeline already has all messages.

### WILL-02: Token Bucket Rate Limiter

Token bucket is a standard algorithm. No library needed.

```typescript
interface BucketState {
  tokens: number;
  lastRefill: number;
}

class TokenBucket {
  private buckets = new Map<string, BucketState>();

  constructor(
    private capacity: number,      // max tokens (burst size)
    private refillRate: number,    // tokens per second
  ) {}

  consume(key: string): boolean {
    const now = Date.now();
    const state = this.buckets.get(key) ?? { tokens: this.capacity, lastRefill: now };

    // Refill based on elapsed time
    const elapsed = (now - state.lastRefill) / 1000;
    const refilled = Math.min(this.capacity, state.tokens + elapsed * this.refillRate);

    if (refilled < 1) {
      this.buckets.set(key, { tokens: refilled, lastRefill: now });
      return false; // rate limited
    }

    this.buckets.set(key, { tokens: refilled - 1, lastRefill: now });
    return true; // allowed
  }
}
```

**Default parameters (Claude's discretion):**
- DM bucket: capacity=5, refillRate=0.5/s (1 token per 2 seconds long-term average, burst of 5)
- Group bucket: capacity=10, refillRate=1/s (1 per second average, burst of 10)
- Rationale: DM is more expensive (1:1 conversation), group has natural throttling from willingness

**Config additions:**
```typescript
rateLimit?: {
  dm?: { capacity: number; refillRate: number };    // per-user DM bucket
  group?: { capacity: number; refillRate: number };  // per-user group bucket
}
```

**Integration point:** Check bucket in `handleEvent` before `enqueue`, using `userId` (from `event.payload.senderId`) as the bucket key. Silent ignore on rate limit (no reply, no log at info level — debug only).

### Anti-Patterns to Avoid

- **Merging DM messages into single string:** CONTEXT.md explicitly says preserve multi-message structure. Don't concatenate.
- **Calling `PromptService.render()` from `formatHorizonText`:** Creates circular dependency (HorizonService → PromptService → HorizonService via injection). Build scope inline instead.
- **Using `console.log` in any new code:** Project rules prohibit it. Use `ctx.logger` or the existing `this.logger`.
- **Mutating `WillingnessConfig` objects:** Follow immutability rules — spread for updates.
- **Asserting v3 Chinese log strings in v4 tests:** v4 parser logs in English. Update assertions.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON repair | Custom repair logic | `jsonrepair` (already installed) | Handles 95%+ of LLM output corruption |
| Template rendering | Custom variable substitution | `mustache` (already installed) | Handles nested paths, sections, partials |
| Test runner | Custom test harness | `vitest` | Turbo `test` task already wired; consistent with project |

**Key insight:** All four requirements are fixes/extensions to existing code. No new architectural components needed.

---

## Common Pitfalls

### Pitfall 1: Mustache Missing Variable Behavior
**What goes wrong:** Mustache renders `{{bot.name}}` as empty string when `scope.bot` is undefined. The CONTEXT.md requirement is to preserve the original tag text, not output empty string.
**Why it happens:** Mustache's default behavior for missing values is empty string.
**How to avoid:** Two options: (a) populate scope with fallback values that are the original tag string (e.g., `bot: { name: scope.bot?.name ?? "{{bot.name}}" }`), or (b) post-render: scan for unresolved `{{...}}` patterns and log at debug. Option (a) is simpler and more reliable.
**Warning signs:** Empty strings in rendered horizon-view output where variable names should appear.

### Pitfall 2: vitest `toContain` vs bun `toContainValue`
**What goes wrong:** `expect(array).toContainValue(x)` is a bun-specific matcher. vitest uses `expect(array).toContain(x)` for primitive values in arrays.
**Why it happens:** Different test framework APIs.
**How to avoid:** Replace all `toContainValue` with `toContain` when porting.
**Warning signs:** TypeScript errors or runtime failures on log assertion tests.

### Pitfall 3: DM Aggregation Cap Race Condition
**What goes wrong:** If the cap timer fires while the reset timer is also pending, two enqueue calls could happen for the same channel.
**Why it happens:** Two concurrent timers (adaptive reset + cap) both calling `enqueue`.
**How to avoid:** Use a single timer reference per channel key. When the cap fires, cancel the reset timer. Use a generation counter (already used in `deferredGen`) to discard stale callbacks.
**Warning signs:** Duplicate agent responses to a single DM conversation.

### Pitfall 4: Token Bucket Key Collision
**What goes wrong:** Using `channelKey` (platform:channelId) as bucket key for DMs means all users in a DM share one bucket. In DMs, `channelId` is often the user's ID, but this varies by platform.
**Why it happens:** DM channel IDs are platform-specific.
**How to avoid:** Use `senderId` (from `event.payload.senderId`) as the bucket key for per-user rate limiting. This is platform-agnostic.
**Warning signs:** One user's rate limit affecting another user's DM.

### Pitfall 5: `formatHorizonText` Called Without Session Context
**What goes wrong:** The deferred judgment path calls `horizon.formatHorizonText(view)` without a percept, so `percept.*` variables would be unavailable.
**Why it happens:** Two call sites with different available context.
**How to avoid:** Make `percept` optional in the scope. When absent, `percept.*` variables fall back to their tag text (per pitfall 1 mitigation). This is acceptable — deferred judgment doesn't need sender info.
**Warning signs:** TypeScript errors if percept is made required.

---

## Code Examples

### BUGFIX-01: Scope Construction Pattern

```typescript
// In HorizonService.formatHorizonText — build scope inline
formatHorizonText(view: HorizonView, workingMemory?: string[], percept?: Percept): string {
  this.horizonViewTpl ??= this.ctx["yesimbot.prompt"].loadPartial("horizon-view");

  const fmt = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "long", day: "numeric",
    weekday: "long", hour: "numeric", minute: "2-digit", hour12: true,
  });

  const scope = {
    // Snippet variables — nested objects for dot-path access
    date: { now: fmt.format(new Date()) },
    bot: {
      name: view.self.name || "{{bot.name}}",  // fallback preserves tag
      id: view.self.id || "{{bot.id}}",
    },
    sender: {
      name: (percept?.metadata?.senderName as string) || "{{sender.name}}",
      id: (percept?.metadata?.senderId as string) || "{{sender.id}}",
    },
    channel: {
      name: view.environment?.name || "{{channel.name}}",
      platform: (view.environment?.metadata?.platform as string) || "{{channel.platform}}",
    },
    // Template data
    environment: /* ... existing logic ... */,
    activeMembers: /* ... existing logic ... */,
    hasHistory: historyObs.length > 0,
    history: historyObs,
    // ...
  };

  return Mustache.render(this.horizonViewTpl, scope).trim();
}
```

### BUGFIX-02: vitest Test File Header

```typescript
// /home/workspace/Athena/core/src/services/agent/__tests__/json-parser.test.ts
import { describe, expect, it } from "vitest";
import { JsonParser } from "../json-parser";

// Port v3 fixtures directly — interface is compatible
// Replace bun:test matchers: toContainValue → toContain
// Update log string assertions to match v4 English log messages
```

### WILL-01: DM Adaptive Aggregation Config

```typescript
// Addition to WillingnessConfig
dm?: {
  directBoost: number;       // probability boost for direct messages (0-1)
  aggregationMinMs: number;  // minimum wait after last message
  aggregationMaxMs: number;  // maximum wait after last message
  aggregationCapMs: number;  // absolute max wait from first message
};
```

### WILL-02: Token Bucket Integration in handleEvent

```typescript
// In AgentCore.handleEvent, before enqueue:
const userId = event.payload.senderId;
const isDirect = event.scope.isDirect;
const bucketKey = `${event.scope.platform}:${userId}`;

if (!this.rateLimiter.consume(bucketKey, isDirect)) {
  this.logger.debug(`[rate-limit] ${bucketKey} | silently ignored`);
  return;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| bun:test (v3) | vitest (v4) | Phase 23 | Test runner change; API nearly identical |
| Direct Mustache.render in formatHorizonText | Scope-threaded render | Phase 23 fix | Enables snippet variables in horizon-view |
| No DM aggregation (immediate enqueue) | Adaptive 3-8s window | Phase 23 | Natural DM conversation pacing |
| No rate limiting | Token bucket per-user | Phase 23 | Cost protection for DM scenarios |

---

## Open Questions

1. **vitest config file location**
   - What we know: No `vitest.config.*` exists in the repo. Turbo `test` task is wired but no test script in `core/package.json`.
   - What's unclear: Whether vitest needs a config file or can run with defaults + `--run` flag.
   - Recommendation: Add `"test": "vitest run"` to `core/package.json` scripts. Vitest auto-discovers `**/*.test.ts` files without a config file. Add `vitest.config.ts` only if path aliases or special transforms are needed.

2. **`formatHorizonText` call site in `loop.ts` — percept availability**
   - What we know: `loop.ts:126` calls `horizon.formatHorizonText(view, wmLines)` and has `percept` in scope.
   - What's unclear: Whether the method signature change (adding optional `percept`) breaks any other callers.
   - Recommendation: Make `percept` optional (`percept?: Percept`). The deferred judgment call site in `service.ts:256` passes no percept — that's fine, sender variables will fall back to tag text.

3. **DM `directBoost` interaction with existing willingness score**
   - What we know: Current `processMessage` returns a probability from willingness score. DM trigger type is `"direct"`. There's no special handling for direct messages in `WillingnessEngine`.
   - What's unclear: Should `directBoost` override the probability entirely (set to fixed high value) or add to it?
   - Recommendation: Apply `directBoost` the same way `mentionBoost` is applied — `applyMentionBoost` pattern: `probability + (1 - probability) * directBoost`. This ensures DMs always get high probability without hardcoding 1.0.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (to be installed) |
| Config file | none — auto-discovery sufficient |
| Quick run command | `yarn workspace koishi-plugin-yesimbot vitest run src/services/agent/__tests__/json-parser.test.ts` |
| Full suite command | `yarn workspace koishi-plugin-yesimbot vitest run` |
| Estimated runtime | ~2 seconds |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BUGFIX-01 | Snippet variables render with correct values | unit | `yarn workspace koishi-plugin-yesimbot vitest run src/services/horizon/__tests__/format-horizon-text.test.ts` | ❌ Wave 0 gap |
| BUGFIX-02 | JSON parser handles all 18 v3 cases | unit | `yarn workspace koishi-plugin-yesimbot vitest run src/services/agent/__tests__/json-parser.test.ts` | ❌ Wave 0 gap |
| WILL-01 | DM gets high probability + adaptive aggregation | unit | `yarn workspace koishi-plugin-yesimbot vitest run src/services/agent/__tests__/willingness.test.ts` | ❌ Wave 0 gap |
| WILL-02 | Token bucket silently drops excess DM requests | unit | `yarn workspace koishi-plugin-yesimbot vitest run src/services/agent/__tests__/token-bucket.test.ts` | ❌ Wave 0 gap |

### Nyquist Sampling Rate
- **Minimum sample interval:** After every committed task → run: `yarn workspace koishi-plugin-yesimbot vitest run`
- **Full suite trigger:** Before merging final task of any plan wave
- **Phase-complete gate:** Full suite green before `/gsd:verify-work` runs
- **Estimated feedback latency per task:** ~2 seconds

### Wave 0 Gaps (must be created before implementation)
- [ ] `core/src/services/agent/__tests__/json-parser.test.ts` — covers BUGFIX-02 (18 cases ported from v3)
- [ ] `core/src/services/horizon/__tests__/format-horizon-text.test.ts` — covers BUGFIX-01 (scope rendering)
- [ ] `core/src/services/agent/__tests__/willingness.test.ts` — covers WILL-01 (directBoost, DM aggregation)
- [ ] `core/src/services/agent/__tests__/token-bucket.test.ts` — covers WILL-02 (bucket consume/refill)
- [ ] `core/package.json` scripts — add `"test": "vitest run"` and install vitest

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `/home/workspace/Athena/core/src/services/horizon/service.ts` — `formatHorizonText` implementation
- Direct code inspection: `/home/workspace/Athena/core/src/services/memory/service.ts` — `registerSnippets` implementation
- Direct code inspection: `/home/workspace/Athena/core/src/services/agent/willingness.ts` — `WillingnessEngine` implementation
- Direct code inspection: `/home/workspace/Athena/core/src/services/agent/service.ts` — `AgentCore.handleEvent` DM path
- Direct code inspection: `/home/workspace/Athena/core/src/services/agent/json-parser.ts` — v4 parser interface
- Direct code inspection: `/home/workspace/Athena/references/YesImBot-v3/packages/core/tests/utils-json-parser.test.ts` — 18 v3 test cases
- Direct code inspection: `/home/workspace/Athena/core/resources/templates/partials/horizon-view.mustache` — template using `{{date.now}}`

### Secondary (MEDIUM confidence)
- Mustache.js documentation: nested object dot-path access (`{{a.b}}`) is standard behavior
- Token bucket algorithm: well-established CS algorithm, no external verification needed

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed; vitest is the only addition
- Architecture: HIGH — root causes confirmed by direct code inspection
- Pitfalls: HIGH — identified from actual code paths, not speculation

**Research date:** 2026-02-25
**Valid until:** 2026-03-25 (stable codebase, 30-day window)
