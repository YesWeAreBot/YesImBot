---
phase: 16-promptservice-redesign-horizonview
plan: 01
subsystem: prompt
tags: [mustache, injection-points, topological-sort, koishi-service, prompt-composition]

requires: []
provides:
  - "PromptService with 6 named injection points and ctx-bound lifecycle"
  - "MustacheRenderer with parse() and multi-pass render"
  - "Section[] render output with cacheable flags"
  - "InjectionPoint, InjectionEntry, Section type exports"
affects: [16-02, agent-core, memory-service, horizon-view]

tech-stack:
  added: []
  patterns: [named-injection-points, before-after-chain-ordering, ctx-bound-lifecycle-cleanup, section-based-render]

key-files:
  created: []
  modified:
    - core/src/services/prompt/types.ts
    - core/src/services/prompt/renderer.ts
    - core/src/services/prompt/service.ts
    - core/src/services/prompt/index.ts

key-decisions:
  - "Kahn's algorithm for topological sort on before/after constraints with cycle fallback to registration order"
  - "Promise.allSettled with per-entry timeout for parallel injection rendering within each point"
  - "Cacheable flag: true for identity/style/core_memories, false for working_memory/environment/extra"
  - "Section rendering via individual partial templates per injection point, not post-hoc string splitting"

patterns-established:
  - "Named injection points: inject(ctx, point, entry) with auto-cleanup on ctx dispose"
  - "Section[] output: render() returns structured sections, renderToString() for backward compat"
  - "Multi-pass Mustache rendering: loop until output stabilizes or maxDepth reached"

requirements-completed: [PROMPT-01, PROMPT-02, PROMPT-03, PROMPT-04]

duration: 2min
completed: 2026-02-21
---

# Phase 16 Plan 01: PromptService Core Redesign Summary

**PromptService rewritten with 6 named injection points, ctx-bound lifecycle cleanup, before/after chain ordering via topological sort, and Section[] render output with MustacheRenderer parse() + multi-pass**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-21T09:16:39Z
- **Completed:** 2026-02-21T09:19:03Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Rewritten type system with InjectionPoint (6 named points), InjectionEntry (before/after ordering), Section (cacheable flag)
- MustacheRenderer enhanced with parse() for variable/partial extraction and multi-pass render loop
- PromptService rewritten with Map-based injection storage, ctx-bound inject() with auto-cleanup, topological sort ordering, Section[] render output, and registerPartial() for plugin overrides
- Updated index.ts exports for all new types

## Task Commits

Each task was committed atomically:

1. **Task 1: Types and Renderer Enhancement** - `f55a45d` (feat)
2. **Task 2: PromptService Rewrite with Named Injection Points** - `29727fc` (feat)

## Files Created/Modified
- `core/src/services/prompt/types.ts` - InjectionPoint, InjectionEntry, Section, INJECTION_POINTS exports; removed old Injection/IRenderer
- `core/src/services/prompt/renderer.ts` - MustacheRenderer with parse() and multi-pass render(); removed IRenderer impl
- `core/src/services/prompt/service.ts` - PromptService with 6 named injection points, ctx-bound inject(), topological sort, Section[] render, registerPartial()
- `core/src/services/prompt/index.ts` - Updated exports for new types and MustacheRenderer

## Decisions Made
- Used Kahn's algorithm for topological sort — simple, correct for small lists (1-3 entries per point)
- Promise.allSettled with per-entry timeout for injection rendering — failed/slow injections don't block others
- Cacheable defaults: identity/style/core_memories = true (stable), working_memory/environment/extra = false (per-request)
- Render sections individually per injection point partial rather than post-hoc string splitting

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- PromptService core API complete, ready for consumer migration in Plan 02
- Expected compilation errors in MemoryService (old inject() signature) and ThinkActLoop (render() now returns Section[] not string) — both addressed in Plan 02
- registerPartial() ready for default section partials (Plan 02 templates)

## Self-Check: PASSED

All files verified present. All commit hashes verified in git log.

---
*Phase: 16-promptservice-redesign-horizonview*
*Completed: 2026-02-21*
