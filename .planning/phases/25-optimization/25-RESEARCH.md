# Phase 25: Optimization - Research

**Researched:** 2026-02-25
**Domain:** Working memory temporal coherence + Anthropic system prompt caching via AI SDK v6
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**触发位置标记 (OPT-03)**
- 消息使用简单递增整数 ID（1-999 循环，不补零），溢出后从 1 重新开始
- 平台原始长 ID（7位+，各适配器不同）通过映射表转为短递增 ID，工具层透明解析——LLM 只看到和使用短 ID，工具接收后自动还原为平台长 ID
- History 消息使用 XML 属性标记格式：`<msg id="N" sender="name" senderId="uid">内容</msg>`
- 回复消息额外标记 `replyTo="M"` 属性，必要时召回被回复的原文进行内联
- 消息内容本身为 koishi 消息元素格式（类 XML），外层 XML 属性包裹自然一致，且天然防御提示词注入
- Working memory 工具条目：保留现有 Round 标记 + 增加 `triggered by #N` 关联到消息 ID
- 混合方案：history 用内联紧凑标记（XML 属性），working memory 用结构化字段（triggeredAt）

**send_message 精简策略 (OPT-04)**
- 始终省略 send_message 的内容参数（LLM 自己生成的内容它已经知道），只保留执行结果摘要
- 成功时最简格式："sent #N, ok"（N 为目标消息短 ID）
- 失败时保留错误原因："sent #N, failed: timeout"
- 本次只对 send_message 做精简，其他工具结果保持现状
- 架构上预留扩展空间，未来可对其他工具结果应用类似精简策略

**Cache breakpoint 策略 (OPT-01)**
- System prompt 稳定/动态二分：soul + instructions 为稳定部分，working memory + 动态上下文为动态部分
- 所有 provider 统一「稳定内容在前、动态内容在后」的排列策略，利于前缀匹配缓存
- Anthropic provider 在稳定 block 末尾标记 `cache_control: {type: "ephemeral"}`
- 通过 response usage 中的 `cache_creation_input_tokens` / `cache_read_input_tokens` 字段观测缓存命中情况
- 在 debug 日志中记录 cache 相关 token 用量

**Provider 检测与回退 (OPT-02)**
- Provider 注册时显式标记类型（anthropic / openai / deepseek / glm 等），不通过 model ID 推断
- 所有 provider 统一「稳定在前、动态在后」排序策略——GLM/DeepSeek 靠前缀匹配自动受益
- Anthropic 在统一排序基础上额外注入 `cache_control` 标记
- 非 Anthropic provider 回退为字符串拼接，debug 日志记录 "cache not supported for provider: xxx"
- 预留 provider 类型 → cache 策略的扩展接口，本次只实现 Anthropic

### Claude's Discretion
- 短 ID 映射表的具体数据结构和生命周期管理
- Working memory triggeredAt 字段的精确格式
- System prompt content blocks 的具体拆分粒度
- Cache 观测日志的格式和级别阈值
- 扩展接口的具体抽象设计

### Deferred Ideas (OUT OF SCOPE)
- 其他工具结果的精简策略（search_memory、recall 等）——未来可扩展，本次只做 send_message
- 全 provider 缓存抽象（各 provider 缓存语义不同）——先做 Anthropic-only + 统一排序
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| OPT-01 | System prompt 拆分为 `SystemModelMessage[]` content blocks，稳定部分（soul + instructions）标记 cache breakpoint | AI SDK v6 `Prompt.system` accepts `SystemModelMessage[]`; `providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } }` on the last stable block |
| OPT-02 | ModelService 支持 provider 检测，Anthropic 自动注入 `providerOptions` cache control，其他 provider 回退为字符串拼接 | `IModelProvider.providerType` field already exists; ModelService already has `getProvider(name)`; detection is a simple string equality check |
| OPT-03 | Working Memory 工具条目标记其在 history 中的触发位置，使 LLM 意识到工具执行与聊天窗口的因果联系 | Short-ID map lives in HorizonService or AgentCore; `MessageObservation.messageId` is the platform ID to map; loop.ts builds wmLines from `view.history` |
| OPT-04 | Working Memory 中 `send_message` 动作省略已在 history 中出现的内容参数，仅保留执行结果摘要 | `send_message` result is built in `loop.ts` `formatToolResults`; the content param is in `action.params.content`; result summary replaces it |
</phase_requirements>

## Summary

Phase 25 has four tightly scoped optimizations across two concerns: (1) working memory temporal coherence (OPT-03, OPT-04) and (2) system prompt caching (OPT-01, OPT-02). No new dependencies are required for OPT-01 through OPT-04 — the AI SDK v6 already ships `SystemModelMessage` with `providerOptions` support, and `IModelProvider.providerType` is already declared in `shared-model`. The `@ai-sdk/anthropic` package is **not yet installed** and must be added as a new provider package.

The working memory changes are localized to `loop.ts` (wmLines construction) and `horizon/service.ts` (formatObservation / formatHorizonText). The short-ID mapping table needs a home — the most natural place is a per-channel map in `HorizonService` or a lightweight wrapper in `loop.ts`. The system prompt caching changes touch `loop.ts` (where `systemPrompt` is built and passed to `modelService.call`) and `model/service.ts` (where `executeCall` passes params to `generateText`).

**Primary recommendation:** Implement OPT-03/OPT-04 first (pure logic changes, no new deps), then OPT-01/OPT-02 (requires installing `@ai-sdk/anthropic` and creating a new provider package).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ai` (Vercel AI SDK) | 6.0.91 (installed) | `SystemModelMessage`, `ProviderOptions`, `generateText` | Already the model call layer; `system` param accepts `SystemModelMessage[]` natively |
| `@ai-sdk/anthropic` | latest (not yet installed) | Anthropic provider for `createAnthropic()` | Official Anthropic adapter for AI SDK v6 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@ai-sdk/provider-utils` | installed (transitive) | `ProviderOptions` type | Already available; used for typing cache control options |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `SystemModelMessage[]` for system | Raw Anthropic API `system: [{type:"text", text:"...", cache_control:{...}}]` | AI SDK approach is provider-agnostic and type-safe; raw API bypasses the SDK entirely |
| Per-channel short-ID map in HorizonService | Global map in loop.ts | HorizonService owns message records; better cohesion. But loop.ts is simpler and avoids service coupling |

**Installation (new Anthropic provider package):**
```bash
yarn workspace yesimbot-provider-anthropic add @ai-sdk/anthropic
```

## Architecture Patterns

### Recommended Project Structure

The phase touches these existing files plus one new provider package:

```
core/src/services/
├── agent/loop.ts              # OPT-03: wmLines triggeredAt; OPT-04: send_message trimming
├── horizon/service.ts         # OPT-03: formatObservation with <msg id="N"> XML format
├── model/service.ts           # OPT-01/02: buildSystemPrompt helper; cache logging
providers/
└── provider-anthropic/        # NEW: Anthropic provider package (mirrors provider-openai)
    └── src/index.ts
```

### Pattern 1: SystemModelMessage[] for Anthropic Cache Control

**What:** The AI SDK v6 `Prompt.system` field accepts `string | SystemModelMessage | SystemModelMessage[]`. A `SystemModelMessage` has `role: 'system'`, `content: string`, and optional `providerOptions`. Setting `providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } }` on a block tells the Anthropic provider to inject `cache_control: { type: "ephemeral" }` into that system block.

**When to use:** Only when `providerType === "anthropic"`. All other providers receive a plain string (concatenated sections).

**Example (verified from AI SDK v6 type definitions):**
```typescript
// Source: node_modules/@ai-sdk/provider/dist/index.d.ts (SharedV3ProviderOptions example)
// Source: node_modules/@ai-sdk/provider-utils/dist/index.d.ts (SystemModelMessage type)

import type { SystemModelMessage } from "ai";

// Stable block — gets cache breakpoint
const stableBlock: SystemModelMessage = {
  role: "system",
  content: soulContent + "\n\n" + instructionsContent,
  providerOptions: {
    anthropic: { cacheControl: { type: "ephemeral" } },
  },
};

// Dynamic block — no cache annotation
const dynamicBlock: SystemModelMessage = {
  role: "system",
  content: workingMemoryContent + "\n\n" + contextContent,
};

// Pass to generateText
await generateText({
  model: wrappedModel,
  system: [stableBlock, dynamicBlock],
  messages,
  ...otherParams,
});
```

### Pattern 2: Provider Detection in ModelService

**What:** `IModelProvider.providerType` is already declared as `readonly providerType: string` in `shared-model`. Both `OpenAIProvider` and `DeepSeekProvider` already set `readonly providerType = "openai"` / `"deepseek"`. The Anthropic provider will set `readonly providerType = "anthropic"`.

**When to use:** In `executeCall` / `executeStreamCall`, look up the provider and check `provider.providerType === "anthropic"` to decide whether to build `SystemModelMessage[]` or a plain string.

```typescript
// In ModelService.executeCall:
private buildSystemParam(
  providerType: string,
  sections: { stable: string; dynamic: string },
): string | SystemModelMessage[] {
  if (providerType === "anthropic") {
    return [
      {
        role: "system",
        content: sections.stable,
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      },
      {
        role: "system",
        content: sections.dynamic,
      },
    ];
  }
  // All other providers: plain string, stable first for prefix-cache benefit
  return sections.stable + "\n\n" + sections.dynamic;
}
```

### Pattern 3: Short-ID Mapping for Message Temporal Coherence

**What:** A per-channel counter (1–999, wrapping) maps platform message IDs to short IDs. The map lives in `HorizonService` (or a helper class) since it owns message records. `formatObservation` emits `<msg id="N" sender="name" senderId="uid">content</msg>`. The loop's wmLines builder appends `triggered by #N` to each working memory entry.

**When to use:** OPT-03. The short-ID map must be populated when messages are recorded (in `EventManager.recordMessage`) or when observations are formatted (in `formatObservation`). The latter is simpler — assign IDs lazily during `formatHorizonText`.

```typescript
// Short-ID map: per-channel, wraps at 999
type ShortIdMap = Map<string, number>; // platform messageId -> short int

// In HorizonService (or a helper):
private shortIdCounters = new Map<string, number>(); // channelKey -> next counter
private shortIdMaps = new Map<string, Map<string, number>>(); // channelKey -> (msgId -> shortId)

assignShortId(channelKey: string, platformMsgId: string): number {
  let map = this.shortIdMaps.get(channelKey);
  if (!map) {
    map = new Map();
    this.shortIdMaps.set(channelKey, map);
  }
  if (map.has(platformMsgId)) return map.get(platformMsgId)!;
  const counter = (this.shortIdCounters.get(channelKey) ?? 0) % 999 + 1;
  this.shortIdCounters.set(channelKey, counter);
  map.set(platformMsgId, counter);
  return counter;
}
```

**History message XML format (OPT-03):**
```
<msg id="42" sender="Alice" senderId="uid123">Hello there</msg>
<msg id="43" sender="Alice" senderId="uid123" replyTo="42">This is a reply</msg>
```

**Working memory entry format (OPT-03):**
```
Round 2 (triggered by #42):
  - send_message({}) -> sent #43, ok
```

### Pattern 4: send_message Result Trimming (OPT-04)

**What:** In `loop.ts`, the wmLines builder iterates `view.history` for `agent.response` entries. For `send_message` actions, instead of showing `send_message({"content":"..."}) -> ok: ...`, emit the compact form `send_message({}) -> sent #N, ok` (omitting content, adding target message short ID).

The `send_message` tool result already contains the sent message ID (or can be made to). The content param is dropped from the wmLines representation only — the actual tool execution is unchanged.

```typescript
// In loop.ts wmLines builder:
for (const a of d.actions) {
  const r = d.toolResults.find((t) => t.name === a.name);
  if (a.name === "send_message") {
    // OPT-04: omit content, use compact result summary
    const sentId = extractSentMessageId(r?.result); // e.g. "#43"
    const status = r?.status === "ok" ? `sent ${sentId}, ok` : `sent ${sentId}, failed: ${r?.error ?? "unknown"}`;
    lines.push(`  - send_message({}) -> ${status}`);
  } else {
    // existing logic unchanged
    const status = r ? r.status + (r.error ? ": " + r.error : "") : "no result";
    const preview = r?.result != null ? String(r.result).slice(0, 200) : "";
    lines.push(`  - ${a.name}(${JSON.stringify(a.params ?? {})}) -> ${status}${preview ? ": " + preview : ""}`);
  }
}
```

### Anti-Patterns to Avoid

- **Inferring provider type from model ID string:** The CONTEXT.md explicitly locks "provider 注册时显式标记类型，不通过 model ID 推断". `providerType` is already on `IModelProvider`.
- **Putting short-ID map in loop.ts:** The loop is stateless per-invocation. The map must survive across loop runs for the same channel. HorizonService is the right owner.
- **Splitting system prompt at the PromptService level:** PromptService renders sections but doesn't know about providers. The split into stable/dynamic must happen in `loop.ts` (which knows the provider) or in `ModelService.executeCall` (which receives the provider name). The cleanest approach: `loop.ts` passes two separate strings (stable, dynamic) to `modelService.call`, and `ModelService` assembles them based on provider type.
- **Passing `SystemModelMessage[]` as the `system` field when provider is non-Anthropic:** The AI SDK accepts it, but non-Anthropic providers may not handle multiple system messages correctly. Always fall back to string for non-Anthropic.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Anthropic API client | Custom HTTP client | `@ai-sdk/anthropic` | Official adapter handles auth, retries, streaming, cache headers |
| Cache hit detection | Parse raw HTTP headers | `result.usage.inputTokenDetails.cacheReadTokens` | AI SDK v6 surfaces cache tokens in `LanguageModelUsage.inputTokenDetails` |
| SystemModelMessage type | Custom interface | `import type { SystemModelMessage } from "ai"` | Already exported from AI SDK v6 |

**Key insight:** The AI SDK v6 already abstracts all the Anthropic-specific cache control plumbing. The only Anthropic-specific code needed is the `providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } }` annotation on the stable system block.

## Common Pitfalls

### Pitfall 1: Cache Observation Field Names

**What goes wrong:** Looking for `cache_creation_input_tokens` / `cache_read_input_tokens` directly on `result.usage` — these are the raw Anthropic API field names, not the AI SDK field names.

**Why it happens:** The CONTEXT.md mentions the raw Anthropic field names. The AI SDK normalizes them.

**How to avoid:** Use `result.usage.inputTokenDetails.cacheWriteTokens` and `result.usage.inputTokenDetails.cacheReadTokens` (AI SDK v6 normalized fields). The raw values are also available in `result.usage.raw` if needed.

**Warning signs:** TypeScript error "Property 'cache_creation_input_tokens' does not exist on type 'LanguageModelUsage'".

### Pitfall 2: Short-ID Map Lifetime

**What goes wrong:** The short-ID map grows unbounded if never pruned, or gets reset too aggressively (losing ID continuity within a conversation window).

**Why it happens:** No explicit lifecycle management.

**How to avoid:** Tie the map lifetime to the channel's active conversation window. When `archiveStale` runs (already called at end of each loop), prune short-ID entries for archived messages. Alternatively, keep only the last N (e.g., 100) entries per channel — the LLM only sees `historyLimit` (default 30) messages anyway.

### Pitfall 3: CallParams.system Type Mismatch

**What goes wrong:** `CallParams` is typed as `CallSettings & Prompt`. The `Prompt.system` field is `string | SystemModelMessage | Array<SystemModelMessage>`. If `ModelService.call` currently receives `system: string` and the caller passes `SystemModelMessage[]`, TypeScript will accept it — but the existing code in `loop.ts` builds `systemPrompt` as a plain string and passes it directly. The split into stable/dynamic must happen before `modelService.call`.

**Why it happens:** The current `loop.ts` calls `prompt.renderToString("system", ...)` which returns a single string. There's no concept of stable vs. dynamic sections at the PromptService level.

**How to avoid:** Either (a) add a `renderSections()` method to PromptService that returns `Section[]` (already exists as `render()`), and split by injection point in `loop.ts`; or (b) pass the full string to ModelService and let ModelService split it by a known delimiter. Option (a) is cleaner: `soul` + `instructions` sections are stable, `memory` + `extra` are dynamic. The `INJECTION_POINTS` order is `["soul", "instructions", "memory", "extra"]`.

### Pitfall 4: @ai-sdk/anthropic Not Installed

**What goes wrong:** The Anthropic provider package doesn't exist yet. There's no `providers/provider-anthropic/` directory.

**Why it happens:** Only OpenAI and DeepSeek providers exist currently.

**How to avoid:** Create `providers/provider-anthropic/` mirroring `providers/provider-openai/` structure, using `createAnthropic` from `@ai-sdk/anthropic`. This is a prerequisite for OPT-01/OPT-02 to be testable end-to-end.

### Pitfall 5: send_message Result Has No Sent Message ID

**What goes wrong:** The compact format `sent #N, ok` requires knowing the short ID of the message that was sent. But the current `send_message` tool result may not return the platform message ID.

**Why it happens:** Tool results are opaque — the result content depends on what the tool implementation returns.

**How to avoid:** Check the `send_message` tool implementation to see if it returns the sent message ID. If not, the compact format can use the triggering message ID instead (the message that caused the agent to respond), or simply `sent, ok` without a target ID. The CONTEXT.md says "sent #N, ok" where N is the target message short ID — this implies the send_message tool must return the sent message's platform ID, which then gets mapped to a short ID.

## Code Examples

### SystemModelMessage with Anthropic Cache Control

```typescript
// Source: node_modules/@ai-sdk/provider-utils/dist/index.d.ts line 900-908
// Source: node_modules/@ai-sdk/provider/dist/index.d.ts lines 32-55 (providerOptions example)

import type { SystemModelMessage } from "ai";

function buildAnthropicSystemParam(
  stableContent: string,
  dynamicContent: string,
): SystemModelMessage[] {
  return [
    {
      role: "system",
      content: stableContent,
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    },
    {
      role: "system",
      content: dynamicContent,
    },
  ];
}
```

### Cache Token Logging

```typescript
// Source: node_modules/ai/dist/index.d.ts lines 283-287 (inputTokenDetails)

const result = await generateText({ model: wrappedModel, ...merged });

const cacheWrite = result.usage.inputTokenDetails?.cacheWriteTokens ?? 0;
const cacheRead = result.usage.inputTokenDetails?.cacheReadTokens ?? 0;
if (cacheWrite > 0 || cacheRead > 0) {
  logger.debug(
    `[${traceId}] cache write=${cacheWrite} read=${cacheRead}`,
  );
}
```

### PromptService.render() for Section Split

```typescript
// Source: core/src/services/prompt/service.ts lines 113-141
// Source: core/src/services/prompt/types.ts lines 1-3

// INJECTION_POINTS = ["soul", "instructions", "memory", "extra"]
// Stable = soul + instructions (indices 0-1)
// Dynamic = memory + extra (indices 2-3)

const sections = await prompt.render("system", { view, percept });
const stableContent = sections
  .filter(s => s.name === "soul" || s.name === "instructions")
  .map(s => s.content)
  .join("\n\n");
const dynamicContent = sections
  .filter(s => s.name === "memory" || s.name === "extra")
  .map(s => s.content)
  .join("\n\n");
```

### History Message XML Format (OPT-03)

```typescript
// In HorizonService.formatObservation:
formatObservation(obs: Observation, selfId?: string, shortId?: number): string {
  if (obs.type === "message") {
    const id = shortId !== undefined ? ` id="${shortId}"` : "";
    const replyTo = obs.replyTo ? ` replyTo="${this.getShortId(channelKey, obs.replyTo)}"` : "";
    const sender = ` sender="${obs.sender.name}" senderId="${obs.sender.id}"`;
    return `<msg${id}${sender}${replyTo}>${obs.content}</msg>`;
  }
  // agent.response unchanged
}
```

### Working Memory Entry with triggeredAt (OPT-03)

```typescript
// In loop.ts wmLines builder:
for (const obs of view.history ?? []) {
  if (obs.type === "agent.response") {
    const d = obs.data;
    // Find the triggering message: the last message before this agent response
    const triggerShortId = findTriggerShortId(view.history, obs);
    const triggerLabel = triggerShortId ? ` (triggered by #${triggerShortId})` : "";
    const lines = [`Round ${d.round}${triggerLabel}:`];
    // ... rest of wmLines construction
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `system: string` only | `system: string \| SystemModelMessage \| SystemModelMessage[]` | AI SDK v6 | Enables per-block provider options including cache control |
| `result.usage.cachedInputTokens` | `result.usage.inputTokenDetails.cacheReadTokens` | AI SDK v6 | Old field deprecated; new field is in `inputTokenDetails` |
| Round N labels only in WM | Round N + triggered by #M | Phase 25 | LLM can correlate tool execution to specific chat messages |

**Deprecated/outdated:**
- `result.usage.cachedInputTokens`: deprecated in AI SDK v6, use `result.usage.inputTokenDetails.cacheReadTokens`

## Open Questions

1. **Does send_message tool return the sent message platform ID?**
   - What we know: `send_message` is a plugin tool; its result is whatever the tool implementation returns
   - What's unclear: Whether the current implementation returns the sent message ID in its result
   - Recommendation: Check `plugins/` for the send_message tool implementation before implementing OPT-04. If it doesn't return the ID, either (a) update the tool to return it, or (b) use a simpler format like `sent, ok` without the target ID

2. **Short-ID map: HorizonService vs loop.ts**
   - What we know: HorizonService owns message records; loop.ts is stateless per-invocation
   - What's unclear: Whether adding mutable state to HorizonService is acceptable given its current design
   - Recommendation: Add `assignShortId(channelKey, platformMsgId): number` to HorizonService. It's the natural owner. The map can be pruned alongside `archiveStale`.

3. **PromptService.render() vs renderToString() for section split**
   - What we know: `render()` already returns `Section[]` with `name` field; `renderToString()` just joins them
   - What's unclear: Whether the planner should change `loop.ts` to call `render()` instead of `renderToString()`
   - Recommendation: Yes — change `loop.ts` to call `render()` and split sections by name. This is a clean, minimal change.

## Sources

### Primary (HIGH confidence)
- `node_modules/ai/dist/index.d.ts` — `SystemModelMessage`, `Prompt.system` type, `LanguageModelUsage.inputTokenDetails`
- `node_modules/@ai-sdk/provider-utils/dist/index.d.ts` — `SystemModelMessage` type definition (lines 900-908), `ProviderOptions` type
- `node_modules/@ai-sdk/provider/dist/index.d.ts` — `SharedV3ProviderOptions` with `cacheControl` example (lines 32-55)
- `core/src/services/prompt/types.ts` — `INJECTION_POINTS`, `Section` type
- `core/src/services/prompt/service.ts` — `render()` returns `Section[]`; `renderToString()` joins them
- `core/src/services/agent/loop.ts` — wmLines construction, `formatToolResults`, `CallParams` usage
- `core/src/services/horizon/service.ts` — `formatObservation`, `formatHorizonText`, `buildView`
- `core/src/services/model/service.ts` — `executeCall`, `GenerateResult`, provider lookup
- `packages/shared-model/src/types/model.ts` — `IModelProvider.providerType: string` (line 49)
- `providers/provider-openai/src/index.ts` — `readonly providerType = "openai"` pattern to mirror for Anthropic

### Secondary (MEDIUM confidence)
- `providers/provider-deepseek/src/index.ts` — `readonly providerType = "deepseek"` confirms pattern is consistent

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — AI SDK v6 types verified directly from installed node_modules
- Architecture: HIGH — all relevant source files read; patterns derived from existing code
- Pitfalls: HIGH — derived from direct code inspection; cache field names verified from type definitions

**Research date:** 2026-02-25
**Valid until:** 2026-03-25 (AI SDK v6 is stable; Anthropic cache API is stable)
