---
phase: 34-environment-enrichment
plan: 01
subsystem: database, api
tags: [koishi, entity, identity, horizon, session]

requires:
  - phase: 33-element-formatter
    provides: ElementFormatterService pipeline, safe content formatting
provides:
  - EntityRecord with userId/username/nickname identity fields
  - SelfInfo with optional role field for bot permission level
  - DB schema columns for identity persistence
  - Enriched updateMemberInfo() populating identity from Koishi session
affects: [34-02, 35-skill-visibility, 36-interactions]

tech-stack:
  added: []
  patterns: [nickname-dedup-on-write]

key-files:
  created: []
  modified:
    - core/src/services/horizon/types.ts
    - core/src/services/horizon/service.ts
    - core/src/services/horizon/listener.ts

key-decisions:
  - "Use session.event.user?.name for username (not session.author.name which is merged GuildMember name)"
  - "Omit nickname when identical to username to reduce token noise in LLM context"
  - "Entity ID uses session.userId (stable platform account ID) instead of session.author.id"

patterns-established:
  - "nickname-dedup: store nickname as undefined when equal to username, reducing redundant data in LLM prompts"

requirements-completed: [ENV-01, ENV-02]

duration: 2min
completed: 2026-02-27
---

# Phase 34 Plan 01: Entity Identity Enrichment Summary

**Extended EntityRecord with stable userId/username/nickname fields, enriched listener to populate from Koishi session data**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-27T13:37:37Z
- **Completed:** 2026-02-27T13:40:20Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- EntityRecord and Entity interfaces extended with userId, username, nickname identity fields
- SelfInfo extended with optional role field for bot permission level
- DB schema updated with three new columns (additive, no migration needed)
- updateMemberInfo() now extracts identity from correct Koishi session fields
- senderId consistently uses session.userId across recordMessage and horizon/message emit

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend EntityRecord and SelfInfo types, add DB schema columns** - `8674d47` (feat)
2. **Task 2: Enrich updateMemberInfo() with userId, username, nickname from session** - `3bd6506` (feat)

## Files Created/Modified

- `core/src/services/horizon/types.ts` - Added userId/username/nickname to EntityRecord and Entity, role to SelfInfo
- `core/src/services/horizon/service.ts` - Added DB columns, updated getEntities() mapping
- `core/src/services/horizon/listener.ts` - Enriched updateMemberInfo(), consistent senderId

## Decisions Made

- Used `session.event.user?.name` for username instead of `session.author.name` (the latter is merged GuildMember.name which overrides User.name)
- Nickname omitted (undefined) when identical to username to reduce token noise in LLM context
- Entity primary key switched from `session.author.id` to `session.userId` for stable platform account ID

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Identity fields are persisted and available via getEntities()
- Plan 02 can now render `<member>` tags using userId/username/nickname from Entity data
- SelfInfo.role ready for bot permission display in environment context

## Self-Check: PASSED

All files exist, all commits verified.

---

_Phase: 34-environment-enrichment_
_Completed: 2026-02-27_
