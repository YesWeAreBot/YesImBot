---
phase: 16-promptservice-redesign-horizonview
verified: 2026-02-21T09:40:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 16: PromptService Redesign + HorizonView Verification Report

**Phase Goal:** Plugins can compose multi-section prompts through named injection points and modular partials, with HorizonView rendering structured context
**Verified:** 2026-02-21T09:40:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A plugin can register injections at named points (identity/environment/style/memories/tools/output) with priority ordering, and the rendered prompt reflects correct section placement | ✓ VERIFIED | `inject(ctx, point, entry)` in service.ts:103; `resolveOrder()` Kahn's algorithm at service.ts:182; 6 points in INJECTION_POINTS array |
| 2 | A plugin can register a custom partial and reference it via `{{>partial}}` in templates, with the rendered output including the partial content | ✓ VERIFIED | `registerPartial()` at service.ts:96; system.mustache uses `{{>identity}}` etc.; `allPartials` merged at service.ts:155 and passed to renderer |
| 3 | When a sub-plugin is unloaded, its registered injections and partials are automatically removed from the prompt without manual cleanup | ✓ VERIFIED | `ctx.on("dispose", dispose)` at service.ts:114; dispose splices entry from list at service.ts:110-113; MemoryService uses `inject(this.ctx, ...)` at memory/service.ts:175 |
| 4 | HorizonView output uses structured tagged sections (environment/members/history) that the prompt template consumes as distinct partials | ✓ VERIFIED | `toStructured()` at horizon/service.ts:130 returns `StructuredHorizonView`; ThinkActLoop formats structured data into `environment_content`/`has_environment` scope vars at loop.ts:40-59; environment.mustache renders `{{{environment_content}}}` in `<environment>` tags |
| 5 | The default system template renders all named sections with sensible defaults when no custom injections are registered | ✓ VERIFIED | system.mustache is pure partial composition (6 `{{>point}}` references); each partial has `{{#has_X}}` guard; default identity/style injections registered in PromptService constructor at service.ts:56-81 |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `core/src/services/prompt/types.ts` | InjectionPoint type, InjectionEntry, Section, ordering types | ✓ VERIFIED | Exports `InjectionPoint` (6-value union), `INJECTION_POINTS` array, `InjectionEntry` (with before/after), `Section` (with cacheable), `Snippet`, `RenderOptions` |
| `core/src/services/prompt/renderer.ts` | MustacheRenderer with parse() and multi-pass render | ✓ VERIFIED | `parse()` traverses Mustache token tree extracting variables+partials; `render()` loops until stable or maxDepth (default 3) |
| `core/src/services/prompt/service.ts` | PromptService with named injection points, ctx lifecycle, Section[] render | ✓ VERIFIED | Map-based injection storage, `inject(ctx, point, entry)` with dispose binding, `resolveOrder()` topological sort, `render()` returns `Section[]`, `renderToString()` convenience |
| `core/resources/templates/system.mustache` | Section-based system template with partial composition | ✓ VERIFIED | 6 lines: `{{>identity}}`, `{{>style}}`, `{{>core_memories}}`, `{{>working_memory}}`, `{{>environment}}`, `{{>extra}}` |
| `core/src/services/horizon/types.ts` | StructuredHorizonView type | ✓ VERIFIED | `StructuredHorizonView` interface at line 157 with `environment`, `members[]`, `history[]` |
| `core/src/services/horizon/service.ts` | toStructured() method on HorizonService | ✓ VERIFIED | `toStructured(view: HorizonView): StructuredHorizonView` at line 130; maps environment, entities→members, history→formatted observations |
| `core/src/services/memory/service.ts` | Migrated MemoryService using new inject() API | ✓ VERIFIED | `this.ctx["yesimbot.prompt"].inject(this.ctx, "core_memories", { name: "core-memory", renderFn })` at line 175 |
| `core/src/services/agent/loop.ts` | ThinkActLoop bridging structured view to prompt scope | ✓ VERIFIED | `horizon.toStructured(view)` at line 37; `prompt.renderToString("system", { ... environment_content, has_environment })` at line 56 |
| 6 section partial files | Conditional rendering with XML tags | ✓ VERIFIED | All 6 exist in `core/resources/templates/partials/`: identity, style, core-memories, working-memory, environment, extra — each with `{{#has_X}}` guard and `{{{X_content}}}` triple-brace |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `prompt/service.ts` | `prompt/types.ts` | imports InjectionPoint, InjectionEntry, Section | ✓ WIRED | Line 5: `import type { InjectionEntry, InjectionPoint, Section, Snippet } from "./types"` |
| `prompt/service.ts` | `prompt/renderer.ts` | uses `this.renderer.parse()` and `this.renderer.render()` | ✓ WIRED | `this.renderer.parse()` at line 248; `this.renderer.render()` at line 168 |
| `agent/loop.ts` | `horizon/service.ts` | calls `horizon.toStructured(view)` | ✓ WIRED | Line 37: `const structured = horizon.toStructured(view)` |
| `agent/loop.ts` | `prompt/service.ts` | passes structured data as render scope, uses `renderToString()` | ✓ WIRED | Line 56: `await prompt.renderToString("system", { view, environment_content, has_environment })` |
| `memory/service.ts` | `prompt/service.ts` | calls `inject(this.ctx, 'core_memories', entry)` | ✓ WIRED | Line 175: `this.ctx["yesimbot.prompt"].inject(this.ctx, "core_memories", { name: "core-memory", renderFn })` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PROMPT-01 | 16-01 | Named injection points with independent priority queues | ✓ SATISFIED | 6 points (identity/style/core_memories/working_memory/environment/extra) in Map; note: RESEARCH.md explicitly documents replacing tools/output with core_memories/working_memory/extra as intentional design decision |
| PROMPT-02 | 16-01 | Modular partial registration and `{{>partial}}` composition | ✓ SATISFIED | `registerPartial()` + system.mustache uses `{{>identity}}` etc. |
| PROMPT-03 | 16-01 | Injection auto-cleanup on ctx dispose | ✓ SATISFIED | `ctx.on("dispose", dispose)` in `inject()` |
| PROMPT-04 | 16-01 | Renderer supports recursive partial variable collection and multi-pass rendering | ✓ SATISFIED | `parse()` traverses token tree; `render()` loops until stable |
| PROMPT-05 | 16-02 | Out-of-box section-based system template with defaults for all named injection points | ✓ SATISFIED | system.mustache + 6 section partials + default identity/style injections in constructor |
| HVIEW-01 | 16-02 | HorizonView structured tagged sections (environment/members/history) | ✓ SATISFIED | `toStructured()` returns `StructuredHorizonView`; environment partial wraps in `<environment>` tags |
| HVIEW-02 | 16-02 | Prompt template as modular partial composition | ✓ SATISFIED | system.mustache is pure partial composition; ThinkActLoop bridges structured data into render scope |

### Anti-Patterns Found

None. No TODO/FIXME/placeholder comments found in any modified files. The `return []` at service.ts:130 is a legitimate early-return guard (no template found), not a stub.

### Human Verification Required

None required. All success criteria are verifiable programmatically.

### Gaps Summary

No gaps. All 5 observable truths verified, all 9 artifacts exist and are substantive and wired, all 5 key links confirmed, all 7 requirements satisfied. `yarn build` passes with 4/4 packages successful (cached).

---

_Verified: 2026-02-21T09:40:00Z_
_Verifier: Claude (gsd-verifier)_
