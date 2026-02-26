# Technology Stack

**Project:** Athena (YesImBot v4) — v2.4 Runtime & Polish
**Researched:** 2026-02-26
**Overall confidence:** HIGH (all findings verified from installed node_modules and reference source)

---

## Scope

This is a **subsequent milestone** research file. The base stack is already in production. This file covers only what is **new or changed** for v2.4's four feature areas:

1. Model group load balancing
2. Provider architecture optimization
3. Koishi config UI grouping
4. Runtime bug fixes (message queue, Bot Action empty record, tool trim)

---

## Current Stack (Verified from node_modules)

| Package | Installed Version | Role |
|---------|------------------|------|
| `ai` | 6.0.91 | Core LLM SDK — generateText/streamText/wrapLanguageModel |
| `@ai-sdk/openai` | ^3.0.0 | OpenAI provider adapter |
| `@ai-sdk/anthropic` | ^3.0.47 | Anthropic provider adapter |
| `@ai-sdk/deepseek` | ^3.0.0 | DeepSeek provider adapter |
| `p-queue` | 5.0.0 | Concurrency queue in ModelService |
| `schemastery` | 3.17.2 | Koishi Schema engine (via koishi dep) |
| `koishi` | ^4.18.3 | Framework |
| `typescript` | ^5.9.3 | Type checking |
| `turbo` | ^2.8.9 | Monorepo task orchestration |

---

## Feature 1: Model Group Load Balancing

### What needs to be built

`ModelService` currently routes calls to a single `provider:model` string via `resolveModel()`. Load balancing requires:

- A named group concept: `{ name: string; models: string[] }`
- A selection strategy per group: round-robin, failover, weighted-random, random
- Per-model runtime state: failure count, circuit breaker open-until, EMA latency, success rate
- `resolveModel()` must accept a group name and delegate to a `ModelGroupSwitcher`

### Stack decision: pure TypeScript, no new library

The v3-dev reference (`references/YesImBot-dev/packages/core/src/services/model/chat-switcher.ts`) already implements the full pattern — `ChatModelSwitcher` with all four strategies, EMA latency tracking, and circuit breaker. This is ~160 lines of pure TypeScript with zero external dependencies.

**Do NOT add** `cockatiel`, `opossum`, or any circuit-breaker library. The v3 implementation is self-contained, production-validated, and fits the existing `ModelService` architecture exactly. A library would add abstraction over a 30-line state machine.

**Do NOT add** `p-retry`. `ModelService.withRetry()` already exists and handles transient/rate-limit errors.

### New types for `shared-model`

```typescript
// packages/shared-model/src/types/model.ts — additions

export enum SwitchStrategy {
  RoundRobin = 'round_robin',
  Failover = 'failover',
  Random = 'random',
  WeightedRandom = 'weighted_random',
}

export interface ModelGroup {
  name: string;
  models: string[];                    // provider:model strings
  strategy?: SwitchStrategy;
  weights?: Record<string, number>;    // WeightedRandom only
  breaker?: {
    enabled: boolean;
    threshold?: number;                // consecutive failures before open
    cooldownMs?: number;               // how long to stay open
  };
}
```

### New file: `ModelGroupSwitcher`

```typescript
// core/src/services/model/switcher.ts  (new file, ~120 lines)

interface ModelRuntimeState {
  failureCount: number;
  openUntil?: number;
  totalRequests: number;
  successRequests: number;
  averageLatency: number;
  weight: number;
}

export class ModelGroupSwitcher {
  private states = new Map<string, ModelRuntimeState>();
  private rrIndex = 0;

  constructor(private group: ModelGroup) {
    for (const m of group.models) {
      this.states.set(m, {
        failureCount: 0, totalRequests: 0,
        successRequests: 0, averageLatency: 0,
        weight: group.weights?.[m] ?? 1,
      });
    }
  }

  pick(): string | undefined { /* strategy dispatch */ }
  recordResult(model: string, success: boolean, latencyMs: number): void { /* EMA + breaker */ }
}
```

### Integration in `ModelService`

- Add `private groups = new Map<string, ModelGroupSwitcher>()` field
- `resolveModel()` checks group map first, then falls back to `provider:model` parse
- `registerGroup(group: ModelGroup)` method — called from `ModelServiceConfig` on init
- `refreshSchemas()` adds `registry.chatModelOrGroup` dynamic schema (group names + individual models)

### Schema additions for `ModelServiceConfig`

```typescript
// Extend ModelServiceConfigSchema in core/src/services/model/service.ts

groups: Schema.array(
  Schema.object({
    name: Schema.string().required().description('Group name'),
    models: Schema.array(Schema.dynamic('registry.chatModels')).required(),
    strategy: Schema.union([
      Schema.const(SwitchStrategy.Failover).description('Failover — best success rate first'),
      Schema.const(SwitchStrategy.RoundRobin).description('Round-robin'),
      Schema.const(SwitchStrategy.Random).description('Random'),
      Schema.const(SwitchStrategy.WeightedRandom).description('Weighted random'),
    ]).default(SwitchStrategy.Failover),
    breaker: Schema.object({
      enabled: Schema.boolean().default(false),
      threshold: Schema.number().default(5),
      cooldownMs: Schema.number().default(60000),
    }).collapse().description('Circuit breaker'),
  }).collapse()
).default([]).description('Model groups for load balancing / failover'),
```

**Confidence: HIGH** — pattern verified from v3-dev reference (production-validated), no external deps needed.

---

## Feature 2: Provider Architecture Optimization

### Current duplication (verified by reading all three providers)

All three providers repeat identically:
- `Config` interface: `id`, `apiKey`, `baseURL`, `models: ModelInfo[]`, `defaultParams`
- `Schema.array(Schema.object({ id, tool_call, reasoning, modalities })).role('table')` block
- `IModelProvider` boilerplate: `listModels()`, `getDefaultParams()`, constructor model mapping

### Stack decision: extract to `shared-model`, no new packages

Move shared config types and Schema fragments into `packages/shared-model/src/types/provider.ts` (new file). Each provider imports and extends.

```typescript
// packages/shared-model/src/types/provider.ts  (new file)

export interface BaseProviderConfig {
  id: string;
  apiKey: string;
  baseURL: string;
  models: ModelInfo[];
  defaultParams: ModelDefaultParams;
}

// Reusable Schema fragment
export const ModelInfoSchema = Schema.object({
  id: Schema.string().required(),
  tool_call: Schema.boolean().default(true),
  reasoning: Schema.boolean().default(false),
  modalities: Schema.array(
    Schema.union([...Modality values...])
  ).default([Modality.Text]).role('checkbox'),
});

export const BaseProviderConfigSchema = Schema.object({
  id: Schema.string().required(),
  apiKey: Schema.string().role('secret').required(),
  baseURL: Schema.string().required(),
  models: Schema.array(ModelInfoSchema).role('table'),
});
```

Provider-specific extras use `Schema.intersect`:

```typescript
// provider-anthropic/src/index.ts
export const Config: Schema<Config> = Schema.intersect([
  BaseProviderConfigSchema,
  Schema.object({
    defaultParams: Schema.object({ temperature, maxTokens }),
    projectId: Schema.string().default('unknown'),
    sessionId: Schema.string().default('unknown'),
  }),
]);
```

`Schema.intersect` is confirmed available in schemastery 3.17.2 (read from source).

### Abstract base class

```typescript
// packages/shared-model/src/provider/base.ts  (new file)

export abstract class BaseProvider implements IModelProvider {
  abstract readonly providerType: string;
  abstract getModel(modelId: string): LanguageModel;

  constructor(
    readonly id: string,
    readonly models: ModelInfo[],
    readonly defaultParams: ModelDefaultParams,
  ) {}

  listModels(): Record<string, ModelInfo> {
    return Object.fromEntries(this.models.map(m => [m.id, m]));
  }

  getDefaultParams(): ModelDefaultParams {
    return this.defaultParams;
  }
}
```

Each provider class extends `BaseProvider` and only implements `getModel()`. This eliminates ~30 lines of identical code per provider.

**Confidence: HIGH** — pure TypeScript, no new deps, schemastery `intersect` confirmed.

---

## Feature 3: Koishi Config UI Grouping

### Mechanism: `Schema.object().description()` + `.collapse()`

Koishi Console renders `Schema.object({ ... }).description('Section Title')` as a labeled collapsible section. Confirmed in schemastery 3.17.2 source:

- `collapse?: boolean` is in `Schemastery.Meta<T>` interface (line 79)
- `.collapse(value?: boolean)` is a prototype method (line 123)
- `.description(text: string)` is a prototype method (line 121)

`Schema.intersect([...])` of multiple `Schema.object().description()` blocks produces a multi-section config UI. This pattern is used extensively in v3-dev (`references/YesImBot-dev/packages/core/src/services/model/config.ts`).

### `AgentCoreConfigSchema` grouping

Current flat `Schema.object({...})` with ~15 fields becomes:

```typescript
export const AgentCoreConfigSchema: Schema<AgentCoreConfig> = Schema.intersect([
  Schema.object({
    model: Schema.dynamic('registry.chatModelOrGroup').description('Chat model or group'),
    fallbackChain: Schema.array(Schema.dynamic('registry.chatModels')).default([]),
  }).description('模型配置'),

  Schema.object({
    maxRounds: Schema.number().default(3),
    streamMode: Schema.boolean().default(false),
    globalTimeout: Schema.number().default(120000),
    maxToolResultLength: Schema.number().default(4000),
    enableThoughts: Schema.boolean().default(true),
  }).description('推理参数'),

  Schema.object({
    charBudget: Schema.number().default(30000),
    keepLastRounds: Schema.number().default(2),
    softTrimHead: Schema.number().default(800),
    softTrimTail: Schema.number().default(800),
  }).description('工作记忆'),

  Schema.object({
    aggregationWindow: Schema.number().default(1500),
    errorReportChannel: Schema.string(),
    debugLevel: Schema.union([...]).default(2),
  }).description('系统'),

  Schema.object({
    willingness: WillingnessSchema,
  }).description('意愿值'),
]);
```

Note: `model` field changes from `Schema.dynamic('registry.chatModels')` to `Schema.dynamic('registry.chatModelOrGroup')` to expose group names alongside individual models.

### Provider config grouping

Each provider's flat `Schema.object` splits into `Schema.intersect([connectionGroup, modelsGroup, paramsGroup])`:

```typescript
// Example for provider-openai
export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    id: ..., apiKey: ..., baseURL: ...,
  }).description('连接配置'),
  Schema.object({
    models: Schema.array(ModelInfoSchema).role('table'),
  }).description('模型列表'),
  Schema.object({
    defaultParams: Schema.object({ temperature, maxTokens, topP }),
  }).description('默认参数').collapse(),
]);
```

**Confidence: HIGH** — schemastery API confirmed from installed source, pattern confirmed from v3-dev reference.

---

## Feature 4: Runtime Bug Fixes

All three bugs are pure logic fixes. No stack changes, no new dependencies.

### Bug 1: Bot Action empty record

When LLM decides not to reply, `ThinkActLoop` records an empty `[Bot Action]` to the timeline. Fix: conditional guard in `core/src/services/agent/loop.ts` before `horizon.addEvent()`. One-line check.

### Bug 2: Tool trim not working

Working memory trimmer (`core/src/services/agent/trimmer.ts`) — `softTrim`/`hardClear` thresholds not evaluated correctly. Fix: logic correction in trimmer. No new deps.

### Bug 3: Message queue — in-flight ignored, backlog merged

Current `AgentCore.enqueue()` uses a `pending: Map<string, LoopPayload>` that stores only the **last** event while a loop is running — new messages arriving during processing are silently dropped (only the last one is kept). The fix accumulates arriving events into a queue and merges them before the next loop run.

The fix is in `core/src/services/agent/service.ts`:
- Change `pending: Map<string, LoopPayload>` to `pending: Map<string, LoopPayload[]>`
- On loop completion, merge all accumulated payloads (combine content, use latest event metadata)
- No new libraries — pure Promise chain logic already in place

**Confidence: HIGH** — bug confirmed by reading `service.ts` enqueue/pending logic directly.

---

## No New Runtime Dependencies Required

All v2.4 features are achievable with the existing stack:

| Feature | Approach | New Dep? |
|---------|----------|----------|
| Load balancing strategies | Pure TS `ModelGroupSwitcher` | No |
| Circuit breaker | Inline state machine (v3 pattern) | No |
| Provider abstraction | `BaseProvider` in shared-model | No |
| Config UI grouping | `Schema.intersect` + `.description()` | No |
| Bug fixes | Logic fixes in existing files | No |

---

## Recommended Stack (No Changes)

| Technology | Version | Keep/Change | Rationale |
|------------|---------|-------------|-----------|
| `ai` | 6.0.91 | Keep | No upgrade needed for v2.4 features |
| `p-queue` | 5.0.0 | Keep | Adequate; group-level concurrency handled by switcher |
| `schemastery` | 3.17.2 | Keep | `.collapse()` / `.intersect()` confirmed available |
| `koishi` | ^4.18.3 | Keep | No framework changes needed |
| `@ai-sdk/*` | current | Keep | No new provider adapters in v2.4 |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Circuit breaker | Inline state machine | `cockatiel` / `opossum` | Overkill for 3 models; adds dep for 30 lines of logic |
| Retry logic | Existing `withRetry()` | `p-retry` | Already implemented; no gap |
| Config grouping | `Schema.intersect` | Flat schema with comments | Flat schema produces no UI sections in Koishi Console |
| Provider abstraction | `BaseProvider` abstract class | Copy-paste per provider | Copy-paste is the current problem being solved |

---

## Files Affected by v2.4

| File | Change Type |
|------|-------------|
| `packages/shared-model/src/types/model.ts` | Add `SwitchStrategy`, `ModelGroup` types |
| `packages/shared-model/src/types/provider.ts` | New — `BaseProviderConfig`, `ModelInfoSchema`, `BaseProvider` |
| `packages/shared-model/src/index.ts` | Export new types |
| `core/src/services/model/switcher.ts` | New — `ModelGroupSwitcher` class |
| `core/src/services/model/service.ts` | Add group registration, `resolveModel` group dispatch, schema grouping |
| `core/src/services/agent/service.ts` | `AgentCoreConfigSchema` grouping, pending queue fix |
| `core/src/services/agent/loop.ts` | Bot Action empty record fix |
| `core/src/services/agent/trimmer.ts` | Tool trim fix |
| `providers/provider-openai/src/index.ts` | Extend `BaseProvider`, use shared Schema |
| `providers/provider-deepseek/src/index.ts` | Extend `BaseProvider`, use shared Schema |
| `providers/provider-anthropic/src/index.ts` | Extend `BaseProvider`, use shared Schema |

---

## Sources

- schemastery 3.17.2 source: `/home/workspace/Athena/node_modules/schemastery/src/index.ts` — HIGH confidence, read directly
- v3-dev `ChatModelSwitcher`: `/home/workspace/Athena/references/YesImBot-dev/packages/core/src/services/model/chat-switcher.ts` — HIGH confidence, production-validated
- v3-dev `SwitchConfig` Schema: `/home/workspace/Athena/references/YesImBot-dev/packages/core/src/services/model/config.ts` — HIGH confidence
- v3-dev `ModelService`: `/home/workspace/Athena/references/YesImBot-dev/packages/core/src/services/model/service.ts` — HIGH confidence
- Current `ModelService`: `/home/workspace/Athena/core/src/services/model/service.ts` — HIGH confidence, read directly
- Current `AgentCore`: `/home/workspace/Athena/core/src/services/agent/service.ts` — HIGH confidence, read directly
- All three provider implementations: read directly from source — HIGH confidence
- `ai` SDK 6.0.91: `/home/workspace/Athena/node_modules/ai/package.json` — HIGH confidence
- `p-queue` 5.0.0: `/home/workspace/Athena/node_modules/p-queue/package.json` — HIGH confidence
