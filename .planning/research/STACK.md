# Stack Research: v2.2 Runtime Optimization & Observability

**Domain:** AI LLM chat agent for IM platforms (Koishi 4.x plugin monorepo)
**Researched:** 2026-02-25
**Confidence:** HIGH (all findings verified against installed node_modules and source code)

## Scope

Technology stack assessment for v2.2's 7 features. Focus: prompt caching via ai-sdk, debug logging, JSON parser testing, snippet variable fix, new dependencies.

## Key Finding: No New Runtime Dependencies Required

The only new dependency is `vitest` (dev-only). Prompt caching uses `SystemModelMessage[]` with `providerOptions` already supported by `ai@6.0.91`.

## Current Stack (Verified)

| Technology | Version | Purpose |
|---|---|---|
| koishi | 4.18.10 | Bot framework, service lifecycle, logger |
| ai (Vercel AI SDK) | 6.0.91 | LLM abstraction, generateText/streamText |
| @ai-sdk/provider | 3.0.8 | SystemModelMessage, ProviderOptions types |
| mustache | ^4.2.0 | Template rendering for prompts |
| jsonrepair | ^3.13.2 | JSON repair for malformed LLM output |
| gray-matter | ^4.0.3 | Frontmatter parsing for memory blocks |
| p-queue | ^9.0.0 | Concurrency control for model calls |
| typescript | ^5.9.3 | Type checking |
| turbo | ^2.8.9 | Monorepo task orchestration |
| pkgroll | ^2.21.4 | Package bundling (CJS + ESM) |
| oxlint / oxfmt | ^1.48.0 / ^0.33.0 | Linting and formatting |
| yarn | 4.12.0 | Package manager |

---

## Area 1: LLM API Prefix Caching / Prompt Splitting

**Confidence:** HIGH (verified from installed type definitions)

### ai-sdk System Parameter

The installed `ai@6.0.91` Prompt type (`node_modules/ai/dist/index.d.ts:681`) accepts:

```ts
system?: string | SystemModelMessage | Array<SystemModelMessage>;
```

`SystemModelMessage` (`@ai-sdk/provider-utils`):

```ts
type SystemModelMessage = {
  role: 'system';
  content: string;
  providerOptions?: ProviderOptions;  // Record<string, JSONObject>
};
```

The JSDoc in `@ai-sdk/provider` shows the Anthropic cache control format:

```ts
{ "anthropic": { "cacheControl": { "type": "ephemeral" } } }
```

No new packages needed. The existing ai-sdk supports cache hints per system message block.

### Current Code Path

`ThinkActLoop.run()` calls `prompt.renderToString()` which returns a single string. This is passed as `system: systemPrompt` to `ModelService.call()` (loop.ts:151). `ModelService.executeCall()` spreads `{ ...defaults, ...params }` (model/service.ts:165) and passes to `generateText()`.

### What Needs to Change

1. `PromptService.render()` already returns `Section[]` with `name`, `content`, and `cacheable` fields. The `cacheable` flag is hardcoded `true` (prompt/service.ts:136) but never consumed. This is the natural seam for cache boundaries.

2. Instead of `renderToString()`, the loop should call `render()` to get `Section[]`, then convert to `SystemModelMessage[]`:

```ts
const sections = await prompt.render("system", { view, percept });
const systemMessages: SystemModelMessage[] = sections.map(s => ({
  role: 'system' as const,
  content: s.content,
  ...(s.cacheable ? {
    providerOptions: {
      anthropic: { cacheControl: { type: "ephemeral" } }
    }
  } : {})
}));
```

3. The `CallParams` type is `CallSettings & Prompt` which already accepts `system: Array<SystemModelMessage>`. No type changes needed at the model layer.

### Provider-Specific Caching Behavior

| Provider | Caching Mechanism | ai-sdk Integration |
|---|---|---|
| Anthropic | Explicit `cache_control` breakpoints. Up to 4 breakpoints. Cached prefix must be >1024 tokens. 5-min TTL. | `providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } }` on `SystemModelMessage` |
| OpenAI | Automatic prefix caching. No explicit hints needed. Caches longest matching prefix >=1024 tokens. | No `providerOptions` needed. Just splitting into `SystemModelMessage[]` is sufficient for stable prefixes. |
| DeepSeek | Automatic prefix caching similar to OpenAI. Context caching on disk, 128-token granularity. | No `providerOptions` needed. Stable prefix ordering is enough. |

**Key insight:** Splitting the system prompt into `SystemModelMessage[]` benefits ALL providers. For OpenAI/DeepSeek, stable ordering of content blocks maximizes automatic cache hits. For Anthropic, explicit `cacheControl` hints are additionally needed. The `providerOptions` field is ignored by providers that don't understand it, so it's safe to always include Anthropic hints.

**Warning:** The ai-sdk docs note "not all providers support several system messages." However, the installed `@ai-sdk/openai` and `@ai-sdk/deepseek` providers both use the OpenAI-compatible API which concatenates multiple system messages. Verified: no `@ai-sdk/anthropic` is installed in this repo (only openai and deepseek providers exist). If Anthropic support is added later, the `providerOptions` plumbing is already in place.

### Section Cacheability

Current `PromptService.render()` produces 4 sections in order: `soul`, `instructions`, `memory`, `extra`. Recommended cacheability:

| Section | Stability | Cacheable? | Rationale |
|---|---|---|---|
| `soul` | Static per role | YES | SOUL.md rarely changes between turns |
| `instructions` | Static per role | YES | AGENTS.md + TOOLS.md rarely change |
| `memory` | Semi-static | YES (last block) | Core memory blocks change infrequently; place cache breakpoint after last memory block |
| `extra` | Dynamic per turn | NO | Contains horizon-view with history, working memory -- changes every turn |

Place Anthropic `cacheControl` on the last `SystemModelMessage` of the stable prefix (after `memory`, before `extra`). This maximizes the cached portion.

---

## Area 2: Debug Logging

**Confidence:** HIGH (verified from Koishi source and current codebase)

### Koishi Logger API

Koishi uses `cordis` Logger under the hood. The API available via `ctx.logger(namespace)`:

- `logger.debug(msg, ...args)` -- level 3
- `logger.info(msg, ...args)` -- level 2 (default visible)
- `logger.warn(msg, ...args)` -- level 1
- `logger.error(msg, ...args)` -- level 0
- `logger.level` -- per-namespace level override

Namespace filtering: `KOISHI_DEBUG=agent.loop,agent.willingness` enables debug-level for specific namespaces. This is the built-in mechanism for granular log control.

### Current Logging State

All agent logs use `ctx.logger("agent")` -- a single namespace. The loop (loop.ts) logs full prompt payloads at `info` level (line 156: `JSON.stringify(callParams, null, 2)`). No trace/correlation ID exists.

### Trace ID Strategy

**No new dependency needed.** Node.js `AsyncLocalStorage` (built-in since Node 16) is the right tool:

```ts
import { AsyncLocalStorage } from "node:async_hooks";
const traceStore = new AsyncLocalStorage<{ traceId: string }>();
```

This avoids threading `traceId` through every function signature. The trace ID is set once at `handleEvent()` entry and automatically propagates through all async calls.

### Recommended Logger Namespaces

| Namespace | What it logs |
|---|---|
| `agent` | Lifecycle: start, stop, error reports |
| `agent.willingness` | Willingness calculations, DM bypass, deferred judgment |
| `agent.loop` | Round progression, model calls, tool executions |
| `agent.loop.prompt` | Full prompt payload (debug level only) |
| `agent.loop.output` | Raw model output (debug level only) |
| `agent.parser` | JSON parse attempts, repairs, failures |

---

## Area 3: JSON Parser Hardening

**Confidence:** HIGH (verified from v3 source and v4 source)

### v3 Parser Reference

The v3 parser (`references/YesImBot-v3/packages/core/src/shared/utils/json-parser.ts`, 267 lines) handles:
- Markdown code block extraction (triple backtick with optional language tag)
- `[OBSERVE]`/`[ANALYZE]`/`[PLAN]`/`[ACT]` prefix stripping
- Nested code blocks inside JSON string values
- Unbalanced bracket detection with logging
- `jsonrepair` fallback for malformed JSON
- Debug flag to suppress verbose logging in production

### v4 Parser Current State

The v4 parser (`core/src/services/agent/json-parser.ts`, 155 lines) is a simplified rewrite. It shares the same core logic but:
- No test coverage
- No debug flag (always logs)
- Uses injected `Logger` interface instead of constructor options

### Testing Framework: vitest

**Use vitest** because:
- The turbo.json already has a `"test"` task defined (line 23-25)
- No test runner is currently installed -- vitest is the standard for modern TypeScript monorepos
- The v3 test suite uses `bun:test` which is incompatible; vitest has near-identical API (`describe`, `it`, `expect`)
- vitest supports workspace mode for monorepo testing out of the box

### Setup Required

```bash
# Root devDependency
yarn add -D vitest -W

# Root vitest.config.ts (minimal)
# vitest auto-discovers **/*.test.ts files
```

Turbo already has `"test": { "outputs": [] }` configured. Add `"vitest --run"` as the test script in `core/package.json`.

### v3 Test Porting Notes

The v3 test file uses:
- `import { describe, it, expect } from "bun:test"` -- replace with `vitest`
- `toContainValue()` custom matcher -- replace with standard `toContain()` or `toEqual(expect.objectContaining(...))`
- Chinese log message assertions -- update to match v4's English messages
- 12 test cases covering: basic JSON, code blocks, `[OBSERVE]` prefix, nested blocks, complex multi-section LLM output

---

## Area 4: Snippet Variable Fix

**Confidence:** HIGH (confirmed bug from source code analysis)

### Root Cause

The `{{date.now}}` variable renders as empty in the horizon-view template. The bug is in `HorizonService.formatHorizonText()` (horizon/service.ts:274):

```ts
return Mustache.render(this.horizonViewTpl, {
  environment,
  activeMembers,
  hasHistory: historyObs.length > 0,
  history: historyObs,
  // ... no date, sender, channel, bot keys
}).trim();
```

Snippets like `date.now` are registered in `MemoryService.registerSnippets()` and resolved by `PromptService.buildScope()` (private method). But `formatHorizonText()` bypasses PromptService entirely -- it renders the template directly with its own scope object that lacks snippet variables.

Confirmed in PROMPT.json output: `"content": "现在是 。"` (empty date).

### Fix Options

**Option A (recommended):** Add a public `resolveScope(initial)` method to PromptService. Have the loop call it once, then pass the resolved scope to both `render()` and `formatHorizonText()`.

**Option B:** Move `{{date.now}}` out of horizon-view.mustache into a section that PromptService renders directly (e.g., the `extra` injection point).

Option A is better because it fixes ALL snippet variables in horizon-view, not just `date.now`. Note: `buildScope` is async (snippets can be async), so `formatHorizonText` would need to accept a pre-resolved scope or become async.

### No New Dependencies

This is a pure architectural fix. Mustache 4.2 handles nested property lookup (`date.now` -> `scope.date.now`) correctly -- the issue is that the scope object is never populated with snippet values when HorizonService renders.

---

## Area 5: New Dependencies Assessment

**Confidence:** HIGH

### New Dependencies Needed

| Package | Type | Purpose | Version |
|---|---|---|---|
| vitest | devDependency (root) | JSON parser unit tests | latest (^3.x) |

That's it. No new runtime dependencies.

### Dependencies NOT Needed

| Considered | Why Not |
|---|---|
| `@ai-sdk/anthropic` | No Anthropic provider plugin exists yet. Cache hints via `providerOptions` work through the generic passthrough. Add when an Anthropic provider is built. |
| `winston` / `pino` | Koishi's built-in Logger (from cordis) is sufficient. It supports namespaces, levels, and env-based filtering. |
| `uuid` | For trace IDs, `crypto.randomUUID()` (Node 19+) or a simple counter suffices. |
| `async_hooks` polyfill | `AsyncLocalStorage` is stable since Node 16. Koishi 4.18 requires Node 18+. |

### Existing Dependencies Leveraged for v2.2

| Package | v2.2 Feature | How Used |
|---|---|---|
| `ai` (6.0.91) | Prompt caching | `SystemModelMessage[]` with `providerOptions` |
| `mustache` (4.2) | Snippet fix | Already handles nested property lookup correctly |
| `jsonrepair` (3.13) | JSON parser hardening | Already used as fallback; add test coverage |
| `koishi` (4.18.10) | Debug logging | Built-in Logger with namespace filtering |

---

## Installation

```bash
# New dev dependency (root workspace)
yarn add -D vitest -W
```

Add to `core/package.json` scripts:
```json
{
  "scripts": {
    "test": "vitest --run"
  }
}
```

No other package changes needed.

---

## Sources

All findings verified by reading actual source code and installed packages:

**ai-sdk types (prompt caching):**
- `node_modules/ai/dist/index.d.ts:678-681` -- `Prompt.system` union type
- `node_modules/@ai-sdk/provider-utils/dist/index.d.ts:900-909` -- `SystemModelMessage` definition
- `node_modules/@ai-sdk/provider/dist/index.d.ts:50-60` -- `SharedV3ProviderOptions` with Anthropic cacheControl JSDoc
- `node_modules/ai/package.json` -- version 6.0.91
- `node_modules/@ai-sdk/provider/package.json` -- version 3.0.8

**Current codebase:**
- `core/src/services/agent/loop.ts:151-153` -- system prompt passed as string
- `core/src/services/model/service.ts:119-165` -- CallParams type, executeCall spread
- `core/src/services/prompt/service.ts:113-148` -- render() returns Section[], cacheable flag
- `core/src/services/prompt/types.ts` -- Section, Snippet, InjectionPoint types
- `core/src/services/horizon/service.ts:242-283` -- formatHorizonText bypasses snippet scope
- `core/src/services/memory/service.ts:135-174` -- snippet registration
- `core/src/services/agent/json-parser.ts` -- v4 parser (155 lines, no tests)
- `core/src/services/agent/service.ts:11-12` -- JUDGMENT_PROMPT
- `core/resources/templates/partials/horizon-view.mustache:1` -- `{{date.now}}` template variable

**Reference code:**
- `references/YesImBot-v3/packages/core/src/shared/utils/json-parser.ts` -- v3 parser (267 lines)

**Build config:**
- `turbo.json:23-25` -- test task already defined
- `core/package.json` -- dependency versions
- `package.json` -- root workspace config

**Confidence note:** WebSearch was unavailable during this research session. Provider-specific caching behavior (Anthropic breakpoint limits, OpenAI auto-cache thresholds, DeepSeek disk caching) is based on training data knowledge and should be verified against current provider documentation during implementation. All ai-sdk type information is HIGH confidence (read directly from installed packages).
