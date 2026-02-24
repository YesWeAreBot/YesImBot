# Project Research Summary

**Project:** Athena v2.2 — Runtime Optimization & Observability
**Domain:** AI LLM chat agent for IM platforms (Koishi 4.x plugin monorepo)
**Researched:** 2026-02-25
**Confidence:** HIGH (all 4 research dimensions verified against actual source code and installed packages)

## Executive Summary

Athena v2.2 targets 8 features across runtime optimization and observability for a Koishi 4.x AI chat agent. The research reveals a codebase with strong architectural foundations — a clean 9-service dependency graph, well-separated injection points, and an ai-sdk integration that already supports the `SystemModelMessage[]` format needed for prompt caching. The critical finding is that **no new runtime dependencies are required**. The only addition is `vitest` as a dev dependency for JSON parser testing. The existing stack (ai@6.0.91, Koishi's built-in Logger, Node.js AsyncLocalStorage, Mustache 4.2) provides everything needed.

The most impactful discovery is a confirmed live bug: `{{date.now}}` and all snippet variables render as empty strings in the horizon-view template because `HorizonService.formatHorizonText()` bypasses the PromptService snippet system entirely. This bug blocks prompt cache optimization (cache boundaries need correct rendering first) and the memory_block merge (snippet ownership moves during merge). The fix is small (~10 lines) but sits on the critical path.

Key risks center on the prompt cache feature: switching from `system: string` to `system: SystemModelMessage[]` touches the model service boundary, and provider-specific `providerOptions` formats fail silently if wrong (no error, just no caching). The mitigation is to implement cache control at the ModelService layer with provider detection, not in the loop. For willingness DM bypass, the main risk is cost explosion from unthrottled DM processing — a per-user rate limiter is essential.

## Key Findings

### Recommended Stack

**What's needed:**
- `vitest` (dev-only, ^3.x) — JSON parser unit tests. Turbo already has a `"test"` task defined.

**What's NOT needed:**
- No `@ai-sdk/anthropic` — cache hints work via generic `providerOptions` passthrough
- No `winston`/`pino` — Koishi's built-in Logger supports namespaces, levels, env-based filtering
- No `uuid` — `crypto.randomUUID()` (Node 19+) suffices for trace IDs
- No `async_hooks` polyfill — `AsyncLocalStorage` stable since Node 16, Koishi requires Node 18+

**Existing dependencies leveraged:**
| Package | v2.2 Use |
|---------|----------|
| `ai` 6.0.91 | `SystemModelMessage[]` with `providerOptions` for prompt caching |
| `mustache` 4.2 | Already handles nested property lookup correctly (snippet fix) |
| `jsonrepair` 3.13 | Already used as fallback; needs test coverage |
| `koishi` 4.18.10 | Built-in Logger with namespace filtering for debug logging |

### Expected Features

**Must have (table stakes):**
1. **Snippet variable fix** — `{{date.now}}` renders empty. Confirmed live bug. ~10 lines. Critical path blocker.
2. **JSON parser hardening + tests** — Zero test coverage in v4. Port v3's 18 test cases to vitest. ~400 lines new tests.
3. **Willingness DM handling** — DMs go through same probability roll as groups. Users expect responses. ~15 lines.
4. **Full-chain debug logging** — No trace ID, no correlation, prompt payloads logged at info level. ~100 lines across 4 files.
5. **Judge prompt improvement** — Current prompt has no persona context, opaque willingness score, fragile yes/no parsing. ~30 lines.

**Should have (differentiators):**
6. **Prompt cache optimization** — Split system prompt into `SystemModelMessage[]` for provider caching. Up to 90% cost reduction on cached tokens. High complexity.
7. **Working memory layout optimization** — Reverse chronological ordering confuses LLM temporal reasoning. Redundant `send_message` content. ~50 lines.

**Defer to v2.3:**
8. **memory_block → RoleService merge** — Architectural refactor with migration risk. Not urgent. Needs careful planning for existing user data paths.

**Anti-features (do NOT build):**
- Full prompt caching abstraction for all providers (start Anthropic-only)
- Dynamic per-channel willingness configs
- External structured logging framework
- Separate "memory LLM" for working memory summarization

### Architecture Approach

All v2.2 features integrate into the existing 9-service architecture with **no new services**:

- **Prompt caching:** Add `renderToMessages()` to PromptService mapping `Section[]` → `SystemModelMessage[]`. ModelService gains an overload accepting `SystemModelMessage[]`. Cache breakpoint after `instructions` section (soul+instructions stable across session).
- **Trace ID:** `TraceContext` object (not AsyncLocalStorage — Koishi's event system doesn't guarantee async context propagation). Created at `handleEvent()`, threaded through `enqueue()` → `loop.run()` → `modelService.call()`.
- **Snippet fix:** Make `buildScope()` public (or add `resolveScope()`) on PromptService. Pass pre-resolved scope to `formatHorizonText()`.
- **Logger namespaces:** `agent`, `agent.willingness`, `agent.loop`, `agent.loop.prompt`, `agent.loop.output`, `agent.parser` — granular filtering via `KOISHI_DEBUG` env var.
- **memory_block merge (if done):** Absorb MemoryService into RoleService. Service count 9→8. Single watcher, unified file loading, snippet registration moves to RoleService.

Feature dependency matrix shows 7 of 8 features are fully independent. Features 2 (prompt cache) and 7 (working memory) both modify `loop.ts` prompt assembly — do working memory first, then cache the result.

### Critical Pitfalls

| # | Pitfall | Risk | Mitigation |
|---|---------|------|------------|
| 1 | `system` string→`SystemModelMessage[]` changes ai-sdk contract; `ModelService.executeCall` spread can silently overwrite | HIGH | Implement cache control at ModelService layer with provider detection, not in the loop |
| 2 | `formatHorizonText()` bypasses snippet system — all snippet variables empty | HIGH | Add public `resolveScope()` to PromptService; pass pre-built scope to horizon rendering |
| 3 | MemoryService + RoleService merge: double watchers, injection name collisions, sync/async file read mismatch | HIGH | Single watcher, all async reads, track+dispose injection handles before re-injecting |
| 4 | DM willingness bypass removes only spam protection — cost explosion risk | MEDIUM | Per-user rate limiter (max 1 req/3s/user) before bypassing willingness |
| 5 | Judge prompt too minimal — no persona context, opaque score, fragile parsing | MEDIUM | Include persona summary, score calibration context, robust yes/no extraction |

## Implications for Roadmap

### Suggested Phase Structure

**Phase 1 — Bug Fixes & Reliability Foundation**
- Features: F3 (snippet fix), F4 (JSON parser tests), F1 (DM willingness)
- Rationale: F3 is a confirmed live bug on the critical path — blocks F6 and F8. F4 prevents regressions in the most critical reliability path (JSON parse failures = silent bot). F1 fixes broken DM experience with minimal code change.
- Delivers: Correct prompt rendering, test infrastructure, working DM responses
- Pitfalls to avoid: #2 (snippet scope), #4 (DM rate limiting)
- Research needed: None — well-documented patterns, all code paths mapped

**Phase 2 — Observability**
- Features: F5 (debug logging + trace ID), F2 (judge prompt improvement)
- Rationale: Debug logging should exist before optimizing anything — it enables validating all subsequent changes. Judge prompt benefits from F5 for validation.
- Delivers: End-to-end message tracing, better deferred judgment quality
- Pitfalls to avoid: #5 (judge prompt), #8 (log level changes breaking monitoring)
- Research needed: None — TraceContext pattern is straightforward

**Phase 3 — Optimization**
- Features: F7 (working memory layout), F6 (prompt cache)
- Rationale: Working memory restructure should come before prompt caching because both touch `loop.ts` prompt assembly. Do F7 first (restructure WM in user message), then F6 (cache the stable system prompt sections). F6 is the highest-complexity feature with the biggest cost savings payoff.
- Delivers: Better LLM reasoning (WM), up to 90% cost reduction on cached tokens (cache)
- Pitfalls to avoid: #1 (SystemModelMessage contract), #6 (WM format regression)
- Research needed: Phase research recommended for F6 — verify `providerOptions` format against current Anthropic API docs, test cache hit/miss response headers

**Deferred to v2.3:**
- F8 (memory_block → RoleService merge) — Architectural refactor with user-facing migration impact. Not blocking any v2.2 features. Needs migration script planning.

### Research Flags

- **Needs phase research:** Phase 3 (prompt cache optimization) — provider-specific `providerOptions` format was based on training data, not live API verification. Cache hit/miss detection needs testing.
- **Standard patterns (skip research):** Phase 1 (all bug fixes with clear code paths), Phase 2 (logging is additive, no behavioral changes)

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified from installed `node_modules`. Only gap: provider-specific caching behavior from training data, not live docs. |
| Features | HIGH | All 8 features mapped to exact source locations with line numbers. Feature dependencies verified. |
| Architecture | HIGH | Full 9-service dependency graph traced. All touch points identified per feature. No external sources needed. |
| Pitfalls | HIGH | All 10 pitfalls verified against actual code. Root causes confirmed (e.g., PROMPT.json shows empty `date.now`). |

**Gaps to address during planning:**
1. Anthropic `providerOptions` cache control format — verify against current API docs before implementing F6
2. Provider behavior with `SystemModelMessage[]` — test that OpenAI/DeepSeek providers correctly handle array system messages
3. DM rate limiting strategy — exact cooldown values need tuning based on real usage patterns
4. Working memory format — A/B test with real conversations before committing to new layout

## Sources

Aggregated from all 4 research files. All findings based on direct source code analysis:

**Core agent pipeline:** `agent/service.ts`, `agent/loop.ts`, `agent/willingness.ts`, `agent/json-parser.ts`, `agent/trimmer.ts`, `agent/tools.ts`
**Prompt system:** `prompt/service.ts`, `prompt/types.ts`, `prompt/renderer.ts`
**Content services:** `memory/service.ts`, `memory/types.ts`, `role/service.ts`, `role/types.ts`
**Horizon layer:** `horizon/service.ts`, `horizon/listener.ts`, `horizon/manager.ts`, `horizon/types.ts`
**Model layer:** `model/service.ts`
**ai-sdk types:** `node_modules/ai/dist/index.d.ts`, `node_modules/@ai-sdk/provider-utils/dist/index.d.ts`, `node_modules/@ai-sdk/provider/dist/index.d.ts`
**v3 reference:** `references/YesImBot-v3/packages/core/src/shared/utils/json-parser.ts`, `references/YesImBot-v3/packages/core/tests/utils-json-parser.test.ts`
**Live output:** `PROMPT.json` (confirmed `{{date.now}}` bug)
