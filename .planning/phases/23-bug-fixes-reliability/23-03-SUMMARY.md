---
phase: 23-bug-fixes-reliability
plan: 03
subsystem: agent
tags: [token-bucket, rate-limiting, dm-aggregation, willingness]

requires:
  - phase: 23-00
    provides: "vitest test scaffolds for token-bucket and willingness"
provides:
  - "TokenBucket class for per-user rate limiting"
  - "DM adaptive aggregation window (3-8s with 15s cap)"
  - "directBoost probability boost for DM trigger type"
  - "Independent dm/group rate limit config in WillingnessConfig"
affects: [agent-core, willingness-engine]

tech-stack:
  added: []
  patterns: [token-bucket-rate-limiting, adaptive-aggregation-window]

key-files:
  created:
    - core/src/services/agent/__tests__/setup.ts
    - core/vitest.config.ts
  modified:
    - core/src/services/agent/willingness.ts
    - core/src/services/agent/service.ts

key-decisions:
  - "TokenBucket uses senderId (not channelId) as bucket key for true per-user rate limiting"
  - "DM adaptive timeout uses interval * 1.5 clamped to 3-8s range"
  - "directBoost applied via same applyMentionBoost formula as mention/reply triggers"

patterns-established:
  - "Token bucket pattern: capacity + refillRate per second, Map-based per-key state"
  - "DM aggregation: dual-timer pattern (adaptive + cap) with mutual cancellation"

requirements-completed: [WILL-01, WILL-02]

duration: 5min
completed: 2026-02-24
---

# Phase 23 Plan 03: DM Willingness & Rate Limiting Summary

**TokenBucket rate limiter with adaptive DM aggregation (3-8s window, 15s cap) and directBoost probability for private messages**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-24T18:54:43Z
- **Completed:** 2026-02-24T19:00:19Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Exported TokenBucket class with per-key consume/refill logic in willingness.ts
- Added dm and rateLimit config blocks to WillingnessConfig with Schema definitions
- Applied directBoost for "direct" trigger type using applyMentionBoost formula
- Replaced DM immediate-enqueue with adaptive 3-8s aggregation window and 15s cap
- Added per-user token bucket rate limiting for both DM and group scenarios
- Rate-limited messages silently ignored with debug-level logging only

## Task Commits

Each task was committed atomically:

1. **Task 1: Add TokenBucket, DM config, and rate limit config to willingness.ts** - `8213568` (feat)
2. **Task 2: Implement DM adaptive aggregation and rate limiting in AgentCore** - `fff61cc` (feat)

## Files Created/Modified
- `core/src/services/agent/willingness.ts` - TokenBucket class, dm/rateLimit config, directBoost in processMessage
- `core/src/services/agent/service.ts` - DM adaptive aggregation, rate limiter init and check in handleEvent
- `core/src/services/agent/__tests__/setup.ts` - Vitest setup with koishi mock for unit tests
- `core/vitest.config.ts` - Vitest config for core package test discovery

## Decisions Made
- Used senderId as bucket key for per-user rate limiting (platform-agnostic, avoids channelId collision in DMs)
- Adaptive timeout algorithm: `clamp(lastInterval * 1.5, minMs, maxMs)` — simple, responsive to user typing pace
- First DM message uses maxMs timeout (no interval data yet), subsequent messages adapt
- Dual-timer pattern (adaptive + cap) with mutual cancellation prevents double enqueue race condition

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added vitest setup with koishi mock**
- **Found during:** Task 1 (verification step)
- **Issue:** Importing willingness.ts in vitest fails because `import { Schema } from "koishi"` triggers Koishi loader which isn't available in test environment
- **Fix:** Created `setup.ts` with `vi.mock("koishi")` providing Schema/Context/Service/Random stubs, and `vitest.config.ts` referencing it
- **Files modified:** core/src/services/agent/__tests__/setup.ts, core/vitest.config.ts
- **Verification:** All 4 token-bucket tests and 1 willingness test pass
- **Committed in:** 8213568 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential for test execution. No scope creep.

## Issues Encountered
None beyond the koishi mock deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- WILL-01 and WILL-02 requirements complete
- DM aggregation and rate limiting ready for integration testing
- Token bucket and willingness directBoost covered by passing unit tests

## Self-Check: PASSED

- Commit 8213568: FOUND
- Commit fff61cc: FOUND
- core/src/services/agent/willingness.ts: FOUND
- core/src/services/agent/service.ts: FOUND
- core/src/services/agent/__tests__/setup.ts: FOUND
- core/vitest.config.ts: FOUND

---
*Phase: 23-bug-fixes-reliability*
*Completed: 2026-02-24*
