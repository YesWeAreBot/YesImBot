---
phase: 16-promptservice-redesign-horizonview
plan: 02
subsystem: prompt
tags: [mustache-partials, section-templates, structured-view, consumer-migration, prompt-pipeline]

requires:
  - phase: 16-01
    provides: "PromptService with inject(ctx, point, entry), Section[] render, registerPartial()"
provides:
  - "6 section partial templates with conditional rendering"
  - "StructuredHorizonView type and toStructured() method"
  - "Default identity/style injections in PromptService constructor"
  - "MemoryService migrated to ctx-bound inject() API"
  - "ThinkActLoop using renderToString() with structured environment scope"
affects: [agent-core, memory-service, horizon-view, trait-skill-system]

tech-stack:
  added: []
  patterns: [section-partial-composition, structured-view-to-scope-bridge, ctx-bound-injection-lifecycle]

key-files:
  created:
    - core/resources/templates/partials/identity.mustache
    - core/resources/templates/partials/style.mustache
    - core/resources/templates/partials/core-memories.mustache
    - core/resources/templates/partials/working-memory.mustache
    - core/resources/templates/partials/environment.mustache
    - core/resources/templates/partials/extra.mustache
  modified:
    - core/resources/templates/system.mustache
    - core/src/services/horizon/types.ts
    - core/src/services/horizon/service.ts
    - core/src/services/memory/service.ts
    - core/src/services/agent/loop.ts
    - core/src/services/prompt/service.ts

key-decisions:
  - "Environment data formatted in ThinkActLoop as text strings passed via render scope, not complex Mustache logic"
  - "Default identity injection includes how_you_work content (folded in, since only 6 injection points)"
  - "User message simplified to [triggerType] + payload content; full context now in system prompt environment section"

patterns-established:
  - "Section partial composition: system.mustache references {{>identity}} etc., each partial conditionally renders via has_X guard"
  - "Structured view bridge: ThinkActLoop formats toStructured() output into scope variables for partials"
  - "Default injections: PromptService constructor registers fallback identity/style via its own ctx"

requirements-completed: [PROMPT-05, HVIEW-01, HVIEW-02]

duration: 3min
completed: 2026-02-21
---

# Phase 16 Plan 02: Templates, HorizonView, and Consumer Migration Summary

**Section-based partial templates with StructuredHorizonView bridge, MemoryService ctx-bound injection, and ThinkActLoop renderToString() integration — full prompt pipeline end-to-end**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-21T09:21:54Z
- **Completed:** 2026-02-21T09:25:10Z
- **Tasks:** 2
- **Files modified:** 12 (6 created, 6 modified)

## Accomplishments
- Rewrote system.mustache as pure partial composition referencing 6 injection points
- Created 6 section partial templates with conditional has_X guards and triple-brace content rendering
- Added StructuredHorizonView type and toStructured() method to HorizonService
- Registered default identity/style injections and section partials in PromptService constructor
- Migrated MemoryService to new inject(ctx, "core_memories", entry) API with ctx-bound lifecycle
- Migrated ThinkActLoop to use renderToString() with structured environment data in render scope

## Task Commits

Each task was committed atomically:

1. **Task 1: Default Templates and HorizonView Structured Output** - `748b0fd` (feat)
2. **Task 2: Consumer Migration — MemoryService and ThinkActLoop** - `c95b0a8` (feat)

## Files Created/Modified
- `core/resources/templates/system.mustache` - Rewritten as partial composition (6 injection point references)
- `core/resources/templates/partials/identity.mustache` - Conditional identity section with XML tags
- `core/resources/templates/partials/style.mustache` - Conditional style section with XML tags
- `core/resources/templates/partials/core-memories.mustache` - Conditional core_memory section
- `core/resources/templates/partials/working-memory.mustache` - Conditional working_memory section
- `core/resources/templates/partials/environment.mustache` - Conditional environment section
- `core/resources/templates/partials/extra.mustache` - Freeform extra content (no wrapper tags)
- `core/src/services/horizon/types.ts` - Added StructuredHorizonView interface
- `core/src/services/horizon/service.ts` - Added toStructured() method
- `core/src/services/prompt/service.ts` - Registered partials and default injections in constructor
- `core/src/services/memory/service.ts` - Migrated to inject(ctx, point, entry) API
- `core/src/services/agent/loop.ts` - Uses renderToString() and toStructured() bridge

## Decisions Made
- Environment data formatted as text in ThinkActLoop rather than complex Mustache templates — keeps partials simple, formatting logic in TypeScript
- how_you_work content folded into default identity injection since there are only 6 injection points
- User message simplified to trigger type + content; full context (history, members, environment) now in system prompt

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing loadPartial import in prompt/service.ts**
- **Found during:** Task 1 (PromptService constructor partial registration)
- **Issue:** loadPartial was used but not imported — only loadTemplate was imported
- **Fix:** Added loadPartial to the import from ./loader
- **Files modified:** core/src/services/prompt/service.ts
- **Verification:** yarn typecheck passes
- **Committed in:** 748b0fd (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential fix for compilation. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Full prompt pipeline operational end-to-end
- Phase 16 complete — PromptService redesign + HorizonView structured output done
- Ready for Phase 17 (Trait + Skill system) which will use inject() API for dynamic prompt composition

## Self-Check: PASSED

All files verified present. All commit hashes verified in git log.

---
*Phase: 16-promptservice-redesign-horizonview*
*Completed: 2026-02-21*
