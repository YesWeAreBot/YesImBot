# Pitfalls Research: v2.2 Runtime Optimization & Observability

**Domain:** AI LLM chat agent for IM platforms (Koishi 4.x plugin)
**Researched:** 2026-02-25
**Confidence:** HIGH (all findings verified against actual source code)

## Critical Pitfalls (HIGH risk)

### 1. Prompt Cache: `system` is currently a plain string, splitting into `SystemModelMessage[]` changes the ai-sdk contract

**Risk:** HIGH
**Where:** `core/src/services/agent/loop.ts:151-153`, `core/src/services/model/service.ts:119-138`
**Description:**
The current code passes `system` as a single string to `generateText`/`streamText`:

```ts
// loop.ts:151-153
const callParams: CallParams = {
  system: systemPrompt,  // string
  messages,
};
```

The ai-sdk `Prompt` type accepts `system?: string | SystemModelMessage | Array<SystemModelMessage>`. Switching to `SystemModelMessage[]` for cache control requires each element to have `{ role: 'system', content: string, providerOptions?: ProviderOptions }`. However:

1. The `CallParams` type alias is `CallSettings & Prompt` (model/service.ts:24). This already supports the union type, so the TypeScript types will pass. But the `ModelService.executeCall` method spreads `{ ...defaults, ...params }` (line 165) -- if `defaults` also has a `system` key, the spread will silently overwrite the array with a string or vice versa.

2. The `providerOptions` field on `SystemModelMessage` is how you'd set Anthropic's `cacheControl: { type: 'ephemeral' }`. But the `@ai-sdk/anthropic` provider in this repo's node_modules has NO explicit `cacheControl` typing -- it relies on the generic `providerOptions` passthrough. This means the cache hint format is provider-specific and undocumented in the installed version. Getting the format wrong means silent no-op (no caching, no error).

3. Not all providers support `Array<SystemModelMessage>`. The ai-sdk docs explicitly warn: "not all providers support several system messages." OpenAI-compatible providers may concatenate or reject arrays. The current codebase supports multiple providers via `ModelService.registerProvider` with a fallback chain -- a cached prompt format that works for Anthropic will silently degrade or error on OpenAI fallbacks.

**Mitigation:**
- Implement cache control at the `ModelService` layer, not in the loop. Let `ModelService.executeCall` detect the provider type and conditionally split the system prompt into `SystemModelMessage[]` with appropriate `providerOptions` only for Anthropic.
- Add integration tests that verify the actual HTTP request body sent to each provider.
- Keep the `renderToString` return type as `string`; convert to `SystemModelMessage[]` only at the model service boundary.

### 2. Snippet variables missing from Horizon's `formatHorizonText` -- `{{date.now}}` renders as empty string

**Risk:** HIGH
**Where:** `core/src/services/horizon/service.ts:274-283`, `core/resources/templates/partials/horizon-view.mustache:1`
**Description:**
The horizon-view template starts with `现在是 {{date.now}}。` (line 1). But `formatHorizonText` passes a hand-built scope object with only `environment`, `activeMembers`, `history`, `trigger`, and `workingMemory` keys:

```ts
// horizon/service.ts:274-283
return Mustache.render(this.horizonViewTpl, {
  environment,
  activeMembers,
  hasHistory: historyObs.length > 0,
  history: historyObs,
  hasTrigger: triggerObs.length > 0,
  trigger: triggerObs,
  hasWorkingMemory: (workingMemory?.length ?? 0) > 0,
  workingMemory,
}).trim();
```

The `date.now` snippet is registered in `MemoryService.registerSnippets()` (memory/service.ts:146) and resolved by `PromptService.buildScope()` (prompt/service.ts:215). But `buildScope` is `private` and only called inside `PromptService.render()`. The horizon service never calls `buildScope` -- it renders the template directly with Mustache, bypassing the entire snippet system.

This is a confirmed live bug visible in the PROMPT.json file (line 178: `"content": "现在是 。`).

**Mitigation:**
- Option A: Make `buildScope` public (or add a `getScope(initialScope)` method) on PromptService, and have HorizonService call it before rendering.
- Option B: Have HorizonService accept a pre-built scope from the caller (the loop already has access to the prompt service).
- Option A is cleaner because it keeps scope resolution centralized. But be careful: `buildScope` is async (snippets can be async), so `formatHorizonText` would need to become async too.

### 3. memory_block merge: MemoryService and RoleService both use `fs.watch` with incompatible patterns

**Risk:** HIGH
**Where:** `core/src/services/memory/service.ts:116-133`, `core/src/services/role/service.ts:121-137`
**Description:**
Both services implement nearly identical file-watching patterns:

- MemoryService watches `data/yesimbot/memories/` (memory/service.ts:120)
- RoleService watches `data/yesimbot/roles/` (role/service.ts:125)

Both use 300ms debounce timers and reload-on-change. Merge risks:

1. **Double watcher on same directory:** If both services watch the same merged directory, every file change triggers two independent reload cycles. The debounce timers are independent (`this.debounceTimer` is per-service), so they won't coalesce.

2. **Injection point collision:** MemoryService injects into `"memory"` point with name `"core-memory"`. RoleService injects into `"soul"` and `"instructions"` with names `"__role_soul"`, `"__role_agents"`, `"__role_tools"`. If the merge changes injection names, the `PromptService.inject` duplicate-name check (prompt/service.ts:93-96) will silently ignore the second injection.

3. **Sync vs async file reads:** RoleService uses `readFileSync` (role/service.ts:68-72) while MemoryService uses `readFile` (async, memory/service.ts:92). Mixing during hot-reload can cause race conditions where one service sees a partially-written file.

4. **Dispose cleanup asymmetry:** RoleService manually tracks `disposers[]` and calls them on reload (role/service.ts:87-88). MemoryService doesn't -- it just replaces `this.blocks`. If the merged service needs to re-inject on reload, it must properly dispose old injections first.

**Mitigation:**
- Use a single watcher on the merged directory.
- Ensure all file reads are async.
- Track and dispose all injection handles before re-injecting on reload.
- Keep injection point semantics clear: files from `roles/` inject into `soul`/`instructions`, files from `memories/` inject into `memory`.

---

## Moderate Pitfalls (MEDIUM risk)

### 4. JSON Parser v4 is missing v3's battle-tested edge cases

**Risk:** MEDIUM
**Where:** `core/src/services/agent/json-parser.ts` vs `references/YesImBot-v3/packages/core/src/shared/utils/json-parser.ts`
**Description:**
The v4 parser is a simplified rewrite of v3. Comparing the two:

| Capability | v3 | v4 |
|---|---|---|
| Code block extraction | Yes | Yes |
| Nested code blocks in JSON values | Yes (tested) | Partial -- same logic but untested |
| `[OBSERVE]` prefix handling | Yes (tested) | Yes |
| Unbalanced bracket detection | Yes (logged) | Yes |
| Log messages | Chinese (match test assertions) | English |
| Constructor | `ParserOptions` with `debug` flag | `Logger` interface |

Key gaps:

1. **v3 test suite uses `bun:test` and custom matchers.** The test file (line 1: `import { describe, it, expect } from "bun:test"`) uses `toContainValue` (line 364) which is a Bun-specific matcher not available in vitest. Porting the test suite requires replacing these.

2. **v3 test assertions check Chinese log messages** (e.g., line 330: `"检测到 Markdown 代码块"`). The v4 parser logs in English. Porting tests means updating all log assertions.

3. **The "complex format" test case** (v3 test line 211-249) tests a massive multi-paragraph LLM output with `[OBSERVE]`, `[ANALYZE & INFER]`, `[PLAN]`, `[ACT]` sections followed by a ```json block. This is a real-world edge case that v4 has no test coverage for.

4. **v4 lacks the `debug` flag.** v3's parser only logs when `debug: true`. v4 always logs to the injected logger. In production, this means every parse attempt generates log noise.

**Mitigation:**
- Port v3 test cases to vitest, updating `bun:test` imports and custom matchers.
- Replace Chinese log assertions with English equivalents matching v4's messages.
- Add the "complex format" test case -- it catches real production failures.
- Add a `debug` flag to v4's constructor to suppress verbose logging.

### 5. Willingness DM bypass: always-reply in DMs removes the only spam protection

**Risk:** MEDIUM
**Where:** `core/src/services/agent/service.ts:113-142`
**Description:**
The current `handleEvent` flow for DMs (service.ts:134-141):

```ts
if (event.scope.isDirect) {
  const built = this.buildPercept(event);
  if (this.queues.has(channelKey)) {
    this.pending.set(channelKey, built);
  } else {
    this.enqueue(channelKey, built);
  }
  return;
}
```

This code runs AFTER the willingness check (line 126: `if (!result.shouldReply)`). So DMs still go through willingness. The v2.2 plan is to bypass willingness for DMs entirely. Risks:

1. **No rate limiting for DMs.** Without willingness as a gate, a user can spam the bot in DMs and trigger unlimited LLM calls. The `queues` map serializes per-channel, but `pending` only keeps the LAST event (line 138: `this.pending.set(channelKey, built)`) -- so rapid-fire messages won't queue up infinitely, but each new message replaces the pending one, meaning the bot will process at least 2 messages per burst (current + pending).

2. **Cost explosion.** Each loop iteration calls `modelService.call` which goes through the queue (p-queue with concurrency 5). DM spam from multiple users hits the concurrency limit and backs up, but doesn't reject.

3. **The deferred judgment path is skipped for DMs.** If DMs bypass willingness entirely, the `scheduleDeferredJudgment` code (service.ts:127-132) never fires for DMs. This is correct behavior but means the Judge prompt feature is group-only.

**Mitigation:**
- Add a per-user rate limiter for DMs (e.g., max 1 request per 3 seconds per user).
- Keep the `pending` map behavior (last-write-wins) as natural backpressure, but add an explicit cooldown.
- Document that deferred judgment is group-only by design.

### 6. Working memory format change may confuse the LLM

**Risk:** MEDIUM
**Where:** `core/src/services/agent/loop.ts:110-126`, `core/resources/templates/partials/horizon-view.mustache:21-28`
**Description:**
The current working memory is built in the loop (loop.ts:110-125) as plain text lines:

```
Round 2:
  - send_message({"content":"搜不了，搜索服务炸了"}) -> success: Sent 1 message(s)
```

This format is embedded in the user message via the horizon-view template's `<working-memory>` section. The LLM has been "trained" (via in-context examples across many conversations) to expect this exact format.

Risks of changing the format:

1. **LLM behavioral regression.** If the format changes (e.g., from indented text to structured XML or JSON), the LLM may misinterpret the working memory or try to mimic the new format in its output. Since the agent's output format is JSON with `actions[]`, any confusion about what's "data" vs "instruction" can cause parse failures.

2. **The trimmer operates on raw strings.** `trimMessages` (trimmer.ts:37-74) uses character counting and string slicing. If working memory format changes to be more verbose (e.g., XML tags), the `charBudget` of 30000 will be hit sooner, causing more aggressive trimming of earlier rounds.

3. **Working memory is duplicated.** The same tool execution data appears in both `<history>` (as `[Bot Action]` lines from `formatObservation`) and `<working-memory>` (as detailed round logs). Changing one format without the other creates inconsistency the LLM may flag or get confused by.

**Mitigation:**
- Make format changes incremental -- test with A/B comparisons on real conversations.
- If adding structure (XML/JSON), keep it concise to avoid blowing the char budget.
- Ensure `<history>` and `<working-memory>` tell a consistent story.

### 7. Deferred judgment JUDGMENT_PROMPT is too minimal -- LLM may not understand the task

**Risk:** MEDIUM
**Where:** `core/src/services/agent/service.ts:11-12`
**Description:**
The current judgment prompt:

```ts
const JUDGMENT_PROMPT = `You are a conversation participation judge. Based on the conversation context and the bot's willingness score, decide whether the bot should reply.
Answer with exactly one word: "yes" or "no".`;
```

Issues:

1. **No persona context.** The judge doesn't know who the bot is, what topics it cares about, or its personality. It receives the full horizon text (which includes history) but has no soul/instructions context. This means the judge can't make persona-consistent decisions.

2. **Willingness score is opaque.** The judge receives `Willingness score: 0.312` but has no idea what this number means, what range it's in, or what threshold triggered the judgment. Without calibration context, the LLM is essentially guessing.

3. **"yes"/"no" parsing is fragile.** The code checks `answer.startsWith("yes")` (service.ts:278). If the LLM responds with "Yes, the bot should reply" or "yes." it works. But some models may respond with "I think yes" or reasoning before the answer, which would fail the startsWith check.

4. **Cost per judgment.** Each deferred judgment is a full LLM call with `maxOutputTokens: 8`. The model used is `this.config.willingness?.deferred?.model` which defaults to empty string (service.ts:257) -- meaning it falls through to the default model, which may be expensive.

**Mitigation:**
- Include a brief persona summary in the judgment prompt.
- Add calibration context: "Score range is 0-1, threshold for this judgment was {threshold}."
- Parse more robustly: extract first "yes" or "no" token from anywhere in the response.
- Default the judgment model to a cheap/fast model, not the main agent model.

---

## Minor Pitfalls (LOW risk)

### 8. Debug logging: all current logs use `logger.info` -- no debug level separation

**Risk:** LOW
**Where:** `core/src/services/agent/loop.ts` (throughout)
**Description:**
The loop currently logs everything at `info` level:

```ts
this.logger.info(`Round ${round}/${maxRounds}`);           // line 147
this.logger.info(JSON.stringify(callParams, null, 2));      // line 156 -- FULL PROMPT
this.logger.info(`Model output: ${rawText}`);               // line 170
```

Line 156 is particularly problematic: it logs the entire system prompt + messages as pretty-printed JSON on every round. This is useful for debugging but extremely noisy in production.

Adding trace ID threading means touching these log calls anyway. The risk is:

1. **Changing log levels breaks existing monitoring.** If users have log scrapers filtering for `info`, downgrading to `debug` will hide messages they depend on.
2. **Trace ID as function parameter has wide blast radius.** If `traceId` is added as a parameter to `ThinkActLoop.run()`, `ModelService.call()`, etc., it touches every call site.

**Mitigation:**
- Use Koishi's logger namespace system: `ctx.logger("agent.loop")`, `ctx.logger("agent.willingness")` etc. for granular filtering.
- Pass trace ID via a context object or AsyncLocalStorage, not as a function parameter.
- Keep `info` for key lifecycle events (loop start/end, round count), use `debug` for payloads.

### 9. RoleService `renderSafe` fallback masks template errors silently

**Risk:** LOW
**Where:** `core/src/services/role/service.ts:75-84`
**Description:**
```ts
private renderSafe(name: string, content: string, scope: Record<string, unknown>): string {
  try {
    const rendered = Mustache.render(content, scope);
    this.lastValid.set(name, rendered);
    return rendered;
  } catch (e) {
    this.logger.warn("Mustache render error in %s: %s", name, e);
    return this.lastValid.get(name) ?? content;
  }
}
```

If a user edits SOUL.md and introduces a Mustache syntax error, the service silently falls back to the last valid render. This is good for resilience but bad for debugging -- the user won't know their edit didn't take effect unless they check logs.

After the merge with MemoryService, this pattern should be applied consistently to memory blocks too (currently memory blocks don't have this fallback).

**Mitigation:**
- Log at `warn` level (already done) but also consider surfacing the error via Koishi's console plugin if available.
- Apply the same `renderSafe` pattern to memory block rendering after the merge.

### 10. `PromptService.render` returns sections with `cacheable: true` hardcoded -- no actual cache logic

**Risk:** LOW
**Where:** `core/src/services/prompt/service.ts:136`
**Description:**
```ts
sections.push({
  name: point,
  content: `<${point}>\n${content}\n</${point}>`,
  cacheable: true,  // always true, never consumed
});
```

The `Section.cacheable` field is always `true` and nothing reads it. When implementing prompt caching, this field could be repurposed to signal which sections should get `cacheControl` hints. But currently it's dead code that might mislead implementers into thinking caching is already partially implemented.

**Mitigation:**
- Either remove the `cacheable` field until it's actually used, or implement the cache boundary logic that consumes it.
- If keeping it, make it dynamic: `soul` and `instructions` sections are cacheable (stable across turns), `memory` and `extra` may not be (they change per-turn with working memory).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|---|---|---|
| Prompt cache optimization | Provider-specific `providerOptions` format for cache hints; silent failure if wrong | Test against actual Anthropic API; add response header check for cache hit/miss |
| Willingness DM handling | Cost explosion from unthrottled DM processing | Add per-user rate limiter before bypassing willingness |
| Judge prompt enhancement | Minimal context leads to poor judgment quality | Include persona summary and score calibration in prompt |
| memory_block → RoleService merge | Data migration for existing `data/yesimbot/memories/` and `data/yesimbot/roles/` directories | Provide migration script or auto-detect old directory structure |
| JSON parser hardening | v3 test suite uses Bun-specific APIs | Port to vitest; replace `bun:test` imports and custom matchers |
| Snippet variable fix | Making `buildScope` public changes PromptService's API surface | Consider a dedicated `resolveScope()` method instead of exposing internals |
| Working memory format | LLM behavioral regression from format changes | A/B test with real conversations before committing to new format |
| Debug logging (trace ID) | Wide blast radius if trace ID is a function parameter | Use AsyncLocalStorage or context object pattern instead |

## Sources

All findings verified by reading actual source code in the repository:

- `core/src/services/model/service.ts` — ModelService, CallParams type, executeCall spread pattern
- `core/src/services/agent/loop.ts` — ThinkActLoop, system prompt passing, working memory construction
- `core/src/services/agent/service.ts` — AgentCore, willingness flow, DM handling, JUDGMENT_PROMPT
- `core/src/services/agent/willingness.ts` — WillingnessEngine algorithm
- `core/src/services/agent/json-parser.ts` — v4 JSON parser
- `core/src/services/agent/trimmer.ts` — Message trimming logic
- `core/src/services/prompt/service.ts` — PromptService, buildScope (private), inject, Section.cacheable
- `core/src/services/prompt/types.ts` — InjectionPoint, Section, Snippet types
- `core/src/services/memory/service.ts` — MemoryService, fs.watch, snippet registration, async reads
- `core/src/services/role/service.ts` — RoleService, fs.watch, sync reads, renderSafe, disposers
- `core/src/services/horizon/service.ts` — HorizonService, formatHorizonText, Mustache.render without scope
- `core/resources/templates/partials/horizon-view.mustache` — `{{date.now}}` template variable
- `references/YesImBot-v3/packages/core/src/shared/utils/json-parser.ts` — v3 parser for comparison
- `references/YesImBot-v3/packages/core/tests/utils-json-parser.test.ts` — v3 test suite (bun:test)
- `node_modules/@ai-sdk/provider-utils/dist/index.d.ts` — SystemModelMessage type definition
- `node_modules/ai/dist/index.d.ts` — `system` field union type in Prompt
- `PROMPT.json` — Live output showing `现在是 。` (empty date.now) bug
