# Phase 5: Agent Core & Integration - Research

**Researched:** 2026-02-18
**Domain:** Agent orchestration loop, ai-sdk tool calling, Koishi session integration
**Confidence:** HIGH

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Think-Act Loop Strategy:**

- Use native tool calls (ai-sdk), not JSON structured text protocol
- Only support models with tool call capability
- `toolChoice: "required"` forces a tool call every round
- Explicit finish tool as termination signal — agent calls finish to end loop
- Max loop rounds default 3, configurable
- LLM content field discarded (or optionally logged as inner monologue)
- Silent completion allowed (no forced text reply, tool execution is sufficient as final action)
- Termination logic: each round checks tool calls — if tool-type calls present, results feed back and loop continues; if only action-type calls with no tool-type calls, also treated as termination (finish tool is explicit fallback)

**Response Generation & Output:**

- send_message is the only way to communicate with users, content uses Koishi Element format
- send_message supports target parameter (`platform:id` format), defaults to current channel, supports cross-platform/cross-channel sending
- Supports `<sep/>` to split long messages into multiple natural sends
- send_message sends immediately on call, does not wait for loop end
- LLM call mode configurable: streaming (streamText) or complete (generateText)
- In streaming mode, a single complete tool call is the minimum split atom — generate one, execute one
- Agent response compressed to single AgentSummary Event stored in Timeline (consistent with Phase 3 design)
- Bot sent messages no longer recorded separately, AgentSummary already implies them

**Tool Call Behavior:**

- Multiple tool calls in same round execute sequentially for predictability
- On tool execution failure, error info returned as tool result for LLM to decide
- Dual timeout: per-tool timeout + global loop timeout
- Tool results that are too long get truncated with a hint to LLM

**Message Trigger & Koishi Integration:**

- Percept directly drives AgentCore (Phase 5 does not include willingness filtering)
- Reuse Phase 3's EventListener → Percept → AgentCore complete chain
- Session-level isolation: same session (Entity/Environment) processes serially, different sessions in parallel
- send_message tool internally calls Koishi bot.sendMessage API directly
- Queue backlog handling: when current Percept is being processed, newly arrived Percepts are merged, avoiding consecutive replies to stale topics

### Claude's Discretion

- finish tool specific schema design
- Streaming parser specific implementation approach
- Per-tool timeout and global timeout default values
- AgentSummary compression strategy details
- Percept merge specific merge logic

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>

## Phase Requirements

| ID          | Description                                                                                                                                                            | Research Support                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| AGENT-01    | AgentCore as framework-agnostic orchestrator, accepts Percept input, retrieves Observation from Horizon, drives think-act loop; reserves AgentIdentity extension point | ai-sdk generateText/streamText with tools, HorizonService.buildView() already exists, AgentCore as Koishi Service subclass |
| AGENT-03    | Heartbeat loop — stimulus → context build → LLM → tool exec → respond → continue flow                                                                                  | ai-sdk stopWhen/onStepFinish pattern, PluginService.invoke() already exists, finish tool terminates loop                   |
| PLATFORM-01 | Koishi integration — runs as Koishi 4.x plugin, Service injection system, lifecycle management                                                                         | Service subclass pattern already established, horizon/percept event already emitted by EventListener                       |

</phase_requirements>

---

## Summary

Phase 5 builds AgentCore on top of the already-complete Phase 3 (Horizon/EventListener/Percept) and Phase 4 (PluginService/tools) infrastructure. The core task is wiring these together: listen for `horizon/percept` events, build context via `HorizonService.buildView()`, call the LLM with tools via ai-sdk, execute tool calls via `PluginService.invoke()`, and record the result as an AgentSummary.

The key architectural insight is that ai-sdk v6's `generateText`/`streamText` with `toolChoice: "required"` and `stopWhen` handles the multi-step loop natively — we do NOT need to manually manage message history or loop state. The SDK accumulates `response.messages` across steps and feeds them back automatically. Our job is to define the tools (including a `finish` tool), set `stopWhen`, and handle side effects (send_message, AgentSummary recording) in `onStepFinish`.

The existing `PluginService.getTools()` returns OpenAI-format tool definitions, but ai-sdk v6 requires its own `tool()` helper format. A thin adapter layer is needed to bridge `FunctionDefinition` → ai-sdk `Tool`. The `send_message` builtin already exists in `CorePlugin` but needs enhancement for `<sep/>` splitting and cross-channel `target` support.

**Primary recommendation:** Implement AgentCore as a Koishi Service that listens on `horizon/percept`, uses a per-channel `Map<string, Promise>` for serial session isolation, and delegates the think-act loop to a `ThinkActLoop` class that wraps ai-sdk `generateText`/`streamText`.

---

## Standard Stack

### Core

| Library     | Version            | Purpose                                   | Why Standard                                       |
| ----------- | ------------------ | ----------------------------------------- | -------------------------------------------------- |
| ai (ai-sdk) | 6.0.90 (installed) | LLM calls with native tool calling        | Already in use, generateText/streamText with tools |
| koishi      | ^4.18.3            | Service pattern, bot.sendMessage, session | Project framework                                  |
| p-queue     | ^9.0.0             | Session-level serial queue                | Already in devDeps, used for concurrency           |

### Supporting

| Library                      | Version  | Purpose                             | When to Use                     |
| ---------------------------- | -------- | ----------------------------------- | ------------------------------- |
| koishi `h` (element builder) | built-in | Parse/build Koishi message elements | send_message `<sep/>` splitting |

### Alternatives Considered

| Instead of                            | Could Use                          | Tradeoff                                                                                                     |
| ------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Manual loop with message accumulation | ai-sdk `stopWhen` + `onStepFinish` | Manual loop is more flexible but requires managing message history manually; ai-sdk handles it automatically |
| `generateText` only                   | `streamText` with `onChunk`        | generateText simpler; streamText needed for streaming mode per decision                                      |

**Installation:** No new packages needed. `p-queue` is already in devDependencies and needs to move to dependencies.

---

## Architecture Patterns

### Recommended Project Structure

```
plugins/core/src/services/agent/
├── index.ts          # exports
├── service.ts        # AgentCore extends Service — listens horizon/percept, manages queues
├── loop.ts           # ThinkActLoop — wraps generateText/streamText, tool adapter
├── tools.ts          # finish tool definition + tool adapter (FunctionDefinition → ai-sdk Tool)
└── config.ts         # AgentCoreConfig interface
```

### Pattern 1: Session-Level Serial Queue

**What:** Each channel key (`platform:channelId`) maps to a running Promise. New Percepts for the same channel wait for the current one to finish (or replace it per the merge decision).

**When to use:** Always — prevents concurrent agent responses to the same channel.

```typescript
// Source: project decision + p-queue pattern
private queues = new Map<string, Promise<void>>();

private enqueue(channelKey: string, percept: Percept): void {
  const prev = this.queues.get(channelKey) ?? Promise.resolve();
  const next = prev.then(() => this.runLoop(percept)).catch(() => {});
  this.queues.set(channelKey, next);
}
```

Note: This is a simple promise-chain queue, not p-queue. p-queue is used in ModelService for LLM concurrency. For session isolation, a promise chain per channel is sufficient and simpler.

### Pattern 2: ai-sdk Tool Adapter

**What:** `PluginService.getTools()` returns OpenAI-format `{type, function: {name, description, parameters}}`. ai-sdk v6 requires `Record<string, Tool>` where each Tool has `{ description, parameters (zod/jsonSchema), execute }`.

**When to use:** When building the tools object to pass to `generateText`/`streamText`.

```typescript
// Source: ai-sdk v6 index.d.ts — tool() helper from @ai-sdk/provider-utils
import { jsonSchema, tool } from "ai";

function buildAiSdkTools(
  pluginService: PluginService,
  fnCtx: FunctionContext,
  toolTimeout: number,
): Record<string, Tool> {
  const result: Record<string, Tool> = {};
  for (const plugin of /* all plugins */) {
    for (const [name, def] of plugin.getFunctions()) {
      result[name] = tool({
        description: def.description,
        parameters: jsonSchema(schemaToJSONSchema(def.parameters)),
        execute: async (params) => {
          const r = await pluginService.invoke(name, params as Record<string, unknown>, fnCtx);
          return r.status === "success" ? r.content : { error: r.error };
        },
      });
    }
  }
  return result;
}
```

### Pattern 3: finish Tool Schema

**What:** Explicit termination signal. Agent calls `finish` to end the loop. The `stopWhen` condition checks if `finish` was called.

**When to use:** Always included in the tool set. `stopWhen: hasToolCall("finish")` from ai-sdk.

```typescript
// Source: ai-sdk v6 — hasToolCall() is exported from "ai"
import { hasToolCall, tool, jsonSchema } from "ai";

const finishTool = tool({
  description: "Signal that you have completed your response. Call this when done.",
  parameters: jsonSchema({
    type: "object",
    properties: {
      summary: { type: "string", description: "Brief summary of what was done" },
    },
    required: [],
  }),
  execute: async ({ summary }) => ({ done: true, summary }),
});

// In generateText/streamText:
stopWhen: hasToolCall("finish"),
```

### Pattern 4: Think-Act Loop with generateText

**What:** Single `generateText` call with `toolChoice: "required"`, `stopWhen: hasToolCall("finish")`, and `onStepFinish` for side effects.

**When to use:** Non-streaming mode (default).

```typescript
// Source: ai-sdk v6 index.d.ts
const result = await generateText({
  model,
  system: systemPrompt,
  messages: historyMessages, // ModelMessage[] from HorizonView
  tools: { ...agentTools, finish: finishTool },
  toolChoice: "required",
  stopWhen: hasToolCall("finish"),
  onStepFinish: async (step) => {
    // side effects: log inner thoughts, check for send_message calls
  },
});
```

### Pattern 5: Streaming Mode with onChunk

**What:** `streamText` with `onChunk` callback. Each complete `tool-call` chunk triggers immediate execution.

**When to use:** When `streamMode: true` in config.

```typescript
// Source: ai-sdk v6 — TextStreamPart types
const result = streamText({
  model,
  system: systemPrompt,
  messages: historyMessages,
  tools: { ...agentTools, finish: finishTool },
  toolChoice: "required",
  stopWhen: hasToolCall("finish"),
  onChunk: async ({ chunk }) => {
    if (chunk.type === "tool-call") {
      // execute immediately
      await pluginService.invoke(chunk.toolName, chunk.input, fnCtx);
    }
  },
});
await result.text; // consume stream
```

### Pattern 6: Context Build → Messages Array

**What:** Convert `HorizonView` to `ModelMessage[]` for ai-sdk. System prompt from PromptService, history as user/assistant turns.

**When to use:** Before every LLM call.

```typescript
// Source: HorizonService.formatHorizonText() already exists
function buildMessages(view: HorizonView, systemPrompt: string): ModelMessage[] {
  const horizonText = horizonService.formatHorizonText(view);
  return [
    // system is passed separately to generateText, not in messages array
    { role: "user", content: horizonText },
  ];
}
```

Note: ai-sdk takes `system` as a separate parameter, not as a message in the `messages` array. The `messages` array is for multi-turn history. For Phase 5 (no memory system), the HorizonView text is the user message.

### Pattern 7: AgentSummary Recording

**What:** After loop completes, record a single AgentSummary event in Timeline via `EventManager.recordAgentSummary()`.

**When to use:** After every successful loop completion.

```typescript
// Source: EventManager.recordAgentSummary() already exists in Phase 3
await horizonService.events.recordAgentSummary({
  scope: percept.scope,
  timestamp: new Date(),
  summary: buildSummary(steps), // compress tool calls + results
});
```

### Pattern 8: send_message Enhancement

**What:** The existing `CorePlugin.sendMessage` uses `ctx.session?.send()`. Needs enhancement for: (1) `<sep/>` splitting into multiple sends, (2) `target` parameter for cross-channel sends.

**When to use:** send_message tool execution.

```typescript
// Source: Koishi docs — bot.sendMessage(channelId, content, guildId)
// For <sep/> splitting:
const parts = content.split("<sep/>");
for (const part of parts) {
  if (part.trim()) await session.send(part.trim());
}

// For target parameter:
// target format: "platform:channelId"
const [platform, channelId] = target.split(":");
const bot = ctx.bots.find((b) => b.platform === platform);
await bot?.sendMessage(channelId, content);
```

### Anti-Patterns to Avoid

- **Manual message history management:** ai-sdk `generateText` with `stopWhen` handles multi-step automatically via `response.messages`. Do not manually accumulate messages between steps.
- **Calling `PluginService.invoke()` outside tool execute:** Tool execution should happen inside the ai-sdk `execute` callback (non-streaming) or `onChunk` (streaming), not in `onStepFinish`.
- **Using `maxSteps` instead of `stopWhen`:** `maxSteps` is deprecated in ai-sdk v6; use `stopWhen: stepCountIs(N)` or `stopWhen: hasToolCall("finish")`.
- **Blocking the Koishi middleware:** AgentCore listens on `horizon/percept` event (not middleware), so it does not block message processing.

---

## Don't Hand-Roll

| Problem                                   | Don't Build                                  | Use Instead                                 | Why                                                        |
| ----------------------------------------- | -------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------- |
| Multi-step tool loop with message history | Custom loop with manual message accumulation | ai-sdk `generateText` + `stopWhen`          | SDK handles assistant/tool message threading automatically |
| Tool call termination detection           | Custom finish-reason parsing                 | `hasToolCall("finish")` from ai-sdk         | Type-safe, handles edge cases                              |
| Step count limiting                       | Manual counter                               | `stepCountIs(N)` from ai-sdk                | Composable with `hasToolCall` via array                    |
| Streaming tool call detection             | Custom stream parser                         | `onChunk` with `chunk.type === "tool-call"` | ai-sdk emits complete tool-call chunks atomically          |

**Key insight:** ai-sdk v6 manages the entire multi-step loop internally when `stopWhen` is provided. The `onStepFinish` callback is the correct hook for side effects per step.

---

## Common Pitfalls

### Pitfall 1: toolChoice "required" Infinite Loop

**What goes wrong:** With `toolChoice: "required"` and no `stopWhen`, the SDK loops forever because the model always calls a tool.
**Why it happens:** `stopWhen` defaults to `stepCountIs(1)` — but with `toolChoice: "required"`, the model never produces a text-only response to stop on.
**How to avoid:** Always pair `toolChoice: "required"` with `stopWhen: hasToolCall("finish")` AND `stopWhen: stepCountIs(maxRounds)` as a safety net.
**Warning signs:** Loop runs indefinitely, token usage spikes.

```typescript
stopWhen: [hasToolCall("finish"), stepCountIs(config.maxRounds ?? 3)],
```

### Pitfall 2: ai-sdk Tool Format vs PluginService Format

**What goes wrong:** `PluginService.getTools()` returns OpenAI-format objects. Passing these directly to ai-sdk `tools` parameter causes type errors and runtime failures.
**Why it happens:** ai-sdk v6 requires `Record<string, Tool>` where Tool has an `execute` function. OpenAI format has no `execute`.
**How to avoid:** Build the adapter in `tools.ts` that converts `FunctionDefinition` → ai-sdk `tool()`.
**Warning signs:** TypeScript errors on `tools` parameter, "tool not found" at runtime.

### Pitfall 3: send_message Called Before Loop Ends (Streaming)

**What goes wrong:** In streaming mode, `onChunk` fires for each tool-call. If send_message is executed there, it sends immediately. But in non-streaming mode with `execute` in the tool definition, it also sends immediately. This is correct per the decision — but the AgentSummary must be recorded AFTER all sends complete.
**Why it happens:** Confusion about when side effects happen.
**How to avoid:** Record AgentSummary in `onFinish` callback, not `onStepFinish`.

### Pitfall 4: Session Object Lifetime in Tool Execute

**What goes wrong:** The Koishi `Session` object passed in `FunctionContext` may be stale or disposed by the time a tool executes in a later step.
**Why it happens:** Koishi sessions have a lifecycle tied to the middleware chain.
**How to avoid:** For `send_message`, use `bot.sendMessage()` directly (via `ctx.bots`) rather than `session.send()` when a `target` is specified. For the default channel, `session.send()` is fine since it's the same session.

### Pitfall 5: Percept Queue Backlog — Wrong Merge Strategy

**What goes wrong:** When a new Percept arrives while the current one is processing, naively queuing it causes the agent to reply to stale context.
**Why it happens:** The decision says "merge" — but the merge logic is at Claude's discretion.
**How to avoid:** Keep only the latest Percept per channel key. When a new Percept arrives for a channel that's already processing, replace the queued (not running) Percept. The running Percept completes; the replaced Percept is what runs next.

### Pitfall 6: p-queue vs Promise Chain for Session Isolation

**What goes wrong:** Using p-queue with `concurrency: 1` per channel creates many queue instances. Using a single p-queue for all channels serializes everything.
**Why it happens:** Misapplying the existing ModelService p-queue pattern.
**How to avoid:** Use a simple `Map<string, Promise<void>>` promise chain per channel key. This gives per-channel serialization with parallel cross-channel execution without extra dependencies.

---

## Code Examples

### Verified: generateText with tools and stopWhen

```typescript
// Source: ai-sdk v6 index.d.ts — generateText signature
import { generateText, hasToolCall, stepCountIs, tool, jsonSchema } from "ai";

const result = await generateText({
  model,
  system: systemPrompt,
  messages,
  tools: {
    finish: tool({
      description: "Signal completion",
      parameters: jsonSchema({ type: "object", properties: {}, required: [] }),
      execute: async () => ({ done: true }),
    }),
    // ... other tools
  },
  toolChoice: "required",
  stopWhen: [hasToolCall("finish"), stepCountIs(3)],
  onStepFinish: async (step) => {
    // step.toolCalls, step.toolResults available
  },
});
// result.steps contains all steps
// result.toolCalls contains last step's tool calls
```

### Verified: streamText with onChunk for streaming mode

```typescript
// Source: ai-sdk v6 index.d.ts — TextStreamPart types
import { streamText } from "ai";

const stream = streamText({
  model,
  system: systemPrompt,
  messages,
  tools,
  toolChoice: "required",
  stopWhen: [hasToolCall("finish"), stepCountIs(3)],
  onChunk: async ({ chunk }) => {
    if (chunk.type === "tool-call") {
      // chunk.toolName, chunk.input available
      // execute immediately
    }
  },
  onFinish: async (event) => {
    // event.steps, event.totalUsage
  },
});
await stream.text; // must consume
```

### Verified: HorizonService.buildView() already exists

```typescript
// Source: plugins/core/src/services/horizon/service.ts line 78
const view = await horizonService.buildView(percept as UserMessagePercept);
// view.history, view.environment, view.entities, view.self, view.percept
const contextText = horizonService.formatHorizonText(view);
```

### Verified: EventManager.recordAgentSummary() already exists

```typescript
// Source: plugins/core/src/services/horizon/manager.ts line 58
await horizonService.events.recordAgentSummary({
  scope: percept.scope,
  timestamp: new Date(),
  summary: "...",
});
```

### Verified: horizon/percept event already emitted

```typescript
// Source: plugins/core/src/services/horizon/listener.ts line 206
// EventListener already emits: this.ctx.emit("horizon/percept", percept)
// AgentCore just needs to listen:
ctx.on("horizon/percept", (percept) => { ... });
```

### Verified: PluginService.invoke() signature

```typescript
// Source: plugins/core/src/services/plugin/service.ts line 47
await pluginService.invoke(
  name, // string
  params, // Record<string, unknown>
  context, // FunctionContext { session?, view?, percept? }
);
// returns ToolResult { status, content?, error? }
```

---

## State of the Art

| Old Approach                               | Current Approach                                  | When Changed       | Impact                                               |
| ------------------------------------------ | ------------------------------------------------- | ------------------ | ---------------------------------------------------- |
| JSON structured text + custom StreamParser | Native tool calls via ai-sdk                      | v4 design decision | Eliminates custom parser, uses SDK-native multi-step |
| `maxSteps` parameter                       | `stopWhen` with `stepCountIs()` / `hasToolCall()` | ai-sdk v6          | `maxSteps` deprecated; `stopWhen` is composable      |
| Manual message history accumulation        | ai-sdk handles via `response.messages`            | ai-sdk v5+         | SDK threads tool call/result messages automatically  |
| xsai                                       | ai-sdk                                            | Phase 2 decision   | Better ecosystem, native tool calling                |

**Deprecated/outdated:**

- `maxSteps`: Use `stopWhen: stepCountIs(N)` instead (ai-sdk v6)
- JSON structured text protocol: Replaced by native tool calls

---

## Open Questions

1. **AgentSummary compression strategy**
   - What we know: `recordAgentSummary(summary: string)` takes a plain string
   - What's unclear: How to compress multiple tool calls + results into a useful summary string
   - Recommendation: Simple approach — concatenate tool names called + final send_message content. E.g., `"Called: get_session_info, send_message. Sent: [message content]"`. Can be improved later.

2. **Percept merge logic specifics**
   - What we know: New Percept replaces queued (not running) Percept for same channel
   - What's unclear: Should the merged Percept use the new message content only, or combine both?
   - Recommendation: Use the latest Percept entirely. The history is already in Timeline via EventManager, so the LLM will see both messages in context anyway.

3. **Global loop timeout default value**
   - What we know: Dual timeout — per-tool (already in PluginService, default 30s) + global loop
   - What's unclear: What's a reasonable global timeout?
   - Recommendation: 120s global loop timeout (3 rounds × ~30s per tool + LLM latency). Configurable.

4. **send_message target parameter and bot lookup**
   - What we know: `ctx.bots` is the Koishi bot registry
   - What's unclear: Exact API for `ctx.bots` lookup by platform
   - Recommendation: `ctx.bots.find(b => b.platform === platform && b.selfId === selfId)` or just first matching platform bot. Needs verification against Koishi 4.x API at implementation time.

---

## Sources

### Primary (HIGH confidence)

- `D:\Codespace\koishi-dev\YesWeAreBot\YesImBot\node_modules\ai\dist\index.d.ts` — ai-sdk v6.0.90 type definitions: generateText, streamText, tool(), hasToolCall(), stepCountIs(), ToolChoice, StepResult, TextStreamPart
- `plugins/core/src/services/horizon/service.ts` — HorizonService.buildView(), formatHorizonText()
- `plugins/core/src/services/horizon/manager.ts` — EventManager.recordAgentSummary()
- `plugins/core/src/services/horizon/listener.ts` — horizon/percept event emission
- `plugins/core/src/services/plugin/service.ts` — PluginService.invoke(), getTools()
- `plugins/core/src/services/plugin/builtin/send-message.ts` — existing send_message action
- `plugins/core/src/services/model/service.ts` — ModelService.call(), streamCall(), getModel()

### Secondary (MEDIUM confidence)

- WebSearch: ai-sdk toolChoice "required" behavior, stopWhen parameter — confirmed against type definitions
- v3 heartbeat-processor.ts — reference for think-act loop structure (different protocol, same concept)

### Tertiary (LOW confidence)

- Koishi `ctx.bots` API for cross-channel send — needs verification at implementation time

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — ai-sdk v6.0.90 installed, types verified directly
- Architecture: HIGH — based on existing codebase + verified ai-sdk types
- Pitfalls: HIGH — derived from type analysis and existing code patterns
- Koishi bot API for cross-channel: LOW — needs runtime verification

**Research date:** 2026-02-18
**Valid until:** 2026-03-18 (ai-sdk stable, 30 days)
