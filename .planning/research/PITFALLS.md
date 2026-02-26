# Pitfalls Research

**Domain:** Koishi AI chat plugin — v2.4 model group load balancing, provider architecture, config UI grouping, runtime bug fixes
**Researched:** 2026-02-26
**Confidence:** HIGH (all findings derived from direct source analysis of v2.3 codebase)

---

## Critical Pitfalls

### Pitfall 1: Model Group Queue Bypasses the Global PQueue

**What goes wrong:**
Group selection logic runs *outside* `queue.add()`, so group member calls skip the global concurrency cap. Under burst load, multiple group members fire simultaneously and hit API rate limits.

**Why it happens:**
The natural implementation of "pick a member, then call it" puts selection before `queue.add()`. If group resolution calls `executeCall` directly instead of going through the queued path, the PQueue guard is bypassed entirely.

**How to avoid:**
All model calls — direct or via group — must enter `queue.add()` as the outermost wrapper. Group member selection happens *inside* the queued task, not before it.

```typescript
// WRONG: selection outside queue
const member = group.pick();
return this.queue.add(() => this.executeCall(member.provider, member.modelId, params));

// CORRECT: selection inside queue
return this.queue.add(async () => {
  const member = group.pick(); // inside the queued task
  return this.executeCall(member.provider, member.modelId, params);
});
```

**Warning signs:**
- `queue.size` stays near 0 even under load while API 429 errors appear
- `usage` map shows uneven distribution across group members despite round-robin config

**Phase to address:** Model group load balancing phase

---

### Pitfall 2: Group Failover Skips `withRetry`

**What goes wrong:**
`withRetry()` wraps a single `executeCall`. When group failover is added as a separate loop, it calls `executeCall` directly, bypassing `withRetry`. Transient errors on group members don't get the retry treatment they would on a direct call — every transient error immediately advances to the next member.

**Why it happens:**
`handleFallback` already exists for `fallbackChain` and calls `executeCall` directly. Developers copy this pattern for group failover without noticing `withRetry` is missing from the chain.

**How to avoid:**
Wrap each group member attempt with `withRetry`, or integrate group failover into the retry loop: on transient error, advance to the next member and retry rather than throwing immediately.

**Warning signs:**
- Single transient 429 on a group member causes immediate failover instead of a retry
- Logs show `Trying fallback` on errors that should have been retried first

**Phase to address:** Model group load balancing phase

---

### Pitfall 3: `IModelService` Interface Not Extended for Groups

**What goes wrong:**
New group methods are added to `ModelService` (concrete class in `core`) without updating `IModelService` (interface in `shared-model`). Provider plugins typed as `IModelService` cannot call group methods. The type contract diverges from the implementation silently.

**Why it happens:**
`ModelService` is the concrete class; `IModelService` is the interface in `shared-model`. It's easy to add methods to the class and forget the interface, especially since provider plugins only use `registerProvider` and never need group methods themselves.

**How to avoid:**
Update `IModelService` first, then implement in `ModelService`. Run `yarn typecheck` (Turbo task) across the monorepo after interface changes — it catches divergence before build.

**Warning signs:**
- TypeScript errors only appear in `core` package, not in `shared-model` or provider packages
- Provider plugins compile fine but runtime calls to group methods fail with "not a function"

**Phase to address:** Model group load balancing phase (interface design step)

---

### Pitfall 4: `refreshSchemas()` Called N Times During Group Registration

**What goes wrong:**
`refreshSchemas()` rebuilds the entire `registry.chatModels` Schema union on every `registerProvider` call. If model groups register multiple members individually, `refreshSchemas()` fires N times during startup — N full Schema rebuilds and N Koishi console refreshes.

**Why it happens:**
The current `registerProvider` always calls `refreshSchemas()` at the end (model/service.ts:71). Adding groups that register multiple members individually multiplies this cost.

**How to avoid:**
Batch group registration: register all members first, then call `refreshSchemas()` once. Or add a `registerGroup(name, members[])` method that defers `refreshSchemas()` until all members are registered.

**Warning signs:**
- Koishi console flickers or shows stale model list during startup
- Startup logs show `Provider registered` + `refreshSchemas` called 5+ times in rapid succession

**Phase to address:** Model group load balancing phase

---

### Pitfall 5: Promise-Chain Queue Loses "Processing" State on Completion

**What goes wrong:**
The `enqueue` method uses a Promise chain stored in `this.queues`. The `finally` block deletes the entry when the chain resolves. If a new message arrives in the tiny window between `finally` running and the next `enqueue` call, `this.queues.has(channelKey)` returns `false`, so the new message starts a fresh chain instead of being queued as `pending`. Two concurrent loops run for the same channel.

**Why it happens:**
The `finally` block runs synchronously after the Promise resolves, but the event handler that checks `this.queues.has()` can fire in the same microtask tick. The delete-then-check race is subtle.

**How to avoid:**
The current code already guards this correctly with an identity check:
```typescript
if (this.queues.get(channelKey) === chain) this.queues.delete(channelKey);
```
The message queue refactor must preserve this identity check. Do not simplify to `this.queues.delete(channelKey)` without the guard — that removes the race protection.

**Warning signs:**
- Two simultaneous "Starting loop" log entries for the same `channelKey`
- `pending` map entries are never consumed (overwritten by a new chain before being drained)

**Phase to address:** Message queue refactor phase

---

### Pitfall 6: Accumulate-and-Merge Drops the Willingness Gate

**What goes wrong:**
The refactored message queue accumulates messages that arrive while a loop is running, then merges them into a single response. If accumulated messages are fed directly to the loop without re-running the willingness check, the bot responds to messages it would have silently ignored under normal conditions.

**Why it happens:**
The willingness check happens in `handleEvent` before `enqueue`. Accumulated messages bypass `handleEvent` — they go straight into `pending` and then into the loop. The willingness gate is skipped for backlog messages.

**How to avoid:**
Make a conscious decision: either (a) re-run willingness for the accumulated batch, or (b) accept that backlog messages inherit the willingness decision of the triggering message. Option (b) is simpler and defensible. Document the chosen behavior explicitly — do not silently skip the willingness check without a recorded decision.

**Warning signs:**
- Bot responds to messages in channels where willingness should have kept it silent
- Willingness logs show no entry for backlog-triggered responses

**Phase to address:** Message queue refactor phase

---

### Pitfall 7: Bot Action Empty Record — Fix at Display Layer Instead of Storage Layer

**What goes wrong:**
The fix for "LLM chooses not to reply → empty `[Bot Action]` recorded" is placed in `formatObservation` (display layer) rather than in `loop.ts` before `recordAgentResponse` (storage layer). The empty record is still written to the timeline DB; it just doesn't show in the rendered view. On the next turn, the empty record is loaded from DB and causes a blank line in history.

**Why it happens:**
`formatObservation` is the most visible place where the empty action string appears (service.ts:281: `[Bot Action]: `). Developers fix the symptom (display) rather than the cause (storage write).

**How to avoid:**
The guard must be in `loop.ts` before calling `horizon.events.recordAgentResponse`. If `response.actions` is empty or contains only no-ops, skip the `recordAgentResponse` call entirely. The display layer should handle the empty case defensively too, but the primary fix is at the write path.

```typescript
// In loop.ts, before recordAgentResponse:
if (response.actions.length > 0) {
  await horizon.events.recordAgentResponse({ ... });
}
```

**Warning signs:**
- Timeline DB accumulates `agent.response` entries with empty `actions` arrays
- `[Bot Action]: ` (trailing space, no names) appears in rendered history

**Phase to address:** Bug fix phase (Bot Action empty record)

---

### Pitfall 8: `trimMessages()` Cannot Trim the Initial User Message

**What goes wrong:**
`trimMessages` is called at the top of each loop round. But the initial `messages` array is `[{ role: "user", content: userContent }]` — a single message. The trimmer's round-detection logic is `Math.floor((messages.length - 1) / 2)`, which gives `totalRounds = 0`, `protectedRounds = 0`, `eligibleEnd = 1`, and an empty eligible slice. Nothing gets trimmed even if `userContent` alone exceeds `charBudget`.

**Why it happens:**
The trimmer assumes at least one assistant+user pair exists. A single initial user message has 0 rounds, so the eligible window is empty. The budget check passes silently.

**How to avoid:**
Truncate `userContent` before building the `messages` array, or add a special case in `trimMessages` for the single-message case. The `charBudget` check must apply to `userContent` directly before it enters the messages array — not only after the loop has accumulated multiple rounds.

**Warning signs:**
- Token counts in logs consistently exceed `charBudget / 4` (rough char-to-token ratio)
- `trimMessages` logs show "budget ok" even when `userContent` is very large
- Working memory grows without bound despite trim config being set

**Phase to address:** Tool trim fix phase

---

## Moderate Pitfalls

### Pitfall 9: Provider Architecture — Duplicated Schema Blocks Across Three Providers

**What goes wrong:**
The `models` array Schema block is copy-pasted identically across `provider-openai`, `provider-deepseek`, and `provider-anthropic`. When a new `ModelInfo` field is added (e.g., `maxContextTokens`), it must be added to all three Schema definitions manually. One provider gets missed, causing a type mismatch between the shared `ModelInfo` type and the provider's config Schema.

**Why it happens:**
Each provider is a standalone Koishi plugin with its own `Config` interface and `Schema<Config>`. There is no shared Schema factory for the common `models` array block.

**How to avoid:**
Extract a shared `modelsArraySchema` factory into `shared-model` or a shared utility. Each provider imports and uses it. When `ModelInfo` changes, only the factory needs updating.

```typescript
// In shared-model:
export function createModelsArraySchema(defaults: ModelInfo[]): Schema<ModelInfo[]> {
  return Schema.array(Schema.object({ ... })).default(defaults).role("table");
}
```

**Warning signs:**
- TypeScript error in one provider but not others after a `ModelInfo` change
- Provider configs show different fields in Koishi console UI

**Phase to address:** Provider architecture optimization phase

---

### Pitfall 10: Provider `apply()` Does Not Unregister on Dispose

**What goes wrong:**
The current `apply()` function in each provider registers the provider with `ctx["yesimbot.model"].registerProvider(config.id, provider)`. The `registerProvider` method in `ModelService` sets up a dispose listener using `this[Context.current]` (model/service.ts:66-69). But if the provider plugin is reloaded (hot-reload in Koishi), the old provider instance may linger if the dispose listener fires after the new registration.

**Why it happens:**
`this[Context.current]` in `registerProvider` captures the caller's context at registration time. This is correct for Koishi's hot-reload model. But if the provider architecture refactor moves registration logic into a class constructor or a different call site, the caller context may not be the plugin's context, breaking the auto-cleanup.

**How to avoid:**
Keep `registerProvider` called directly from `apply(ctx, config)` — never from a constructor or a nested function that doesn't have the plugin's `ctx` as the current context. Verify hot-reload behavior: disable and re-enable the provider plugin in Koishi console and confirm the old provider is unregistered.

**Warning signs:**
- After hot-reload, `listProviders()` returns duplicate provider names
- `refreshSchemas()` shows duplicate model entries in the dropdown

**Phase to address:** Provider architecture optimization phase

---

### Pitfall 11: Koishi Schema Grouping — `Schema.object().collapse()` vs Nested Objects

**What goes wrong:**
Koishi Console renders `Schema.object()` as a flat list of fields by default. Adding `.collapse()` makes it collapsible in the UI. But if a nested `Schema.object()` is used inside another `Schema.object()` without `.collapse()`, the inner object's fields render inline and the grouping is invisible to the user.

**Why it happens:**
The distinction between "grouping for UI" and "grouping for data structure" is conflated. A nested object in the Schema data model does not automatically create a visual group in the console UI — it requires explicit `.collapse()` or `.role("group")` annotations.

**How to avoid:**
For config grouping in Koishi Console, use `Schema.object({ ... }).collapse()` for sections that should be collapsible. Test the UI rendering in the actual Koishi console after Schema changes — the rendered output is not always predictable from the Schema definition alone.

**Warning signs:**
- Config fields appear in unexpected order or without visual separation in Koishi console
- Nested config objects render as flat fields instead of grouped sections

**Phase to address:** Config grouping optimization phase

---

### Pitfall 12: `Schema.dynamic()` Dropdown Breaks When Group Names Contain Colons

**What goes wrong:**
The `registry.chatModels` dynamic Schema uses `provider:model` as the option value (model/service.ts:55). If model group names also use colons (e.g., `group:primary`), the `parseModelId` function in `shared-model` may misparse the group name as a provider name, causing "Provider not found" errors at runtime.

**Why it happens:**
`parseModelId` splits on the first colon to extract `provider` and `model`. A group name like `group:primary` would parse as `provider="group"`, `model="primary"`, which is not a registered provider.

**How to avoid:**
Use a different separator for group references in the dropdown (e.g., `@group/primary`) or add explicit group resolution before `parseModelId` in `resolveModel`. The group lookup must happen before the provider lookup, not after.

**Warning signs:**
- "Provider not found: group" errors in logs when a group model is selected
- `resolveModel` throws on valid group names

**Phase to address:** Model group load balancing phase (model ID format design)

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Copy-paste provider Schema blocks | Fast to add new provider | Schema drift when `ModelInfo` changes | Never — extract shared factory |
| `declare module "koishi"` in each provider | Each provider is self-contained | Three identical augmentation blocks; any change requires 3 edits | Acceptable until a shared provider-base package exists |
| `pending` map holds only last message | Simple backpressure, no unbounded queue | Burst messages during processing are silently dropped | Acceptable for v2.4; document the behavior |
| Group failover as linear scan | Simple to implement | No circuit-breaker; a permanently-down member is retried every call | Acceptable for v2.4; add circuit-breaker in later milestone |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| PQueue + group selection | Selection before `queue.add()` bypasses concurrency cap | Selection inside `queue.add()` callback |
| Koishi `ctx[Context.current]` | Called from constructor instead of `apply()` | Always call `registerProvider` from the plugin's `apply()` function |
| Koishi Schema `.collapse()` | Assuming nested objects auto-collapse in UI | Explicitly annotate collapsible sections with `.collapse()` |
| `parseModelId` with group names | Group name parsed as provider:model | Resolve group names before calling `parseModelId` |
| `recordAgentResponse` with empty actions | Empty record written to DB | Guard at write path in `loop.ts`, not at display path |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| `refreshSchemas()` on every registration | Koishi console flickers at startup | Batch registrations, call `refreshSchemas()` once | At 5+ providers/groups registered |
| `trimMessages()` skips initial message | Token counts grow unbounded | Pre-truncate `userContent` before loop | When `userContent` > `charBudget` chars |
| Round-robin counter not persisted | After restart, all groups start at member 0 | In-memory counter is acceptable; document restart behavior | Not a performance issue, but fairness issue |
| Group failover with no circuit-breaker | Every call retries a dead member | Add failure tracking per member | When one group member is permanently down |

---

## "Looks Done But Isn't" Checklist

- [ ] **Model group load balancing:** Group selection is inside `queue.add()`, not before it — verify with concurrency stress test
- [ ] **Group failover:** Each member attempt goes through `withRetry` — verify transient errors retry before advancing
- [ ] **Bot Action fix:** Empty `actions` arrays are not written to DB — verify with `ctx.database.get` after a no-reply turn
- [ ] **Tool trim fix:** `userContent` exceeding `charBudget` is truncated before entering `messages` — verify with a large history channel
- [ ] **Provider architecture:** All three providers use shared Schema factory — verify `ModelInfo` field addition only requires one change
- [ ] **Config grouping:** Collapsible sections render correctly in Koishi console — verify by loading the plugin in a real Koishi instance
- [ ] **Hot-reload:** Provider unregisters cleanly on plugin disable — verify `listProviders()` after disable/re-enable cycle
- [ ] **Message queue refactor:** Identity check `this.queues.get(channelKey) === chain` preserved — verify no concurrent loops for same channel

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Group queue bypass (API overload) | MEDIUM | Add `queue.add()` wrapper around group selection; redeploy |
| Empty Bot Action records in DB | LOW | One-time DB cleanup: delete `agent.response` entries with empty `actions`; deploy fix |
| `trimMessages` not trimming initial message | LOW | Add pre-truncation of `userContent`; no DB migration needed |
| `IModelService` interface divergence | LOW | Update interface in `shared-model`; rebuild all packages |
| `refreshSchemas()` startup flicker | LOW | Batch registrations; cosmetic issue only |
| Promise-chain race condition | HIGH | Restore identity check; requires careful testing to verify fix |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Group queue bypass | Model group load balancing | Concurrency stress test: 10 simultaneous requests, verify `queue.size` > 0 |
| Group failover skips retry | Model group load balancing | Inject transient error on member 1; verify retry before failover to member 2 |
| `IModelService` not extended | Model group load balancing (interface step) | `yarn typecheck` passes across all packages |
| `refreshSchemas()` N-times | Model group load balancing | Startup log shows single `refreshSchemas` call |
| Promise-chain race | Message queue refactor | Identity check preserved; no concurrent loop logs |
| Willingness gate dropped | Message queue refactor | Backlog behavior documented and tested |
| Bot Action empty record | Bug fix phase | DB query after no-reply turn returns 0 `agent.response` entries |
| `trimMessages` initial message | Tool trim fix | Large history channel stays within token budget |
| Provider Schema duplication | Provider architecture | Single `ModelInfo` field addition requires 1 file change |
| Provider dispose on hot-reload | Provider architecture | Disable/re-enable cycle leaves no duplicate providers |
| Schema grouping UI | Config grouping | Visual inspection in Koishi console |
| Group name colon collision | Model group load balancing (ID format) | Group names resolve correctly before `parseModelId` |

---

## Sources

All findings verified by direct source analysis:

- `core/src/services/model/service.ts` — PQueue usage, `registerProvider`, `refreshSchemas`, `withRetry`, `handleFallback`, `resolveModel`
- `core/src/services/agent/service.ts` — `enqueue`, `pending` map, identity check in `finally`, `handleEvent` willingness gate
- `core/src/services/agent/loop.ts` — `recordAgentResponse` call site, `messages` array construction, `trimMessages` call
- `core/src/services/agent/trimmer.ts` — `trimMessages` round-detection logic, single-message edge case
- `core/src/services/horizon/manager.ts` — `recordAgentResponse` write path
- `core/src/services/horizon/service.ts` — `formatObservation` display path for empty actions
- `providers/provider-openai/src/index.ts` — Schema duplication, `apply()` registration pattern
- `providers/provider-deepseek/src/index.ts` — Schema duplication
- `providers/provider-anthropic/src/index.ts` — Schema duplication, `ctx` passed to constructor
- `packages/shared-model/src/types/model.ts` — `IModelService` interface, `ModelInfo` type

---
*Pitfalls research for: Koishi AI chat plugin v2.4 milestone*
*Researched: 2026-02-26*
