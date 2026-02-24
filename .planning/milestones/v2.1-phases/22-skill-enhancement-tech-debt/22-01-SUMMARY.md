---
phase: 22-skill-enhancement-tech-debt
plan: 01
subsystem: skill
tags: [injection-point, prompt-routing, specificity-sort, skill-system]

requires:
  - phase: 18-skill-system
    provides: SkillRegistry, SkillDefinition, mergeEffects, loader, condition evaluator
provides:
  - Configurable injection point per skill (soul/instructions/memory/extra)
  - Style injection point routing through SkillEffect to loop
  - Specificity-based ordering for prompt injections
affects: [22-02, prompt-assembly, skill-authoring]

tech-stack:
  added: []
  patterns: [configurable-injection-point, specificity-sorted-merge]

key-files:
  created: []
  modified:
    - core/src/services/skill/types.ts
    - core/src/services/skill/loader.ts
    - core/src/services/skill/service.ts
    - core/src/services/agent/loop.ts

key-decisions:
  - "injectionPoint defaults to 'extra', styleInjectionPoint defaults to 'soul' — backward compatible"
  - "Sort active skills by specificity descending before prompt injection concatenation"
  - "Only set after: '__role_soul' when style target point is 'soul'; omit for other points"

patterns-established:
  - "validateInjectionPoint: reusable frontmatter field validator against INJECTION_POINTS array"
  - "Configurable injection routing: skill.injectionPoint ?? default in mergeEffects"

requirements-completed: [SKILL-01, SKILL-02]

duration: 3min
completed: 2026-02-24
---

# Phase 22 Plan 01: Skill Injection Point Routing Summary

**Configurable per-skill injection point routing with specificity-based ordering and style point propagation through to loop**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-24T09:33:39Z
- **Completed:** 2026-02-24T09:37:04Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- SkillDefinition now supports injectionPoint and styleInjectionPoint optional fields
- Loader validates injection_point/style_injection_point from SKILL.md frontmatter with graceful fallback
- mergeEffects sorts active skills by specificity descending and uses configurable injection points
- Loop reads styleOverride.point instead of hardcoding "soul"

## Task Commits

1. **Task 1: Add injection point fields to types and update loader parsing** - `3e7bc71` (feat)
2. **Task 2: Update mergeEffects for configurable injection and fix loop style routing** - `aa4b8b0` (feat)

## Files Created/Modified
- `core/src/services/skill/types.ts` - Added injectionPoint/styleInjectionPoint to SkillDefinition, point to styleOverride
- `core/src/services/skill/loader.ts` - Added validateInjectionPoint helper, parse both fields from frontmatter
- `core/src/services/skill/service.ts` - Sort by specificity, use skill.injectionPoint, propagate styleInjectionPoint
- `core/src/services/agent/loop.ts` - Read effects.styleOverride.point, conditional after anchor

## Decisions Made
- Defaults preserve backward compatibility: extra for prompt, soul for style
- Specificity sort applied before iteration (not post-collection per-point) for simplicity
- Style after anchor only set for soul point where __role_soul exists

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Injection point routing complete, ready for Plan 02 (trait-bound lifecycle + DEBT-01)
- Existing skills work without modification

---
*Phase: 22-skill-enhancement-tech-debt*
*Completed: 2026-02-24*

## Self-Check: PASSED
