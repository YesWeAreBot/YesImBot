# Phase 40: 数据结构和渲染格式优化 - Research

**Researched:** 2026-02-28
**Domain:** Timeline data structures, render pipeline, trimmer semantics — internal TypeScript refactoring
**Confidence:** HIGH (all findings from direct codebase inspection)

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

#### AgentResponseRecord 拆分

- 当前 AgentResponseRecord 拆为两个独立的 TimelineEventType：
  - `AgentResponse` — LLM 原始响应记录（含 rawText 或 error，记录网络错误等失败情况）
  - `AgentAction` — 响应成功后执行的 Action 数组（含 params 和执行结果）
- 两者通过 round 字段关联

#### Bot 消息记录

- bot 通过 send_message 发送的消息也作为 MessageRecord 记录到 timeline（sender 标记为 bot）
- 这样 bot 发言和用户发言使用相同的 `<msg>` 渲染逻辑，格式完全一致

#### 统一时间线

- 合并 working memory 和 history 为统一时间线，延续 v3 做法
- history 按时间顺序包含 Message、AgentAction、AgentResponse（错误）等所有条目
- 移除 horizon-view.mustache 中单独的 `<working-memory>` 区块
- formatObservation() 统一处理所有条目类型，loop.ts 不再手动拼接 wmLines

#### 渲染格式统一

- 所有 timeline 条目统一用 XML 标签渲染：
  - 用户/bot 消息：`<msg id="3" sender="Alice" time="14:30">content</msg>`
  - Agent action：`<bot-action round="1" trigger="#3">search({q:"test"}) -> ok</bot-action>`
- 用户消息增加 `time` 属性（HH:MM 格式），解决当前缺少时间戳标记的问题
- agent.response 不再用 `[HH:MM] [Bot]:` 纯文本格式

#### Tool Results 序列化

- tool results 从 JSON.stringify 改为 XML 格式：`<tool-results><tool-result name="search" status="ok">...</tool-result></tool-results>`
- send_message 的 result 精简渲染（省略 content param，只显示 `sent`），保持 OPT-04 优化

#### 消息内容类型

- LoopMessage.content 变为 `string | UserContent`（复用 ai-sdk 类型），支持多模态
- MessageEventData.content 保持 `string`（存储层不变）
- ElementFormatterService 负责序列化/反序列化，以及资源持久化（图片存文件系统，formatter 输出纯文本描述）
- 图片数据不存数据库

#### Trimmer 语义化

- trimmer 操作对象从渲染后的 string 改为渲染前的 Observation 数组
- 新增 image strip 层级：超预算时先移除 image parts，再 softTrim，再 hardClear
- 渲染在裁剪之后发生（先裁剪 Observation[]，再 formatObservation）
- 裁剪按整条 observation 移除，不切割单条内容

#### Entity 表规范化

- 单表 + type 字段区分 user/member，不拆双表
- Environment 保持 JsonDB 文件存储，但从 Entity 管理逻辑中解耦，独立管理

### Claude's Discretion

- AgentResponse/AgentAction 的具体字段设计细节
- trimmer 的预算分配策略（charBudget 是否需要调整）
- formatObservation 中 bot-action 的具体内容格式
- Entity 表解耦的具体实现方式

### Deferred Ideas (OUT OF SCOPE)

- History 缓存分块（前部基本不变，可标记 cacheable）— 需要 provider 层配合，复杂度较高，单独 phase
- System event 条目类型（guild-member-added 等）— v2.6
  </user_constraints>

## Summary

Phase 40 is a pure internal refactoring phase with no new external dependencies. All changes are confined to `core/src/` — specifically the timeline type system (`types.ts`), the event manager (`manager.ts`), the horizon service render pipeline (`service.ts`), the loop trimmer (`trimmer.ts`), the loop itself (`loop.ts`), and the mustache template (`horizon-view.mustache`).

The central theme is collapsing two separate rendering paths (history `<msg>` tags and working-memory plain-text lines) into a single unified timeline rendered entirely with XML tags. The current `AgentResponseRecord` conflates LLM response metadata with action execution results; splitting it into `AgentResponse` + `AgentAction` makes each concern independently queryable and renderable. The trimmer currently operates on already-rendered strings, which risks cutting XML mid-tag; moving it upstream to operate on `Observation[]` eliminates that class of bug entirely.

The scope is well-bounded: no new npm packages, no database schema migrations beyond adding two new `type` enum values to the existing `yesimbot.timeline` table, and no changes to the plugin SDK or provider packages.

**Primary recommendation:** Implement in three sequential waves — (1) type system + EventManager split, (2) render pipeline unification + mustache update, (3) trimmer semantics upgrade. Each wave is independently testable.

## Standard Stack

### Core

| Library                              | Version         | Purpose                                     | Why Standard                                  |
| ------------------------------------ | --------------- | ------------------------------------------- | --------------------------------------------- |
| TypeScript (existing)                | project version | All implementation                          | Already in use                                |
| Koishi database ORM (existing)       | project version | Timeline persistence                        | Already in use                                |
| Mustache (existing)                  | project version | Template rendering                          | Already in use, `horizon-view.mustache`       |
| ai-sdk `UserContent` type (existing) | project version | Multimodal content typing for `LoopMessage` | Already a dependency                          |
| vitest (existing)                    | project version | Unit tests                                  | Already configured at `core/vitest.config.ts` |

### Supporting

| Library  | Version | Purpose | When to Use        |
| -------- | ------- | ------- | ------------------ |
| None new | —       | —       | No new deps needed |

**Installation:** No new packages required.

## Architecture Patterns

### Current State (what exists today)

```
core/src/services/horizon/types.ts
  TimelineEventType { Message, AgentResponse }   ← AgentResponse conflates LLM + actions
  AgentResponseData { round, assistantText, actions[], toolResults[] }
  Observation = MessageObservation | AgentResponseObservation

core/src/services/agent/trimmer.ts
  LoopMessage { role, content: string, _trimState }  ← content is already-rendered string
  trimMessages(messages: LoopMessage[], config)       ← operates on rendered strings

core/src/services/horizon/service.ts
  formatObservation(obs, selfId, channelKey): string
    message → <msg id="N" sender="X" senderId="Y">content</msg>   ← XML
    agent.response → [HH:MM] [Bot]: content [also: tool1, tool2]  ← plain text (INCONSISTENT)

  formatHorizonText(view, workingMemory?, percept?): string
    ← manually builds wmLines[] in loop.ts, passes as separate param
    ← template has separate <working-memory> block

core/src/services/agent/loop.ts
  ← manually iterates view.history to build wmLines[]
  ← calls formatHorizonText(view, wmLines, percept)
  ← formatToolResults() serializes to JSON string
```

### Target State (after Phase 40)

```
TimelineEventType { Message, AgentResponse, AgentAction }
  AgentResponseData { round, rawText, error? }          ← LLM output only
  AgentActionData   { round, actions[], toolResults[] } ← execution results only

Observation = MessageObservation | AgentResponseObservation | AgentActionObservation

LoopMessage { role, content: string | UserContent, _trimState }

trimMessages(observations: Observation[], config) → Observation[]  ← pre-render
  layers: image-strip → softTrim → hardClear

formatObservation(obs, selfId, channelKey): string
  message → <msg id="N" sender="X" time="HH:MM">content</msg>   ← adds time attr
  agent.action → <bot-action round="N" trigger="#M">...</bot-action>
  agent.response (error only) → <bot-error round="N">...</bot-error>  (or omit if no error)

formatHorizonText(view, percept?): string   ← no workingMemory param
  ← all history rendered uniformly via formatObservation
  ← template has no <working-memory> block

loop.ts
  ← no wmLines construction
  ← formatToolResults() → XML format
  ← bot send_message result recorded as MessageRecord (sender=bot)
```

### Pattern 1: BaseTimelineEntry Generic Extension

The existing pattern for adding new timeline types — follow it exactly:

```typescript
// Source: core/src/services/horizon/types.ts (existing pattern)

// Step 1: Add enum values
export enum TimelineEventType {
  Message = "message",
  AgentResponse = "agent.response", // keep for backward compat query
  AgentAction = "agent.action", // NEW
}

// Step 2: Define data interface
export interface AgentActionData {
  round: number;
  actions: Array<{ name: string; params?: Record<string, unknown> }>;
  toolResults: Array<{ name: string; status: string; result?: unknown; error?: string }>;
}

// Step 3: Define record type
export type AgentActionRecord = BaseTimelineEntry<TimelineEventType.AgentAction, AgentActionData>;

// Step 4: Expand union
export type TimelineEntry = MessageRecord | AgentResponseRecord | AgentActionRecord;

// Step 5: Expand Observation union
export interface AgentActionObservation {
  type: "agent.action";
  timestamp: Date;
  data: AgentActionData;
}
export type Observation = MessageObservation | AgentResponseObservation | AgentActionObservation;
```

### Pattern 2: AgentResponseData Slimming

The existing `AgentResponseData` becomes LLM-output-only:

```typescript
// BEFORE
export interface AgentResponseData {
  round: number;
  assistantText: string;
  actions: Array<{ name: string; params?: Record<string, unknown> }>;
  toolResults: Array<{ name: string; status: string; result?: unknown; error?: string }>;
}

// AFTER
export interface AgentResponseData {
  round: number;
  rawText: string; // renamed from assistantText for clarity
  error?: string; // network/parse errors recorded here
}
```

### Pattern 3: Semantic Trimmer (pre-render)

The trimmer moves from operating on `LoopMessage[]` (rendered strings) to `Observation[]` (structured data). The budget check uses estimated char cost per observation:

```typescript
// New signature
export function trimObservations(observations: Observation[], config: TrimConfig): Observation[]; // returns new array (immutable — no mutation)

// Trim layers (in order):
// 1. image-strip: remove ImagePart entries from multimodal observations
// 2. softTrim: remove oldest non-protected observations entirely
// 3. hardClear: replace observation data with placeholder

// Budget estimation: sum of formatObservation() output lengths
// (or pre-computed char estimate per observation type)
```

Key design note: the trimmer must return a **new array** (immutable pattern per project rules), not mutate in place. The current `trimMessages` mutates `messages[i].content` — this must change.

### Pattern 4: XML Tool Results

```typescript
// BEFORE (loop.ts formatToolResults)
function formatToolResults(results: ToolResultEntry[]): string {
  return `Tool results:\n${JSON.stringify(compact)}\n\nRespond with...`;
}

// AFTER
function formatToolResults(results: ToolResultEntry[]): string {
  const items = results.map((r) => {
    const status = r.error ? `status="error"` : `status="${r.status}"`;
    const content =
      r.name === "send_message" ? "sent" : r.result != null ? String(r.result) : (r.error ?? "");
    return `  <tool-result name="${r.name}" ${status}>${content}</tool-result>`;
  });
  return `<tool-results>\n${items.join("\n")}\n</tool-results>\n\nRespond with a JSON object containing "actions" array.`;
}
```

### Pattern 5: Bot Message Recording

`send_message` execution in `loop.ts` must record the sent content as a `MessageRecord` with `senderId = selfId`:

```typescript
// After successful send_message execution in executeActions():
if (action.name === "send_message" && result.status === "fulfilled") {
  const content = String(action.params?.content ?? "");
  await horizon.events.recordMessage({
    platform: percept.platform,
    channelId: percept.channelId,
    stage: TimelineStage.Active,
    timestamp: new Date(),
    data: {
      messageId: Random.id(), // synthetic ID — no platform message ID available here
      senderId: toolCtx.bot?.selfId ?? "",
      senderName: toolCtx.bot?.user?.name ?? "",
      content,
    },
  });
}
```

Note: `EventListener.recordBotSentMessage()` already exists as a private method (line 116 of `listener.ts`) but is never called. Phase 40 should either wire it up or consolidate the logic into loop.ts directly. The CONTEXT.md decision says bot messages are recorded via `send_message` execution — loop.ts is the right place since it has the content before `<sep/>` splitting.

### Pattern 6: Mustache Template Update

Remove `<working-memory>` block entirely. The `history` array now contains all observations including agent actions:

```mustache
{{! REMOVE this entire block: }}
{{#hasWorkingMemory}}
<working-memory>
...
</working-memory>
{{/hasWorkingMemory}}

{{! history now contains everything — no separate working-memory }}
<history>
{{#hasHistory}}
{{#history}}
{{{.}}}
{{/history}}
{{/hasHistory}}
...
</history>
```

The `formatHorizonText` scope no longer needs `hasWorkingMemory` / `workingMemory` keys.

### Anti-Patterns to Avoid

- **Mutating Observation arrays in trimmer:** The current `trimMessages` mutates `messages[i].content` in place. The new trimmer MUST return a new array (immutable pattern).
- **Cutting XML mid-tag:** The old string-based trimmer could slice `<msg id="3" sender=` in half. The new observation-based trimmer removes whole observations — this is the entire motivation.
- **Storing image data in the database:** `MessageEventData.content` stays `string`. Image data goes to filesystem via `ElementFormatterService`. Do not add blob columns to the timeline table.
- **Keeping `wmLines` construction in loop.ts:** After Phase 40, `loop.ts` must not manually iterate `view.history` to build working memory lines. `formatHorizonText` handles all rendering.
- **Breaking the `hardClearToolResult` regex:** The current `hardClearToolResult` parses `Tool results:\n{JSON}`. After switching to XML format, this regex will fail silently. The hardClear layer in the new trimmer operates on `Observation` objects directly — no regex needed.

## Don't Hand-Roll

| Problem                | Don't Build        | Use Instead                                          | Why                                                                                         |
| ---------------------- | ------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Char budget estimation | Custom tokenizer   | `String.length` (chars, not tokens)                  | Existing `charBudget` config is already char-based; consistency matters more than precision |
| XML serialization      | Custom XML builder | Template literals with manual escaping               | The existing `formatObservation` already uses template literals; keep consistent            |
| Observation ordering   | Custom sort        | Preserve insertion order from `EventManager.query()` | Already ordered by `timestamp asc` from the DB query                                        |

**Key insight:** This phase is a refactoring, not a feature addition. Resist the urge to introduce new abstractions beyond what the decisions specify.

## Common Pitfalls

### Pitfall 1: Database Schema Migration for New TimelineEventType

**What goes wrong:** Adding `AgentAction = "agent.action"` to the enum is a TypeScript change only. The DB column `type` is `string(32)` — no migration needed. But `EventManager.query()` filters by `types?: TimelineEventType[]`. Callers that pass `[TimelineEventType.AgentResponse]` will miss `AgentAction` entries. All `buildView` callers must be updated to include the new type.
**Why it happens:** Enum extension is invisible to the DB but visible to query filters.
**How to avoid:** After adding the new type, grep all `EventQueryOptions` usages and update `types` arrays.
**Warning signs:** `view.history` contains no `agent.action` observations despite actions being executed.

### Pitfall 2: Backward Compatibility of Existing AgentResponseRecord Rows

**What goes wrong:** Existing DB rows have `type = "agent.response"` with `data` containing `{ round, assistantText, actions, toolResults }`. After the split, new rows use the slimmed `AgentResponseData`. Old rows will fail to deserialize into the new type.
**Why it happens:** The `data` column is `json` — Koishi deserializes it as-is.
**How to avoid:** Keep `AgentResponseData` backward-compatible by making `actions` and `toolResults` optional (or just tolerate extra fields via TypeScript structural typing). The `toObservations()` method should handle both old and new shapes gracefully during the transition.
**Warning signs:** TypeScript errors in `toObservations()` when accessing `obs.data.rawText` on old records.

### Pitfall 3: `formatHorizonText` Signature Change Breaks Callers

**What goes wrong:** Removing the `workingMemory?: string[]` parameter from `formatHorizonText` will break `loop.ts` which currently passes `wmLines`.
**Why it happens:** The parameter removal and the loop.ts cleanup must happen atomically.
**How to avoid:** Remove `wmLines` construction from `loop.ts` and the `workingMemory` param from `formatHorizonText` in the same commit/plan.
**Warning signs:** TypeScript compile error `Expected 3 arguments, but got 2`.

### Pitfall 4: Trimmer Immutability — `_trimState` Tracking

**What goes wrong:** The current trimmer uses `_trimState` on `LoopMessage` objects to track which messages have been soft/hard trimmed across multiple `trimMessages()` calls within a single loop run. The new observation-based trimmer must preserve this multi-call semantics.
**Why it happens:** `trimMessages` is called at the start of each round AND before the wrap-up call. State must persist across calls.
**How to avoid:** Either keep `_trimState` as a field on `Observation` (added transiently, not persisted), or maintain a separate `Set<Observation>` of already-trimmed items passed through the loop.
**Warning signs:** Observations that were already hard-cleared get re-processed on the next round.

### Pitfall 5: `time` Attribute on `<msg>` Tag — XML Escaping

**What goes wrong:** The `time` attribute value (`HH:MM`) is safe, but `sender` values come from user-controlled names. The existing `formatObservation` embeds `obs.sender.name` directly into XML attributes without escaping.
**Why it happens:** Phase 33 fixed content escaping but attribute values in `formatObservation` were not audited.
**How to avoid:** Apply `h.escape(value, true)` (Koishi's XML attribute escaper) to all dynamic attribute values in `formatObservation`. The `handlers.ts` already uses this pattern (`h.escape(String(attrs.name), true)`).
**Warning signs:** LLM sees malformed XML when a user's name contains `"` or `>`.

### Pitfall 6: Bot Message Recording — `<sep/>` Split

**What goes wrong:** `send_message` splits content on `<sep/>` and sends multiple messages. If the bot message is recorded before splitting, the timeline shows one entry with `<sep/>` in it. If recorded after splitting, multiple entries are created.
**Why it happens:** The decision says "bot 通过 send_message 发送的消息也作为 MessageRecord 记录" — it's ambiguous whether this means one record or multiple.
**How to avoid:** Record one `MessageRecord` per sent part (after splitting), matching what the user actually sees. This is consistent with how user messages are recorded (one record per received message).
**Warning signs:** `<sep/>` appearing in timeline content rendered to LLM.

## Code Examples

### Current `formatObservation` for agent.response (to be replaced)

```typescript
// Source: core/src/services/horizon/service.ts lines 369-381
const actions = obs.data.actions;
const sendAction = actions.find((a) => a.name === "send_message");
const otherTools = actions.filter((a) => a.name !== "send_message").map((a) => a.name);
if (sendAction) {
  const content = (sendAction.params?.content as string) ?? "";
  const suffix = otherTools.length ? ` [also: ${otherTools.join(", ")}]` : "";
  return `[${hhmm}] [Bot]: ${content}${suffix}`;
}
```

### New `formatObservation` for agent.action (target)

```typescript
// AgentAction observation rendering
if (obs.type === "agent.action") {
  const d = obs.data;
  const triggerAttr = d.triggerMsgId
    ? ` trigger="#${this.getShortId(channelKey ?? "", d.triggerMsgId) ?? "?"}"`
    : "";
  const lines = d.actions.map((a) => {
    const r = d.toolResults.find((t) => t.name === a.name);
    if (a.name === "send_message") {
      const ok = r?.status === "ok" || !r?.error;
      return ok ? "send_message -> sent" : `send_message -> failed: ${r?.error ?? "unknown"}`;
    }
    const status = r ? r.status + (r.error ? ": " + r.error : "") : "no result";
    const preview = r?.result != null ? String(r.result).slice(0, 200) : "";
    return `${a.name}(${JSON.stringify(a.params ?? {})}) -> ${status}${preview ? ": " + preview : ""}`;
  });
  return `<bot-action round="${d.round}"${triggerAttr}>${lines.join("; ")}</bot-action>`;
}
```

### Current `trimMessages` mutation pattern (to be replaced)

```typescript
// Source: core/src/services/agent/trimmer.ts lines 38-93
// PROBLEM: mutates messages[i].content in place
export function trimMessages(messages: LoopMessage[], config: TrimConfig): void {
  // ...
  msg.content = softTrim(msg.content, config.softTrimHead, config.softTrimTail);
  msg._trimState = "soft";
}
```

### New `trimObservations` immutable pattern (target)

```typescript
// Returns new array — never mutates input
export function trimObservations(
  observations: Observation[],
  config: TrimConfig,
  trimState?: Map<Observation, "soft" | "hard">,
): { observations: Observation[]; trimState: Map<Observation, "soft" | "hard"> } {
  const state = trimState ?? new Map();
  if (estimateChars(observations) <= config.charBudget) {
    return { observations: [...observations], trimState: state };
  }
  // ... trim layers
}
```

### Current `formatHorizonText` wmLines construction in loop.ts (to be removed)

```typescript
// Source: core/src/services/agent/loop.ts lines 167-207
// THIS ENTIRE BLOCK IS REMOVED in Phase 40
const wmLines: string[] = [];
for (let i = 0; i < (view.history ?? []).length; i++) {
  const obs = view.history![i];
  if (obs.type === "agent.response") {
    // ... manual rendering of agent responses
    wmLines.push(lines.join("\n"));
  }
}
const userContent = horizon.formatHorizonText(view, wmLines, percept);
// BECOMES:
const userContent = horizon.formatHorizonText(view, percept);
```

## State of the Art

| Old Approach                      | Current Approach                    | When Changed | Impact                                    |
| --------------------------------- | ----------------------------------- | ------------ | ----------------------------------------- |
| Separate working-memory + history | Unified timeline                    | Phase 40     | Simpler render pipeline, single trim pass |
| String-based trimmer              | Observation-based trimmer           | Phase 40     | No XML corruption, image-aware trimming   |
| JSON tool results                 | XML tool results                    | Phase 40     | Consistent with rest of prompt format     |
| `[HH:MM] [Bot]:` plain text       | `<bot-action>` XML tag              | Phase 40     | LLM can parse structured bot history      |
| AgentResponseRecord (monolithic)  | AgentResponse + AgentAction (split) | Phase 40     | Independent queryability, cleaner types   |

## Open Questions

1. **`AgentActionData.triggerMsgId` field**
   - What we know: The current `loop.ts` computes `triggerLabel` by scanning backward through history for the last message before an agent response (lines 173-182). This is a render-time lookup.
   - What's unclear: Should `triggerMsgId` be stored in `AgentActionData` at record time (in loop.ts, where the percept's messageId is available), or computed at render time (in `formatObservation`)?
   - Recommendation: Store it at record time. The percept carries `percept.metadata.messageId` (or the triggering message's ID). This avoids the backward-scan at render time and makes the data self-contained. Claude's discretion per CONTEXT.md.

2. **`AgentResponseData` backward compatibility window**
   - What we know: Existing DB rows have `assistantText` + `actions` + `toolResults` in `data`. New rows will have `rawText` + optional `error`.
   - What's unclear: How long do old rows persist? `archiveThresholdMs` defaults to 86400000 (24h). After 24h, old rows are archived and won't appear in `buildView` queries.
   - Recommendation: Make `toObservations()` handle both shapes with a type guard. Old rows with `assistantText` can be mapped to `AgentActionObservation` using the existing `actions`/`toolResults` fields. This avoids a data migration.

3. **`LoopMessage.content: string | UserContent` — trimmer char estimation**
   - What we know: `UserContent` is an array of `TextPart | ImagePart | ...`. Char estimation for multimodal content requires summing text parts only.
   - What's unclear: The `charBudget` config is currently compared against `String.length` of rendered strings. With multimodal content, the "size" of an image part is not its base64 length (that's the raw bytes, not what the LLM sees as tokens).
   - Recommendation: For budget purposes, count only text parts. Image parts are handled by the image-strip trim layer (removed first). This is consistent with the CONTEXT.md decision: "新增 image strip 层级：超预算时先移除 image parts".

## Sources

### Primary (HIGH confidence)

- Direct codebase inspection — `core/src/services/horizon/types.ts` — current type definitions
- Direct codebase inspection — `core/src/services/horizon/service.ts` — `formatObservation`, `formatHorizonText`
- Direct codebase inspection — `core/src/services/agent/loop.ts` — wmLines construction, `recordAgentResponse` calls
- Direct codebase inspection — `core/src/services/agent/trimmer.ts` — current string-based trimmer
- Direct codebase inspection — `core/src/services/horizon/manager.ts` — `EventManager`, `toObservations`
- Direct codebase inspection — `core/resources/templates/partials/horizon-view.mustache` — template structure
- Direct codebase inspection — `core/src/services/horizon/listener.ts` — `recordBotSentMessage` (unused)
- Direct codebase inspection — `.planning/phases/40-data-structure-render-optimization/40-CONTEXT.md` — locked decisions

### Secondary (MEDIUM confidence)

- `references/YesImBot-v3/packages/core/src/agent/context-builder.ts` — v3 unified timeline pattern reference

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new deps, all existing libraries confirmed in codebase
- Architecture: HIGH — all patterns derived from direct code inspection
- Pitfalls: HIGH — all pitfalls identified from concrete code analysis (not speculation)

**Research date:** 2026-02-28
**Valid until:** Stable — internal refactoring, no external dependencies to track
