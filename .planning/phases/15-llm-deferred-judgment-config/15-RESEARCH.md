# Phase 15: LLM Deferred Judgment & Model Config Refactor - Research

**Researched:** 2026-02-21
**Domain:** Willingness decision system / Model configuration architecture
**Confidence:** HIGH

## Summary

Phase 15 adds LLM deferred judgment for borderline SKIP decisions in the willingness system and refactors model configuration to move fallback chains into per-module configs. The current `AgentCore.gateAndEnqueue()` in `service.ts` makes a binary REPLY/SKIP decision via `WillingnessEngine.processMessage()`. When SKIP occurs but willingness is above a configurable threshold, a deferred timer should schedule an LLM judgment call. The timer delay is inversely proportional to willingness — higher willingness means shorter delay. If a new message arrives in the same channel before the timer fires, the timer is cancelled and normal processing resumes.

The model config refactor removes top-level `defaultModel` and `fallbackChains` from `ModelServiceConfig` and the root Schema. Instead, `AgentCoreConfig` and `WillingnessConfig` each get their own `fallbackChain: string[]` field rendered via `Schema.array(Schema.dynamic("registry.chatModels"))`. A new `judgmentModel` field is added to `WillingnessConfig` for the deferred LLM call.

**Primary recommendation:** Implement deferred judgment as a `Map<string, Disposable>` of `ctx.setTimeout` timers in `AgentCore`, triggered from `gateAndEnqueue` when SKIP + threshold condition met. Use `generateText` with a minimal prompt for the binary yes/no LLM judgment. Refactor config by removing `ModelServiceConfig.defaultModel`/`fallbackChains` and adding per-module `fallbackChain` arrays.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- 固定阈值触发：willingness 结果为 SKIP 但基础分数超过可配置阈值时触发延迟判断
- 反比延迟：willingness 越高延迟越短，线性映射到配置的时间范围
- 同会话消息取消：延迟期间同一会话/频道收到新消息时取消当前延迟计时器，新消息走自己的 willingness 流程（可能再次进入延迟判断）
- LLM 判断为 no 时直接终止，等待下一条消息触发新流程
- 输入：当前对话上下文 + willingness 分数，让 LLM 有充分信息判断
- 输出：二元 yes/no 判断，不需要返回理由
- 模型：单独配置 judgment 专用模型（轻量级即可）
- 失败处理：调用失败（超时、模型错误等）时默认保持 SKIP
- 各模块独立配置：AgentCoreConfig 和 WillingnessConfig 各自配置主模型 + fallbackChain
- 删除全局字段：移除顶层 defaultModel / fallbackModel
- 空数组 = 无 fallback：fallbackChain 为空时主模型失败直接失败
- 直接删除旧字段：不做自动迁移，用户需重新配置
- 走正常心跳流程：LLM 判断 yes 后走完整 AgentCore 心跳循环
- 用原始触发时上下文：延迟判断触发时的上下文就是最新的
- 详细日志：记录触发原因、延迟时长、LLM 判断结果等调试信息

### Claude's Discretion
- 延迟时间的具体映射范围和算法
- judgment prompt 的具体设计
- 日志格式和级别
- fallbackChain Schema.dynamic 的具体实现方式

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AGENT-02 | 混合回复决策 — 规则引擎快速筛选 + LLM 精细判断 | Deferred judgment adds the LLM fine-grained judgment layer on top of the existing rule-based WillingnessEngine. The rule engine (Phase 10) handles fast REPLY/SKIP; this phase adds LLM judgment for borderline SKIPs. Config refactor ensures each module has its own model + fallbackChain. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ai (ai-sdk) | v6 | `generateText` for LLM judgment call | Already used throughout for model calls |
| koishi | 4.x | `ctx.setTimeout` for cancellable timers, `Schema.dynamic` for config UI | Framework — auto-dispose on plugin unload |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @yesimbot/shared-model | workspace | `parseModelId` for model string parsing | Resolving judgment model config |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `ctx.setTimeout` | raw `setTimeout` | ctx.setTimeout auto-cancels on dispose — always prefer it per project conventions |
| Structured output (JSON mode) | Plain text parsing | Structured output adds complexity; simple text "yes"/"no" parsing is sufficient for binary judgment |

## Architecture Patterns

### Recommended Project Structure
```
plugins/core/src/services/agent/
├── config.ts              # AgentCoreConfig gains fallbackChain[]
├── willingness-config.ts  # WillingnessConfig gains judgmentModel, deferredThreshold, delay range, fallbackChain[]
├── willingness.ts         # WillingnessEngine unchanged (pure algorithm)
├── service.ts             # AgentCore gains deferred timer map + LLM judgment logic
├── loop.ts                # ThinkActLoop reads fallbackChain from config instead of single fallbackModel
└── tools.ts               # Unchanged
```

### Pattern 1: Deferred Timer Map in AgentCore
**What:** A `Map<string, Disposable>` keyed by channelKey stores pending deferred judgment timers. When a new message arrives for the same channel, the existing timer is cancelled before normal willingness processing.
**When to use:** Every time `gateAndEnqueue` is called.
**Example:**
```typescript
// In AgentCore
private deferredTimers = new Map<string, () => void>();

private async gateAndEnqueue(percept: Percept): Promise<void> {
  const channelKey = `${percept.scope.platform}:${percept.scope.channelId}`;

  // Cancel any pending deferred judgment for this channel
  const cancel = this.deferredTimers.get(channelKey);
  if (cancel) {
    cancel();
    this.deferredTimers.delete(channelKey);
    this.logger.info(`[deferred] ${channelKey} | cancelled by new message`);
  }

  // ... existing willingness processing ...

  if (!result.shouldReply) {
    // Check deferred threshold
    const ratio = result.probability; // already 0-1
    if (ratio >= deferredThreshold) {
      this.scheduleDeferredJudgment(channelKey, percept, ratio);
    }
    return;
  }
  // ... existing enqueue logic ...
}
```

### Pattern 2: Linear Delay Mapping
**What:** Map willingness probability to delay inversely: higher probability = shorter delay.
**When to use:** When scheduling deferred judgment timer.
**Example:**
```typescript
// Linear interpolation: probability closer to 1 → delay closer to minDelay
// probability at threshold → delay at maxDelay
function computeDeferredDelay(
  probability: number,
  threshold: number,
  minDelayMs: number,
  maxDelayMs: number,
): number {
  // Normalize probability from [threshold, 1] to [0, 1]
  const normalized = (probability - threshold) / (1 - threshold);
  // Invert: high probability → low delay
  return maxDelayMs - normalized * (maxDelayMs - minDelayMs);
}
```

### Pattern 3: Lightweight LLM Judgment Call
**What:** Use `generateText` with a minimal system prompt asking for yes/no. Parse first word of response.
**When to use:** When deferred timer fires.
**Example:**
```typescript
private async executeDeferredJudgment(
  channelKey: string,
  percept: Percept,
): Promise<boolean> {
  const horizon = this.ctx["yesimbot.horizon"] as HorizonService;
  const view = await horizon.buildView(percept as UserMessagePercept);
  const contextText = horizon.formatHorizonText(view);

  const result = await modelService.call(judgmentModel, {
    system: JUDGMENT_PROMPT,
    messages: [{ role: "user", content: contextText }],
    maxOutputTokens: 8,
  });

  const answer = (result?.text ?? "").trim().toLowerCase();
  return answer.startsWith("yes");
}
```

### Pattern 4: Schema.array + Schema.dynamic for fallbackChain
**What:** Use `Schema.array(Schema.dynamic("registry.chatModels"))` to render an editable list where each item is a model selector dropdown.
**When to use:** For `fallbackChain` fields in AgentCoreConfig and WillingnessConfig schemas.
**Example:**
```typescript
// In root Schema definition
fallbackChain: Schema.array(Schema.dynamic("registry.chatModels"))
  .default([])
  .description("Fallback model chain (tried in order when primary fails)"),
```

### Anti-Patterns to Avoid
- **Raw setTimeout:** Always use `ctx.setTimeout` — auto-cancelled on plugin dispose, prevents memory leaks
- **Storing timer IDs instead of cancel functions:** `ctx.setTimeout` returns a dispose function, not a numeric ID. Store the dispose function directly.
- **LLM judgment with complex structured output:** Binary yes/no doesn't need JSON mode or tool calls. Plain text with `maxOutputTokens: 8` is sufficient and cheaper.
- **Sharing deferred state with WillingnessEngine:** Keep deferred judgment logic in AgentCore (orchestration layer), not in WillingnessEngine (pure algorithm). WillingnessEngine stays stateless regarding deferred decisions.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cancellable timers | Manual setTimeout + clearTimeout tracking | `ctx.setTimeout` | Auto-dispose on plugin unload, returns cancel function |
| Model resolution | Custom provider:model parsing | `parseModelId` from shared-model | Already handles edge cases, single source of truth |
| LLM call with retry/fallback | Direct `generateText` with manual retry | `ModelService.call()` | Already has retry + fallback chain logic built in |

**Key insight:** The deferred judgment is orchestration logic (belongs in AgentCore), not willingness logic (WillingnessEngine stays pure). The LLM call should go through ModelService to get retry/fallback for free.

## Common Pitfalls

### Pitfall 1: Timer Not Cancelled on Dispose
**What goes wrong:** Plugin unloads but deferred timers keep firing, causing errors on disposed contexts.
**Why it happens:** Using raw `setTimeout` instead of `ctx.setTimeout`.
**How to avoid:** Always use `ctx.setTimeout`. Additionally, clear the `deferredTimers` map in the service's `stop()` method.
**Warning signs:** Errors about accessing disposed services after plugin reload.

### Pitfall 2: Race Between Deferred Judgment and New Message
**What goes wrong:** Timer fires at the exact moment a new message arrives, causing both deferred judgment AND normal processing to run.
**Why it happens:** JavaScript event loop can interleave the timer callback and the new message handler.
**How to avoid:** Cancel timer FIRST in `gateAndEnqueue` before any willingness processing. Delete from map atomically. The deferred judgment callback should also check if the timer is still in the map before proceeding.
**Warning signs:** Duplicate replies in the same channel within milliseconds.

### Pitfall 3: Stale Percept Context After Long Delay
**What goes wrong:** Deferred judgment fires with a percept whose session may be stale.
**Why it happens:** The delay can be several seconds; the session object may have been garbage collected or invalidated.
**How to avoid:** Per user decision, new messages cancel the timer, so the percept is always "latest." The `buildView` call at judgment time fetches fresh timeline data from the database. The session reference in the percept is only needed for sending — verify it's still valid before proceeding.
**Warning signs:** Null reference errors when trying to send after deferred judgment.

### Pitfall 4: ModelService.call Fallback Chain Confusion
**What goes wrong:** After removing global `fallbackChains` from `ModelServiceConfig`, the `handleFallback` method in ModelService has no chain to fall back to.
**Why it happens:** The global chain was the safety net; now each caller must provide its own.
**How to avoid:** Pass the per-module `fallbackChain` from config through to `ModelService.call()`. The ModelService's `handleFallback` should accept the chain as a parameter rather than reading from `this.config`.
**Warning signs:** Model failures that used to recover now throw errors.

### Pitfall 5: Schema.dynamic in Schema.array Not Rendering
**What goes wrong:** `Schema.array(Schema.dynamic("registry.chatModels"))` might not render the dynamic dropdown for each array item.
**Why it happens:** Koishi's Schema.dynamic resolves at render time; nesting inside Schema.array may require the dynamic schema to be registered before the config UI renders.
**How to avoid:** Ensure `ctx.schema.set("registry.chatModels", ...)` is called in ModelService constructor (already done — `refreshSchemas()` runs in constructor). The array items should each resolve the dynamic schema independently. Test in Koishi console after implementation.
**Warning signs:** Array items show as plain text inputs instead of model dropdowns.

## Code Examples

### Current Flow (gateAndEnqueue in service.ts)
```typescript
// Current: binary REPLY/SKIP
private async gateAndEnqueue(percept: Percept): Promise<void> {
  const channelKey = `${percept.scope.platform}:${percept.scope.channelId}`;
  const result = this.willingness.processMessage(channelKey, triggerType, content);
  if (!result.shouldReply) return;  // <-- Phase 15 adds deferred check here
  // ... enqueue logic
}
```

### Target Flow (with deferred judgment)
```typescript
private async gateAndEnqueue(percept: Percept): Promise<void> {
  const channelKey = `${percept.scope.platform}:${percept.scope.channelId}`;

  // Cancel pending deferred judgment
  this.cancelDeferred(channelKey);

  const result = this.willingness.processMessage(channelKey, triggerType, content);

  if (!result.shouldReply) {
    const cfg = this.config.willingness?.deferred;
    if (cfg && result.probability >= cfg.threshold) {
      this.scheduleDeferredJudgment(channelKey, percept, result.probability);
    }
    return;
  }
  // ... existing enqueue logic
}
```

### Config Changes (AgentCoreConfig)
```typescript
// Before
export interface AgentCoreConfig {
  model?: string;
  fallbackModel?: string;  // single model
  // ...
}

// After
export interface AgentCoreConfig {
  model?: string;
  fallbackChain?: string[];  // array replaces single fallbackModel
  // ...
}
```

### Config Changes (WillingnessConfig)
```typescript
// New fields added to WillingnessConfig
export interface DeferredJudgmentConfig {
  threshold: number;       // probability threshold to trigger (e.g., 0.3)
  minDelayMs: number;      // minimum delay in ms (e.g., 3000)
  maxDelayMs: number;      // maximum delay in ms (e.g., 15000)
  judgmentModel?: string;  // provider:model for judgment LLM
}

export interface WillingnessConfig {
  // ... existing fields ...
  deferred?: DeferredJudgmentConfig;
}
```

### ModelService Refactor (handleFallback accepts chain parameter)
```typescript
// Before: reads from this.config.fallbackChains
private async handleFallback(params: CallParams, error: unknown) {
  const chain = this.config.fallbackChains;
  // ...
}

// After: accepts chain as parameter
public async call(
  model: string | ModelSelector,
  params: CallParams,
  fallbackModel?: string | ModelSelector,
  fallbackChain?: string[],
): Promise<GenerateResult | undefined> {
  // ... try primary, try fallbackModel, then try fallbackChain
}

private async handleFallback(params: CallParams, error: unknown, chain?: string[]) {
  if (!chain || chain.length === 0) throw error;
  // ...
}
```

### Root Schema Changes
```typescript
// Before
export const Config: Schema<Config> = Schema.object({
  defaultModel: Schema.string(),
  fallbackChains: Schema.array(Schema.string()),
  model: Schema.dynamic("registry.chatModels"),
  fallbackModel: Schema.dynamic("registry.chatModels"),
  // ...
});

// After
export const Config: Schema<Config> = Schema.object({
  // defaultModel: REMOVED
  // fallbackChains: REMOVED
  // fallbackModel: REMOVED
  model: Schema.dynamic("registry.chatModels").description("Agent chat model"),
  fallbackChain: Schema.array(Schema.dynamic("registry.chatModels"))
    .default([]).description("Agent fallback chain"),
  // ...
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Global defaultModel + fallbackChains in ModelServiceConfig | Per-module model + fallbackChain in AgentCoreConfig/WillingnessConfig | Phase 15 | Each module controls its own model selection; ModelService becomes a pure execution layer |
| Binary REPLY/SKIP willingness | REPLY / DEFERRED / SKIP three-tier decision | Phase 15 | Borderline cases get LLM second opinion, reducing missed conversations |

## Open Questions

1. **Schema.array(Schema.dynamic()) rendering behavior**
   - What we know: `Schema.dynamic("registry.chatModels")` works for single fields (proven in Phase 9). `Schema.array(Schema.string())` works for plain arrays.
   - What's unclear: Whether nesting `Schema.dynamic` inside `Schema.array` renders each item as a dropdown in Koishi console. No documentation confirms this combination.
   - Recommendation: Implement and test in Koishi console. If it doesn't render correctly, fall back to `Schema.array(Schema.string())` with a description noting the `provider:model` format. LOW confidence on this specific combination working out of the box.

2. **ModelService.call signature change — backward compatibility**
   - What we know: `call()` and `streamCall()` currently accept `(model, params, fallbackModel?)`. Adding `fallbackChain?` as a 4th parameter is backward-compatible.
   - What's unclear: Whether to remove the global `handleFallback` entirely or keep it as a last resort.
   - Recommendation: Remove global chain from `ModelServiceConfig`. Pass chain explicitly from callers. ModelService becomes stateless regarding fallback policy.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `plugins/core/src/services/agent/service.ts` — current gateAndEnqueue flow
- Codebase analysis: `plugins/core/src/services/agent/willingness.ts` — WillingnessEngine API
- Codebase analysis: `plugins/core/src/services/model/service.ts` — ModelService call/streamCall/handleFallback
- Codebase analysis: `plugins/core/src/index.ts` — current Schema definitions and Config interface
- Codebase analysis: `references/YesImBot-dev/packages/core/src/agent/agent-core.ts` — v3 deferredTimers pattern

### Secondary (MEDIUM confidence)
- Codebase analysis: `plugins/core/src/services/horizon/service.ts` — buildView API for context generation
- Codebase analysis: `references/YesImBot-v3/packages/core/src/agent/scheduler.ts` — deferred timer pattern in v3

### Tertiary (LOW confidence)
- Schema.array(Schema.dynamic()) combination — no official docs found confirming this works; needs runtime validation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in use, no new dependencies
- Architecture: HIGH — deferred timer pattern proven in v3 reference, clear integration points in current AgentCore
- Pitfalls: HIGH — race conditions and timer lifecycle well-understood from v3 patterns and Koishi conventions
- Schema.dynamic in array: LOW — untested combination, needs runtime validation

**Research date:** 2026-02-21
**Valid until:** 2026-03-21 (stable domain, no external dependency changes expected)
