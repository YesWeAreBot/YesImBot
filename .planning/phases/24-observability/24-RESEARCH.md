# Phase 24: Observability - Research

**Researched:** 2026-02-25
**Domain:** Structured logging, traceId propagation, Judge prompt upgrade
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### TraceId Design
- nanoid short ID format, prefix `msg-` (e.g. `msg-a3f8b2c1`), short and readable
- Generated at entry layer (when listener receives message), wrapped in context object and passed layer by layer
- Explicit context object propagation (contains traceId + other metadata), NOT attached to session
- Log prefix auto-injects traceId, format: `[msg-xxxxxxxx] namespace key=value`

#### Log Namespace and Granularity
- `agent.*` hierarchical structure, dot-separated
  - `agent` — top-level general logs
  - `agent.willingness` — willingness judgment
  - `agent.loop` — agent loop (tool calls etc.)
  - `agent.model` — model calls (latency, tokens)
  - `agent.parser` — JSON parse results
  - `agent.tool` — tool execution results
- key=value structured format for debug logs
- Each namespace defines its own fields, no forced unified schema
- Fully relies on Koishi native Logger, no extra wrapping

#### Judge Prompt Improvement
- JSON structured output replaces bare yes/no, fields: `decision`(bool), `confidence`(number), `reasoning`(string), `factors`(object)
- Inject concise persona summary into prompt (role name, personality keywords, expertise topics, speaking style — a few sentences)
- Enumerate specific judgment factors: mention (direct mention), topic_relevance, silence_awkwardness, etc.
- confidence is for logging only, does NOT participate in actual reply decision logic

#### Debug Experience
- Plugin config `debugLevel` single master switch controls all `agent.*` logs
- Numeric levels 0-3: 0=off, 1=basic(traceId+decision result), 2=detailed(+breakdown+latency+tokens), 3=full(+prompt sizes+raw output)
- After each message processing, output one summary line: traceId + decision result + latency + token usage + tool call count

### Claude's Discretion
- Specific field design of the traceId context object
- Which specific key=value fields each namespace outputs
- Exact output content boundaries for each debugLevel
- Specific wording and length of persona summary in Judge prompt

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| OBS-01 | Each message processing flow carries a traceId, threading through listener → willingness → agent → loop → model → parser → reply | TraceContext object design; nanoid for ID generation; explicit parameter threading through AgentCore.handleEvent → buildPercept → enqueue → runLoop → ThinkActLoop.run |
| OBS-02 | Use Koishi Logger namespaces (`agent`, `agent.willingness`, `agent.loop`, `agent.parser` etc.), support `KOISHI_DEBUG` env var granular filtering | Koishi uses reggol logger; `KOISHI_DEBUG=agent.willingness` sets that namespace to DEBUG level; dot-separated names map to nested LevelConfig; each sub-logger created via `ctx.logger("agent.willingness")` |
| OBS-03 | Key nodes output debug-level structured logs: willingness decision details, prompt section sizes, model call latency/token usage, JSON parse result, tool execution results | All data already exists in code; needs debug-level emission with key=value format and traceId prefix; debugLevel config gates emission |
| WILL-03 | Judge Prompt includes persona summary context, provides explicit judgment criteria (indirect mention, topic relevance, silence awkwardness), uses structured output format instead of bare yes/no | JUDGMENT_PROMPT constant in service.ts needs replacement; RoleService loads SOUL.md which has persona; structured output needs JSON schema in prompt; response parsing needs update from `answer.startsWith("yes")` to JSON parse |
</phase_requirements>

## Summary

Phase 24 is a pure instrumentation and prompt-quality phase — no new services, no new dependencies beyond nanoid (already in yarn.lock). The work divides cleanly into two tracks: (1) threading a `TraceContext` object through the existing message pipeline and emitting structured debug logs at each stage, and (2) upgrading the deferred judgment prompt from bare yes/no to structured JSON output with persona context.

The Koishi logger system (reggol under the hood) already supports hierarchical namespace filtering via `KOISHI_DEBUG=agent.willingness`. The `getLevel()` method splits the logger name on dots and walks a nested `LevelConfig` object, so `ctx.logger("agent.willingness")` is automatically filtered independently from `ctx.logger("agent.loop")`. No custom log infrastructure is needed — just create the right named loggers and emit at the right level.

The `TraceContext` object needs to be threaded explicitly (confirmed decision: not AsyncLocalStorage) through `handleEvent` → `buildPercept` → `enqueue` → `runLoop` → `ThinkActLoop.run`. The `Percept` type already has an `id` field (`Random.id()`) which can serve as the traceId carrier, or a separate `TraceContext` wrapper can be added alongside `LoopPayload`. The cleanest approach is to generate the `msg-` prefixed traceId at `handleEvent` entry and store it in `Percept.metadata` or a new `traceId` field on `Percept`.

**Primary recommendation:** Add `traceId` field to `Percept`, generate via `nanoid(8)` with `msg-` prefix at `handleEvent` entry, create sub-loggers per namespace, emit debug logs gated by `debugLevel` config, and replace `JUDGMENT_PROMPT` with a structured JSON prompt that reads persona from RoleService.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| reggol (via Koishi) | bundled | Hierarchical namespace logger | Already the Koishi logger system; `ctx.logger("name")` returns a Logger instance |
| nanoid | ^3.3.11 | Short unique ID generation | Already in yarn.lock (transitive dep); `msg-` prefix IDs |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | — | — | All needed libraries already present |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| nanoid | `Random.id()` (Koishi built-in) | `Random.id()` already used for `percept.id`; nanoid gives shorter, more readable IDs with custom prefix; either works |
| Explicit traceId field on Percept | AsyncLocalStorage | AsyncLocalStorage rejected (Koishi event system doesn't guarantee async context propagation — confirmed in STATE.md) |
| debugLevel config switch | KOISHI_DEBUG only | debugLevel gives runtime control without env var restart; KOISHI_DEBUG still works for namespace-level filtering |

**Installation:** No new packages needed. nanoid is already in yarn.lock. If explicit import is needed:
```bash
yarn workspace koishi-plugin-yesimbot add nanoid
```

## Architecture Patterns

### Recommended Project Structure

No new files needed. Changes are in-place modifications to:
```
core/src/services/agent/
├── service.ts        # Add traceId generation, TraceContext threading, debugLevel config
├── loop.ts           # Accept traceId, emit per-namespace debug logs
├── willingness.ts    # WillingnessResult already has debug field — emit it
└── (no new files)
```

### Pattern 1: TraceContext Object

**What:** A lightweight object carrying traceId and timing metadata, threaded explicitly through the call chain.

**When to use:** At every layer boundary where a new function call is made.

**Example:**
```typescript
// In shared/types.ts or agent/service.ts
export interface TraceContext {
  traceId: string       // "msg-a3f8b2c1"
  startedAt: number     // Date.now() at handleEvent entry
}

// In Percept (shared/types.ts) — add one field
export interface Percept {
  id: string
  traceId: string       // NEW: "msg-a3f8b2c1"
  type: TriggerType
  scope: Scope
  timestamp: Date
  metadata?: Record<string, unknown>
}
```

### Pattern 2: Koishi Namespace Logger Creation

**What:** Create one logger per namespace at construction time, reuse across calls.

**When to use:** In constructors of AgentCore and ThinkActLoop.

**Example:**
```typescript
// Source: reggol src/shared.ts — Logger constructor + getLevel()
// In AgentCore constructor:
constructor(ctx: Context, config: AgentCoreConfig) {
  super(ctx, "yesimbot.agent", false)
  this.config = config
  // One logger per namespace, created once
  this.logAgent = ctx.logger("agent")
  this.logWillingness = ctx.logger("agent.willingness")
  this.logLoop = ctx.logger("agent.loop")
  this.logModel = ctx.logger("agent.model")
  this.logParser = ctx.logger("agent.parser")
  this.logTool = ctx.logger("agent.tool")
}

// KOISHI_DEBUG=agent.willingness sets Logger.levels["agent"]["willingness"] = 3 (DEBUG)
// KOISHI_DEBUG=agent.loop sets Logger.levels["agent"]["loop"] = 3
// Each namespace filters independently
```

### Pattern 3: debugLevel-Gated Structured Logging

**What:** A helper that checks `debugLevel` before emitting, formats key=value with traceId prefix.

**When to use:** At every instrumented point.

**Example:**
```typescript
// Inline helper — no separate file needed
private debugLog(
  logger: Logger,
  traceId: string,
  minLevel: number,
  fields: Record<string, unknown>
): void {
  if ((this.config.debugLevel ?? 0) < minLevel) return
  const kv = Object.entries(fields)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' ')
  logger.debug(`[${traceId}] ${kv}`)
}

// Usage:
this.debugLog(this.logWillingness, traceId, 2, {
  score: result.probability.toFixed(3),
  breakdown: result.debug,
  decision: result.shouldReply ? 'REPLY' : 'SKIP'
})
```

### Pattern 4: Summary Line After Each Message

**What:** One `.info()` line after the full pipeline completes, always emitted (not gated by debugLevel).

**When to use:** At the end of `runLoop()` in AgentCore.

**Example:**
```typescript
// At end of runLoop, after loop.run() completes:
const latencyMs = Date.now() - traceCtx.startedAt
this.logAgent.info(
  `[${traceCtx.traceId}] decision=RESPOND latency=${(latencyMs/1000).toFixed(2)}s tokens=${totalTokens} tools=${toolCallCount}`
)
```

### Pattern 5: Structured Judge Prompt

**What:** Replace bare yes/no JUDGMENT_PROMPT with JSON schema prompt + persona summary injection.

**When to use:** In `executeDeferredJudgment()`.

**Example:**
```typescript
// New JUDGMENT_PROMPT constant
const JUDGMENT_PROMPT = `You are a conversation participation judge for a chat bot.

## Bot Persona
{{PERSONA_SUMMARY}}

## Task
Decide whether the bot should reply to the current conversation.

## Judgment Factors
Consider these factors:
- mention: Was the bot directly mentioned or addressed?
- topic_relevance: Is the topic relevant to the bot's interests/expertise?
- silence_awkwardness: Would staying silent feel socially awkward?
- conversation_flow: Does the conversation naturally invite a response?

## Output Format
Respond with ONLY a JSON object:
{
  "decision": true,
  "confidence": 0.85,
  "reasoning": "Brief explanation of the decision",
  "factors": {
    "mention": 0.0,
    "topic_relevance": 0.4,
    "silence_awkwardness": 0.15,
    "conversation_flow": 0.3
  }
}

decision: true = reply, false = stay silent
confidence: 0.0-1.0 (for logging only, does not affect decision)
`

// Persona summary extraction from SOUL.md (first ~200 chars or first paragraph)
// Injected at call time from RoleService or read directly
```

### Anti-Patterns to Avoid

- **Creating a new logger on every call:** `ctx.logger("agent.willingness").debug(...)` creates a new Logger object each time. Create once in constructor, reuse.
- **Using AsyncLocalStorage for traceId:** Rejected — Koishi event system doesn't guarantee async context propagation. Thread explicitly.
- **Emitting debug logs unconditionally:** Always gate with `debugLevel` check to avoid performance impact in production.
- **Parsing Judge response with `startsWith("yes")`:** Must be replaced with JSON.parse + fallback for the structured output format.
- **Attaching traceId to session:** Session is a Koishi runtime object; attaching custom fields risks conflicts. Use Percept or explicit parameter.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Namespace log filtering | Custom filter middleware | Koishi Logger + KOISHI_DEBUG | reggol already does hierarchical namespace filtering via `getLevel()` |
| Unique ID generation | Custom random string | nanoid (already in yarn.lock) | Collision-resistant, URL-safe, configurable length |
| JSON structured output parsing | Custom regex | `JSON.parse()` with try/catch fallback | Judge output is controlled; simple parse + fallback is sufficient |
| Log level configuration | Custom config system | Koishi `logger.levels` config | Already supported via koishi.yml `logger.levels` config |

**Key insight:** The entire logging infrastructure already exists. This phase is about wiring up the right logger names and emitting the right data — not building new infrastructure.

## Common Pitfalls

### Pitfall 1: Logger Namespace Separator
**What goes wrong:** Using `/` or `_` as namespace separator instead of `.`
**Why it happens:** Confusion with Koishi service names (which use `.`) vs logger names
**How to avoid:** Logger names use `.` as separator: `agent.willingness`, not `agent/willingness` or `agent_willingness`. The reggol `getLevel()` splits on `.` to walk the LevelConfig tree.
**Warning signs:** `KOISHI_DEBUG=agent.willingness` has no effect

### Pitfall 2: KOISHI_DEBUG Namespace Exact Match
**What goes wrong:** `KOISHI_DEBUG=agent` does NOT enable debug for `agent.willingness`
**Why it happens:** reggol `getLevel()` walks the config tree: `Logger.levels["agent"]` is checked, then `Logger.levels["agent"]["willingness"]`. Setting `agent` to DEBUG only affects the `agent` logger, not sub-loggers.
**How to avoid:** To enable all agent sub-loggers: `KOISHI_DEBUG=agent,agent.willingness,agent.loop,agent.model,agent.parser,agent.tool`
**Warning signs:** Only top-level `agent` logs appear when debugging sub-namespaces

### Pitfall 3: Judge Response Parse Failure
**What goes wrong:** Structured JSON response from Judge fails to parse, causing silent SKIP
**Why it happens:** LLM may wrap JSON in markdown code blocks, add preamble text, or return malformed JSON
**How to avoid:** Use the existing `JsonParser` class (already handles code blocks, jsonrepair fallback). If parse fails, fall back to checking if response contains `"decision": true` or legacy `yes` string.
**Warning signs:** All deferred judgments result in SKIP even when LLM clearly intends YES

### Pitfall 4: TraceId Not Reaching ThinkActLoop
**What goes wrong:** traceId generated in AgentCore but not passed to ThinkActLoop.run()
**Why it happens:** `ThinkActLoop.run(percept, toolCtx)` signature doesn't include traceId
**How to avoid:** Add `traceId` to `Percept` (cleanest) OR add it to `LoopPayload` OR pass as third parameter to `run()`. Adding to `Percept` is cleanest since Percept already flows through the whole pipeline.
**Warning signs:** Loop logs don't show traceId prefix

### Pitfall 5: debugLevel vs KOISHI_DEBUG Interaction
**What goes wrong:** debugLevel=0 suppresses logs even when KOISHI_DEBUG is set
**Why it happens:** If debugLevel check comes before logger.debug(), KOISHI_DEBUG has no effect
**How to avoid:** debugLevel gates the structured debug logs (the new ones). Existing `.info()` logs are unaffected. KOISHI_DEBUG controls whether `.debug()` calls actually emit. Both can coexist: debugLevel=2 enables structured debug emission, KOISHI_DEBUG=agent.willingness controls which namespace's debug calls reach output.
**Warning signs:** Setting KOISHI_DEBUG has no visible effect

### Pitfall 6: Persona Summary Source
**What goes wrong:** Persona summary is hardcoded or stale
**Why it happens:** SOUL.md is user-editable and loaded at runtime by RoleService
**How to avoid:** Read persona summary from RoleService at judgment time, not at startup. RoleService stores rendered content in `lastValid` map. Alternatively, read SOUL.md directly and extract first paragraph (first ~200 chars before a blank line).
**Warning signs:** Persona summary doesn't reflect user's custom SOUL.md

## Code Examples

### TraceId Generation at Entry Point
```typescript
// Source: nanoid docs + existing AgentCore.handleEvent pattern
import { customAlphabet } from 'nanoid'
// OR use the simpler:
import { nanoid } from 'nanoid'

// In handleEvent:
private handleEvent(event: HorizonMessageEvent): void {
  const traceId = `msg-${nanoid(8)}`  // e.g. "msg-a3f8b2c1"
  // ... rest of handleEvent, pass traceId to buildPercept
}
```

### Percept Extension
```typescript
// In core/src/services/shared/types.ts
export interface Percept {
  id: string
  traceId: string        // NEW: "msg-a3f8b2c1"
  type: TriggerType
  scope: Scope
  timestamp: Date
  metadata?: Record<string, unknown>
}
```

### Willingness Debug Log (debugLevel=2)
```typescript
// In AgentCore.handleEvent, after willingness.processMessage():
const d = result.debug
// Always emit info summary (existing behavior, upgrade format):
this.logAgent.info(
  `[${traceId}] willingness channel=${channelKey} P=${result.probability.toFixed(3)} decision=${result.shouldReply ? 'REPLY' : 'SKIP'}`
)
// Emit detailed breakdown at debug level (gated by debugLevel >= 2):
if ((this.config.debugLevel ?? 0) >= 2) {
  this.logWillingness.debug(
    `[${traceId}] score_prev=${d.prevWillingness.toFixed(1)} score_new=${d.newWillingness.toFixed(1)} gain=${d.gain.toFixed(1)} fatigue=${d.fatigue.toFixed(2)} keyword=${d.keywordHit} trigger=${d.triggerType}`
  )
}
```

### Model Call Latency Log (debugLevel=2)
```typescript
// In ThinkActLoop.run(), wrapping modelService.call():
const callStart = Date.now()
const result = await modelService.call(...)
const latencyMs = Date.now() - callStart

if ((this.config.debugLevel ?? 0) >= 2) {
  this.logModel.debug(
    `[${percept.traceId}] round=${round} latency=${latencyMs}ms tokens_in=${result?.usage?.promptTokens ?? 0} tokens_out=${result?.usage?.completionTokens ?? 0} tokens_total=${result?.usage?.totalTokens ?? 0}`
  )
}
```

### Parser Debug Log (debugLevel=2)
```typescript
// After parser.parse(rawText):
if ((this.config.debugLevel ?? 0) >= 2) {
  this.logParser.debug(
    `[${percept.traceId}] round=${round} success=${parsed.data !== null} error=${parsed.error ?? 'none'} logs=${parsed.logs.length}`
  )
}
```

### Tool Execution Debug Log (debugLevel=2)
```typescript
// After executeActions():
if ((this.config.debugLevel ?? 0) >= 2) {
  for (const r of toolResults) {
    this.logTool.debug(
      `[${percept.traceId}] tool=${r.name} status=${r.status}${r.error ? ` error=${r.error}` : ''}`
    )
  }
}
```

### Prompt Section Size Log (debugLevel=3)
```typescript
// After prompt.renderToString():
if ((this.config.debugLevel ?? 0) >= 3) {
  this.logLoop.debug(
    `[${percept.traceId}] system_bytes=${Buffer.byteLength(systemPrompt, 'utf8')} user_bytes=${Buffer.byteLength(userContent, 'utf8')}`
  )
}
```

### Structured Judge Prompt + Response Parsing
```typescript
// In executeDeferredJudgment():
const personaSummary = this.extractPersonaSummary()  // from RoleService or SOUL.md

const judgmentPrompt = buildJudgmentPrompt(personaSummary)

const result = await modelService.call(judgmentModel, {
  system: judgmentPrompt,
  messages: [{
    role: "user" as const,
    content: `Willingness score: ${probability.toFixed(3)}\n\n${contextText}`
  }],
  maxOutputTokens: 256,  // increased from 8 to accommodate JSON
}, fallbackChain)

// Parse structured response
const rawAnswer = result?.text ?? ""
let judgeDecision = false
try {
  const parser = new JsonParser<JudgeResponse>(this.logWillingness)
  const parsed = parser.parse(rawAnswer)
  if (parsed.data) {
    judgeDecision = parsed.data.decision
    if ((this.config.debugLevel ?? 0) >= 1) {
      this.logWillingness.debug(
        `[${traceId}] judge decision=${judgeDecision} confidence=${parsed.data.confidence?.toFixed(2)} reasoning="${parsed.data.reasoning?.slice(0, 80)}"`
      )
    }
  }
} catch {
  // Legacy fallback: bare yes/no
  judgeDecision = rawAnswer.trim().toLowerCase().startsWith("yes")
}
```

### AgentCoreConfig debugLevel Addition
```typescript
export interface AgentCoreConfig {
  // ... existing fields ...
  debugLevel?: number  // 0=off, 1=basic, 2=detailed, 3=full
}

export const AgentCoreConfigSchema: Schema<AgentCoreConfig> = Schema.object({
  // ... existing fields ...
  debugLevel: Schema.number()
    .default(0)
    .description("Debug log verbosity: 0=off, 1=basic, 2=detailed, 3=full"),
})
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Bare yes/no Judge response | Structured JSON with decision+confidence+reasoning+factors | Phase 24 | Better calibration visibility, reasoning logged |
| Single `agent` logger for all | Per-namespace loggers (`agent.willingness`, `agent.loop`, etc.) | Phase 24 | Independent KOISHI_DEBUG filtering |
| No traceId | `msg-` prefixed nanoid traceId on Percept | Phase 24 | Single grep shows full message flow |
| `maxOutputTokens: 8` for Judge | `maxOutputTokens: 256` | Phase 24 | Required for JSON response |

## Open Questions

1. **Persona summary extraction strategy**
   - What we know: RoleService loads SOUL.md and renders it via Mustache; the rendered content is stored in `lastValid` map but not publicly exposed
   - What's unclear: Should we expose a `getPersonaSummary()` method on RoleService, or read SOUL.md directly in AgentCore?
   - Recommendation: Add a `getSoulSummary(maxChars: number): string` method to RoleService that returns the first N chars of the rendered SOUL content. This avoids re-reading the file and uses the already-rendered version.

2. **Token accumulation for summary line**
   - What we know: `result.usage` is available per model call; multiple rounds may occur
   - What's unclear: Should total tokens be summed across all rounds, or just the last round?
   - Recommendation: Accumulate `totalTokens` across all rounds in a local variable in `ThinkActLoop.run()`, return it to `AgentCore.runLoop()` for the summary line.

3. **Tool call count for summary line**
   - What we know: `executeActions()` returns `toolResults` array
   - What's unclear: Count all tool invocations across all rounds, or just the last round?
   - Recommendation: Accumulate tool call count across rounds in ThinkActLoop, return alongside token total.

## Sources

### Primary (HIGH confidence)
- `/home/workspace/Athena/node_modules/reggol/src/shared.ts` — Logger class, `getLevel()` method, namespace splitting on `.`, `Logger.DEBUG = 3`
- `/home/workspace/Athena/node_modules/koishi/src/worker/logger.ts` — `KOISHI_DEBUG` env var handling: splits on `,`, sets each named logger to `Logger.DEBUG`
- `/home/workspace/Athena/node_modules/@cordisjs/logger/src/index.ts` — `ctx.logger("name")` returns `new Logger(name)` via `[Service.invoke]`
- `/home/workspace/Athena/core/src/services/agent/service.ts` — Full AgentCore implementation, existing logger usage, JUDGMENT_PROMPT constant
- `/home/workspace/Athena/core/src/services/agent/loop.ts` — ThinkActLoop.run(), model call, parser usage, tool execution
- `/home/workspace/Athena/core/src/services/agent/willingness.ts` — WillingnessResult.debug fields already available
- `/home/workspace/Athena/core/src/services/shared/types.ts` — Percept interface
- `/home/workspace/Athena/yarn.lock` — nanoid@^3.3.11 already present

### Secondary (MEDIUM confidence)
- STATE.md decision: "TraceContext threaded as explicit object (not AsyncLocalStorage — Koishi event system doesn't guarantee async context propagation)" — confirmed design constraint

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified in node_modules, no new deps needed
- Architecture: HIGH — all call sites identified in source, threading path is clear
- Pitfalls: HIGH — verified from actual source code (reggol getLevel, KOISHI_DEBUG handling)
- Judge prompt upgrade: HIGH — JUDGMENT_PROMPT location confirmed, response parsing location confirmed

**Research date:** 2026-02-25
**Valid until:** 2026-03-25 (stable domain — Koishi logger API is stable)
