---
phase: 20-injection-point-merge-wrapper-elimination
plan: 01
subsystem: prompt
tags: [injection-points, type-safety, runtime-guard]

requires:
  - phase: none
    provides: existing 6-point injection system
provides:
  - "InjectionPoint type: soul | instructions | memory | extra"
  - "Runtime guard in inject() throwing on unrecognized points"
  - "CACHEABLE_POINTS derived from INJECTION_POINTS"
  - "All call sites migrated to new point names"
affects: [20-02, prompt-service, agent-loop]

tech-stack:
  added: []
  patterns: [derived-cacheable-set, runtime-injection-guard]

key-files:
  created: []
  modified:
    - core/src/services/prompt/types.ts
    - core/src/services/prompt/service.ts
    - core/src/services/agent/loop.ts

key-decisions:
  - "Removed old default injections (identity, control_flow, basic_functions, style) from constructor — Phase 21 fills content"
  - "Removed old partial registrations (identity, style, control_flow, basic_functions) from partialMap"

patterns-established:
  - "Derived CACHEABLE_POINTS: new Set<InjectionPoint>(INJECTION_POINTS) instead of hardcoded"
  - "Runtime guard pattern: check injections.get(point) before use, throw on undefined"

requirements-completed: [PROMPT-01, PROMPT-04]

duration: 2min
completed: 2026-02-23
---

# Phase 20 Plan 01: Injection Point Merge Summary

**InjectionPoint type merged from 6 to 4 (soul/instructions/memory/extra) with runtime guard and all call sites migrated**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-23T12:24:37Z
- **Completed:** 2026-02-23T12:26:50Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- InjectionPoint type changed to `soul | instructions | memory | extra` — compiler enforces across codebase
- CACHEABLE_POINTS derived from INJECTION_POINTS array (all 4 cacheable)
- inject() throws Error on unrecognized injection point names (runtime guard)
- loop.ts call sites migrated: style->soul, basic_functions->instructions

## Task Commits

Each task was committed atomically:

1. **Task 1: Merge InjectionPoint type and update CACHEABLE_POINTS** - `00ea9af` (feat)
2. **Task 2: Migrate loop.ts call sites to new injection point names** - `ac1331f` (feat)

## Files Created/Modified
- `core/src/services/prompt/types.ts` - New 4-point InjectionPoint type and INJECTION_POINTS array
- `core/src/services/prompt/service.ts` - Derived CACHEABLE_POINTS, runtime guard in inject(), removed old default injections and partials
- `core/src/services/agent/loop.ts` - Migrated style->soul and basic_functions->instructions call sites

## Decisions Made
- Removed old default injections from constructor (identity, control_flow, basic_functions, style) — these used old point names and per CONTEXT.md, Phase 21 fills content via SOUL.md/AGENTS.md
- Removed old partial registrations (identity, style, control_flow, basic_functions) from partialMap — wrapper partials will be deleted in Plan 02

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed old default injections and partial registrations from constructor**
- **Found during:** Task 1 (Merge InjectionPoint type)
- **Issue:** Constructor called inject() with old point names (identity, control_flow, basic_functions, style) causing compile errors in service.ts — plan expected errors only in loop.ts
- **Fix:** Removed 4 default inject() calls and 4 old partial registrations from constructor, per CONTEXT.md decision that old defaults are deleted
- **Files modified:** core/src/services/prompt/service.ts
- **Verification:** tsc --noEmit shows errors only in loop.ts after Task 1
- **Committed in:** 00ea9af (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to achieve clean compilation of service.ts. Aligned with CONTEXT.md locked decision.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- InjectionPoint type system is now enforced by compiler
- Ready for Plan 02: wrapper partial elimination and render() rewrite
- Old .mustache partials and default-*.md files still on disk (Plan 02 deletes them)

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 20-injection-point-merge-wrapper-elimination*
*Completed: 2026-02-23*
