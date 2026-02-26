# Architecture Research

**Domain:** Koishi AI chat plugin — v2.4 model group load balancing, provider unification, config UI grouping, runtime bug fixes
**Researched:** 2026-02-26
**Confidence:** HIGH (direct source code analysis of v2.3 baseline)

## Current Architecture (v2.3 Baseline)

### Service Graph

```
Layer 0 (no internal deps):
  ModelService      — immediate=true,  inject: []
  PluginService     — immediate=true,  inject: []

Layer 1:
  PromptService     — immediate=true,  inject: []
  HorizonService    — immediate=false, inject: ["database", "yesimbot.prompt"]

Layer 2:
  RoleService       — immediate=false, inject: ["yesimbot.prompt"]
  TraitAnalyzer     — immediate=false, inject: ["yesimbot.horizon"]

Layer 3:
  SkillRegistry     — immediate=false, inject: ["yesimbot.trait"]

Layer 4 (terminal):
  AgentCore         — immediate=false, inject: [
                        "yesimbot.horizon", "yesimbot.plugin",
                        "yesimbot.prompt",  "yesimbot.model",
                        "yesimbot.trait",   "yesimbot.skill",
                        "yesimbot.role"
                      ]
```

### Provider Registration Flow (current)

```
provider-openai apply()
  → new OpenAIProvider(config)
  → ctx["yesimbot.model"].registerProvider(config.id, provider)
  → ModelService.providers Map<string, IModelProvider>
  → ModelService.refreshSchemas()  ← updates registry.chatModels dynamic schema

AgentCore.config.model = "openai:gpt-4o"
  → ModelService.call("openai:gpt-4o", params, fallbackChain?)
  → resolveModel() → { provider: "openai", modelId: "gpt-4o" }
  → providers.get("openai").getModel("gpt-4o")
  → PQueue.add(() => executeCall(...))
```

### Message Queue Flow (current — has bug)

```
horizon/message event
  → handleEvent(event)
  → willingness check
  → if shouldReply:
      if isDirect: handleDmAggregation()
      else: pendingWindows aggregation (1500ms)
  → enqueue(channelKey, built)
      → queues.get(channelKey) ?? Promise.resolve()
      → .then(() => runLoop())
      → .then(() => check pending map for next payload)
      → queues.set(channelKey, chain)

BUG: While loop is running, new messages set pending[channelKey].
     But if TWO messages arrive before loop starts, only the last
     one is kept — earlier messages are silently dropped.
     Also: if loop is running and new message arrives, it goes to
     pending but the "check pending" only runs AFTER the current
     loop finishes — this is actually correct behavior, but the
     aggregation window fires immediately even if loop is busy.
```

### Working Memory Trim (current — has bug)

```
ThinkActLoop.run()
  → trimMessages(messages, trimConfig)  ← called at start of each round
  → trimConfig.charBudget = config.charBudget ?? 30000

BUG: trimMessages() is called with messages[] that starts as
     [{ role: "user", content: userContent }] — only ONE message.
     The trim logic requires messages.length > 1 to identify rounds:
       totalRounds = Math.floor((messages.length - 1) / 2)
     With 1 message: totalRounds = 0, protectedRounds = 0,
     eligibleEnd = 1, eligible = [] — nothing to trim.
     Trim never fires on round 1. By round 2+ messages grow but
     the initial userContent (which can be very large) is never
     trimmed because it's at index 0 (protected as "system context").
```

### Bot Action Empty Record (current — has bug)

```
ThinkActLoop.run() → executeActions() → horizon.events.recordAgentResponse()

BUG: recordAgentResponse() is called unconditionally after every
     LLM response, even when the model returns no actions or
     returns only a "stay silent" decision. This writes empty
     [Bot Action] entries to the timeline DB, polluting history
     that gets fed back to the LLM in subsequent turns.
```

---

## v2.4 Integration Map

### Feature 1: Message Queue Refactor (积压合并)

**What changes:** While a loop is running, new messages should be buffered. When the loop finishes, all buffered messages should be merged into a single response rather than processing each one individually.

**Current code location:** `core/src/services/agent/service.ts`

**Relevant state:**
```typescript
private queues = new Map<string, Promise<void>>();   // per-channel running promise
private pending = new Map<string, LoopPayload>();    // single-slot pending buffer
```

**Problem:** `pending` is a single-slot map — only the last message is kept. Multiple messages arriving during a running loop lose all but the last.

**Integration approach:** Replace single-slot `pending` with a queue buffer per channel. When the loop finishes, drain the buffer and merge all accumulated messages into one `Percept` before calling `runLoop()`.

**Touch points:**
- `agent/service.ts` — `pending` map type changes from `Map<string, LoopPayload>` to `Map<string, LoopPayload[]>`
- `agent/service.ts:enqueue()` — drain logic: collect all pending, merge into single percept
- `agent/service.ts:handleEvent()` — aggregation window logic unchanged; only the enqueue/pending path changes
- `agent/loop.ts` — `Percept` may need a `mergedMessages` field to carry multiple source messages
- `core/src/services/shared/types.ts` — `Percept` type may gain optional `mergedMessages` array

**New vs modified:**
- MODIFIED: `agent/service.ts` (pending map + enqueue drain logic)
- MODIFIED: `core/src/services/shared/types.ts` (Percept type, if merged messages need to be visible to loop)

**Independence:** Fully independent. No dependency on other v2.4 features.

---

### Feature 2: Bot Action Empty Record Fix

**What changes:** `recordAgentResponse()` should only be called when the agent actually took meaningful actions (sent a message or called a tool). Silent decisions should not be recorded.

**Current code location:** `core/src/services/agent/loop.ts:316-326`

```typescript
// Current — unconditional
await horizon.events.recordAgentResponse({
  platform: percept.platform,
  channelId: percept.channelId,
  timestamp: new Date(),
  data: { round, assistantText: rawText, actions: response.actions, toolResults },
});
```

**Fix:** Add a guard before `recordAgentResponse()`. Only record if `response.actions` contains at least one non-empty action, or if `toolResults` is non-empty.

**Touch points:**
- `agent/loop.ts` — add guard condition before `recordAgentResponse()` call (lines ~316-326)
- No type changes needed

**New vs modified:**
- MODIFIED: `agent/loop.ts` (2-3 line guard addition)

**Independence:** Fully independent. Surgical fix.

---

### Feature 3: Tool Trim Fix

**What changes:** The working memory trimmer must actually fire. The root cause is that `trimMessages()` is called with a messages array that starts with only 1 element (the initial user context), and the trim logic skips arrays with 0 eligible rounds.

**Current code location:** `core/src/services/agent/loop.ts` and `core/src/services/agent/trimmer.ts`

**Root cause:** `trimMessages()` at `trimmer.ts:37` computes:
```typescript
const totalRounds = Math.floor((messages.length - 1) / 2);
```
With `messages = [userContent]` (length 1): `totalRounds = 0`. Nothing is eligible. The initial `userContent` (which contains the full HorizonView + working memory) is at index 0 and is treated as protected "system context" — it never gets trimmed regardless of size.

**Fix options:**
1. Apply a separate budget check on `messages[0]` (the initial user context) before the round-based trim
2. Move the initial user context into a separate field and only pass the round messages to `trimMessages()`
3. Trim the `userContent` string itself before inserting into `messages[0]`

**Recommended fix:** Option 3 — trim `userContent` at construction time in `loop.ts` before it enters `messages[]`. The `formatHorizonText()` output can be truncated if it exceeds a separate `userContextBudget` config value. This is simpler than restructuring the messages array.

**Touch points:**
- `agent/loop.ts` — add user context size check after `formatHorizonText()` call
- `agent/trimmer.ts` — optionally add a `trimUserContext()` helper
- `agent/service.ts` — `AgentCoreConfig` may gain `userContextBudget` field
- `agent/service.ts:AgentCoreConfigSchema` — new schema field if config added

**New vs modified:**
- MODIFIED: `agent/loop.ts` (user context trim before messages construction)
- MODIFIED: `agent/trimmer.ts` (optional new helper)

**Independence:** Fully independent. Localized to loop.ts + trimmer.ts.

---

### Feature 4: Model Group Load Balancing

**What changes:** Add a `ModelGroup` abstraction above `IModelProvider`. A group contains multiple model instances and applies a selection strategy (round-robin, random, least-loaded, failover) when `ModelService.call()` is invoked.

**Current call path:**
```
ModelService.call("openai:gpt-4o", params)
  → resolveModel() → { provider: "openai", modelId: "gpt-4o" }
  → providers.get("openai").getModel("gpt-4o")
```

**New call path with groups:**
```
ModelService.call("group:my-group", params)
  → resolveModel() → detects "group:" prefix
  → groups.get("my-group").selectMember()  ← strategy picks a provider:model
  → providers.get(provider).getModel(modelId)
```

**New types needed in `shared-model`:**

```typescript
// packages/shared-model/src/types/model.ts — additions

export type LoadBalanceStrategy = "round-robin" | "random" | "least-loaded" | "failover";

export interface ModelGroupMember {
  model: string;          // "provider:modelId" format
  weight?: number;        // for weighted random
}

export interface ModelGroupConfig {
  id: string;
  strategy: LoadBalanceStrategy;
  members: ModelGroupMember[];
}

export interface IModelGroup {
  readonly id: string;
  readonly strategy: LoadBalanceStrategy;
  selectMember(): string;  // returns "provider:modelId"
  recordSuccess(model: string): void;
  recordFailure(model: string): void;
}
```

**ModelService changes:**

```typescript
// core/src/services/model/service.ts — additions
private groups = new Map<string, IModelGroup>();

registerGroup(config: ModelGroupConfig): void
unregisterGroup(id: string): void
getGroup(id: string): IModelGroup | undefined

// resolveModel() — extend to handle "group:" prefix
private resolveModel(model: string | ModelSelector): { provider: string; modelId: string } {
  if (typeof model === "string" && model.startsWith("group:")) {
    const groupId = model.slice(6);
    const group = this.groups.get(groupId);
    if (!group) throw new Error(`Model group not found: ${groupId}`);
    const selected = group.selectMember();  // returns "provider:modelId"
    return this.resolveModel(selected);     // recurse with concrete model
  }
  // ... existing logic
}
```

**Failover integration:** The existing `fallbackChain` in `call()` already handles sequential fallback. Model groups add a pre-call selection layer. When a group member fails with TRANSIENT/RATE_LIMIT, `recordFailure()` updates the group's internal state, and the existing `handleFallback()` can try the next group member.

**Schema for group config in core:**

```typescript
// core/src/services/model/service.ts — ModelServiceConfig additions
export interface ModelServiceConfig {
  concurrency?: number;
  groups?: ModelGroupConfig[];  // NEW
}
```

**Dynamic schema update:** `refreshSchemas()` must also enumerate group IDs so they appear in the `registry.chatModels` dropdown alongside individual models.

**New files:**
- `core/src/services/model/group.ts` — `ModelGroup` class implementing `IModelGroup`

**Modified files:**
- `packages/shared-model/src/types/model.ts` — add `ModelGroupConfig`, `IModelGroup`, `LoadBalanceStrategy`
- `packages/shared-model/src/index.ts` — export new types
- `core/src/services/model/service.ts` — `groups` map, `registerGroup/unregisterGroup`, `resolveModel` extension, `refreshSchemas` extension
- `core/src/services/model/index.ts` — re-export `ModelGroup`

**Independence:** Independent of bug fixes. Depends on `shared-model` types being updated first (build order: shared-model → model/group.ts → model/service.ts).

---

### Feature 5: Provider Architecture Optimization

**What changes:** The 3 provider plugins (openai, deepseek, anthropic) have near-identical structure. Extract shared logic into a base class or factory in `shared-model` to eliminate duplication.

**Current duplication across providers:**

| Element | openai | deepseek | anthropic |
|---------|--------|----------|-----------|
| `Config` interface | identical shape | identical shape | adds `projectId`/`sessionId` |
| `Config` Schema | identical structure | identical structure | adds 2 fields |
| `IModelProvider` impl | identical | identical | adds custom fetch |
| `listModels()` | identical | identical | identical |
| `getDefaultParams()` | identical | identical | identical |
| `apply()` | identical | identical | identical |

**Recommended approach:** Add a `BaseProviderConfig` and `createBaseProviderSchema()` factory to `shared-model`. Each provider extends the base schema and adds provider-specific fields.

```typescript
// packages/shared-model/src/types/provider.ts — NEW FILE

export interface BaseProviderConfig {
  id: string;
  apiKey: string;
  baseURL: string;
  models: ModelInfo[];
  defaultParams: {
    temperature: number;
    maxTokens: number;
    topP?: number;
  };
}

export function createBaseProviderSchema<T extends BaseProviderConfig>(
  defaults: { id: string; baseURL: string; defaultModels: ModelInfo[] }
): Schema<BaseProviderConfig>
```

**Abstract base class option:**

```typescript
// packages/shared-model/src/provider/base.ts — NEW FILE

export abstract class BaseProvider implements IModelProvider {
  readonly id: string;
  readonly models: ModelInfo[];
  readonly defaultParams: ModelDefaultParams;

  constructor(config: BaseProviderConfig) {
    this.id = config.id;
    this.defaultParams = config.defaultParams;
    this.models = config.models.map(m => ({ ...m }));
  }

  abstract readonly providerType: string;
  abstract getModel(modelId: string): LanguageModel;

  listModels(): Record<string, ModelInfo> {
    return Object.fromEntries(this.models.map(m => [m.id, m]));
  }

  getDefaultParams(): ModelDefaultParams {
    return this.defaultParams;
  }
}
```

**Provider refactor result:**

```typescript
// providers/provider-openai/src/index.ts — after refactor
class OpenAIProvider extends BaseProvider {
  readonly providerType = "openai";
  private client: ReturnType<typeof createOpenAI>;

  constructor(config: Config) {
    super(config);
    this.client = createOpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  }

  getModel(modelId: string) {
    return this.client.chat(modelId);
  }
}
```

**New files:**
- `packages/shared-model/src/provider/base.ts` — `BaseProvider` abstract class
- `packages/shared-model/src/provider/schema.ts` — `createBaseProviderSchema()` factory

**Modified files:**
- `packages/shared-model/src/index.ts` — export new provider base
- `providers/provider-openai/src/index.ts` — extend `BaseProvider`
- `providers/provider-deepseek/src/index.ts` — extend `BaseProvider`
- `providers/provider-anthropic/src/index.ts` — extend `BaseProvider`, keep custom fetch

**Independence:** Independent of all other features. Can be done in parallel with model groups. Build order: shared-model changes first, then provider refactors.

---

### Feature 6: Config UI Grouping

**What changes:** The Koishi Console config UI currently shows all fields from `Schema.intersect([...8 schemas...])` as a flat list. Group related fields under collapsible sections using `Schema.object().description()` with Koishi's `collapse` role.

**Current structure in `core/src/index.ts`:**

```typescript
export const Config: Schema<Config> = Schema.intersect([
  AgentCoreConfigSchema,       // model, fallbackChain, maxRounds, streamMode, ...
  HorizonServiceConfigSchema,  // allowedChannels, keywords, historyLimit, ...
  ModelServiceConfigSchema,    // concurrency
  PluginServiceConfigSchema,   // defaultTimeout
  PromptServiceConfigSchema,   // templates
  RoleServiceConfigSchema,     // rolePath
  SkillRegistryConfigSchema,   // skillPaths, confidenceThreshold, ...
  TraitAnalyzerConfigSchema,   // (currently empty)
]);
```

**Koishi Schema grouping pattern:**

```typescript
// Koishi supports Schema.object() with .role('group') or nested intersect
// The standard approach is Schema.object() with description for section headers
Schema.object({
  model: Schema.dynamic("registry.chatModels").description("..."),
  fallbackChain: Schema.array(...).description("..."),
}).description("Agent Settings")
```

**Recommended grouping:**

| Group | Fields | Schema Source |
|-------|--------|---------------|
| "模型设置" | concurrency, groups | ModelServiceConfigSchema |
| "智能体设置" | model, fallbackChain, maxRounds, streamMode, globalTimeout, maxToolResultLength, enableThoughts, charBudget, keepLastRounds, softTrimHead, softTrimTail, debugLevel, errorReportChannel | AgentCoreConfigSchema |
| "意愿值设置" | willingness (nested) | AgentCoreConfigSchema.willingness |
| "消息聚合" | aggregationWindow | AgentCoreConfigSchema |
| "频道设置" | allowedChannels, keywords, historyLimit, archiveThresholdMs, botName, entityCacheTtl, maxActiveEntities | HorizonServiceConfigSchema |
| "角色设置" | rolePath | RoleServiceConfigSchema |
| "技能设置" | skillPaths, confidenceThreshold, stickyDefaultTimeout | SkillRegistryConfigSchema |
| "高级设置" | templates, defaultTimeout | PromptServiceConfigSchema + PluginServiceConfigSchema |

**Touch points:**
- `core/src/index.ts` — restructure `Config` type and `Schema.intersect` into grouped `Schema.object` sections
- Individual `*ConfigSchema` exports — may need to be broken into sub-schemas if grouping requires field redistribution
- `core/src/index.ts:apply()` — config destructuring must match new structure

**Risk:** Koishi's `Schema.intersect` flattens all fields into one namespace. Switching to nested `Schema.object` changes how config is accessed (e.g., `config.agent.model` vs `config.model`). This is a breaking change for existing config files.

**Safer approach:** Keep `Schema.intersect` for backward compatibility, add `.description()` to each sub-schema for section headers in the UI. Koishi renders `Schema.intersect` members as collapsible groups when each member has a `.description()`.

```typescript
export const Config: Schema<Config> = Schema.intersect([
  AgentCoreConfigSchema.description("智能体设置"),
  HorizonServiceConfigSchema.description("频道与上下文"),
  ModelServiceConfigSchema.description("模型服务"),
  // ...
]);
```

**New vs modified:**
- MODIFIED: `core/src/index.ts` — add `.description()` to each schema in intersect
- MODIFIED: individual `*ConfigSchema` — add `.description()` to fields that lack them

**Independence:** Fully independent. Pure UI/schema change, no behavioral impact.

---

## Component Boundaries After v2.4

### Updated Component Table

| Component | Responsibility | New in v2.4 |
|-----------|----------------|-------------|
| `ModelService` | Provider registry, PQueue, call/streamCall, fallback chains, **model groups** | `groups` map, `registerGroup()`, group-aware `resolveModel()` |
| `ModelGroup` | Load balancing strategy, member selection, failure tracking | NEW file: `model/group.ts` |
| `IModelGroup` | Interface for group implementations | NEW type in `shared-model` |
| `BaseProvider` | Shared provider logic (listModels, getDefaultParams) | NEW in `shared-model` |
| `AgentCore` | Per-channel queues, willingness, aggregation | **pending buffer** changes from single-slot to queue |
| `ThinkActLoop` | LLM loop, tool exec, working memory | **trim fix** + **empty action guard** |
| Provider plugins | Register `IModelProvider` | Extend `BaseProvider` (less duplication) |

### Data Flow Changes

**Model group selection:**
```
call("group:fast-models", params)
  → resolveModel() detects "group:" prefix
  → ModelGroup.selectMember() → "openai:gpt-4o-mini"
  → executeCall("openai", "gpt-4o-mini", params)
  → on RATE_LIMIT: group.recordFailure("openai:gpt-4o-mini")
  → handleFallback() tries next group member
```

**Message queue with backlog merge:**
```
Message A arrives → enqueue(channelKey, A) → loop starts
Message B arrives → pending[channelKey].push(B)   (was: overwrite)
Message C arrives → pending[channelKey].push(C)   (was: overwrite)
Loop A finishes → drain pending → merge B+C into single percept
  → runLoop(channelKey, merged_BC)
```

**Trim fix flow:**
```
loop.run():
  userContent = formatHorizonText(view, wmLines, percept)
  if userContent.length > userContextBudget:
    userContent = trimUserContext(userContent, userContextBudget)  ← NEW
  messages = [{ role: "user", content: userContent }]
  while round < maxRounds:
    trimMessages(messages, trimConfig)  ← existing, now fires correctly
    ...
```

---

## Build Order

Dependencies between v2.4 features determine safe implementation order:

```
Phase 1 (no deps, do first):
  Bug Fix: Bot Action empty record    — agent/loop.ts only, 2-3 lines
  Bug Fix: Tool trim                  — agent/loop.ts + trimmer.ts

Phase 2 (no deps, can parallel with Phase 1):
  Config UI grouping                  — core/index.ts schema only
  Provider architecture optimization  — shared-model + 3 provider files

Phase 3 (depends on Phase 2 shared-model changes):
  Model group load balancing          — shared-model types → model/group.ts → model/service.ts

Phase 4 (no deps on above, but benefits from stable queue):
  Message queue refactor              — agent/service.ts pending map
```

**Rationale:**
- Bug fixes first: they're surgical, low risk, unblock testing
- Config grouping is pure UI, zero behavioral risk
- Provider unification before model groups: `BaseProvider` in shared-model is a prerequisite for clean group integration
- Message queue refactor last: it's the most behavioral change and benefits from having the bugs fixed first so the test baseline is clean

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Group as Provider Alias

**What:** Implementing model groups by registering a fake `IModelProvider` that wraps other providers.
**Why bad:** Breaks the `IModelProvider` contract (a provider wraps an ai-sdk client, not other providers). Confuses the registry. Makes `providerType` detection unreliable.
**Instead:** Keep groups as a separate layer in `ModelService` above the provider registry. `resolveModel()` handles the group → concrete model translation before touching providers.

### Anti-Pattern 2: Nested Schema Objects Breaking Config Compatibility

**What:** Restructuring `Config` from `Schema.intersect([flat schemas])` to `Schema.object({ agent: AgentSchema, horizon: HorizonSchema })`.
**Why bad:** Existing Koishi config files use flat keys (`model`, `fallbackChain`). Nesting breaks all existing deployments.
**Instead:** Keep `Schema.intersect` for flat key compatibility. Add `.description()` to each sub-schema for UI grouping. Koishi renders intersect members as collapsible sections.

### Anti-Pattern 3: Trim on Messages[0]

**What:** Modifying `trimMessages()` to also trim `messages[0]` (the initial user context).
**Why bad:** `messages[0]` contains the current turn's full context — trimming it mid-loop corrupts the LLM's view of the current conversation.
**Instead:** Trim `userContent` before it enters `messages[]`, at construction time in `loop.ts`. The trim budget for user context is separate from the round-history budget.

### Anti-Pattern 4: Blocking Queue on Aggregation Window

**What:** Holding the channel queue open during the aggregation window (waiting for more messages before starting the loop).
**Why bad:** Adds latency to every response. The aggregation window is already handled by `pendingWindows` before `enqueue()` is called.
**Instead:** Keep aggregation window logic in `handleEvent()` (pre-enqueue). The queue refactor only affects what happens after `enqueue()` is called — i.e., how backlogged messages are merged when the loop is already running.

---

## Sources

All findings based on direct source code analysis of v2.3 baseline:

| File | Key Findings |
|------|-------------|
| `core/src/services/agent/service.ts` | Queue structure, pending map (single-slot bug), aggregation windows |
| `core/src/services/agent/loop.ts` | `recordAgentResponse()` unconditional call (empty action bug), `trimMessages()` call site (trim bug) |
| `core/src/services/agent/trimmer.ts` | `totalRounds` calculation, why trim never fires on round 1 |
| `core/src/services/model/service.ts` | `resolveModel()`, `providers` map, `refreshSchemas()`, fallback chain |
| `packages/shared-model/src/types/model.ts` | `IModelProvider`, `ModelInfo`, `ModelSelector` — extension points for groups |
| `providers/provider-openai/src/index.ts` | Duplicated structure pattern |
| `providers/provider-deepseek/src/index.ts` | Duplicated structure pattern |
| `providers/provider-anthropic/src/index.ts` | Unique: custom fetch for user_id injection |
| `core/src/index.ts` | `Schema.intersect` flat config, `ctx.plugin` registration order |

**Confidence:** HIGH — all integration points verified against actual source code.

---
*Architecture research for: Koishi AI chat plugin v2.4*
*Researched: 2026-02-26*
