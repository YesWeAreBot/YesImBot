---
phase: 27-scope-deletion-module-migration
plan: 02
subsystem: types
tags: [typescript, types, trait, skill, scope, channelkey, migration]

requires:
  - phase: 27-01
    provides: ChannelKey type alias, Scope deleted, Horizon module migrated

provides:
  - TraitDetector.detect uses ChannelKey parameter
  - TraitAnalyzer.analyze uses ChannelKey parameter
  - HeatTrait and SceneTrait channelKey helpers accept ChannelKey
  - SceneTrait derives isDirect from view.environment.type
  - SkillRegistry.resolve uses ChannelKey parameter

affects:
  - 27-03 (agent/loop.ts callers of trait.analyze and skill.resolve)

tech-stack:
  added: []
  patterns:
    - "isDirect derivation: view.environment?.type === 'private' replaces scope.isDirect"
    - "ChannelKey satisfies bare event fields: HorizonMessageEvent has platform/channelId directly"

key-files:
  created: []
  modified:
    - core/src/services/trait/types.ts
    - core/src/services/trait/service.ts
    - core/src/services/trait/detectors/heat.ts
    - core/src/services/trait/detectors/scene.ts
    - core/src/services/skill/service.ts

key-decisions:
  - "isDirect derived from view.environment?.type === 'private' — Environment.type set by getOrCreateEnvironment in Plan 01"
  - "HorizonMessageEvent satisfies ChannelKey structurally — event passed directly to channelKey() helper"

patterns-established:
  - "Event handler pattern: channelKey(event) works because HorizonMessageEvent has bare platform/channelId fields"

requirements-completed: [CTX-03, CTX-04]

duration: 3min
completed: 2026-02-26
---

# Phase 27 Plan 02: Trait and Skill Module Migration Summary

**Trait detectors (heat, scene) and SkillRegistry migrated from Scope to ChannelKey; SceneTrait isDirect now derived from view.environment.type.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-02-26T05:27:39Z
- **Completed:** 2026-02-26T05:30:08Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- TraitDetector interface and TraitAnalyzer.analyze both use ChannelKey parameter
- HeatTrait and SceneTrait channelKey helpers accept ChannelKey; event handlers use bare event fields
- SceneTrait.detect derives isDirect from view.environment?.type === "private" instead of scope.isDirect
- SkillRegistry.resolve accepts ChannelKey instead of Scope

## Task Commits

1. **Task 1: Migrate Trait module to ChannelKey** - `cdc350d` (feat)
2. **Task 2: Migrate Skill module resolve method to ChannelKey** - `39a1655` (feat)

## Files Created/Modified
- `core/src/services/trait/types.ts` - TraitDetector.detect uses ChannelKey
- `core/src/services/trait/service.ts` - TraitAnalyzer.analyze uses ChannelKey
- `core/src/services/trait/detectors/heat.ts` - channelKey helper and detect use ChannelKey; event uses bare fields
- `core/src/services/trait/detectors/scene.ts` - channelKey helper, detect, isDirect derivation all updated
- `core/src/services/skill/service.ts` - resolve() uses ChannelKey

## Decisions Made
- isDirect derived from `view.environment?.type === "private"` — the Environment.type field is set correctly by `getOrCreateEnvironment` (Plan 01), so this is the canonical source of truth for private vs group context
- HorizonMessageEvent structurally satisfies ChannelKey (has bare platform/channelId fields), so `channelKey(event)` works without any adapter

## Deviations from Plan

None — plan executed exactly as written. Note: trait/types.ts, trait/service.ts, and trait/detectors/heat.ts were already partially migrated by a prior commit (e76ff01) that ran ahead of schedule; the remaining scene.ts changes and skill/service.ts were applied cleanly.

## Issues Encountered
None.

## Next Phase Readiness
- Trait and Skill modules fully migrated to ChannelKey
- Callers in agent/loop.ts still pass Scope to trait.analyze and skill.resolve — Plan 03 handles those
- TypeScript compiles clean with no errors

---
*Phase: 27-scope-deletion-module-migration*
*Completed: 2026-02-26*
