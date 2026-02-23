# Project Research Summary

**Project:** Athena v2.1 — OpenClaw Memory Paradigm + Polish & Release Prep
**Domain:** Koishi LLM agent plugin — prompt system refactor, memory block restructure
**Researched:** 2026-02-23
**Confidence:** HIGH

## Executive Summary

Athena v2.1 is a focused internal refactor of an existing, working Koishi plugin. The goal is to adopt the OpenClaw memory paradigm (SOUL.md/AGENTS.md/TOOLS.md fixed-role files) and simplify the prompt injection system from 6 points to 4. All research was conducted via direct codebase analysis — no speculative patterns, no external API research needed. The existing stack (gray-matter, Mustache, TypeScript, Turbo/Yarn) already handles every v2.1 feature; the only new dependency is vitest for test coverage.

The recommended approach is strictly bottom-up: update the `InjectionPoint` type first, let TypeScript errors surface all affected call sites, then work outward through PromptService, MemoryService, ThinkActLoop, and template files in dependency order. The injection point rename is the single blocking dependency for everything else — it must land before memory block routing, wrapper partial elimination, or test coverage work begins.

The primary risk is silent failures. Mustache renders missing partials as empty string (no error), Koishi silently defers plugin load when injected services are absent, and renamed injection points produce no output without a runtime guard. All three failure modes are invisible in logs. The mitigation is: add a runtime throw in `PromptService.inject()` for unknown point names, validate partial existence at boot, and assert service instance is defined in every vitest test before exercising behavior.

## Key Findings

### Recommended Stack

The existing stack requires no changes for the core refactor. Only vitest needs to be added for test coverage. The project uses `"type": "module"` and `moduleResolution: "bundler"` — vitest 4.x handles both natively with zero transform config, making it the only viable choice over Jest.

**Core technologies:**
- vitest ^4.0.18: test runner — ESM-native, zero-config for this project's TypeScript setup; matches openclaw reference
- @vitest/coverage-v8 ^4.0.18: coverage — V8 built-in, no instrumentation overhead; must match vitest version
- gray-matter 4.0 (existing): frontmatter parsing for fixed-role files — already used in MemoryService, no new code needed
- mustache 4.2 (existing): template rendering — Mustache.render() already handles SOUL.md/AGENTS.md as templates

`pool: "forks"` is required in vitest config — Koishi services use module-level state and `vmThreads` (default) causes cross-test pollution.

### Expected Features

**Must have (table stakes):**
- Injection point merge 6→4 (`identity+style→soul`, `control_flow+basic_functions→instructions`) — foundational; everything else depends on it
- SOUL.md/AGENTS.md/TOOLS.md fixed-role files loaded by MemoryService, routed to `soul`/`instructions` points — replaces 4 hardcoded default .md files
- Wrapper partial elimination — 5 structurally identical `.mustache` partials replaced by inline XML tag generation in `render()`
- Memory block routing by frontmatter label — `routeBlock()` in MemoryService; per-block injections replace single `core-memory` injection

**Should have (differentiators):**
- SOUL.md as Mustache template — fixed-role files can reference `{{bot.name}}`, `{{date.now}}` etc.; zero extra work, pipeline already supports it
- Graceful fallback when fixed-role files absent — prevents blank system prompts on fresh installs
- Vitest coverage for PromptService + MemoryService — injection point merge is a breaking internal change; tests catch regressions

**Defer (v2+):**
- Skill effects targeting `soul`/`instructions` points — nice-to-have, not blocking release
- USER.md per-user profile file — requires per-user persistence not yet built (L1/L2/L3 memory milestone)
- Dynamic SOUL.md per-channel — defeats fixed-role purpose; Skill effects handle per-context adjustments

### Architecture Approach

The refactor touches 5 source files and deletes 9 template files. The dependency graph is strictly linear at the top (`prompt/types.ts` first), then parallel (PromptService, MemoryService, ThinkActLoop can proceed independently after the type change). The key architectural decision is that MemoryService handles routing via `routeBlock(label)` — fixed-role files (SOUL.md etc.) are just memory blocks with special labels, not a separate loader class. PromptService handles built-in defaults (`__default_soul`, `__default_instructions`) registered in its constructor; MemoryService handles user-provided files.

**Major components:**
1. `prompt/types.ts` — defines `InjectionPoint` union; must change first; TypeScript errors guide all downstream fixes
2. `prompt/service.ts` — removes 5 partial entries from `partialMap`, adds inline XML wrap in `render()`, updates `CACHEABLE_POINTS`, registers 2 new default injections
3. `memory/service.ts` — adds `FIXED_ROUTES` map + `routeBlock()`, switches from 1 aggregate injection to N per-block injections, moves char limit enforcement to load time
4. `agent/loop.ts` — two string changes: `"style"→"soul"`, `"basic_functions"→"instructions"`
5. `resources/templates/` — add `default-soul.md` + `default-instructions.md`, delete 4 old defaults + 5 wrapper partials

### Critical Pitfalls

1. **Skill `point: "extra"` hardcode breaks silently** — `SkillRegistry.mergeEffects()` hardcodes `point: "extra"`. Update `InjectionPoint` type first; TypeScript errors will surface this. Add runtime throw in `PromptService.inject()` for unknown point names.
2. **Wrapper partial deletion orphans `{{> name }}` references** — Mustache silently renders missing partials as empty string. Delete partial files and update `system.mustache` in the same commit. Grep for `{{>` references before deleting any partial.
3. **`CACHEABLE_POINTS` set becomes stale after rename** — defined separately from `INJECTION_POINTS` with no cross-reference. Update atomically in the same commit as the type change.
4. **Memory block double-injection on name collision** — `PromptService.inject()` silently drops duplicate entry names. Use `"__memory_${filename}"` (not label) as entry name to guarantee uniqueness.
5. **Koishi service silent non-load in vitest** — missing `static inject` dependency causes plugin to never initialize; tests pass vacuously. Assert `expect(app['yesimbot.memory']).toBeDefined()` before every service test.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Injection Point Rename (6→4)
**Rationale:** Single blocking dependency for all other work. TypeScript type change surfaces every affected call site automatically.
**Delivers:** `InjectionPoint` type updated to `soul|instructions|memory|extra`; `INJECTION_POINTS`, `CACHEABLE_POINTS`, `partialMap` updated atomically; `loop.ts` call sites remapped.
**Addresses:** Injection point merge (table stakes), `CACHEABLE_POINTS` stale pitfall, skill hardcode pitfall
**Avoids:** Silent failures from stale point names — add runtime throw in `inject()` for unknown points in this phase

### Phase 2: Wrapper Partial Elimination
**Rationale:** Simplifies render path before adding new file loaders. Removes the dual-path conflict risk (partial vs inline XML).
**Delivers:** 5 wrapper partials deleted; `render()` generates XML tags inline; `system.mustache` updated to remove `{{> identity}}` etc. references.
**Addresses:** Wrapper partial elimination (table stakes)
**Avoids:** Orphaned `{{>` references — delete files and update mustache template atomically

### Phase 3: Fixed-Role File Loading (SOUL.md/AGENTS.md/TOOLS.md)
**Rationale:** Depends on Phase 1 (correct point names) and Phase 2 (no partial conflicts). MemoryService routing is straightforward once the type is correct.
**Delivers:** `routeBlock()` in MemoryService; per-block injections; `default-soul.md` + `default-instructions.md` replacing 4 old defaults; graceful fallback on missing files.
**Addresses:** Fixed-role files (table stakes), memory block routing (table stakes), graceful fallback (differentiator)
**Avoids:** Double-injection — use filename-based entry names; default file routing — register defaults in PromptService constructor, not via MemoryService

### Phase 4: Vitest Coverage
**Rationale:** Validates the refactor after all structural changes are complete. Pure functions (`condition.ts`, `renderer.ts`) are zero-mock test targets; service tests need mock setup patterns established first.
**Delivers:** vitest + @vitest/coverage-v8 installed; `core/vitest.config.ts` with `pool: "forks"`; tests for PromptService inject/render/dispose, MemoryService block loading + routing, fixed-role file loading.
**Addresses:** Vitest coverage (differentiator)
**Avoids:** Vacuous test passes — assert service instance defined before every service test

### Phase Ordering Rationale

- Phase 1 must be first: the `InjectionPoint` type is the single source of truth; TypeScript errors are the migration guide
- Phase 2 before Phase 3: eliminates the partial/inline dual-path conflict before new file loaders are added
- Phase 3 before Phase 4: tests validate the complete refactored state, not intermediate states
- Phases 2 and 3 could technically parallelize, but sequential is safer given the partial/routing interaction

### Research Flags

Phases with standard patterns (skip research-phase):
- **Phase 1:** Pure TypeScript type change + string updates — well-understood, no research needed
- **Phase 2:** String concatenation replacing Mustache partials — trivial, no research needed
- **Phase 3:** Extends existing MemoryService pattern — same gray-matter + fs.watch already in use
- **Phase 4:** vitest config pattern taken directly from openclaw reference — no research needed

No phases require `/gsd:research-phase`. All patterns are either already in the codebase or directly available from the openclaw reference project.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Direct npm registry verification; openclaw reference confirms vitest 4.0.18 |
| Features | HIGH | Direct codebase analysis + OpenClaw reverse-engineering; scope is tightly bounded |
| Architecture | HIGH | Direct source reading of all 5 affected files; build order verified against actual dependencies |
| Pitfalls | HIGH | All pitfalls identified from direct code analysis, not speculation |

**Overall confidence:** HIGH

### Gaps to Address

- `system.mustache` role after partial elimination: may become vestigial if `render()` fully owns section assembly. Clarify during Phase 2 whether to keep as passthrough or remove from render flow entirely.
- `trait-bound` lifecycle in `SkillRegistry`: typed but unimplemented. Not blocking v2.1 but should be resolved (implement or remove from union) before adding new skills that use this lifecycle.

## Sources

### Primary (HIGH confidence)
- Direct codebase: `core/src/services/prompt/service.ts`, `types.ts` — injection points, CACHEABLE_POINTS, partialMap, render()
- Direct codebase: `core/src/services/memory/service.ts` — block loading, injection registration, char limit
- Direct codebase: `core/src/services/agent/loop.ts` — injection call sites
- Direct codebase: `core/src/services/skill/service.ts`, `types.ts` — hardcoded point, LifecycleStrategy
- Direct codebase: `core/resources/templates/` — system.mustache, all partials, default .md files
- `references/openclaw/` — vitest config pattern, AGENTS.md example, package.json versions
- npm registry: vitest 4.0.18, @vitest/coverage-v8 4.0.18 confirmed latest stable 2026-02-23

### Secondary (MEDIUM confidence)
- `references/从OpenClaw看Agnet记忆范式.md` — OpenClaw paradigm analysis (SOUL/AGENTS/TOOLS/USER two-tier architecture)
- `.planning/PROJECT.md` — v2.1 milestone goals and key decisions table

---
*Research completed: 2026-02-23*
*Ready for roadmap: yes*
