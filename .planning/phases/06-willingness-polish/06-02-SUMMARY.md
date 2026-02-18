---
phase: 06-willingness-polish
plan: 02
subsystem: agent
tags: [error-handling, delay, sleep, koishi, send-message]

requires:
  - phase: 06-01
    provides: AgentCore with gateAndEnqueue, WillingnessCalculator, ThinkActLoop

provides:
  - Silent error handling in runLoop with optional channel reporting via reportError()
  - Inter-part 1s typing delay in send_message between <sep/> splits
  - Inference-aware reply delay for fallback text sends in ThinkActLoop

affects: []

tech-stack:
  added: []
  patterns:
    - "reportError: find bot via ctx.bots.find(platform) → sendMessage with swallowed errors"
    - "Inference-aware delay: typingMs = min(len*50, 3000) - elapsed, applied before fallback send"
    - "Inter-part delay: sleep(1000) before each part except first in send_message loop"

key-files:
  created: []
  modified:
    - plugins/core/src/services/agent/config.ts
    - plugins/core/src/services/agent/service.ts
    - plugins/core/src/services/plugin/builtin/send-message.ts
    - plugins/core/src/services/agent/loop.ts
    - plugins/core/src/index.ts

key-decisions:
  - "reportError swallows its own send errors (.catch(() => {})) to prevent infinite error loops"
  - "Fallback delay uses fallbackText.trim().length (not sentContent) — sentContent declared after the check"
  - "Inter-part delay applied in send_message tool, not in loop — separation of concerns"

patterns-established:
  - "Silent failure pattern: catch → log → reportError().catch(() => {}) — never re-throw, never message user"

requirements-completed: [AGENT-02]

duration: 5min
completed: 2026-02-19
---

# Phase 6 Plan 02: Polish Summary

**Silent error handling with optional monitoring channel reporting, 1s inter-part typing delay in send_message, and inference-aware fallback reply delay in ThinkActLoop**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-02-19
- **Completed:** 2026-02-19
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- AgentCore.runLoop errors are caught, logged, and optionally forwarded to a configured monitoring channel — never shown to users
- send_message inserts 1s sleep between <sep/> message parts to simulate natural typing intervals
- ThinkActLoop fallback send subtracts LLM inference elapsed time from typing delay to avoid double-latency

## Task Commits

1. **Task 1: Error handling and channel reporting in AgentCore** - `a33a91c` (feat)
2. **Task 2: Reply delay and inter-part typing delay** - `ea90111` (feat)

## Files Created/Modified

- `plugins/core/src/services/agent/config.ts` - Added errorReportChannel field
- `plugins/core/src/services/agent/service.ts` - Added reportError() method, updated runLoop catch
- `plugins/core/src/services/plugin/builtin/send-message.ts` - Added sleep(1000) between parts
- `plugins/core/src/services/agent/loop.ts` - Added loopStartTime, inference-aware delay before fallback send
- `plugins/core/src/index.ts` - Added errorReportChannel to Config interface and Schema

## Decisions Made

- `reportError` swallows its own errors via `.catch(() => {})` to prevent infinite loops if the monitoring channel itself fails
- Used `fallbackText.trim().length` for typing delay calculation (not `sentContent`) because `sentContent` is declared after the fallback check block
- Inter-part delay lives in `send_message` tool, not in the loop — keeps delay logic co-located with the send action

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed sentContent reference before declaration**

- **Found during:** Task 2 (reply delay in loop.ts)
- **Issue:** Plan specified `sentContent.length` for typingMs but `sentContent` is declared after the `!hasSent` block — TypeScript TS2448/TS2454 errors
- **Fix:** Used `fallbackText.trim().length` instead — equivalent value since `!hasSent` means fallbackText is the content being sent
- **Files modified:** plugins/core/src/services/agent/loop.ts
- **Verification:** `npx tsc --noEmit -p plugins/core/tsconfig.json` passes
- **Committed in:** ea90111 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug)
**Impact on plan:** Necessary correctness fix. Semantically equivalent to plan intent. No scope creep.

## Issues Encountered

None beyond the auto-fixed variable ordering issue above.

## Next Phase Readiness

- Phase 6 complete — all willingness and polish work done
- Agent now has: willingness gate, silent error handling, monitoring channel, natural typing delays

---

_Phase: 06-willingness-polish_
_Completed: 2026-02-19_

## Self-Check: PASSED

- FOUND: plugins/core/src/services/agent/service.ts (reportError method)
- FOUND: plugins/core/src/services/plugin/builtin/send-message.ts (sleep between parts)
- FOUND: plugins/core/src/services/agent/loop.ts (loopStartTime)
- FOUND: commit a33a91c (error reporting channel and silent error handling)
- FOUND: commit ea90111 (inter-part typing delay and inference-aware reply delay)
- FOUND: .planning/phases/06-willingness-polish/06-02-SUMMARY.md
