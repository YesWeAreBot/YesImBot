# Feature Research: v2.2 Runtime Optimization & Observability

**Domain:** AI chat agent runtime (Koishi 4.x plugin monorepo)
**Researched:** 2026-02-25
**Confidence:** HIGH (all findings based on direct code analysis)

## Context: What Already Exists (v2.1)

### Willingness System (v4 current)
The `WillingnessEngine` (`core/src/services/agent/willingness.ts`) implements:
- Exponential decay with configurable half-life (default 300s)
- Elastic decay: slows when willingness > 70% of max
- Silence-aware decay: 5s/15s/60s tiers reduce decay strength
- Sigmoid gain curve with configurable midpoint/steepness
- Fatigue penalty: exponential penalty after N bot replies in sliding window
- Mention/reply boost: `probability + (1 - probability) * mentionBoost`
- Deferred LLM judgment for borderline SKIP decisions

**Critical gap:** `isDirect` is detected in `handleEvent()` (line 134) but only affects *routing* (skip aggregation window). The willingness calculation itself treats DM and group identically — no special gain, no forced reply for DMs.

### Prompt System (v4 current)
- `PromptService` renders 4 injection points: `soul`, `instructions`, `memory`, `extra`
- Each point produces a `Section { name, content, cacheable }` — but `cacheable` is always set to `true` (line 137) and **never consumed** by ModelService
- `ModelService.call()` passes `system` as a plain string via Vercel AI SDK's `generateText({ system: string })`
- The entire system prompt is re-sent as a single string every turn — no content block splitting

### Agent Loop (v4 current)
- `ThinkActLoop` in `core/src/services/agent/loop.ts` runs up to `maxRounds` (default 3)
- Working memory is built from `view.history` agent.response observations (lines 110-125)
- Format: `Round N:` followed by `  - action(params) -> status: preview`
- History and working memory are rendered via `formatHorizonText()` into the user message
- Trimmer (`trimmer.ts`) does soft/hard trimming on multi-round messages

### Memory & Role Services (v4 current)
- `MemoryService` loads `.md` files from disk, parses frontmatter, registers snippets (`date.now`, `sender.*`, `channel.*`, `bot.*`), injects into `memory` point
- `RoleService` loads `SOUL.md`, `AGENTS.md`, `TOOLS.md` from disk, injects into `soul`/`instructions` points
- Both services: watch files for hot-reload, use Mustache rendering, depend on `yesimbot.prompt`
- **Overlap:** Both manage "who the bot is" content. MemoryService owns snippets that RoleService needs. RoleService renders Mustache templates that reference snippet variables.

### JSON Parser (v4 current)
- `JsonParser` in `core/src/services/agent/json-parser.ts` (155 lines)
- Handles: markdown code blocks, leading/trailing text, `jsonrepair` fallback
- `isLikelyJsonStart()` distinguishes `[OBSERVE]` from JSON arrays
- **No tests exist** in v4

### Snippet Variable Rendering
- `{{date.now}}` in `horizon-view.mustache` line 1: `现在是 {{date.now}}。`
- `formatHorizonText()` in `horizon/service.ts` line 274 calls `Mustache.render(this.horizonViewTpl, {...})` with its own data object containing `environment`, `activeMembers`, `history`, `trigger`, `workingMemory`
- **Bug:** This Mustache.render call does NOT include the snippet scope. Snippets like `date.now` are registered in MemoryService and resolved in `PromptService.buildScope()`, but `formatHorizonText()` bypasses PromptService entirely. Result: `{{date.now}}` renders as empty string.

---

## Table Stakes (must-have for v2.2)

### 1. Willingness: DM Special Handling
| Aspect | Detail |
|--------|--------|
| **What** | DMs should always reply (or near-always). Currently DMs go through the same probability roll as group messages. |
| **Why Expected** | Users who DM the bot expect a response. Ignoring DMs feels broken. v3 had `attribute.isDirectMessage` gain bonus. |
| **Complexity** | Low |
| **Current code path** | `handleEvent()` line 134 checks `isDirect` for routing only. `processMessage()` line 201 receives `triggerType: "direct"` but only `"mention"` and `"reply"` get boost (line 234). |
| **Implementation** | Add `isDirect` check in `processMessage()`: when `triggerType === "direct"`, set `probability = 1.0` (or apply a configurable `directBoost` similar to `mentionBoost`). Add `directBoost` field to `WillingnessConfig` with default `1.0`. |
| **Code change** | ~15 lines in `willingness.ts` + schema update |

### 2. Willingness: Judge Prompt Improvement
| Aspect | Detail |
|--------|--------|
| **What** | The deferred judgment prompt is too generic. It says "decide whether the bot should reply" with no persona context. |
| **Why Expected** | The judge should consider the bot's personality and conversation patterns, not just a willingness score. |
| **Complexity** | Low |
| **Current code** | `JUDGMENT_PROMPT` in `service.ts` line 11: `"You are a conversation participation judge..."` — a single sentence with no persona awareness. The user message only sends `Willingness score: X` + raw horizon text. |
| **Implementation** | Enrich the judgment prompt with: (a) bot persona summary from soul injection, (b) explicit criteria (is bot mentioned indirectly? is topic relevant to bot's interests? would silence be awkward?), (c) structured output format instead of bare "yes"/"no". |
| **Code change** | ~30 lines prompt rewrite in `service.ts` |

### 3. Snippet Variable Injection Fix
| Aspect | Detail |
|--------|--------|
| **What** | `{{date.now}}` renders as empty in the user message (horizon view). All snippet variables are broken in horizon context. |
| **Why Expected** | The prompt literally says `现在是 。` with nothing after it (visible in PROMPT.json line 178). This is a visible bug. |
| **Complexity** | Low |
| **Root cause** | `formatHorizonText()` at `horizon/service.ts:274` calls `Mustache.render(tpl, data)` where `data` only contains horizon-specific fields. Snippet values (`date.now`, `bot.name`, etc.) live in the scope built by `PromptService.buildScope()`, which is never passed to this render call. |
| **Implementation** | Option A (minimal): Accept a `scope` parameter in `formatHorizonText()`, merge it with the horizon data before rendering. The caller in `loop.ts:126` already has access to the prompt scope (or can build it). Option B (cleaner): Move `{{date.now}}` out of horizon-view template into the system prompt where snippets are properly resolved. Option A is better because it fixes all snippet variables in horizon context. |
| **Code change** | ~10 lines: add `scope?: Record<string, unknown>` param to `formatHorizonText()`, spread into render data. Update caller in `loop.ts`. |

### 4. JSON Parser Hardening + Tests
| Aspect | Detail |
|--------|--------|
| **What** | Port v3's comprehensive test suite to v4 and ensure parser handles all edge cases. |
| **Why Expected** | JSON parsing failures cause the bot to go silent. This is the most critical reliability path. |
| **Complexity** | Medium |
| **v3 vs v4 comparison** | The v4 parser is a clean rewrite of v3 — algorithmically identical. Both use `jsonrepair`, both have `isLikelyJsonStart()`, both handle code blocks, leading/trailing text, truncated JSON. Key differences: (1) v3 has Chinese log messages, v4 has English; (2) v3 accepts `ParserOptions` with `debug` flag, v4 accepts a `Logger` directly; (3) v3 has 547 lines of tests covering 18 cases, v4 has zero tests. |
| **v3 test cases to port** | Perfect JSON, code blocks, nested code blocks (JS inside JSON), nested JSON code blocks, `[OBSERVE]` prefix with unbalanced code block, leading/trailing text, missing braces, missing brackets, multi-level unclosed structures, truncated strings, dangling keys, mixed errors, empty input, non-object results, unbalanced bracket skip. The "complex format" test (line 211-249 in v3) is especially important — it tests a massive LLM output with `[OBSERVE]`/`[ANALYZE]`/`[PLAN]`/`[ACT]` prefixed text followed by a JSON code block. |
| **Implementation** | Create `core/tests/json-parser.test.ts`, adapt v3 tests from `bun:test` to `vitest`, update interface references from v3's `ParserOptions` to v4's `Logger` constructor. |
| **Code change** | ~400 lines new test file. Parser itself needs no changes — it's already equivalent to v3. |

### 5. Full-Chain DEBUG Logging
| Aspect | Detail |
|--------|--------|
| **What** | Add structured debug logging across the entire message processing pipeline. |
| **Why Expected** | Currently debugging requires reading scattered `logger.info()` calls. There's no way to trace a single message from reception through willingness evaluation, prompt rendering, model call, JSON parsing, tool execution, to final reply. |
| **Complexity** | Medium |
| **Current state** | 69 logger calls across 14 files. Key gaps: (a) No log when willingness check passes but aggregation window delays execution; (b) No log of rendered system prompt size/section breakdown; (c) No log of prompt cache hit/miss; (d) No structured correlation ID linking logs for one message flow; (e) `loop.ts:156` dumps entire `callParams` as JSON which is too verbose for info level. |
| **Implementation** | (1) Add a `traceId` (use `percept.id`) threaded through all log calls for a single message flow. (2) Add debug-level logs at: message received in listener, willingness decision with full debug struct, aggregation window start/end, prompt section sizes, model call start/latency/token usage, JSON parse attempt/result, each tool invocation start/result, final reply sent. (3) Use structured log format: `[traceId] [stage] message`. |
| **Code change** | ~100 lines across `listener.ts`, `service.ts` (agent), `loop.ts`, `willingness.ts`. No new files needed. |

---

## Differentiators (should-have for v2.2)

### 6. Prompt Cache Optimization
| Aspect | Detail |
|--------|--------|
| **What** | Split system prompt into separate content blocks so providers (Anthropic, etc.) can cache stable portions across turns. |
| **Value** | Cost reduction (up to 90% on cached tokens for Anthropic), latency reduction on TTFT. |
| **Complexity** | High |
| **Current architecture** | `PromptService.render()` returns `Section[]` with `cacheable` flag, but `renderToString()` (called by loop.ts:105) flattens everything into one string. `ModelService.call()` passes `system: string` to Vercel AI SDK. The SDK supports `system: Array<{ type: 'text', text: string, experimental_providerMetadata?: {...} }>` for content blocks. |
| **Analysis of PROMPT.json** | The actual prompt has clear stable/dynamic boundaries: `<soul>` (stable per session), `<instructions>` (stable per session, ~3000 chars), `<memory>` (stable per session, ~800 chars), `<extra>` (empty/stable). The user message contains all dynamic content (history, trigger, working memory). This means the ENTIRE system prompt is cacheable — it only changes when role files or memory blocks are edited. |
| **Implementation** | (1) Change `PromptService.render()` to return sections with cache breakpoints. (2) Change `ModelService.call()` to accept `system: Section[]` and convert to provider-specific content block format. (3) For Anthropic: add `cache_control: { type: "ephemeral" }` to the last cacheable block. (4) For other providers: fall back to string concatenation. This requires changes to the Vercel AI SDK call site and potentially the provider abstraction. |
| **Risk** | Vercel AI SDK's `system` parameter typing. Need to verify `experimental_providerMetadata` support for cache control in the Anthropic provider. |

### 7. Working Memory Layout Optimization
| Aspect | Detail |
|--------|--------|
| **What** | Improve the working memory format to better convey causality, temporal ordering, and interaction context. |
| **Value** | Better LLM reasoning about conversation flow. Current flat `Round N` format loses causal relationships between tool calls and their motivating messages. |
| **Complexity** | Medium |
| **Current format** | From PROMPT.json, working memory looks like: `Round 2:\n  - send_message({...}) -> success: Sent 1 message(s)\nRound 1:\n  - send_message({...}) -> success: Sent 2 message(s)` — Rounds are listed in reverse chronological order (newest first), which is counterintuitive. Each round is isolated with no connection to the triggering message. |
| **Problems** | (1) Reverse ordering (Round 2 before Round 1) confuses temporal reasoning. (2) No link between "what was said to me" and "what I did about it". (3) Tool params are dumped as raw JSON — `send_message({"content":"搜不了"})` is redundant when the same content appears in history as `[Bot]: 搜不了`. (4) Working memory and history are separate sections but describe the same timeline, forcing the LLM to mentally merge them. |
| **Implementation** | (1) Reverse the order so oldest rounds come first (chronological). (2) For `send_message` actions, omit the content param since it's already in history — just show `send_message -> Sent N message(s)`. (3) For tool calls, show a compact summary: `web_search("query") -> result_preview`. (4) Consider interleaving working memory entries with history entries by timestamp instead of separating them. |
| **Code change** | ~50 lines in `loop.ts` (working memory builder, lines 110-125) and possibly `horizon-view.mustache`. |

### 8. memory_block to RoleService Merge
| Aspect | Detail |
|--------|--------|
| **What** | Consolidate MemoryService's core memory block functionality into RoleService, making RoleService the single owner of "who the bot is". |
| **Value** | Eliminates confusing split where persona lives in memory blocks but soul/instructions live in role files. Simplifies the mental model for users configuring the bot. |
| **Complexity** | Medium |
| **Current overlap** | MemoryService: loads `.md` files from `data/yesimbot/memories/`, parses frontmatter, renders with Mustache, injects into `memory` point, owns all snippet registrations (`date.now`, `sender.*`, `channel.*`, `bot.*`), watches for file changes. RoleService: loads `SOUL.md`/`AGENTS.md`/`TOOLS.md` from `data/yesimbot/roles/`, renders with Mustache, injects into `soul`/`instructions` points, watches for file changes. |
| **Merge strategy** | (1) Move snippet registration from MemoryService to RoleService (or a new shared SnippetService). (2) Move core memory block loading into RoleService — role files become the single source for persona + memory. (3) Keep MemoryService as a thin wrapper for future L2/L3 memory (archival, episodic) that doesn't overlap with static persona. (4) RoleService gains a `memories/` subdirectory alongside its role files. |
| **Risk** | Breaking change for users who have customized memory block paths. Need migration path. |

---

## Anti-Features (what NOT to build in v2.2)

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Full prompt caching for all providers** | Each provider has different caching semantics (Anthropic ephemeral, OpenAI auto-cache, Google implicit). Trying to abstract all of them is a rabbit hole. | Start with Anthropic-only cache control. Other providers get string fallback. |
| **Dynamic willingness model per-channel** | Tempting to let each channel have different willingness configs. Adds massive config complexity for marginal benefit. | Keep single config. DM vs group distinction is sufficient. |
| **Structured logging framework** | Don't introduce Winston/Pino/etc. Koishi has its own logger system. Adding another layer creates confusion. | Use Koishi's built-in logger with consistent format conventions. |
| **Working memory as separate LLM context window** | Some architectures use a separate "memory LLM" to summarize. Adds latency and cost for unclear benefit at current scale. | Keep working memory as formatted text in the user message. Optimize the format, not the architecture. |
| **Automated JSON parser repair via fine-tuned model** | The LLM repair fallback in `loop.ts:182-185` already exists. Don't invest in training a specialized repair model. | Harden the parser itself. The `jsonrepair` library handles 95%+ of cases. |

---

## Feature Dependencies

```
Snippet Variable Fix (F3) ← independent, no deps
  └── blocks Prompt Cache (F6) — cache boundaries need correct rendering first

JSON Parser Tests (F4) ← independent, no deps

Willingness DM Handling (F1) ← independent
Willingness Judge Prompt (F2) ← independent, but benefits from F5 (debug logging to validate)

Debug Logging (F5) ← independent, but should be done early to aid debugging other features

Prompt Cache (F6) ← depends on F3 (snippet fix) being done first
  └── also depends on understanding Section boundaries from prompt service

Working Memory Layout (F7) ← independent, but interacts with F6 (cache boundaries)

memory_block → RoleService (F8) ← depends on F3 (snippet ownership moves during merge)
```

**Critical path:** F3 (snippet fix) should be first — it's a bug fix that blocks F6 and F8.

---

## MVP Recommendation

**Phase 1 — Bug fixes and reliability (do first):**
1. F3: Snippet variable fix (~10 lines, immediate visible improvement)
2. F4: JSON parser tests (~400 lines, prevents regressions)
3. F1: Willingness DM handling (~15 lines, fixes broken DM experience)

**Phase 2 — Observability:**
4. F5: Debug logging (~100 lines, enables debugging everything else)
5. F2: Judge prompt improvement (~30 lines, benefits from F5 for validation)

**Phase 3 — Optimization:**
6. F7: Working memory layout (~50 lines, improves LLM reasoning quality)
7. F6: Prompt cache optimization (high complexity, biggest cost savings)

**Defer to v2.3:**
- F8: memory_block → RoleService merge (architectural refactor, not urgent, needs careful migration planning)

---

## Sources

All findings from direct code analysis of the Athena repository:

| File | Purpose |
|------|---------|
| `core/src/services/agent/willingness.ts` | Willingness engine — full implementation reviewed |
| `core/src/services/agent/service.ts` | AgentCore — handleEvent, JUDGMENT_PROMPT, deferred judgment |
| `core/src/services/agent/loop.ts` | ThinkActLoop — working memory builder, prompt rendering, JSON parsing |
| `core/src/services/agent/json-parser.ts` | v4 JSON parser — full implementation reviewed |
| `core/src/services/agent/trimmer.ts` | Message trimmer — soft/hard trim logic |
| `core/src/services/agent/tools.ts` | Tool schema builder for prompt injection |
| `core/src/services/prompt/service.ts` | PromptService — render(), buildScope(), Section generation |
| `core/src/services/prompt/types.ts` | Section type with cacheable flag |
| `core/src/services/prompt/renderer.ts` | MustacheRenderer — iterative rendering |
| `core/src/services/horizon/service.ts` | HorizonService — formatHorizonText() bug site |
| `core/src/services/horizon/listener.ts` | EventListener — trigger classification, isDirect detection |
| `core/src/services/memory/service.ts` | MemoryService — snippet registration, core memory blocks |
| `core/src/services/role/service.ts` | RoleService — SOUL/AGENTS/TOOLS injection |
| `core/src/services/model/service.ts` | ModelService — call() with plain string system prompt |
| `core/resources/templates/partials/horizon-view.mustache` | Template with broken `{{date.now}}` |
| `PROMPT.json` | Actual rendered prompt output — cache boundary analysis |
| `references/YesImBot-v3/packages/core/src/shared/utils/json-parser.ts` | v3 parser for comparison |
| `references/YesImBot-v3/packages/core/tests/utils-json-parser.test.ts` | v3 test suite (18 cases) to port |
| `references/YesImBot-v3/packages/core/src/agent/willing.ts` | v3 willingness with isDirect gain bonus |
