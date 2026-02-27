---
phase: 35-skill-driven-tool-loading
plan: 01
subsystem: plugin
tags: [decorators, hidden-tools, builtin-plugins, tool-visibility]

requires:
  - phase: 34-environment-enrichment
    provides: stable plugin infrastructure with decorator-based tool registration
provides:
  - hidden flag in DecoratorOpts for @Tool/@Action decorators
  - hidden propagation from StaticEntry to FunctionDefinition in base-plugin
  - all non-send_message builtin tools marked hidden by default
affects: [35-02, 36-skill-conditions, 37-interactions-plugin]

tech-stack:
  added: []
  patterns: [hidden-by-default tool visibility]

key-files:
  created: []
  modified:
    - core/src/services/plugin/decorators.ts
    - core/src/services/plugin/base-plugin.ts
    - core/src/services/plugin/builtin/demo.ts
    - core/src/services/plugin/builtin/session-info.ts
    - core/src/services/plugin/builtin/onebot/index.ts

key-decisions:
  - "send_message stays visible by omitting hidden flag (falsy default = visible)"

patterns-established:
  - "hidden-by-default: all new builtin tools should set hidden: true unless they are always-visible like send_message"

requirements-completed: [TOOL-01, TOOL-03]

duration: 3min
completed: 2026-02-27
---

# Phase 35 Plan 01: Hidden Tool Infrastructure Summary

**Added hidden?: boolean to @Tool/@Action decorators and marked all non-send_message builtins hidden by default**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-27T14:48:09Z
- **Completed:** 2026-02-27T14:50:50Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- DecoratorOpts now supports hidden?: boolean, inherited by StaticEntry
- base-plugin.ts propagates hidden from StaticEntry to FunctionDefinition for both tools and actions
- All 4 non-send_message builtin tools (get_weather, web_search, get_session_info, get_forward_msg) marked hidden: true
- send_message remains always visible (no hidden flag)
- Existing getTools(includeHidden) and buildToolSchemaForPrompt(toolFilter) pipeline works end-to-end without changes

## Task Commits

Each task was committed atomically:

1. **Task 1: Add hidden to decorator infrastructure and propagate in base-plugin** - `95027a3` (feat)
2. **Task 2: Mark all non-send_message builtin tools as hidden** - `ce7fd40` (feat)

## Files Created/Modified

- `core/src/services/plugin/decorators.ts` - Added hidden?: boolean to DecoratorOpts interface
- `core/src/services/plugin/base-plugin.ts` - Propagate hidden: entry.hidden in both tools and actions loops
- `core/src/services/plugin/builtin/demo.ts` - hidden: true on get_weather and web_search
- `core/src/services/plugin/builtin/session-info.ts` - hidden: true on get_session_info
- `core/src/services/plugin/builtin/onebot/index.ts` - hidden: true on get_forward_msg

## Decisions Made

- send_message stays visible by omitting hidden flag (falsy default = visible), per user decision

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Hidden tool infrastructure complete, ready for Plan 02 (skill-driven tool filter wiring)
- getTools() now correctly filters hidden tools; buildToolSchemaForPrompt() can un-hide them via skill toolFilter.include

## Self-Check: PASSED

All files found, all commits verified.

---

_Phase: 35-skill-driven-tool-loading_
_Completed: 2026-02-27_
