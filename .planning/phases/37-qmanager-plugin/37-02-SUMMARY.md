---
phase: 37-qmanager-plugin
plan: 02
subsystem: agent
tags: [moderation, tool-handler, safety-intercept, onebot]

requires:
  - phase: 37-qmanager-plugin
    provides: entities injection into ToolExecutionContext and qmanager Skill definition
  - phase: 36-interactions-plugin
    provides: OnebotPlugin base class with existing action handlers
provides:
  - delmsg batch message deletion via standard Koishi Bot API
  - ban/mute with duration conversion (seconds to ms) and lift-ban support
  - kick user removal with safety intercepts
  - getEntityRole helper for role-based safety checks
affects: [qmanager-tools, moderation, bot-safety]

tech-stack:
  added: []
  patterns: [safety-intercept-before-api-call, entity-role-lookup]

key-files:
  created: []
  modified:
    - core/src/services/plugin/builtin/onebot/index.ts

key-decisions:
  - "All three tools use requireBotRole('admin') activator, NOT requirePlatform('onebot') — standard Koishi Bot API is cross-platform"
  - "Safety intercept blocks bot self and admin/owner targets before any platform API call"
  - "channelId fallback to ctx.channelId for type safety (session.channelId can be undefined)"

patterns-established:
  - "Safety intercept pattern: check bot selfId + getEntityRole before destructive operations"
  - "Entity role lookup: getEntityRole helper extracts owner/admin from entities[].attributes.roles"

requirements-completed: [QMGR-01, QMGR-02, QMGR-03]

duration: 3min
completed: 2026-02-27
---

# Phase 37 Plan 02: QManager Tool Handlers Summary

**Three moderation @Action handlers (delmsg/ban/kick) with getEntityRole safety intercepts blocking bot-self and admin/owner targets**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-27T17:30:18Z
- **Completed:** 2026-02-27T17:33:03Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Added getEntityRole helper that looks up user roles from entities in ToolExecutionContext
- Implemented delmsg with batch delete (cap 10), short ID resolution, Chinese messages
- Implemented ban with seconds-to-ms conversion, duration 0 lifts ban, safety intercepts
- Implemented kick with safety intercepts blocking bot self and admin/owner targets
- All three tools hidden by default, gated by requireBotRole("admin")

## Task Commits

Each task was committed atomically:

1. **Task 1: Add getEntityRole helper and delmsg @Action handler** - `78ea07d` (feat)
2. **Task 2: Add ban and kick @Action handlers with safety intercepts** - `75afd7b` (feat)

## Files Created/Modified

- `core/src/services/plugin/builtin/onebot/index.ts` - Added getEntityRole helper, delmsg/ban/kick @Action handlers with safety intercepts

## Decisions Made

- All three tools use requireBotRole("admin"), NOT requirePlatform("onebot") — standard Koishi Bot API is cross-platform
- Safety intercept blocks bot self (selfId check) and admin/owner targets (getEntityRole check) before any platform API call
- channelId uses fallback `session.channelId ?? ctx.channelId` for type safety

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed channelId type narrowing in delmsg**

- **Found during:** Task 2 (typecheck verification)
- **Issue:** `session.channelId` typed as `string | undefined`, causing TS2345 when passed to `deleteMessage`
- **Fix:** Changed to `session.channelId ?? ctx.channelId` which is always `string`
- **Files modified:** core/src/services/plugin/builtin/onebot/index.ts
- **Verification:** `tsc --noEmit` passes cleanly
- **Committed in:** 75afd7b (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Type narrowing fix necessary for compilation. No scope creep.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All three QManager moderation tools complete (delmsg, ban, kick)
- Phase 37 fully complete — qmanager Skill + entity injection (Plan 01) + tool handlers (Plan 02)
- Ready for Phase 38 (Multimodal)

## Self-Check: PASSED

All files and commits verified:

- FOUND: core/src/services/plugin/builtin/onebot/index.ts
- FOUND: 78ea07d (Task 1 commit)
- FOUND: 75afd7b (Task 2 commit)
- FOUND: 37-02-SUMMARY.md

---

_Phase: 37-qmanager-plugin_
_Completed: 2026-02-27_
