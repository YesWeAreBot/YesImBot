# Phase 13: Non-stream Path & Fallback Wiring - Research

**Researched:** 2026-02-20
**Domain:** Agent loop model invocation, fallback chains, tool assembly
**Confidence:** HIGH

## Summary

The non-stream path in `loop.ts` (line 92) calls `generateText()` directly with a raw `LanguageModel` obtained from `modelService.getModel()`, completely bypassing `modelService.call()`. This means the non-stream path gets no PQueue concurrency control and no fallback chain. The stream path already correctly uses `modelService.streamCall()`.

Additionally, `AgentCoreConfig.fallbackModel` is declared and passed from root config but never consumed anywhere — it needs to be wired into ModelService's fallback chain. The `classifyError` function is missing 503 status handling (user decision requires 429/503/timeout to trigger fallback). The finishTool is hardcoded in `buildAiSdkTools` separately from the plugin system's tool registry, which is the single assembly point but mixes concerns.

**Primary recommendation:** Replace the direct `generateText()` call in `loop.ts` with `modelService.call()`, wire `fallbackModel` into the fallback chain, fix `classifyError` to handle 503, and consolidate finishTool injection.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Fallback 行为
- 切换时记录 warn 级别日志，不影响用户体验（不通知用户）
- 仅临时性错误触发 fallback（429/503/超时），认证错误等直接报错
- 主模型重试 1-2 次后仍失败再切换 fallback
- 遍历整条 fallback 链，全部失败才最终报错

#### 非流式路径统一策略
- ModelService 提供 call() 和 stream() 双方法，共享 fallback/PQueue 逻辑
- 非流式和流式路径行为语义完全一致（相同的 fallback 链、并发限制、错误处理）
- 顺便确保流式路径也走 ModelService（如果尚未统一）
- 正常路径必须走 ModelService，特殊场景（测试/调试）允许直接调用 ai-sdk

#### finishTool 清理范围
- 修复双重包含 bug + 小幅整理 tool 注入逻辑
- finishTool 始终自动包含，不需要配置开关
- tool 注入收敛到单一组装点，而非多处分散拼接

#### parseModelId 处置
- parseModelId 已迁移到 shared-model，正式使用（不移除）
- 已引入 `type ModelSelector = { provider: string; model: string }` 规范类型
- 边界解析策略：用户配置输入处解析一次 provider:model 字符串为 ModelSelector，内部全部传递 ModelSelector 对象
- fallbackModel 配置格式与主模型相同（provider:model 字符串），边界统一解析
- 解析逻辑和可用性判断全部收敛到 ModelService 内部，调用方只传 ModelSelector

### Claude's Discretion
- 重试次数的具体值（1 或 2 次）
- fallback 链遍历的具体实现方式
- call()/stream() 内部共享逻辑的抽取方式
- tool 组装点的具体位置选择

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AGENT-01 | AgentCore as framework-agnostic orchestrator, accepts Percept, drives think-act loop | Non-stream path must go through ModelService.call() to gain concurrency/fallback — currently bypassed at loop.ts:92 |
| AGENT-03 | Heartbeat loop — stimulus → context build → LLM → tool exec → respond (with streamMode branch) | Both stream and non-stream branches must share identical ModelService behavior; non-stream currently raw |
| MODEL-01 | Provider plugins register models to ModelService with independent config | ModelService.call() already uses registered providers; loop.ts bypasses this by using getModel() directly |
| MODEL-04 | Dynamic Schema linkage — registered models appear in config dropdown | Already complete; parseModelId at config boundary ensures selected model string is valid |
| MODEL-05 | Schema hot-update — provider hot-plug refreshes model list | Already complete; relevant because fallbackModel also uses Schema.dynamic("registry.chatModels") |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ai (ai-sdk) | v6 | generateText/streamText, ToolSet, StepResult | Already in use; provides the LLM call primitives |
| p-queue | current | Concurrency control in ModelService | Already in use; limits parallel model calls |
| @yesimbot/shared-model | workspace | parseModelId, ModelSelector, classifyError, ErrorCategory | Already in use; shared types and utilities |
| koishi | 4.x | Service framework, Context, Schema | Already in use; plugin host |

### Supporting
No new libraries needed. All changes are internal refactoring of existing code.

## Architecture Patterns

### Pattern 1: ModelService as Single Gateway

**What:** All LLM calls (stream and non-stream) go through ModelService.call() or ModelService.streamCall(). No direct generateText/streamText in consumer code.

**Current state (broken):**
```
loop.ts (stream):    modelService.streamCall()  → PQueue + fallback ✓
loop.ts (non-stream): generateText({ model })   → raw call, no PQueue, no fallback ✗
```

**Target state:**
```
loop.ts (stream):     modelService.streamCall() → PQueue + fallback ✓
loop.ts (non-stream): modelService.call()       → PQueue + fallback ✓
```

**Key change in loop.ts:** Replace lines 51 and 92:
```typescript
// BEFORE (line 51): gets raw model, bypasses ModelService
const { model, defaultParams } = modelService.getModel(config.model ?? "") ?? {};
// BEFORE (line 92): direct generateText call
const result = await Promise.race([generateText({ model, ...callParams }), timeoutPromise]);

// AFTER: use modelService.call() which handles PQueue + fallback
const result = await Promise.race([modelService.call(config.model ?? "", callParams), timeoutPromise]);
```

This eliminates the need for `modelService.getModel()` in loop.ts entirely. The `defaultParams` merge happens inside `ModelService.executeCall()` already.

### Pattern 2: Retry-then-Fallback in ModelService

**What:** ModelService retries the primary model 1-2 times on transient errors before walking the fallback chain.

**Current state:** No retry — immediate fallback on first transient error.

**Target state:**
```
Primary model attempt 1 → fail (transient) →
Primary model attempt 2 → fail (transient) →
Fallback[0] attempt → fail →
Fallback[1] attempt → fail →
... → throw original error
```

**Implementation location:** Inside `ModelService.call()` and `ModelService.streamCall()`, wrapping `executeCall` with a retry loop before entering `handleFallback`.

### Pattern 3: fallbackModel Wiring

**What:** `AgentCoreConfig.fallbackModel` is a single `provider:model` string that should be consulted when the primary model fails.

**Current state:** `fallbackModel` is declared in config, passed to AgentCore, but never used. `ModelServiceConfig.fallbackChains` is a separate array used by ModelService internally.

**Design decision needed:** How to connect these two. Options:
1. **AgentCore passes fallbackModel to ModelService.call()** — ModelService.call() accepts an optional fallback parameter
2. **Merge at config boundary** — Root plugin merges `fallbackModel` into `fallbackChains` when constructing ModelService config

**Recommendation:** Option 1 — pass fallbackModel as a parameter to `modelService.call(model, params, fallbackModel?)`. This keeps the per-agent fallback separate from the global fallback chain. ModelService tries: primary → retry → agent fallback → global chain.

### Pattern 4: Config Boundary Parsing

**What:** Parse `provider:model` strings to `ModelSelector` at the config boundary, pass `ModelSelector` internally.

**Current state:** `loop.ts` passes raw strings like `config.model ?? ""` to ModelService. ModelService re-parses inside call()/streamCall()/getModel().

**Target state:** Parse once in loop.ts (or AgentCore), pass `ModelSelector` objects. ModelService.call() already accepts `ModelSelector`.

### Anti-Patterns to Avoid
- **Raw generateText/streamText in consumer code:** All calls must go through ModelService to get concurrency + fallback
- **Parsing model strings deep inside call chains:** Parse at boundary, pass typed objects
- **Silent fallback without logging:** User decision requires warn-level logging on fallback switch

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Retry logic | Custom retry with backoff | Simple for-loop with configurable count (1-2) | Only 1-2 retries needed, no exponential backoff complexity warranted |
| Error classification | New error categorizer | Existing `classifyError()` in shared-model | Already handles most cases, just needs 503 added |
| Concurrency control | Manual semaphore | Existing PQueue in ModelService | Already wired and working |

## Common Pitfalls

### Pitfall 1: defaultParams Double-Merge
**What goes wrong:** If loop.ts merges defaultParams into callParams AND ModelService.executeCall() also merges defaultParams, parameters get applied twice or conflict.
**Why it happens:** Currently loop.ts line 51 gets `defaultParams` from `modelService.getModel()` and spreads them into callParams (line 73-81). ModelService.executeCall() line 128 also merges defaults.
**How to avoid:** When switching to `modelService.call()`, remove the `defaultParams` extraction and spread from loop.ts. Let ModelService handle it.
**Warning signs:** Unexpected parameter values, temperature/maxTokens different from config.

### Pitfall 2: onStepFinish Compatibility with ModelService.call()
**What goes wrong:** The current `callParams` includes `onStepFinish`, `stopWhen`, `tools`, `toolChoice` — these are ai-sdk generateText parameters. ModelService.call() spreads them via `{ ...defaults, ...params }` into generateText, so they should pass through.
**Why it happens:** `CallParams = CallSettings & Prompt` may not include all generateText-specific fields in its type.
**How to avoid:** Verify that `CallParams` type accommodates `onStepFinish`, `stopWhen`, `tools`, `toolChoice`. The existing `as CallParams` cast on line 81 handles this at runtime, but the type may need widening or the cast must remain.
**Warning signs:** TypeScript errors on callParams, missing step callbacks.

### Pitfall 3: Fallback Model Getting Same Transient Error
**What goes wrong:** If the error is rate-limiting (429) from a shared API endpoint, the fallback model on the same provider hits the same limit.
**Why it happens:** Both primary and fallback may use the same provider/API key.
**How to avoid:** This is acceptable per user decision — walk the entire chain, all fail = final error. No special handling needed.

### Pitfall 4: classifyError Missing 503
**What goes wrong:** 503 Service Unavailable is not classified as TRANSIENT, so it throws immediately instead of triggering fallback.
**Why it happens:** Current `classifyError` only checks 429 for rate limit and 401/403 for auth. 503 falls through to PERMANENT.
**How to avoid:** Add `status === 503` check to return `ErrorCategory.TRANSIENT`.

### Pitfall 5: finishTool Name Collision
**What goes wrong:** `buildAiSdkTools` starts with `{ finish: finishTool }` then iterates plugin tools. If a plugin registers a function named "finish", it overwrites the built-in finishTool.
**Why it happens:** No guard against name collision.
**How to avoid:** Add finishTool AFTER plugin tools, or use a reserved name check.

## Code Examples

### Current Non-stream Path (loop.ts lines 50-93) — BEFORE
```typescript
// Gets raw model, bypasses ModelService gateway
const { model, defaultParams } = modelService.getModel(config.model ?? "") ?? {};
// ... builds callParams with defaultParams spread ...
const result = await Promise.race([generateText({ model, ...callParams }), timeoutPromise]);
```

### Target Non-stream Path — AFTER
```typescript
// No getModel() call needed — ModelService handles everything
const result = await Promise.race([
  modelService.call(config.model ?? "", callParams),
  timeoutPromise,
]);
```

### Retry Logic in ModelService (new)
```typescript
private async withRetry<T>(
  fn: () => Promise<T>,
  retries: number,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const category = classifyError(error);
      if (category !== ErrorCategory.TRANSIENT && category !== ErrorCategory.RATE_LIMIT) throw error;
      if (i < retries) this.logger.warn(`Retry ${i + 1}/${retries} after transient error`);
    }
  }
  throw lastError;
}
```

### classifyError Fix (shared-model/errors.ts)
```typescript
// Add 503 handling:
if (status === 503) return ErrorCategory.TRANSIENT;
```

### fallbackModel Wiring in ModelService.call()
```typescript
public async call(
  model: string | ModelSelector,
  params: CallParams,
  fallbackModel?: string | ModelSelector,  // NEW parameter
): Promise<GenerateResult | undefined> {
  // ... parse model ...
  // ... retry primary ...
  // ... on transient failure: try fallbackModel first, then fallbackChains ...
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct generateText in loop.ts | Should use ModelService.call() | This phase | Gains PQueue + fallback |
| No retry before fallback | Retry 1-2 times then fallback | This phase | Reduces unnecessary fallback switches |
| 503 not classified | 503 = TRANSIENT | This phase | Enables fallback on service unavailable |
| fallbackModel unused | Wired into ModelService call chain | This phase | Config actually takes effect |

## Open Questions

1. **CallParams type width**
   - What we know: `CallParams = CallSettings & Prompt` from ai-sdk. The loop passes `onStepFinish`, `stopWhen`, `tools`, `toolChoice` via `as CallParams` cast.
   - What's unclear: Whether ModelService.call() needs a wider type to accommodate these fields without casting.
   - Recommendation: Keep the `as CallParams` cast for now — it works at runtime. A future cleanup could widen the type.

2. **ModelService.getModel() — keep or remove?**
   - What we know: After this phase, loop.ts won't use `getModel()`. It's a public method on ModelService.
   - What's unclear: Whether any other consumer uses it.
   - Recommendation: Keep it as a public API but remove the import from loop.ts. It may be useful for diagnostics.

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection of all files in `plugins/core/src/services/agent/` and `plugins/core/src/services/model/`
- `packages/shared-model/src/` — parseModelId, ModelSelector, classifyError implementations
- `plugins/core/src/index.ts` — root config wiring

### Secondary (MEDIUM confidence)
- ai-sdk v6 API patterns from existing codebase usage (generateText, streamText, ToolSet, StepResult)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries, all existing code
- Architecture: HIGH — clear gap identified (direct generateText vs ModelService.call()), straightforward fix
- Pitfalls: HIGH — identified from direct code reading, especially defaultParams double-merge and 503 gap

**Research date:** 2026-02-20
**Valid until:** 2026-03-20 (stable internal refactoring, no external dependency changes)
