---
phase: 27-scope-deletion-module-migration
plan: 01
subsystem: types
tags: [typescript, types, horizon, scope, channelkey, migration]

requires:
  - phase: 26-memory-cleanup
    provides: cleaned PromptService and memory templates

provides:
  - ChannelKey type alias in shared/types.ts
  - Scope interface deleted from codebase
  - Percept with bare platform/channelId fields
  - Horizon types (HorizonMessageEvent, BaseTimelineEntry, EventQueryOptions) migrated
  - Horizon manager/listener/service using ChannelKey with DB bridge pattern

affects:
  - 27-02 (agent/trait/skill/plugin files that still reference Scope)
  - 28-scope-db-migration (CTX-08 will remove scope JSON column)

tech-stack:
  added: []
  patterns:
    - "DB bridge pattern: TS types use bare fields, DB writes scope JSON column with as unknown as cast"
    - "ChannelKey = { platform: string; channelId: string } — minimal required identity"

key-files:
  created: []
  modified:
    - core/src/services/shared/types.ts
    - core/src/services/horizon/types.ts
    - core/src/services/horizon/manager.ts
    - core/src/services/horizon/listener.ts
    - core/src/services/horizon/service.ts

key-decisions:
  - "ChannelKey is a type alias (not interface) with required non-optional fields — stricter than Scope"
  - "DB bridge: scope JSON column preserved until Phase 28 (CTX-08), bridged via as unknown as casts"
  - "isDirect/guildId/userId moved to Session parameter in service.ts — not part of channel identity"
  - "EventQueryOptions uses key?: ChannelKey (renamed from scope) to avoid confusion with DB column"

patterns-established:
  - "Phase 28 bridge comment: // Phase 28 (CTX-08) will migrate DB column — marks all temporary casts"

requirements-completed: [CTX-01, CTX-02, CTX-06]

duration: 5min
completed: 2026-02-26
---

# Phase 27 Plan 01: Scope Deletion and Horizon Migration Summary

**Deleted Scope interface, introduced ChannelKey type alias, and migrated all 5 Horizon module files to bare platform/channelId fields with a DB bridge pattern for the still-unchanged scope JSON column.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-02-26T05:19:51Z
- **Completed:** 2026-02-26T05:24:40Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Scope interface deleted; ChannelKey = { platform: string; channelId: string } established
- Percept, HorizonMessageEvent, BaseTimelineEntry all use bare platform/channelId fields
- EventQueryOptions renamed scope to key (ChannelKey) to avoid DB column confusion
- manager.ts bridges DB scope JSON column with Phase 28 cast comments throughout
- service.ts sources isDirect/guildId/userId from Session parameter instead of Scope

## Task Commits

1. **Task 1: Replace Scope with ChannelKey in shared and horizon types** - `199c8b6` (feat)
2. **Task 2: Migrate Horizon manager, listener, service to ChannelKey** - `e62d764` (feat)

## Files Created/Modified
- `core/src/services/shared/types.ts` - Scope deleted, ChannelKey added, Percept updated
- `core/src/services/horizon/types.ts` - HorizonMessageEvent, BaseTimelineEntry, EventQueryOptions updated
- `core/src/services/horizon/manager.ts` - All method signatures use ChannelKey, DB bridge casts
- `core/src/services/horizon/listener.ts` - Emits bare platform/channelId in horizon/message event
- `core/src/services/horizon/service.ts` - buildView/getOrCreateEnvironment/getEntities use ChannelKey

## Decisions Made
- ChannelKey is a type alias with required (non-optional) fields — stricter than Scope's optional fields
- DB bridge pattern: TypeScript types have bare fields, but DB writes still use `scope: { platform, channelId }` via `as unknown as` casts, with `// Phase 28 (CTX-08)` comments marking each bridge point
- isDirect, guildId, userId removed from channel identity — they belong to Session context, not the channel key

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript error in service.ts DB schema definition**
- **Found during:** Task 2 (service.ts migration)
- **Issue:** `ctx.model.extend("yesimbot.timeline", { scope: "json", ... })` caused TS2353 because TimelineEntry no longer has a `scope` field after the type migration
- **Fix:** Added `as Record<string, unknown> as never` cast on the schema object to bridge the DB schema definition with the updated TypeScript type
- **Files modified:** core/src/services/horizon/service.ts
- **Verification:** `npx tsc --noEmit` shows no errors in horizon/service.ts
- **Committed in:** e62d764 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug)
**Impact on plan:** Necessary to keep the DB schema definition compiling while the TypeScript type has moved ahead of the DB schema. No scope creep.

## Issues Encountered
None beyond the auto-fixed schema cast above.

## Next Phase Readiness
- Horizon module fully migrated to ChannelKey
- Downstream files (agent/loop.ts, agent/service.ts, trait, skill, plugin) still reference Scope — Plan 02 handles those
- DB scope JSON column unchanged — Phase 28 (CTX-08) will migrate to bare columns

---
*Phase: 27-scope-deletion-module-migration*
*Completed: 2026-02-26*
