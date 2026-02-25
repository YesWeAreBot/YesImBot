---
phase: 23-bug-fixes-reliability
plan: 02
subsystem: template-rendering
tags: [mustache, snippet-variables, horizon-view, scope-construction]

requires:
  - phase: 23-00
    provides: "vitest test scaffolds for BUGFIX-01"
provides:
  - "formatHorizonText with full nested scope (date, bot, sender, channel)"
  - "Percept threading from loop.ts into horizon-view rendering"
affects: [23-03, 25-prompt-cache]

tech-stack:
  added: []
  patterns: [nested-scope-for-mustache-dot-path, fallback-to-tag-text-on-missing]

key-files:
  created: []
  modified:
    - core/src/services/horizon/service.ts
    - core/src/services/agent/loop.ts
    - core/src/services/horizon/__tests__/format-horizon-text.test.ts

key-decisions:
  - "Build scope inline in formatHorizonText to avoid circular dependency with PromptService"
  - "Missing variables fall back to original tag text (e.g. '{{bot.name}}') instead of empty string"
  - "percept parameter is optional — deferred judgment path omits it intentionally"

patterns-established:
  - "Nested scope objects for Mustache dot-path access: { date: { now }, bot: { name, id } }"
  - "Fallback-to-tag-text pattern: use original template tag string as default value"

requirements-completed: [BUGFIX-01]

duration: 5min
completed: 2026-02-25
---

# Phase 23 Plan 02: Snippet Variable Rendering Summary

**formatHorizonText builds full nested scope with date.now, bot.name, sender.*, channel.* for Mustache dot-path rendering; missing variables preserve original tag text**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-24T18:54:27Z
- **Completed:** 2026-02-24T18:59:02Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- formatHorizonText now constructs a full nested scope with date, bot, sender, channel variable groups
- {{date.now}} renders zh-CN formatted date instead of empty string
- Missing variables (e.g. sender.* without percept) preserve original tag text as fallback
- percept threaded from loop.ts into formatHorizonText for sender identity resolution

## Task Commits

1. **Task 1: Rebuild formatHorizonText scope with snippet variables** - `00012e5` (feat)
2. **Task 2: Thread percept into formatHorizonText call in loop.ts** - `f20ba28` (feat)

## Files Created/Modified
- `core/src/services/horizon/service.ts` - Added Percept import, rebuilt formatHorizonText with nested scope and debug logging
- `core/src/services/agent/loop.ts` - Pass percept to formatHorizonText call
- `core/src/services/horizon/__tests__/format-horizon-text.test.ts` - Updated from RED scaffolds to GREEN tests (6 passing)

## Decisions Made
- Built scope inline in formatHorizonText rather than importing PromptService (avoids circular dependency)
- Used Intl.DateTimeFormat("zh-CN") for date.now formatting (matches template language)
- Optional percept parameter — deferred judgment path in service.ts intentionally omits it

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed missing closing bracket in json-parser.test.ts**
- **Found during:** Task 1 (typecheck verification)
- **Issue:** Pre-existing scaffold file missing closing `});` for describe block, blocking tsc --noEmit
- **Fix:** Added closing bracket to json-parser.test.ts (pre-existing scaffold issue from 23-00)
- **Files modified:** core/src/services/agent/__tests__/json-parser.test.ts
- **Verification:** tsc --noEmit passes cleanly
- **Committed in:** Not committed (out-of-scope pre-existing file, will be addressed by 23-01)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Minimal — fix was to a pre-existing scaffold file that blocked typecheck. No scope creep.

## Issues Encountered
None beyond the pre-existing json-parser.test.ts scaffold issue.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- BUGFIX-01 resolved — snippet variables render correctly in horizon-view
- Phase 25 (prompt cache) can now rely on correct horizon-view output
- Remaining plans 23-01 (JSON parser tests) and 23-03 (willingness/rate limiting) are independent

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 23-bug-fixes-reliability*
*Completed: 2026-02-25*
