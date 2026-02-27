---
phase: 37-qmanager-plugin
plan: 01
subsystem: agent
tags: [skill, moderation, entities, tool-context]

requires:
  - phase: 36-interactions-plugin
    provides: OneBot action handlers and plugin pattern
  - phase: 35-skill-tool-wiring
    provides: Skill resolution pipeline and tool filtering
provides:
  - entities injected into ToolExecutionContext for role-based safety intercepts
  - qmanager Skill definition gating moderation tools on bot admin role
affects: [37-02, qmanager-tools, moderation]

tech-stack:
  added: []
  patterns: [entity-passthrough-to-tool-context]

key-files:
  created:
    - core/resources/skills/qmanager/SKILL.md
  modified:
    - core/src/services/agent/loop.ts

key-decisions:
  - "Entities passed as-is from view.entities — no filtering or transformation needed"

patterns-established:
  - "Entity passthrough: view.entities injected into toolCtxWithPercept for tool handlers to consume"

requirements-completed: [QMGR-04, QMGR-05]

duration: 1min
completed: 2026-02-27
---

# Phase 37 Plan 01: Entities Injection & QManager Skill Summary

**Injected view.entities into ToolExecutionContext and created qmanager SKILL.md with trait-bound bot-role gating for delmsg/ban/kick tools**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-27T17:25:48Z
- **Completed:** 2026-02-27T17:27:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Extended toolCtxWithPercept with entities array so tool handlers can look up target user roles
- Created qmanager Skill with and(group-chat, or(admin, owner)) conditions and trait-bound lifecycle
- TypeScript typecheck passes cleanly

## Task Commits

Each task was committed atomically:

1. **Task 1: Inject view.entities into ToolExecutionContext** - `ae3be7e` (feat)
2. **Task 2: Create qmanager SKILL.md with bot-role gating** - `4b179ce` (feat)

## Files Created/Modified

- `core/src/services/agent/loop.ts` - Added entities: view.entities to toolCtxWithPercept spread
- `core/resources/skills/qmanager/SKILL.md` - Skill definition with bot-role gating, Chinese description

## Decisions Made

- Entities passed as-is from view.entities — the index signature on ToolExecutionContext already supports arbitrary keys, no type changes needed

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- entities available in ToolExecutionContext for Plan 02's safety intercept (getEntityRole helper)
- qmanager Skill will activate delmsg/ban/kick tools when bot has admin/owner role in group chat
- Ready for Plan 02: QManager tool handler implementations

## Self-Check: PASSED

All files and commits verified:

- FOUND: core/resources/skills/qmanager/SKILL.md
- FOUND: core/src/services/agent/loop.ts
- FOUND: ae3be7e (Task 1 commit)
- FOUND: 4b179ce (Task 2 commit)
- FOUND: 37-01-SUMMARY.md

---

_Phase: 37-qmanager-plugin_
_Completed: 2026-02-27_
