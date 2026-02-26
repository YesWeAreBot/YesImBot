---
phase: 26-memory-cleanup
plan: "02"
subsystem: prompt
tags: [prompt-service, injection-points, mustache, templates, agent-loop]

requires:
  - phase: 26-memory-cleanup/26-01
    provides: MemoryService deleted — memory-block partial and injection point now dead code

provides:
  - InjectionPoint type without "memory" (soul | instructions | extra)
  - PromptService without memory-block partial registration
  - Agent loop dynamic content filter referencing only "extra" section
  - Templates directory containing only partials/horizon-view.mustache

affects: [prompt-service, agent-loop, horizon-service]

tech-stack:
  added: []
  patterns:
    - "Sentinel file for resourcesDir seeding uses partials/horizon-view.mustache"

key-files:
  created: []
  modified:
    - core/src/services/prompt/types.ts
    - core/src/services/prompt/service.ts
    - core/src/services/agent/loop.ts
  deleted:
    - core/resources/templates/core-memory.mustache
    - core/resources/templates/default-persona.md
    - core/resources/templates/partials/memory-block.mustache

key-decisions:
  - "Sentinel file for resourcesDir seeding changed from core-memory.mustache to partials/horizon-view.mustache since core-memory.mustache was deleted"

patterns-established: []

requirements-completed: [MEM-04]

duration: 2min
completed: "2026-02-26"
---

# Phase 26 Plan 02: Memory Cleanup — PromptService & Templates Summary

**Removed "memory" InjectionPoint, memory-block partial registration, and all three memory template files; agent loop now filters only on "extra" for dynamic content**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-02-26T03:26:01Z
- **Completed:** 2026-02-26T03:28:00Z
- **Tasks:** 2
- **Files modified:** 3 modified, 3 deleted

## Accomplishments

- Removed "memory" from InjectionPoint union type and INJECTION_POINTS array
- Cleaned PromptService constructor: single `registerPartial` call for horizon-view only, updated resourcesDir sentinel
- Updated agent loop to filter dynamic content sections on "extra" only
- Deleted core-memory.mustache, default-persona.md, and partials/memory-block.mustache

## Task Commits

1. **Task 1: Remove memory injection point and clean PromptService** - `d83514b` (refactor)
2. **Task 2: Delete memory template files** - `9003e28` (chore)

## Files Created/Modified

- `core/src/services/prompt/types.ts` - InjectionPoint is now `"soul" | "instructions" | "extra"`
- `core/src/services/prompt/service.ts` - Removed memory-block partial; updated sentinel to partials/horizon-view.mustache
- `core/src/services/agent/loop.ts` - Dynamic content filter now only checks `s.name === "extra"`
- `core/resources/templates/core-memory.mustache` - Deleted
- `core/resources/templates/default-persona.md` - Deleted
- `core/resources/templates/partials/memory-block.mustache` - Deleted

## Decisions Made

- Changed resourcesDir seeding sentinel from `core-memory.mustache` to `partials/horizon-view.mustache` — the old sentinel file was being deleted, so the check needed a file that will always be present in the builtin templates directory.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- PromptService is fully clean of memory-related code
- Templates directory contains only `partials/horizon-view.mustache`
- `yarn build` passes with no TypeScript errors
- Ready for any remaining Phase 26 cleanup tasks

---
*Phase: 26-memory-cleanup*
*Completed: 2026-02-26*
