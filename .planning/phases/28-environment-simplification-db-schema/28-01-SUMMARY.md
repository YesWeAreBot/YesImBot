---
phase: 28-environment-simplification-db-schema
plan: 01
subsystem: database
tags: [koishi, horizon, timeline, db-schema, scope-deletion]

# Dependency graph
requires:
  - phase: 27-scope-deletion
    provides: ChannelKey type alias with required platform/channelId fields; scope bridging casts in manager.ts
provides:
  - Environment interface with required platform/channelId, no metadata field
  - Timeline DB schema with platform/channelId string columns, no scope JSON column
  - manager.ts write/query sites using bare fields end-to-end
affects: [horizon, role-service, any code reading Environment.platform or Environment.channelId]

# Tech tracking
tech-stack:
  added: []
  patterns: [bare-field DB columns instead of JSON scope column, direct field access instead of metadata indirection]

key-files:
  created: []
  modified:
    - core/src/services/horizon/types.ts
    - core/src/services/horizon/service.ts
    - core/src/services/horizon/manager.ts
    - core/src/services/role/service.ts

key-decisions:
  - "Environment.platform and Environment.channelId are now required (non-optional) fields — callers must always provide both"
  - "Timeline DB schema migrated from scope:json to platform:string(64) + channelId:string(255) — bare columns end-to-end"
  - "role/service.ts channel.platform snippet updated as part of this plan (auto-fix, same change set)"

patterns-established:
  - "Environment fields: access env.platform and env.channelId directly, never via metadata indirection"
  - "Timeline queries: use bare platform/channelId fields in Query.Expr, not a scope object"

requirements-completed: [CTX-07, CTX-08]

# Metrics
duration: 3min
completed: 2026-02-26
---

# Phase 28 Plan 01: Environment Simplification and DB Schema Summary

**Scope→Environment indirection eliminated: Environment interface now has required platform/channelId fields, timeline DB uses bare string columns, all 5 manager.ts write/query sites use bare fields with no bridging casts.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-02-26T08:58:30Z
- **Completed:** 2026-02-26T09:01:21Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Environment interface cleaned up: `platform: string` and `channelId: string` required, `metadata` field removed
- Timeline DB schema migrated from `scope: "json"` to `platform: "string(64)"` + `channelId: "string(255)"`
- All 5 CTX-08 sites in manager.ts migrated to bare fields, bridging `as unknown as` casts removed from entry construction
- `formatHorizonText` reads `env.platform`/`env.channelId` directly at all 3 sites

## Task Commits

Each task was committed atomically:

1. **Task 1: Update Environment interface and service.ts (CTX-07 + schema)** - `887ab4d` (feat)
2. **Task 2: Migrate manager.ts write/query sites to bare fields (CTX-08)** - `5893b84` (feat)

## Files Created/Modified
- `core/src/services/horizon/types.ts` - Environment interface: platform/channelId required, metadata removed
- `core/src/services/horizon/service.ts` - DB schema with bare columns; getOrCreateEnvironment and formatHorizonText updated
- `core/src/services/horizon/manager.ts` - All 5 write/query sites migrated to bare fields, Phase 28 comments removed
- `core/src/services/role/service.ts` - channel.platform snippet reads env.platform directly (auto-fix)

## Decisions Made
- Environment.platform and Environment.channelId are now required fields — no optional chaining needed at call sites
- Timeline DB schema uses two independent string columns instead of a single JSON blob — enables indexed queries per field
- role/service.ts fix included in Task 1 commit as it was a direct consequence of the Environment interface change

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed role/service.ts reading removed metadata field**
- **Found during:** Task 1 (TypeScript check after types.ts + service.ts changes)
- **Issue:** `core/src/services/role/service.ts:80` read `view?.environment?.metadata?.platform` — metadata no longer exists on Environment
- **Fix:** Changed to `view?.environment?.platform ?? ""`
- **Files modified:** `core/src/services/role/service.ts`
- **Verification:** `npx tsc --noEmit -p core/tsconfig.json` passes with zero errors
- **Committed in:** `887ab4d` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug in dependent file)
**Impact on plan:** Necessary fix — role/service.ts directly consumed the removed metadata field. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 28 Plan 01 complete — Scope deletion is fully done across all files
- No remaining `scope` references in horizon module
- No remaining `Phase 28` annotations anywhere in the codebase
- Ready for Phase 28 Plan 02 if it exists, or Phase 28 is complete

---
*Phase: 28-environment-simplification-db-schema*
*Completed: 2026-02-26*
