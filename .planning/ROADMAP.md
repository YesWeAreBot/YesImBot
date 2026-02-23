# Roadmap: Athena (YesImBot v4)

## Milestones

- ✅ **v1.0 Foundation + Feature Parity** — Phases 1-15 (shipped 2026-02-21)
- ✅ **v2.0 Context-Aware Architecture** — Phases 16-19 (shipped 2026-02-23)
- 🚧 **v2.1 Polish & Release Prep** — Phases 20-23 (in progress)

## Phases

<details>
<summary>✅ v1.0 Foundation + Feature Parity (Phases 1-15) — SHIPPED 2026-02-21</summary>

- [x] Phase 1: Foundation & Shared Model (2/2 plans) — completed 2026-02-17
- [x] Phase 2: Model Service & Providers (3/3 plans) — completed 2026-02-18
- [x] Phase 3: Horizon Context System (3/3 plans) — completed 2026-02-18
- [x] Phase 4: Prompt & Tool Services (2/2 plans) — completed 2026-02-18
- [x] Phase 5: Agent Core & Integration (2/2 plans) — completed 2026-02-18
- [x] Phase 6: Willingness & Polish (2/2 plans) — completed 2026-02-18
- [x] Phase 7: Core Wiring Fixes (1/1 plan) — completed 2026-02-19
- [x] Phase 8: Stream Support & Dead Code Cleanup (2/2 plans) — completed 2026-02-19
- [x] Phase 9: Dynamic Schema Linkage (2/2 plans) — completed 2026-02-19
- [x] Phase 10: Willingness System Migration (2/2 plans) — completed 2026-02-19
- [x] Phase 11: Horizon Context Filling (1/1 plan) — completed 2026-02-20
- [x] Phase 12: Memory & Prompt Snippets (2/2 plans) — completed 2026-02-20
- [x] Phase 13: Non-stream Path & Fallback Wiring (2/2 plans) — completed 2026-02-20
- [x] Phase 14: Provider Pattern Cleanup & PLATFORM-01 (1/1 plan) — completed 2026-02-20
- [x] Phase 15: LLM Deferred Judgment & Config (2/2 plans) — completed 2026-02-20

</details>

<details>
<summary>✅ v2.0 Context-Aware Architecture (Phases 16-19) — SHIPPED 2026-02-23</summary>

- [x] Phase 16: PromptService Redesign + HorizonView (2/2 plans) — completed 2026-02-21
- [x] Phase 16.1: Percept Ownership & User Message Context (2/2 plans) — completed 2026-02-21
- [x] Phase 16.2: Percept Type Cleanup & Session Decoupling (2/2 plans) — completed 2026-02-21
- [x] Phase 16.3: Tool Call Improve (2/2 plans) — completed 2026-02-22
- [x] Phase 16.4: Working Memory Improve (2/2 plans) — completed 2026-02-22
- [x] Phase 17: Trait Perception (2/2 plans) — completed 2026-02-22
- [x] Phase 18: Skill Response (2/2 plans) — completed 2026-02-22
- [x] Phase 19: Integration & Validation (2/2 plans) — completed 2026-02-22

</details>

### 🚧 v2.1 Polish & Release Prep (In Progress)

**Milestone Goal:** Adopt OpenClaw memory paradigm, simplify prompt injection (6->4 points), fix tech debt, establish test coverage for core services.

- [x] **Phase 20: Injection Point Merge & Wrapper Elimination** - Consolidate 6 injection points to 4, replace wrapper partials with inline XML generation (completed 2026-02-23)
- [ ] **Phase 21: Fixed-Role File Loading** - SOUL.md/AGENTS.md/TOOLS.md replace legacy default files, with Mustache templating and hot-reload
- [ ] **Phase 22: Skill Enhancement & Tech Debt** - Skill effects target any injection point, resolve trait-bound lifecycle and type export debt
- [ ] **Phase 23: Test Infrastructure** - Vitest setup and unit tests for PromptService, MemoryService, SkillRegistry

## Phase Details

### Phase 20: Injection Point Merge & Wrapper Elimination
**Goal**: Prompt system uses 4 clean injection points (soul/instructions/memory/extra) with inline XML tag generation, no wrapper partials
**Depends on**: Phase 19
**Requirements**: PROMPT-01, PROMPT-02, PROMPT-03, PROMPT-04
**Success Criteria** (what must be TRUE):
  1. InjectionPoint type is `soul | instructions | memory | extra` and all call sites (loop.ts, SkillRegistry, PromptService) compile without error
  2. PromptService.render() generates XML section tags inline — no wrapper .mustache partials exist in resources/templates/
  3. system.mustache references only the 4 new injection points with no orphaned `{{> identity}}` or similar partial calls
  4. PromptService.inject() throws at runtime for unrecognized injection point names (guards against silent failures)
**Plans**: 2 plans
Plans:
- [x] 20-01-PLAN.md — Merge InjectionPoint type (6->4), update CACHEABLE_POINTS, add inject() guard, migrate loop.ts call sites
- [x] 20-02-PLAN.md — Rewrite render() for inline XML generation, clean constructor, delete 11 obsolete template/default files

### Phase 21: Fixed-Role File Loading
**Goal**: Bot personality and behavior instructions are defined in SOUL.md/AGENTS.md/TOOLS.md files that replace legacy defaults, with template variable support and graceful fallback
**Depends on**: Phase 20
**Requirements**: ROLE-01, ROLE-02, ROLE-03, ROLE-04, ROLE-05, ROLE-06, ROLE-07
**Success Criteria** (what must be TRUE):
  1. SOUL.md content is injected at the `soul` point, replacing default-identity.md + default-style.md + default persona.md
  2. AGENTS.md content is injected at the `instructions` point, replacing default-control-flow.md + default-basic-functions.md
  3. TOOLS.md is optional — present: injected at `instructions` point; absent: silently skipped, no error
  4. Fixed-role files support Mustache variables (e.g. `{{bot.name}}` renders the bot's configured name)
  5. Editing a fixed-role file on disk triggers hot-reload within the same debounce window as existing memory blocks
**Plans**: TBD

### Phase 22: Skill Enhancement & Tech Debt
**Goal**: Skills can inject prompt content at any of the 4 injection points, and v2.0 tech debt items are resolved
**Depends on**: Phase 20
**Requirements**: SKILL-01, SKILL-02, DEBT-01, DEBT-02
**Success Criteria** (what must be TRUE):
  1. A Skill definition file can specify `injection_point: "soul"` (or instructions/memory/extra) and the effect lands at that point during prompt assembly
  2. SkillRegistry.mergeEffects() reads the injection point from skill definition instead of hardcoding `"extra"`
  3. TraitAnalyzerConfig is a type-only export (no runtime value leak)
  4. trait-bound skills persist across turns until their trait deactivates, distinguishable from per-turn skills at runtime in SkillRegistry.resolve()
**Plans**: TBD

### Phase 23: Test Infrastructure
**Goal**: Core services have unit test coverage via vitest, catching regressions from the v2.1 refactor
**Depends on**: Phase 20, Phase 21, Phase 22
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04
**Success Criteria** (what must be TRUE):
  1. `yarn test` runs vitest with pool:forks mode, integrated into turbo pipeline, and exits cleanly on a fresh clone
  2. MemoryService tests verify block loading from disk, frontmatter parsing, injection registration, and character limit enforcement
  3. SkillRegistry tests verify condition tree activation, effect merging across skills, and sticky vs trait-bound lifecycle differentiation
  4. PromptService tests verify inject/render/dispose lifecycle, injection point ordering, and XML tag generation for all 4 points
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 20 -> 21 -> 22 -> 23
(Phases 21 and 22 both depend on 20 but are independent of each other; Phase 23 depends on all three.)

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-15 | v1.0 | 29/29 | Complete | 2026-02-21 |
| 16-19 | v2.0 | 16/16 | Complete | 2026-02-23 |
| 20. Injection Point Merge & Wrapper Elimination | 2/2 | Complete   | 2026-02-23 | - |
| 21. Fixed-Role File Loading | v2.1 | 0/? | Not started | - |
| 22. Skill Enhancement & Tech Debt | v2.1 | 0/? | Not started | - |
| 23. Test Infrastructure | v2.1 | 0/? | Not started | - |
