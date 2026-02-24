# Architecture Research: v2.2 Runtime Optimization & Observability

**Domain:** AI LLM chat agent for IM platforms (Koishi 4.x plugin monorepo)
**Researched:** 2026-02-25
**Confidence:** HIGH (based on direct source code analysis of v2.1 baseline)

## Current Architecture (v2.1 Baseline)

### Service Graph (dependency order)

9 services registered as Koishi `Service` subclasses. Entry point at `core/src/index.ts:47-82`.

```
Layer 0 (no internal deps):
  ModelService      — immediate=true,  inject: []
  PluginService     — immediate=true,  inject: []

Layer 1:
  PromptService     — immediate=true,  inject: []
  HorizonService    — immediate=false, inject: ["database", "yesimbot.prompt"]

Layer 2:
  RoleService       — immediate=false, inject: ["yesimbot.prompt"]
  MemoryService     — immediate=false, inject: ["yesimbot.prompt"]
  TraitAnalyzer     — immediate=false, inject: ["yesimbot.horizon"]

Layer 3:
  SkillRegistry     — immediate=false, inject: ["yesimbot.trait"]

Layer 4 (terminal):
  AgentCore         — immediate=false, inject: [
                        "yesimbot.horizon", "yesimbot.plugin",
                        "yesimbot.prompt",  "yesimbot.model",
                        "yesimbot.trait",   "yesimbot.skill"
                      ]
```

`waitForServiceReady()` at `index.ts:100-129` polls all 9 with 100ms intervals, 10s timeout.

### Message Processing Flow

#### Step 1: Message Ingress — `horizon/listener.ts:26-48`

Koishi middleware intercepts session:
1. `isChannelAllowed()` check (`listener.ts:58-66`)
2. Skip if `session.author.isBot` (`listener.ts:29`)
3. `recordUserMessage()` writes to timeline DB (`listener.ts:78-102`)
4. `updateMemberInfo()` upserts entity record (`listener.ts:125-151`)
5. `ctx.emit("horizon/message", event)` with classified TriggerType

`classifyTrigger()` at `listener.ts:69-76`: direct > reply > mention > keyword > random.

#### Step 2: Willingness Gate — `agent/service.ts:113-159`

`handleEvent(event)` computes willingness:
1. Build `channelKey = "platform:channelId"`
2. `cancelDeferred(channelKey)` — cancel any pending LLM judgment
3. `willingness.processMessage(channelKey, triggerType, content)`
4. `Math.random() < probability` determines `shouldReply`

Three outcomes (`service.ts:126-155`):
- `shouldReply=true` + `isDirect` — immediate enqueue (no aggregation window)
- `shouldReply=true` + group — aggregation window (default 1500ms), last event wins
- `shouldReply=false` + deferred config + `probability >= threshold` — schedule LLM judgment

#### Step 3: Deferred LLM Judgment (optional) — `agent/service.ts:221-287`

1. `scheduleDeferredJudgment()` computes delay inversely proportional to probability
2. `ctx.setTimeout(delay)` schedules `executeDeferredJudgment()`
3. Builds `HorizonView`, formats context text
4. Calls `modelService.call(JUDGMENT_PROMPT, contextText)` with maxOutputTokens=8
5. Answer starts with "yes" -> enqueue; otherwise stay silent
6. Generation counter (`deferredGen`) prevents stale judgments

#### Step 4: Channel Queue — `agent/service.ts:183-198`

Per-channel serial execution via promise chaining:
1. `enqueue(channelKey, built)` chains onto existing queue promise
2. Runs `runLoop(channelKey, built)` then checks `pending` map for next payload
3. If loop is running when new message arrives, latest payload overwrites `pending`

#### Step 5: ThinkActLoop — `agent/loop.ts:46-298`

The core agent loop. Called via `loop.run(percept, toolCtx)`:

**5a. Context Assembly** (`loop.ts:49-102`):
1. `horizon.buildView(scope, options)` — queries timeline DB, builds `HorizonView`
2. `trait.analyze(scope, view)` — runs SceneTrait + HeatTrait detectors in parallel
3. `skill.resolve(signals, scope)` — evaluates conditions, returns `SkillEffect`
4. Injects skill prompt/style/tools into PromptService (with disposers for cleanup)
5. `buildToolSchemaForPrompt()` — serializes available tools as text schema

**5b. Prompt Rendering** (`loop.ts:105-127`):
1. `prompt.renderToString("system", { view, percept })` — renders all injection points
2. Builds working memory lines from `view.history` agent.response observations
3. `horizon.formatHorizonText(view, wmLines)` — renders user message content

**5c. Multi-Round Loop** (`loop.ts:145-288`):
```
while (round < maxRounds):
  trimMessages(messages, trimConfig)        // budget-aware trimming
  modelService.call(model, {system, messages})
  parser.parse(rawText)                     // JsonParser with jsonrepair
  if parse fails + "actions" in text:
    attemptLlmRepair(modelService, rawText) // LLM-based JSON repair
  executeActions(actions, pluginService)    // Tool parallel, Action sequential
  horizon.events.recordAgentResponse(...)   // persist round to timeline
  if hasToolCalls || request_heartbeat:
    append assistant+user messages, continue
  else: break
```

**5d. Cleanup** (`loop.ts:296-298`):
All skill injection disposers called in `finally` block.

### Prompt Assembly Pipeline

#### Injection Points — `prompt/types.ts:1-3`

```typescript
type InjectionPoint = "soul" | "instructions" | "memory" | "extra";
const INJECTION_POINTS = ["soul", "instructions", "memory", "extra"];
```

#### Injection Registry

| Service | Injection Name | Point | Content |
|---------|---------------|-------|---------|
| RoleService | `__role_soul` | soul | SOUL.md rendered with Mustache |
| RoleService | `__role_agents` | instructions | AGENTS.md rendered |
| RoleService | `__role_tools` | instructions (after agents) | TOOLS.md rendered |
| MemoryService | `core-memory` | memory | Memory blocks with char limit |
| SkillRegistry (via loop) | `__skill_{name}_{id}` | configurable | Skill prompt content |
| SkillRegistry (via loop) | `__skill_style_{id}` | configurable | Style override |
| ThinkActLoop | `__loop_tool_schema_{id}` | instructions | Tool schema text |

#### render() Pipeline — `prompt/service.ts:113-141`

```typescript
async render(_templateName, initialScope?) -> Section[]
```

1. `buildScope(initialScope)` — runs all registered snippets sequentially
2. For each injection point in order (soul, instructions, memory, extra):
   - `resolveOrder()` — topological sort via `before`/`after` constraints
   - `Promise.allSettled()` on all entries with timeout
   - Join fragments with `\n\n`, wrap in XML tags: `<point>...content...</point>`
3. Returns `Section[]` where each section has `{ name, content, cacheable: true }`

`renderToString()` at `service.ts:143-149` joins all sections with `\n\n`.

#### Snippet System — `prompt/service.ts:77-79, 215-236`

Snippets are scope-building functions registered by name (dot-path notation):

| Snippet Key | Registered By | Value |
|-------------|--------------|-------|
| `date.now` | MemoryService | Formatted current date/time (zh-CN) |
| `sender.name` | MemoryService | `percept.metadata.senderName` |
| `sender.id` | MemoryService | `percept.metadata.senderId` |
| `channel.name` | MemoryService | `view.environment.name` |
| `channel.platform` | MemoryService | `view.environment.metadata.platform` |
| `bot.name` | MemoryService | `view.self.name` |
| `bot.id` | MemoryService | `view.self.id` |

Snippets run in `buildScope()` before injection rendering. The scope object is passed to all `renderFn` callbacks.

## v2.2 Integration Map

### Feature 1: Willingness DM Handling + Judge Prompt

**Primary:** `agent/service.ts` (handleEvent), `agent/willingness.ts` (WillingnessEngine)
**Secondary:** `agent/service.ts:221-287` (deferred judgment prompt)

**Current gap:** `handleEvent()` at `service.ts:126-131` treats DM (`isDirect`) as "always reply immediately" — bypasses willingness entirely. The `WillingnessEngine.processMessage()` still runs but its result is ignored for DMs.

**Touch points:**
- `agent/service.ts:126-131` — DM branch needs willingness-aware logic
- `agent/willingness.ts:201-251` — `processMessage()` may need DM-specific gain/decay params
- `agent/service.ts:221-287` — Judge prompt text (hardcoded `JUDGMENT_PROMPT` string) needs tuning
- `agent/willingness.ts:11-17` — `DeferredJudgmentConfig` may need DM-specific overrides

**Independence:** Fully independent. No dependency on other v2.2 features.

### Feature 2: Prompt Cache Optimization (SystemModelMessage[])

**Primary:** `prompt/service.ts` (render pipeline), `model/service.ts` (call/streamCall)
**Secondary:** `agent/loop.ts` (system prompt consumption)

**Current gap:** `render()` returns `Section[]` with `cacheable: true` on every section, but `renderToString()` flattens everything into a single string. The `modelService.call()` at `model/service.ts:72-107` passes `system` as a plain string to ai-sdk's `generateText()`. No `SystemModelMessage[]` splitting occurs.

**Touch points:**
- `prompt/service.ts:113-141` — `render()` already returns `Section[]` with `cacheable` flag
- `prompt/types.ts:5-9` — `Section` type: `{ name: string; content: string; cacheable: boolean }`
- `model/service.ts:72-107` — `call()` needs to accept `Section[]` or `SystemModelMessage[]`
- `agent/loop.ts:105-127` — Must switch from `renderToString()` to `render()` and pass sections
- ai-sdk `generateText()` — needs `system` as `Array<{ type: "text", text: string, providerOptions?: { cacheControl } }>`

**Independence:** Depends on understanding the ai-sdk `SystemModelMessage` format. No dependency on other v2.2 features, but touches the same `loop.ts` code as Feature 7.

### Feature 3: Full-Chain DEBUG Logging (Trace ID)

**Primary:** `agent/service.ts` (handleEvent entry point), `agent/loop.ts` (ThinkActLoop)
**Secondary:** All services touched during message processing

**Current state:** Logging is ad-hoc. `horizon/listener.ts:79` logs user messages. `agent/service.ts` logs willingness results. `agent/loop.ts` logs round progress. No correlation ID ties them together.

**Touch points:**
- `agent/service.ts:113` — `handleEvent()` is the natural trace ID generation point
- `agent/service.ts:183-198` — `enqueue()` / `runLoop()` must propagate trace ID
- `agent/loop.ts:46-298` — Every log call needs trace ID prefix
- `model/service.ts:72-107` — `call()` should log model name, token counts, latency
- `horizon/listener.ts:26-48` — Message ingress should log with trace ID (or pre-trace correlation)
- `agent/willingness.ts:157-168` — `WillingnessResult.debug` already has structured data

**Design question:** Parameter threading vs context object. Koishi has no built-in async context (no AsyncLocalStorage). Options:
1. Pass `traceId: string` as parameter through the call chain
2. Create a `TraceContext` object passed alongside `Percept`
3. Use Node.js `AsyncLocalStorage` (works but adds complexity)

**Recommendation:** Option 2 — `TraceContext` object. It can carry traceId + timing marks + log buffer. Pass it through `loop.run(percept, toolCtx, trace)`.

**Independence:** Fully independent. Touches many files but only adds logging, no behavioral changes.

### Feature 4: memory_block → RoleService Merge

**Primary:** `memory/service.ts` (MemoryService), `role/service.ts` (RoleService)
**Secondary:** `prompt/service.ts` (injection registry)

**Current state:** Two separate services both inject into PromptService at startup:
- `MemoryService` loads `*.md` files from `memoryPath`, registers as `core-memory` at `memory` injection point, also registers all 7 snippets
- `RoleService` loads `SOUL.md`/`AGENTS.md`/`TOOLS.md` from `rolePath`, registers as `__role_soul`/`__role_agents`/`__role_tools`

**Overlap:** Both load markdown files from disk. Both register PromptService injections. Both do Mustache rendering. MemoryService's `MemoryBlock` type (`{ label, title?, description?, content, filename }`) is a subset of what RoleService already handles.

**Touch points:**
- `memory/service.ts` — Entire file to be absorbed into RoleService
- `memory/types.ts` — `MemoryBlock` interface moves to `role/types.ts`
- `role/service.ts` — Gains memory block loading + snippet registration
- `index.ts:57-58` — Remove MemoryService registration
- `index.ts:100-129` — Remove from `waitForServiceReady()` list
- `agent/service.ts` inject list — Remove `yesimbot.memory` if present (currently not in inject)

**Independence:** Fully independent. No dependency on other v2.2 features.

### Feature 5: JSON Parser Hardening

**Primary:** `agent/json-parser.ts` (JsonParser)
**Secondary:** `agent/loop.ts:145-288` (parse call site)

**Current state:** `JsonParser<T>` at `json-parser.ts:13-155` has a 3-stage pipeline:
1. Extract from markdown code block if present
2. Find JSON start (`{` or `[`), trim trailing text if balanced
3. `JSON.parse()` → fallback to `jsonrepair()` → fallback to error

**Known gaps:**
- `isLikelyJsonStart()` at line 134-153 checks `[` followed by specific chars to avoid `[OBSERVE]` false positives, but doesn't handle all edge cases
- No handling of truncated JSON (model hit max_tokens mid-output)
- No handling of multiple JSON objects in output (model outputs text + JSON + text)
- The `attemptLlmRepair()` in `loop.ts` is a separate fallback that calls the model again

**Touch points:**
- `agent/json-parser.ts` — Main file to harden
- `agent/loop.ts` — Call site at parse step, LLM repair fallback
- v3 reference: `references/YesImBot-v3/` has a more mature parser to port patterns from

**Independence:** Fully independent. Self-contained in json-parser.ts + tests.

### Feature 6: Snippet Variable Injection Fix

**Primary:** `prompt/service.ts` (buildScope, snippet system)
**Secondary:** `prompt/renderer.ts` (MustacheRenderer), `memory/service.ts` (snippet registration)

**Current state:** Snippets register via `prompt.registerSnippet(key, fn)` at `service.ts:77-79`. The `buildScope()` at `service.ts:215-224` runs each snippet function and sets the result into a nested scope object using dot-path notation (e.g., `date.now` → `scope.date.now`).

**Known bug:** `{{date.now}}` renders as empty. The issue is likely in how `buildScope()` constructs the nested object. The `setNestedValue()` helper at `service.ts:226-236` splits on `.` and creates intermediate objects, but the Mustache renderer may not receive the scope correctly, or the snippet functions aren't being called with the right `initialScope` context (view/percept may be missing).

**Touch points:**
- `prompt/service.ts:215-236` — `buildScope()` and `setNestedValue()` logic
- `prompt/service.ts:77-79` — `registerSnippet()` API
- `prompt/renderer.ts:26-42` — `MustacheRenderer.render()` iterative rendering
- `memory/service.ts` — Where snippets are registered with their value functions
- `agent/loop.ts:105-127` — Where `renderToString("system", { view, percept })` is called

**Root cause hypothesis:** The `initialScope` passed to `render()` from `loop.ts` contains `{ view, percept }`, but snippet functions need to access `view.self.name`, `percept.metadata.senderName` etc. If the snippet function receives the wrong scope shape, it returns undefined, and Mustache renders `{{date.now}}` as empty string.

**Independence:** Fully independent. Fix is localized to prompt/service.ts snippet pipeline.

### Feature 7: Working Memory Layout Optimization

**Primary:** `agent/loop.ts` (working memory construction), `horizon/service.ts` (formatHorizonText)
**Secondary:** `agent/trimmer.ts` (trimMessages)

**Current state:** Working memory is built in `loop.ts:105-127`:
1. `view.history` observations are iterated
2. `agent.response` observations extract `assistantText` + tool results
3. These become `wmLines` strings passed to `horizon.formatHorizonText()`
4. The result becomes the first `user` message in the loop's `messages[]` array

The `trimmer.ts` manages budget via `softTrim` (head+tail with ellipsis) then `hardClear` (replace with placeholder). Messages are `LoopMessage[]` with `role: "user" | "assistant"` and `_trimState`.

**Known issues:**
- Causality: tool results appear before the assistant message that requested them
- Temporal ordering: agent responses and user messages may interleave confusingly
- The working memory lines are plain text concatenation, not structured

**Touch points:**
- `agent/loop.ts:105-127` — Working memory construction from `view.history`
- `horizon/service.ts` — `formatHorizonText()` method
- `horizon/types.ts` — `Observation`, `AgentResponseData` types
- `agent/trimmer.ts` — May need awareness of message semantic types for smarter trimming

**Independence:** Partially dependent on Feature 2 (prompt cache). Both touch `loop.ts` prompt assembly. Should be coordinated but can be developed independently if interfaces are agreed first.

### Feature Dependency Matrix

```
Feature                        Independent?  Shared Code
1. Willingness DM + Judge      YES           agent/service.ts
2. Prompt Cache (Section[])    YES*          loop.ts, model/service.ts
3. Trace ID Logging            YES           all services (additive)
4. memory_block → RoleService  YES           memory/, role/, index.ts
5. JSON Parser Hardening       YES           agent/json-parser.ts
6. Snippet Variable Fix        YES           prompt/service.ts
7. Working Memory Layout       YES*          loop.ts, horizon/service.ts

* Features 2 and 7 both modify loop.ts prompt assembly.
  Recommend: do Feature 7 first (restructure WM), then Feature 2 (cache the result).
```

## Architecture Decisions for v2.2

### Decision 1: Prompt Caching — Section[] → SystemModelMessage[] Mapping

**Context:** ai-sdk's `generateText()` accepts `system` as either a string or `Array<SystemModelMessage>`. Each `SystemModelMessage` can carry `providerOptions` with `cacheControl` hints (e.g., Anthropic's `ephemeral` cache breakpoint).

**Current:** `render()` already returns `Section[]` with `{ name, content, cacheable }`. The `renderToString()` flattens this. The infrastructure is 80% there.

**Recommendation:** Add a `renderToMessages()` method to PromptService that maps `Section[]` to `SystemModelMessage[]`:

```typescript
// prompt/service.ts — new method
renderToMessages(templateName: string, scope?: Record<string, unknown>): Promise<SystemModelMessage[]> {
  const sections = await this.render(templateName, scope);
  return sections
    .filter(s => s.content.trim())
    .map(s => ({
      type: "text" as const,
      text: s.content,
      providerOptions: s.cacheable
        ? { anthropic: { cacheControl: { type: "ephemeral" } } }
        : undefined,
    }));
}
```

**model/service.ts change:** `call()` signature gains an overload accepting `system: SystemModelMessage[]` alongside the existing `system: string`.

**Cache boundary strategy:** The `soul` and `instructions` sections are stable across turns (same SOUL.md, same tools). The `memory` section changes rarely. The `extra` section changes per-turn (skill injections). Place cache breakpoint after `instructions`, making soul+instructions cacheable across the entire session.

### Decision 2: Trace ID Threading Strategy

**Context:** Need to correlate logs across the full chain: message ingress → willingness → queue → loop → model call → tool exec → response.

**Options considered:**
1. Pass `traceId: string` as parameter through every function
2. Create `TraceContext` object passed alongside Percept
3. Use Node.js `AsyncLocalStorage`

**Recommendation:** Option 2 — `TraceContext` object.

```typescript
// shared/types.ts — new type
interface TraceContext {
  traceId: string;          // e.g., "t-{channelKey}-{timestamp}"
  startedAt: number;        // Date.now() at handleEvent entry
  marks: Map<string, number>; // named timing marks
  mark(name: string): void;
  elapsed(from?: string): number;
}
```

**Why not AsyncLocalStorage:** Koishi's event system and middleware chain don't guarantee async context propagation. The `ctx.emit("horizon/message")` → `handleEvent()` path crosses event boundaries where AsyncLocalStorage context can be lost.

**Why not plain traceId string:** A string requires a separate timing mechanism. The `TraceContext` object carries both correlation and performance data in one pass.

**Threading path:**
1. `handleEvent()` creates `TraceContext` with `traceId = "t-{channelKey}-{ts}"`
2. Passed to `enqueue()` → `runLoop()` → `loop.run(percept, toolCtx, trace)`
3. `loop.run()` passes to `modelService.call()` for latency logging
4. Logger helper: `trace.log(logger, "step description")` auto-prefixes traceId + elapsed

### Decision 3: memory_block → RoleService Merge Strategy

**Context:** MemoryService and RoleService both load markdown files from disk and inject into PromptService. They're siblings at Layer 2 with identical dependencies.

**Recommendation:** Absorb MemoryService into RoleService. RoleService becomes the single "content from disk" service.

**Strategy:**
1. Move `MemoryBlock` type to `role/types.ts`
2. Add `memoryPath` config to `RoleServiceConfig` (alongside existing `rolePath`)
3. Move snippet registration from MemoryService to RoleService
4. Move memory block loading + `core-memory` injection to RoleService
5. Delete `memory/service.ts`, `memory/types.ts`
6. Update `index.ts` to remove MemoryService registration
7. Update service count in `waitForServiceReady()` (9 → 8)

**Risk:** Low. MemoryService is ~120 LOC with no external consumers. RoleService already has the same patterns (file loading, Mustache rendering, PromptService injection).

**Post-merge RoleService responsibilities:**
- Load SOUL.md/AGENTS.md/TOOLS.md → inject at soul/instructions
- Load memory blocks (*.md from memoryPath) → inject at memory
- Register all 7 snippets (date, sender, channel, bot)
- Hot-reload on file changes (already implemented for role files)

### Decision 4: Snippet Scope Fix Strategy

**Context:** `{{date.now}}` and other Mustache variables render as empty in role files.

**Root cause analysis:** The `buildScope()` at `prompt/service.ts:215-224` runs snippet functions and builds a nested scope object. But the snippet functions registered by MemoryService need access to `view` and `percept` from the `initialScope`. The issue is that `buildScope()` receives `initialScope` but snippet functions may not be receiving it as their argument.

Looking at `service.ts:77-79`:
```typescript
registerSnippet(key: string, fn: SnippetFn): Disposable
```

And `buildScope()` at `service.ts:215-224` calls each `fn(initialScope)`. The snippet function must extract what it needs from `initialScope`. If `initialScope` is `{ view, percept }` but the snippet expects a flat scope, it fails silently (Mustache renders missing keys as empty string).

**Recommendation:** Fix the snippet function signatures to correctly destructure from `initialScope`. The fix is in MemoryService's snippet registration (or post-merge, RoleService). Each snippet function should be:

```typescript
prompt.registerSnippet("date.now", (_scope) => {
  return new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
});
prompt.registerSnippet("sender.name", (scope) => {
  return scope?.percept?.metadata?.senderName ?? "";
});
```

The `setNestedValue()` helper then places the return value at the correct dot-path in the scope object, making `{{sender.name}}` resolve correctly in Mustache.

### Decision 5: Working Memory Layout Restructure

**Context:** Current working memory is built as plain text lines from `view.history` observations. Tool results appear before the assistant message that requested them, breaking causality.

**Current flow in `loop.ts:105-127`:**
1. Iterate `view.history` (chronological)
2. For `agent.response` observations: extract `assistantText` + stringify tool results
3. Concatenate as `wmLines` strings
4. Pass to `horizon.formatHorizonText(view, wmLines)`

**Problem:** The `AgentResponseData` bundles `assistantText`, `actions[]`, and `toolResults[]` in a single record. When rendered linearly, the causal chain (assistant thinks → calls tool → gets result → responds) is lost.

**Recommendation:** Restructure working memory into a structured format:

```
[Previous interaction]
Assistant thought: "..."
  → Called: tool_name(params) → result summary
  → Called: tool_name(params) → result summary
Assistant said: "final response text"

[Current context]
User messages since last response...
```

**Implementation:** Change `loop.ts` working memory builder to:
1. Group `agent.response` observations by round
2. For each round: render thought → actions → results → final text
3. Separate "previous interactions" from "current context" (new messages since last response)
4. Use XML-like structure for clarity to the LLM

**Touch point with Feature 2:** The restructured working memory becomes part of the `user` message (not system). This is orthogonal to system prompt caching — system prompt sections are stable, working memory is per-turn user content.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Monolithic System Prompt String
**What:** Passing the entire system prompt as a single string to the model API.
**Why bad:** Prevents prompt caching. Every turn re-sends identical soul/instructions content.
**Instead:** Use `Section[]` → `SystemModelMessage[]` mapping with cache breakpoints.

### Anti-Pattern 2: Ad-hoc Logging Without Correlation
**What:** Each service logs independently with no shared identifier.
**Why bad:** Impossible to trace a single message's journey through the system.
**Instead:** Generate trace ID at message entry, thread through all downstream calls.

### Anti-Pattern 3: Parallel Services With Identical Responsibilities
**What:** MemoryService and RoleService both load markdown files and inject into PromptService.
**Why bad:** Duplicated patterns, split configuration, unclear ownership boundaries.
**Instead:** Single service (RoleService) owns all "content from disk" responsibilities.

## Sources

All findings are based on direct source code analysis of the v2.1 baseline:

| File | Lines | Key Types/Functions |
|------|-------|-------------------|
| `core/src/index.ts` | 47-129 | Service registration, `waitForServiceReady()` |
| `core/src/services/agent/service.ts` | 113-287 | `handleEvent()`, `enqueue()`, `scheduleDeferredJudgment()` |
| `core/src/services/agent/loop.ts` | 46-298 | `ThinkActLoop.run()`, context assembly, multi-round loop |
| `core/src/services/agent/willingness.ts` | 170-257 | `WillingnessEngine`, `processMessage()`, `WillingnessResult` |
| `core/src/services/agent/json-parser.ts` | 13-155 | `JsonParser<T>`, `parse()`, `isLikelyJsonStart()` |
| `core/src/services/agent/trimmer.ts` | 37-75 | `trimMessages()`, `softTrim()`, `hardClearToolResult()` |
| `core/src/services/agent/tools.ts` | 1-39 | `buildToolSchemaForPrompt()` |
| `core/src/services/prompt/service.ts` | 77-236 | `render()`, `renderToString()`, `buildScope()`, `registerSnippet()` |
| `core/src/services/prompt/types.ts` | 1-9 | `InjectionPoint`, `Section`, `INJECTION_POINTS` |
| `core/src/services/prompt/renderer.ts` | 7-43 | `MustacheRenderer.render()`, `parse()` |
| `core/src/services/model/service.ts` | 72-107 | `call()`, `streamCall()`, PQueue integration |
| `core/src/services/horizon/service.ts` | full | `buildView()`, `formatHorizonText()`, DB schema |
| `core/src/services/horizon/listener.ts` | 12-152 | `EventListener`, middleware, `classifyTrigger()` |
| `core/src/services/horizon/manager.ts` | 18-113 | `EventManager`, `recordMessage()`, `toObservations()` |
| `core/src/services/horizon/types.ts` | full | `HorizonView`, `Observation`, `TimelineEntry`, `Scope` |
| `core/src/services/memory/service.ts` | full | `MemoryService`, block loading, snippet registration |
| `core/src/services/memory/types.ts` | 1-7 | `MemoryBlock` |
| `core/src/services/role/service.ts` | full | `RoleService`, SOUL/AGENTS/TOOLS loading, hot-reload |
| `core/src/services/role/types.ts` | 1-12 | `RoleServiceConfig` |
| `core/src/services/trait/service.ts` | full | `TraitAnalyzer`, `analyze()`, SceneTrait/HeatTrait |
| `core/src/services/skill/service.ts` | full | `SkillRegistry`, `resolve()`, condition evaluation |
| `core/src/services/skill/types.ts` | full | `SkillDefinition`, `SkillEffect`, `ToolFilter` |
| `core/src/services/plugin/service.ts` | 30-131 | `PluginService`, `invoke()`, `getTools()` |
| `core/src/services/plugin/types.ts` | 1-47 | `FunctionDefinition`, `ToolExecutionContext`, `Activator` |
| `core/src/services/shared/types.ts` | 1-34 | `TriggerType`, `Scope`, `Percept`, `TraitSignal` |

**Confidence:** HIGH — all findings verified against actual source code, no external sources needed for architecture mapping.
