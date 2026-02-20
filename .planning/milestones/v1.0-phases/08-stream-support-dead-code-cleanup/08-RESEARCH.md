# Phase 8: Stream Support & Dead Code Cleanup - Research

**Researched:** 2026-02-19
**Domain:** ai-sdk v6 streamText, PQueue concurrency, TimelineStage lifecycle, REQUIREMENTS.md traceability
**Confidence:** HIGH

## Summary

Phase 8 closes four concrete gaps identified in the v1 audit. All four are small, surgical changes to existing code — no new abstractions needed.

The `streamMode` config field already exists in `AgentCoreConfig` and is wired through `index.ts`, but `ThinkActLoop.run()` ignores it and always calls `generateText`. The fix is a branch: when `config.streamMode` is true, call `modelService.streamCall()` and await `result.text` (a `PromiseLike<string>` that auto-consumes the stream). The `onStepFinish` callback and `stopWhen` are both supported by `streamText` in ai-sdk v6, so the loop logic is identical between the two paths.

`ModelService.streamCall()` exists but bypasses the `PQueue` instance entirely — it calls `streamText` directly. The fix wraps the call in `this.queue.add(...)` exactly like `call()` does. The key difference: `streamText` returns a result object immediately (the stream is lazy), so `queue.add` resolves as soon as the stream object is created, not when streaming completes. This is correct behavior — the queue slot is released once the HTTP connection is established, not after the full response.

`markAsActive()` exists in `EventManager` and is fully implemented. It is simply never called. The decision is to call it from `ThinkActLoop.run()` after the response is sent, marking all `New` messages in the current scope as `Active`. Auto-archive (Active → Archived) requires a new `archiveStale()` method on `EventManager` that bulk-updates entries older than a configurable threshold. The `buildView` query does not filter by stage, so archived messages currently appear in context — this is a pre-existing issue that auto-archive will partially address by reducing noise over time (the `historyLimit` already caps the query).

The REQUIREMENTS.md traceability audit requires reading all 14 requirements against the actual source code and updating status accurately.

**Primary recommendation:** Four targeted edits — loop stream branch, queue wrap, lifecycle calls, requirements audit.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- markAsActive is NOT dead code — it is the core of TimelineStage lifecycle management
- Lifecycle: New (unread) → Active (read/background) → Archived (excluded from context) → Deleted (soft delete)
- Activation timing: after agent response completes, mark all New messages in current scope as Active
- Scope: only current scope (current channel), no cross-channel marking
- Auto-archive: also implement Active → Archived transition, check for stale Active messages after response and archive them
- Summarized state (context compression) is deferred to future iteration
- Requirements traceability: audit all 14 requirements for actual implementation status, not just Phase 8 ones
- Keep three-level status: Complete / Partial / Pending
- Add notes column explaining actual implementation state (e.g. "streamMode config exists but unused")

### Claude's Discretion
- Stream response behavior: how streamText output is delivered to user, stream interruption/error handling
- streamCall concurrency control: whether to share queue with normal requests, timeout strategy
- Archive time window threshold

### Deferred Ideas (OUT OF SCOPE)
- Summarized stage (context auto-compression) — future iteration
- Full implementation of message weight gradation — depends on memory system
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AGENT-03 | 心跳循环 — stimulus → context build → LLM → tool exec → respond → continue 流程 | streamText path completes the loop; markAsActive closes the lifecycle after respond |
| HORIZON-02 | Timeline 存储 — Event 按时间序列的数据库存储架构 | markAsActive + archiveStale implement stage transitions on the existing timeline schema |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ai (Vercel AI SDK) | ^6.0.0 (6.0.91 installed) | streamText, onStepFinish, stopWhen | Already used for generateText; streamText has identical call signature |
| p-queue | already installed | Concurrency control for LLM calls | Already used in ModelService.call() |

No new dependencies required.

## Architecture Patterns

### Gap 1: ThinkActLoop stream branch

`config.streamMode` is already in `AgentCoreConfig` and passed through. The loop needs a branch:

```typescript
// Source: plugins/core/src/services/agent/loop.ts
// streamText has identical params to generateText; onStepFinish + stopWhen both supported
if (config.streamMode) {
  const streamResult = await modelService.streamCall(config.provider, config.model, {
    ...defaultParams,
    system: systemPrompt,
    messages,
    tools: allTools as ToolSet,
    toolChoice: "required",
    stopWhen,
    onStepFinish: (step) => { /* same handler */ },
  });
  fallbackText = await streamResult.text; // PromiseLike<string>, auto-consumes stream
} else {
  // existing generateText path
}
```

Key facts (HIGH confidence, verified against ai-sdk v6 source):
- `streamText` accepts `onStepFinish`, `stopWhen`, `toolChoice` — same as `generateText`
- `StreamResult.text` is `PromiseLike<string>` — awaiting it auto-consumes the full stream
- `StreamResult.textStream` is `AsyncIterableStream<string>` — for chunk-by-chunk delivery
- The `LoopAbort` throw inside `onStepFinish` works the same way for both paths

**Stream delivery to user (Claude's Discretion):** For a chat bot context, the simplest correct approach is to await `streamResult.text` (full text, then send). True chunk-by-chunk delivery via `textStream` would require the Koishi session to support message editing/streaming, which is platform-dependent and out of scope for this phase. Use `await streamResult.text` — functionally equivalent to `generateText` result, just uses the streaming HTTP path.

**Error handling:** Wrap in the same try/catch as the non-stream path. `streamCall` already has fallback logic. The `LoopAbort` pattern works identically.

### Gap 2: streamCall PQueue wrap

Current `streamCall` bypasses the queue. Fix:

```typescript
// Source: plugins/core/src/services/model/service.ts
public async streamCall(...): Promise<StreamResult> {
  // ...
  const result = await this.queue.add(async () => {
    const p = this.providers.get(provider);
    // ... same body as before
    return await streamText({ model: m, ...merged });
  });
  if (!result) throw new Error("Queue returned undefined");
  return result;
}
```

**Queue semantics (Claude's Discretion):** Share the same queue as `call()`. The queue slot is held only until `streamText` returns the result object (stream is lazy — HTTP connection established but not fully consumed). This is correct: the concurrency limit controls simultaneous LLM connections, not total streaming time. No separate queue needed.

**Timeout:** No additional timeout beyond what the existing `globalTimeout` in the loop provides. `streamText` itself has no built-in timeout parameter.

### Gap 3: markAsActive + archiveStale in ThinkActLoop

Call after response is sent, before `recordAgentSummary`:

```typescript
// Source: plugins/core/src/services/agent/loop.ts
// After send logic, before recordAgentSummary:
await horizon.events.markAsActive(userPercept.scope, new Date());
await horizon.events.archiveStale(userPercept.scope, archiveThreshold);
```

`markAsActive` already exists in `EventManager`. Need to add `archiveStale`:

```typescript
// Source: plugins/core/src/services/horizon/manager.ts
async archiveStale(scope: Scope, olderThanMs: number): Promise<void> {
  const cutoff = new Date(Date.now() - olderThanMs);
  await this.ctx.database.set(
    TIMELINE_TABLE,
    { scope, stage: TimelineStage.Active, timestamp: { $lte: cutoff } } as unknown as Query.Expr<TimelineEntry>,
    { stage: TimelineStage.Archived },
  );
}
```

**Archive threshold (Claude's Discretion):** Default to 24 hours (86400000 ms). This is a reasonable "stale context" window for a chat bot. Should be configurable via `HorizonServiceConfig`. Add `archiveThresholdMs?: number` with default 86400000.

**Note on buildView:** The current `buildView` query does not filter by stage — it returns all entries including Archived ones. This is a pre-existing issue. Phase 8 does NOT change `buildView` filtering (that would be a separate concern). The archive operation reduces future context noise by ensuring old messages don't accumulate indefinitely, but the `historyLimit: 30` already caps what's shown.

### Gap 4: REQUIREMENTS.md traceability audit

Actual implementation status based on source code review:

| Requirement | Current Status | Actual State |
|-------------|---------------|--------------|
| MODEL-01 | Pending | Partial — ModelService.registerProvider() exists and works; no provider plugin package yet |
| MODEL-02 | Pending | Partial — provider-openai package exists at providers/provider-openai/src/index.ts |
| MODEL-03 | Pending | Partial — provider-deepseek package exists at providers/provider-deepseek/src/index.ts |
| AGENT-01 | Complete | Complete — AgentCore + ThinkActLoop fully implemented |
| AGENT-02 | Complete | Complete — WillingnessCalculator implemented |
| AGENT-03 | Pending | Partial — loop exists but streamMode unused, no lifecycle transitions |
| HORIZON-01 | Complete | Complete — Environment/Entity/Event schema in place |
| HORIZON-02 | Pending | Partial — schema exists, records written, but stage transitions (markAsActive/archive) never called |
| HORIZON-03 | Complete | Complete — toObservations() implemented |
| HORIZON-04 | Complete | Complete — EventListener + percept emission implemented |
| TOOL-01 | Complete | Complete — PluginService + buildAiSdkTools implemented |
| TOOL-02 | Complete | Complete — decorator pattern in base-plugin.ts |
| PROMPT-01 | Complete | Complete — PromptService + DEFAULT_SYSTEM_TEMPLATE implemented |
| PLATFORM-01 | Pending | Partial — Koishi Service pattern used throughout; plugin loads but no formal lifecycle test |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Consuming stream to string | Custom async iterator | `await streamResult.text` | Built-in PromiseLike, handles multi-step correctly |
| Concurrency limiting | Custom semaphore | Existing `this.queue` (PQueue) | Already instantiated, just wrap streamCall |
| Bulk DB stage update | Row-by-row loop | `ctx.database.set(table, query, update)` | Koishi ORM supports bulk update via query predicate |

## Common Pitfalls

### Pitfall 1: streamText queue slot held too long
**What goes wrong:** Wrapping `await streamResult.text` inside `queue.add()` holds the concurrency slot for the entire streaming duration (potentially minutes).
**Why it happens:** Confusing "start streaming" with "finish streaming".
**How to avoid:** Only wrap the `streamText(...)` call itself in `queue.add()`. Return the result object; let the caller consume it outside the queue.
**Warning signs:** Queue stalls with concurrent requests.

### Pitfall 2: LoopAbort not caught in stream path
**What goes wrong:** `onStepFinish` throws `LoopAbort`, but if the stream path doesn't have the same try/catch, it propagates as an unhandled error.
**How to avoid:** Reuse the same `try/catch (e) { if (e instanceof LoopAbort) ... }` block for both paths.

### Pitfall 3: markAsActive called before response sent
**What goes wrong:** If called before `session.send()`, a crash during send leaves messages stuck in Active state with no response sent.
**How to avoid:** Call `markAsActive` after the send logic completes (after the `if (!hasSent && fallbackText)` block).

### Pitfall 4: archiveStale query type mismatch
**What goes wrong:** Koishi ORM query with `$lte` on timestamp may need type casting depending on the database adapter.
**How to avoid:** Use the same `as unknown as Query.Expr<TimelineEntry>` cast pattern already used in `EventManager.query()`.

## Code Examples

### streamText with onStepFinish (verified against ai-sdk v6.0.91 source)
```typescript
// Source: node_modules/ai/src/generate-text/stream-text.ts lines 249, 287, 422
const streamResult = await streamText({
  model,
  system: systemPrompt,
  messages,
  tools: allTools as ToolSet,
  toolChoice: "required",
  stopWhen,
  onStepFinish: (step: StepResult<ToolSet>) => { /* identical to generateText handler */ },
});
const text = await streamResult.text; // auto-consumes, returns full text
```

### PQueue wrap for streamCall (correct — releases slot after stream object created)
```typescript
// Source: plugins/core/src/services/model/service.ts pattern from call()
const result = await this.queue.add(async () => {
  return await streamText({ model: m, ...merged });
});
```

### archiveStale bulk update
```typescript
// Source: Koishi ORM pattern from EventManager.query()
async archiveStale(scope: Scope, olderThanMs: number): Promise<void> {
  const cutoff = new Date(Date.now() - olderThanMs);
  await this.ctx.database.set(
    TIMELINE_TABLE,
    { scope, stage: TimelineStage.Active, timestamp: { $lte: cutoff } } as unknown as Query.Expr<TimelineEntry>,
    { stage: TimelineStage.Archived },
  );
}
```

## Open Questions

1. **buildView stage filtering**
   - What we know: `buildView` queries all stages including Archived
   - What's unclear: Should Phase 8 also add `stage: { $ne: TimelineStage.Archived }` to the query?
   - Recommendation: Out of scope for Phase 8 per the phase boundary. The archive threshold + historyLimit together limit context size. Add as a note in the plan.

2. **archiveThresholdMs config location**
   - What we know: `HorizonServiceConfig` is the right home; `historyLimit` is already there
   - Recommendation: Add `archiveThresholdMs?: number` to `HorizonServiceConfig` and `index.ts` Schema with default 86400000 (24h).

## Sources

### Primary (HIGH confidence)
- `/home/workspace/Athena/node_modules/ai/src/generate-text/stream-text.ts` — verified `onStepFinish`, `stopWhen`, `toolChoice` params; `StreamResult.text` as `PromiseLike<string>`
- `/home/workspace/Athena/node_modules/ai/src/generate-text/stream-text-result.ts` — verified `text: PromiseLike<string>` (line 125), `textStream: AsyncIterableStream<string>` (line 280)
- `/home/workspace/Athena/plugins/core/src/services/model/service.ts` — verified PQueue usage in `call()`, `streamCall()` bypass
- `/home/workspace/Athena/plugins/core/src/services/agent/loop.ts` — verified `generateText` path, `LoopAbort` pattern, `config.streamMode` unused
- `/home/workspace/Athena/plugins/core/src/services/horizon/manager.ts` — verified `markAsActive()` exists and is complete, no `archiveStale()`
- `/home/workspace/Athena/.planning/REQUIREMENTS.md` — current traceability table

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — ai-sdk v6 source read directly, no version ambiguity
- Architecture: HIGH — all four gaps are verified against actual source; patterns are direct extensions of existing code
- Pitfalls: HIGH — derived from reading actual implementation, not speculation

**Research date:** 2026-02-19
**Valid until:** 2026-03-19 (stable libraries, 30-day window)
