---
phase: 23-bug-fixes-reliability
plan: 00
subsystem: testing
tags: [vitest, mustache, token-bucket, willingness, tdd]

requires: []
provides:
  - "RED test scaffolds for BUGFIX-01 (snippet rendering), WILL-01 (directBoost), WILL-02 (token bucket)"
  - "vitest installed as dev dependency in core package"
affects: [23-02, 23-03]

tech-stack:
  added: [vitest]
  patterns: [wave-0-red-tests, mustache-scope-contract-testing]

key-files:
  created:
    - core/src/services/horizon/__tests__/format-horizon-text.test.ts
    - core/src/services/agent/__tests__/token-bucket.test.ts
    - core/src/services/agent/__tests__/willingness.test.ts
  modified:
    - core/package.json

key-decisions:
  - "Test horizon-view rendering via Mustache.render with real template (no HorizonService instantiation needed)"
  - "Token-bucket and willingness tests import from willingness.ts directly — fail at module resolution until koishi mock or implementation lands"

patterns-established:
  - "Wave 0 RED tests: test files assert target behavior before implementation exists"
  - "Scope contract testing: validate Mustache dot-path rendering with buildScope helper"

requirements-completed: []

duration: 4min
completed: 2026-02-24
---

# Phase 23 Plan 00: Test Scaffolds Summary

**RED test scaffolds for BUGFIX-01 snippet rendering, WILL-01 directBoost, and WILL-02 token bucket using vitest**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-24T18:46:25Z
- **Completed:** 2026-02-24T18:51:05Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- 3 smoke tests for format-horizon-text snippet variable rendering (2 RED, 1 green)
- 3 unit tests for TokenBucket consume/refill behavior (RED — class not yet exported)
- 1 unit test for WillingnessEngine directBoost on DM trigger (RED — directBoost not yet implemented)
- vitest installed as dev dependency in core package

## Task Commits

Each task was committed atomically:

1. **Task 1: Create format-horizon-text smoke test** - `c7daa46` (test)
2. **Task 2: Create token-bucket and willingness test scaffolds** - `0f0a74f` (test)

## Files Created/Modified
- `core/src/services/horizon/__tests__/format-horizon-text.test.ts` - Smoke tests for BUGFIX-01 snippet rendering
- `core/src/services/agent/__tests__/token-bucket.test.ts` - Unit tests for WILL-02 TokenBucket
- `core/src/services/agent/__tests__/willingness.test.ts` - Unit test for WILL-01 directBoost
- `core/package.json` - Added vitest dev dependency

## Decisions Made
- Tested horizon-view rendering via direct Mustache.render with the real template file, avoiding HorizonService instantiation (requires full Koishi context)
- Token-bucket and willingness tests import directly from willingness.ts — they fail at koishi module resolution, which is acceptable RED state for Wave 0
- Used `buildCurrentBrokenScope()` helper to reproduce the exact broken scope formatHorizonText currently builds

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed vitest before creating test files**
- **Found during:** Pre-task setup
- **Issue:** vitest not installed — test files can't run without it
- **Fix:** `yarn workspace koishi-plugin-yesimbot add -D vitest`
- **Files modified:** core/package.json
- **Verification:** vitest discovers and runs test files
- **Committed in:** 0f0a74f (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential prerequisite. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 3 test files exist and are discovered by vitest
- Tests are RED — 23-02 (BUGFIX-01 fix) and 23-03 (WILL-01/WILL-02 implementation) will make them green
- vitest infrastructure ready for BUGFIX-02 json-parser tests in 23-01

## Self-Check: PASSED

All files and commits verified:
- FOUND: core/src/services/horizon/__tests__/format-horizon-text.test.ts
- FOUND: core/src/services/agent/__tests__/token-bucket.test.ts
- FOUND: core/src/services/agent/__tests__/willingness.test.ts
- FOUND: commit c7daa46
- FOUND: commit 0f0a74f

---
*Phase: 23-bug-fixes-reliability*
*Completed: 2026-02-24*
