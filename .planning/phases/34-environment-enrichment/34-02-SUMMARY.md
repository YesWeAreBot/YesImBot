---
phase: 34-environment-enrichment
plan: 02
subsystem: api, rendering
tags: [koishi, horizon, member-tags, short-id, bot-role, mustache]

requires:
  - phase: 34-environment-enrichment
    plan: 01
    provides: EntityRecord with userId/username/nickname identity fields, SelfInfo with role
provides:
  - Bot role cache with 10-minute TTL via getGuildMember()
  - Structured <member> tag rendering with id/name/role/self attributes
  - Bidirectional short-ID map with synced eviction
  - lookupPlatformId() for tool support (Phase 37 delmsg)
affects: [35-skill-visibility, 37-tool-actions]

tech-stack:
  added: []
  patterns: [member-tag-rendering, bidirectional-map-eviction]

key-files:
  created: []
  modified:
    - core/src/services/horizon/service.ts
    - core/resources/templates/partials/horizon-view.mustache

key-decisions:
  - "Bot role fetched via bot.getGuildMember with silent degradation on failure (null cached for TTL)"
  - "classifyRole maps owner/admin/administrator/moderator to two-tier role system"
  - "Bot self entity rendered first in member list with self=true attribute"
  - "Reverse short-ID map synced during eviction to prevent stale lookups"

patterns-established:
  - "member-tag-rendering: <member id='' name='' role='' self='' /> XML tags for structured identity in LLM context"
  - "bidirectional-map-eviction: forward and reverse maps evicted in lockstep"

requirements-completed: [ENV-03, ENV-04]

duration: 3min
completed: 2026-02-27
---

# Phase 34 Plan 02: Member Tag Rendering & Reverse Short-ID Summary

**Structured <member> tag rendering with bot role cache, bidirectional short-ID lookup for tool support**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-27T13:44:15Z
- **Completed:** 2026-02-27T13:47:47Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Bot role cache with 10-minute TTL fetches permission level via getGuildMember()
- formatHorizonText renders structured <member> tags instead of comma-separated names
- Bidirectional short-ID map enables lookupPlatformId() for future tool support
- Mustache template uses triple-mustache for unescaped member tag output

## Task Commits

Each task was committed atomically:

1. **Task 1: Add bot role cache, member tag rendering, and update buildView** - `5a17b6b` (feat)
2. **Task 2: Add reverse short-ID map and update mustache template** - `b4c080a` (feat)

## Files Created/Modified

- `core/src/services/horizon/service.ts` - Bot role cache, classifyRole/getBotRole methods, <member> tag rendering, reverse short-ID map, lookupPlatformId()
- `core/resources/templates/partials/horizon-view.mustache` - Triple-mustache for activeMembers

## Decisions Made

- Bot role fetched via bot.getGuildMember() with try/catch silent degradation — null cached for TTL to avoid repeated failed calls
- classifyRole() maps owner/admin/administrator/moderator strings to two-tier "owner" | "admin" system
- Bot self entity always rendered first with self="true" so LLM knows its own identity
- Reverse short-ID map eviction synced with forward map to prevent stale lookups

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- <member> tags available in LLM working memory with structured identity info
- lookupPlatformId() ready for Phase 37 delmsg tool integration
- Bot role awareness enables permission-gated tool actions

## Self-Check: PASSED

All files exist, all commits verified.

---

_Phase: 34-environment-enrichment_
_Completed: 2026-02-27_
