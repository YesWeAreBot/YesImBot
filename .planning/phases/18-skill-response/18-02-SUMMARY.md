---
phase: 18-skill-response
plan: 02
subsystem: skill
tags: [skill-registry, koishi-service, lifecycle-management, effect-merging]

requires:
  - phase: 18-skill-response
    provides: SkillDefinition types, evaluateCondition, specificity, filterByConfidence, loadSkillsFromDir
  - phase: 17-trait-perception
    provides: TraitSignal interface in shared/types.ts
  - phase: 16-prompt-service
    provides: InjectionPoint type in prompt/types.ts
provides:
  - SkillRegistry Koishi Service with register/reload/resolve API
  - Per-channel sticky lifecycle tracking
  - Merged SkillEffect (prompt injections, style override, tool filter)
affects: [agent-loop-integration, skill-consumption-in-think-act-loop]

tech-stack:
  added: []
  patterns: [koishi-service-subclass, per-channel-state-map, specificity-based-style-resolution]

key-files:
  created:
    - core/src/services/skill/service.ts
  modified:
    - core/src/services/skill/index.ts
    - core/src/index.ts

key-decisions:
  - "SkillRegistry uses static inject for yesimbot.trait dependency"
  - "Style resolution picks highest specificity; on tie, later registration wins (>=)"
  - "Sticky skills track roundsSinceActive per-channel, deactivate when >= timeout"

patterns-established:
  - "Per-channel state map pattern: Map<channelKey, Map<skillName, ActiveSkillState>>"
  - "Merged effect pattern: additive prompts, max-specificity style, union include/exclude tools"

requirements-completed: [SKILL-02, SKILL-04]

duration: 2min
completed: 2026-02-22
---

# Phase 18 Plan 02: SkillRegistry Service Summary

**SkillRegistry Koishi Service with register/reload/resolve API, per-channel sticky lifecycle, and specificity-based effect merging**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-22T15:53:19Z
- **Completed:** 2026-02-22T15:55:29Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- SkillRegistry Koishi Service accessible as ctx['yesimbot.skill']
- register() API with auto-dispose via Koishi context lifecycle
- resolve() evaluates activation conditions, manages sticky/per-turn/trait-bound lifecycle per-channel
- Merged SkillEffect with additive prompt injections, specificity-based style, include/exclude tool filter
- reload() refreshes file-based skills without affecting plugin-registered ones
- Wired into core index.ts with config schema and waitForServiceReady

## Task Commits

1. **Task 1: SkillRegistry service** - `964e855` (feat)
2. **Task 2: Wire SkillRegistry into core plugin** - `e0a1517` (feat)

## Files Created/Modified
- `core/src/services/skill/service.ts` - SkillRegistry Service with register/reload/resolve, lifecycle management, effect merging
- `core/src/services/skill/index.ts` - Added SkillRegistry exports to barrel
- `core/src/index.ts` - Wired SkillRegistry into core plugin with config schema

## Decisions Made
- SkillRegistry declares `static inject = ["yesimbot.trait"]` for service dependency ordering
- Style specificity uses `>=` comparison so later registrations win ties (registration order tiebreaker)
- builtinSkillsDir uses same `__dirname` resolution pattern as PromptService's builtinResourcesDir

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SkillRegistry fully operational, ready for consumption in agent loop
- resolve() returns SkillEffect that can drive prompt injection, style override, and tool filtering
- No blockers identified

## Self-Check: PASSED

- All 1 created files verified on disk
- Commits 964e855 and e0a1517 verified in git log

---
*Phase: 18-skill-response*
*Completed: 2026-02-22*
