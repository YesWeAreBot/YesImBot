# Phase 29: Runtime Bug Fixes - Research

**Researched:** 2026-02-26
**Domain:** TypeScript / Koishi plugin — agent queue, timeline recording, working memory trimming
**Confidence:** HIGH

## Summary

All three bugs are surgical, self-contained fixes in two files: `core/src/services/agent/service.ts` (REQ-01) and `core/src/services/agent/loop.ts` + `core/src/services/agent/trimmer.ts` (REQ-02, REQ-03). No new dependencies are required. The codebase is well-structured and the defect locations are unambiguous from reading the source.

REQ-01 is a classic single-slot pending-message race: `this.pending` is a `Map<string, LoopPayload>` (one slot per channel). When a second message arrives while a loop is running, it overwrites the first pending slot. The fix replaces the single slot with an array and drains all accumulated payloads into one merged percept after the in-flight loop completes.

REQ-02 is a missing guard: `recordAgentResponse` is called unconditionally in `loop.ts` even when `response.actions` is empty (LLM chose silence). The fix adds a guard before the call. Per the CONTEXT.md decision, the timeline still records the response — but the rendering path in `formatObservation` (horizon/service.ts) must render an empty-actions entry as a "chose silence" marker rather than an empty `[Bot Action]:` line.

REQ-03 is an off-by-one in `trimMessages`: `messages[0]` (the initial user context block) is permanently excluded from trimming because `eligible` indices start at `1`. The fix adds an independent trim pass for `messages[0]` with a configurable token budget, truncating from the head while preserving the tail (most recent content).

**Primary recommendation:** Fix all three in a single wave of small, targeted edits. Write unit tests for each fix before implementing (TDD). No architectural changes needed.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### 消息队列合并策略（REQ-01）
- pending 从单槽 Map 改为数组队列存储
- drain 时全部拼接，按时间顺序组织
- trigger 语义扩展：不再仅限于 status=new 的消息，而是"时间段内的消息集合"，起始点为第一条积压消息
- 积压期间 bot 自己发送的消息也纳入 trigger 作为上下文（bot 消息比积压消息新但不是未读）
- drain 后复用现有聚合窗口（短窗口），避免连续快速消息被拆成两批
- trigger 和 history 共享容量上限，超出时丢弃最早的消息
- drain 后的合并请求强制回复，跳过意愿值判定（用户已等了一轮响应时间）

#### 沉默判定与过滤逻辑（REQ-02）
- 不是"空 actions 不记录"，而是改变渲染方式
- timeline 照常记录完整的原始 response，保持 agent.response 结构不变
- 运行时渲染/展示时判断：actions 为空时渲染为"选择沉默"标记（如 "you skipped this round"），而非空的 [Bot Action]
- 在调用 recordAgentResponse 之前做守卫判断（agent 层）
- 区分「LLM 主动沉默」和「LLM 出错无输出」：主动沉默正常记录沉默标记，出错时记录错误标记到 timeline

#### 初始上下文裁剪预算（REQ-03）
- messages[0]（初始用户上下文）受独立的固定 token 上限约束
- 该上限作为可配置参数暴露给用户
- 超出时从开头截断，保留末尾（最近信息）
- 按消息边界截断，保持语义完整性（不在句子中间断开）

### Claude's Discretion
- 积压队列的具体数据结构选择（数组 vs 其他队列实现）
- 沉默标记的具体文本内容和格式
- 初始上下文 token 上限的默认值
- 错误标记的具体展示方式

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| REQ-01 | pending 单槽 Map 导致积压消息丢失且逐条触发响应。改为数组存储，处理完成后合并积压消息一次性响应。 | `this.pending` field in `service.ts` is confirmed as `Map<string, LoopPayload>` (single slot). `enqueue()` drain logic reads one slot. Fix: change to `Map<string, LoopPayload[]>`, merge on drain. |
| REQ-02 | LLM 选择沉默时 `recordAgentResponse()` 无条件调用，写入空 `[Bot Action]` 到 timeline。 | `loop.ts` line 316 calls `recordAgentResponse` unconditionally. `formatObservation` in `service.ts` line 281 renders empty-actions as `[Bot Action]: `. Fix: guard call + fix renderer. |
| REQ-03 | `trimMessages()` 对 `messages[0]` 永远不裁剪，`totalRounds = Math.floor((1-1)/2) = 0`，导致 working memory 无限增长。 | `trimmer.ts` confirmed: eligible indices start at `1`, `messages[0]` never touched. Fix: add independent head-trim pass for `messages[0]` with configurable char budget. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | (project) | Type safety | Project-wide standard |
| Koishi 4.x | (project) | Plugin framework, Service base class | All services extend `Service` |
| Vitest | (project) | Unit testing | Already configured in `core/vitest.config.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None new | — | — | All fixes use existing code only |

**Installation:** No new packages required.

## Architecture Patterns

### Relevant Project Structure
```
core/src/services/agent/
├── service.ts       # REQ-01: pending queue, enqueue(), handleEvent()
├── loop.ts          # REQ-02: recordAgentResponse() call site
├── trimmer.ts       # REQ-03: trimMessages(), TrimConfig
└── __tests__/       # Unit tests (Vitest)

core/src/services/horizon/
├── service.ts       # REQ-02: formatObservation() renderer
└── manager.ts       # recordAgentResponse() implementation
```

### Pattern 1: REQ-01 — Pending Queue Array

**What:** Replace `Map<string, LoopPayload>` with `Map<string, LoopPayload[]>`. On drain, merge all queued payloads into a single percept with a combined trigger context.

**Current code (service.ts lines 135, 237-239, 373-380):**
```typescript
// CURRENT — single slot, overwrites on burst
private pending = new Map<string, LoopPayload>();

// In handleEvent (group path):
if (this.queues.has(channelKey)) {
  this.pending.set(channelKey, stored);  // BUG: overwrites previous
} else {
  this.enqueue(channelKey, stored);
}

// In enqueue drain:
const next = this.pending.get(channelKey);
if (next) {
  this.pending.delete(channelKey);
  this.enqueue(channelKey, next);  // only one payload processed
}
```

**Fixed pattern:**
```typescript
// FIXED — array queue, accumulates all backlogged payloads
private pending = new Map<string, LoopPayload[]>();

// In handleEvent (group path):
if (this.queues.has(channelKey)) {
  const arr = this.pending.get(channelKey) ?? [];
  arr.push(stored);
  this.pending.set(channelKey, arr);
} else {
  this.enqueue(channelKey, stored);
}

// In enqueue drain:
const backlog = this.pending.get(channelKey);
if (backlog?.length) {
  this.pending.delete(channelKey);
  const merged = this.mergeBacklog(channelKey, backlog);
  this.enqueue(channelKey, merged);
}
```

**mergeBacklog:** Creates a new `LoopPayload` whose `percept` uses the first backlogged message's timestamp and a combined `metadata.content` (all messages joined). The `percept.type` stays as the first message's trigger type. The merged percept is flagged (e.g. `metadata.isBacklogDrain = true`) so the loop can skip willingness judgment.

**DM path:** Same pattern — `dmWindows` and `handleDmAggregation` also call `this.pending.set(channelKey, built)` in three places (lines 280, 295, 312, 327). All must be updated to push to array.

### Pattern 2: REQ-02 — Silence Guard + Renderer Fix

**What:** Two-part fix. (1) Guard in `loop.ts` before `recordAgentResponse`. (2) Renderer fix in `horizon/service.ts` `formatObservation`.

**Current code (loop.ts line 315-326):**
```typescript
// CURRENT — unconditional, records even when actions is empty
await horizon.events.recordAgentResponse({
  platform: percept.platform,
  channelId: percept.channelId,
  timestamp: new Date(),
  data: { round, assistantText: rawText, actions: response.actions, toolResults },
});
```

**Fixed guard (loop.ts):**
```typescript
// FIXED — only record if there are actions (LLM chose to act)
// Empty actions = LLM chose silence; still record but mark it
const isSilent = response.actions.length === 0;
await horizon.events.recordAgentResponse({
  platform: percept.platform,
  channelId: percept.channelId,
  timestamp: new Date(),
  data: { round, assistantText: rawText, actions: response.actions, toolResults },
});
// Note: per CONTEXT.md decision, we always record — fix is in the renderer
```

Per the locked decision: timeline always records. The renderer fix is in `formatObservation` (horizon/service.ts line 281):

```typescript
// CURRENT — renders empty actions as "[Bot Action]: "
return `[${hhmm}] [Bot Action]: ${actions.map((a) => a.name).join(", ")}`;

// FIXED — distinguish silence from actual tool-only actions
if (actions.length === 0) {
  return `[${hhmm}] [Bot]: (chose silence this round)`;
}
return `[${hhmm}] [Bot Action]: ${actions.map((a) => a.name).join(", ")}`;
```

The exact silence marker text is Claude's discretion. A concise option: `"(chose silence)"`.

### Pattern 3: REQ-03 — Initial Context Trim

**What:** Add a new `initialContextCharBudget` field to `TrimConfig`. Before the existing trim logic, apply a separate head-trim to `messages[0]` if it exceeds the budget.

**Current code (trimmer.ts line 37-44):**
```typescript
export function trimMessages(messages: LoopMessage[], config: TrimConfig): void {
  if (totalChars(messages) <= config.charBudget) return;

  const totalRounds = Math.floor((messages.length - 1) / 2);
  // messages[0] never enters eligible — permanently protected
  const eligibleEnd = 1 + (totalRounds - protectedRounds) * 2;
  // eligible starts at index 1
```

**Fixed pattern:**
```typescript
export interface TrimConfig {
  charBudget: number;
  keepLastRounds: number;
  softTrimHead: number;
  softTrimTail: number;
  initialContextCharBudget?: number;  // NEW: budget for messages[0]
}

export function trimMessages(messages: LoopMessage[], config: TrimConfig): void {
  // NEW: trim messages[0] independently if it exceeds its own budget
  if (messages.length > 0 && config.initialContextCharBudget !== undefined) {
    const m0 = messages[0];
    if (m0.content.length > config.initialContextCharBudget) {
      // Truncate from head, preserve tail (most recent content)
      // Trim to message boundary (newline) to preserve semantic integrity
      const excess = m0.content.length - config.initialContextCharBudget;
      const cutPoint = m0.content.indexOf("\n", excess);
      m0.content = cutPoint !== -1
        ? "...(trimmed)\n" + m0.content.slice(cutPoint + 1)
        : "...(trimmed)\n" + m0.content.slice(excess);
    }
  }

  if (totalChars(messages) <= config.charBudget) return;
  // ... existing logic unchanged ...
}
```

**Config wiring (loop.ts):** Add `initialContextCharBudget` to `TrimConfig` construction and `AgentCoreConfig` schema. Reasonable default: `20000` chars (roughly 5000 tokens).

### Anti-Patterns to Avoid

- **Merging percepts by mutating existing objects:** Always create a new `LoopPayload` for the merged backlog — immutability rule.
- **Skipping timeline record for silence:** CONTEXT.md locked decision says always record; only the renderer changes.
- **Trimming messages[0] in the existing eligible loop:** Keep the two trim passes separate — the initial context has different semantics from round messages.
- **Breaking on sentence boundary mid-word:** Use `indexOf("\n", excess)` to find a clean line boundary, not a character offset.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Queue data structure | Custom linked list | Plain `LoopPayload[]` array | Array push/splice is sufficient; no performance concern at chat scale |
| Token counting | tiktoken integration | Character budget (existing pattern) | Project already uses `charBudget` in chars, not tokens — stay consistent |

**Key insight:** All three fixes are 5-20 line changes. Resist the urge to refactor surrounding code.

## Common Pitfalls

### Pitfall 1: DM path also uses `this.pending`
**What goes wrong:** Fixing only the group path in `handleEvent` leaves the DM path (`handleDmAggregation`) still using single-slot `pending.set`. Burst messages in DMs still get dropped.
**Why it happens:** `handleDmAggregation` has three separate `this.pending.set(channelKey, built)` call sites (lines 280, 295, 312, 327 in service.ts).
**How to avoid:** Search all `this.pending.set` usages and update every one.
**Warning signs:** DM burst test passes but group burst test fails (or vice versa).

### Pitfall 2: mergeBacklog percept timestamp
**What goes wrong:** Using the last backlogged message's timestamp means the merged percept appears newer than the bot's in-flight response, confusing the timeline ordering.
**Why it happens:** The first backlogged message arrived before the bot responded; the last arrived after.
**How to avoid:** Use the first backlogged message's timestamp as the percept timestamp. The trigger context should span from first to last.

### Pitfall 3: REQ-02 — two `recordAgentResponse` call sites
**What goes wrong:** Fixing only the main call site (line 316) misses the wrap-up round call site (line 358) in the `round >= maxRounds` branch.
**Why it happens:** The max-rounds wrap-up path also calls `recordAgentResponse` unconditionally.
**How to avoid:** Fix both call sites. The wrap-up path can also produce empty actions if the LLM ignores the forced `send_message` instruction.

### Pitfall 4: REQ-03 — `initialContextCharBudget` default too small
**What goes wrong:** A default that's too small (e.g. 5000 chars) aggressively trims the initial context on every call, degrading LLM quality.
**Why it happens:** The initial context block contains the full horizon view (history + entities + environment) which can be large.
**How to avoid:** Default to a generous value (20000 chars). The existing `charBudget` is 30000 — the initial context budget should be a fraction of that, not a tiny number.

### Pitfall 5: REQ-03 — trimming `messages[0]` when it's the only message
**What goes wrong:** If `messages` has only one entry (first round, no tool results yet), trimming `messages[0]` may cut critical context needed for the LLM to respond correctly.
**Why it happens:** The trim fires before the budget check.
**How to avoid:** Only apply `initialContextCharBudget` trim when `totalChars(messages) > config.charBudget` — i.e., inside the existing budget guard, or add a separate guard.

## Code Examples

### REQ-01: Backlog merge helper
```typescript
// Source: derived from existing service.ts patterns
private mergeBacklog(channelKey: string, backlog: LoopPayload[]): LoopPayload {
  // Use first payload as base (earliest timestamp)
  const first = backlog[0];
  if (backlog.length === 1) return first;

  // Combine content from all backlogged messages
  const combinedContent = backlog
    .map((p) => p.percept.metadata?.content as string ?? "")
    .filter(Boolean)
    .join("\n");

  return {
    percept: {
      ...first.percept,
      metadata: {
        ...first.percept.metadata,
        content: combinedContent,
        isBacklogDrain: true,
        backlogCount: backlog.length,
      },
    },
    toolCtx: first.toolCtx,
  };
}
```

### REQ-02: formatObservation silence branch
```typescript
// Source: horizon/service.ts formatObservation, agent.response branch
// BEFORE (line 281):
return `[${hhmm}] [Bot Action]: ${actions.map((a) => a.name).join(", ")}`;

// AFTER:
if (actions.length === 0) {
  return `[${hhmm}] [Bot]: (chose silence)`;
}
return `[${hhmm}] [Bot Action]: ${actions.map((a) => a.name).join(", ")}`;
```

### REQ-03: TrimConfig extension
```typescript
// Source: trimmer.ts
export interface TrimConfig {
  charBudget: number;
  keepLastRounds: number;
  softTrimHead: number;
  softTrimTail: number;
  initialContextCharBudget?: number;  // budget for messages[0]; undefined = no limit
}
```

### REQ-03: AgentCoreConfig schema addition
```typescript
// Source: service.ts AgentCoreConfigSchema
initialContextCharBudget: Schema.number()
  .default(20000)
  .description("Character budget for messages[0] (initial user context block)"),
```

## Open Questions

1. **REQ-01: Should the merged percept skip willingness judgment entirely, or use a forced-reply flag?**
   - What we know: CONTEXT.md says "drain 后的合并请求强制回复，跳过意愿值判定". The `enqueue()` path bypasses willingness already — willingness is checked in `handleEvent` before `enqueue` is called.
   - What's unclear: Whether `isBacklogDrain` needs to propagate into the loop itself (e.g. to skip deferred judgment).
   - Recommendation: Since `enqueue()` is called directly (not via `handleEvent`), willingness is already bypassed. No extra flag needed in the loop. Just call `enqueue(channelKey, merged)` directly.

2. **REQ-01: How should the merged trigger context be presented to the LLM?**
   - What we know: CONTEXT.md says "积压消息附加说明如'这是刚才遗漏的消息'". The `percept.metadata.content` feeds into `formatHorizonText` via the horizon view, not directly.
   - What's unclear: Whether the "missed messages" annotation belongs in the percept metadata or in the horizon view rendering.
   - Recommendation: Add a note in `percept.metadata` (`isBacklogDrain: true`, `backlogCount: N`). The loop can inject a brief context note into the user message if `isBacklogDrain` is set.

## Sources

### Primary (HIGH confidence)
- Direct source code reading — `core/src/services/agent/service.ts` (confirmed `pending` type, all call sites)
- Direct source code reading — `core/src/services/agent/loop.ts` (confirmed `recordAgentResponse` call sites at lines 316, 358)
- Direct source code reading — `core/src/services/agent/trimmer.ts` (confirmed `eligible` starts at index 1, `messages[0]` never trimmed)
- Direct source code reading — `core/src/services/horizon/service.ts` (confirmed `formatObservation` empty-actions rendering at line 281)

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions — user-locked implementation choices verified against source code

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, existing Vitest infrastructure confirmed
- Architecture: HIGH — all defect locations confirmed by direct source reading
- Pitfalls: HIGH — derived from actual code paths, not speculation

**Research date:** 2026-02-26
**Valid until:** 2026-03-28 (stable codebase, no fast-moving dependencies)
