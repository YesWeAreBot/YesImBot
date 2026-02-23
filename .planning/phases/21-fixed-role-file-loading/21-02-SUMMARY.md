---
phase: 21-fixed-role-file-loading
plan: 02
subsystem: prompt
tags: [mustache, fs-watch, service, role-files, hot-reload]

requires:
  - phase: 20-injection-point-merge-wrapper-elimination
    provides: "Empty soul/instructions injection points ready for content"
  - phase: 21-01
    provides: "Bundled default SOUL.md/AGENTS.md/TOOLS.md in core/resources/roles/"
provides:
  - "RoleService that loads, renders, and injects role file content into prompt injection points"
  - "Hot-reload of role files with 300ms debounce"
  - "First-launch seeding of default role files to user directory"
  - "Graceful Mustache error recovery with last-valid-content fallback"
affects: [prompt-rendering, skill-style-overrides, agent-loop]

tech-stack:
  added: []
  patterns: ["RoleService file-loading with Mustache rendering and fs.watch hot-reload"]

key-files:
  created:
    - core/src/services/role/types.ts
    - core/src/services/role/service.ts
    - core/src/services/role/index.ts
  modified:
    - core/src/index.ts
    - core/src/services/agent/loop.ts

key-decisions:
  - "Used Mustache.render() directly (same as MemoryService) rather than MustacheRenderer wrapper"
  - "Fixed loop.ts __default_soul -> __role_soul for skill style override ordering"

patterns-established:
  - "RoleService file-loading pattern: ensureFiles -> loadAndInject -> startWatching lifecycle"

requirements-completed: [ROLE-01, ROLE-02, ROLE-03, ROLE-05, ROLE-06, ROLE-07]

duration: 6min
completed: 2026-02-23
---

# Phase 21 Plan 02: RoleService Summary

**RoleService loads SOUL.md/AGENTS.md/TOOLS.md from disk, renders Mustache variables, injects into prompt injection points with fs.watch hot-reload**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-23T14:32:33Z
- **Completed:** 2026-02-23T14:38:58Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- RoleService module with file loading, Mustache rendering, and hot-reload
- Wired into plugin lifecycle with proper dependency ordering
- Fixed loop.ts skill style override to reference __role_soul instead of stale __default_soul

## Task Commits

Each task was committed atomically:

1. **Task 1: Create RoleService module** - `5ec8531` (feat)
2. **Task 2: Wire RoleService into plugin and fix loop.ts ordering** - `30504f4` (feat)

## Files Created/Modified
- `core/src/services/role/types.ts` - RoleServiceConfig interface and schema
- `core/src/services/role/service.ts` - RoleService with file loading, Mustache rendering, hot-reload, injection
- `core/src/services/role/index.ts` - Barrel exports
- `core/src/index.ts` - RoleService wired into plugin apply() and waitForServiceReady
- `core/src/services/agent/loop.ts` - Style override ordering fixed to __role_soul

## Decisions Made
- Used Mustache.render() directly (matching MemoryService pattern) rather than MustacheRenderer wrapper, since renderer is private on PromptService
- Fixed __default_soul -> __role_soul in loop.ts (Pitfall 1 from research)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Soul and instructions injection points now have content from role files
- Hot-reload enables live editing of role files without restart
- Skill style overrides correctly order after __role_soul

## Self-Check: PASSED

All files and commits verified.

---
*Phase: 21-fixed-role-file-loading*
*Completed: 2026-02-23*
