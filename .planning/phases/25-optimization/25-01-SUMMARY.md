---
phase: 25-optimization
plan: 01
subsystem: horizon
tags: [horizon, working-memory, xml, short-id, temporal-coherence]

requires:
  - phase: 24-observability
    provides: structured judge prompt and persona-aware willingness scoring

provides:
  - Short-ID mapping (cycling 1-999, bounded per channel) in HorizonService
  - XML <msg> format for history observations with id/sender/senderId/replyTo attributes
  - triggeredAt labels in working memory linking agent rounds to triggering messages
  - send_message trimming in working memory (compact sent, ok / sent, failed format)

affects: [26-prompt-cache, any phase touching horizon formatObservation or wmLines]

tech-stack:
  added: []
  patterns:
    - "Short-ID map: per-channel cycling integer (1-999) assigned on first observation, bounded at 100 entries"
    - "XML observation format: <msg id=N sender=name senderId=uid [replyTo=M]>content</msg>"
    - "Working memory causal link: Round N (triggered by #M): prefix"
    - "send_message compaction: always omit content param, use sent, ok / sent, failed"

key-files:
  created: []
  modified:
    - core/src/services/horizon/types.ts
    - core/src/services/horizon/service.ts
    - core/src/services/horizon/manager.ts
    - core/src/services/agent/loop.ts

key-decisions:
  - "XML format only when channelKey is provided; legacy [HH:MM] format preserved as fallback for backward compat"
  - "Short-ID map bounded at 100 entries per channel (evict to 80 on overflow) to prevent unbounded memory growth"
  - "send_message always shows sent, ok without #N target ID — tool result doesn't return platform message ID yet"
  - "triggeredAt looks backward through history for nearest preceding message observation"

patterns-established:
  - "assignShortId/getShortId are public methods — loop.ts consumes getShortId for triggered-by labels"
  - "channelKey derived as platform:channelId in both service.ts and loop.ts"

requirements-completed: [OPT-03, OPT-04]

duration: 5min
completed: 2026-02-25
---

# Phase 25 Plan 01: Working Memory Temporal Coherence Summary

**XML history format with short-ID mapping, triggered-by causal labels, and send_message token trimming for LLM context efficiency**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-02-25T16:02:00Z
- **Completed:** 2026-02-25T16:06:29Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- HorizonService now assigns cycling short IDs (1-999) per channel and renders history as `<msg id="N" sender="name" senderId="uid">content</msg>` XML
- Working memory round headers show `Round N (triggered by #M):` linking each agent response to the message that preceded it
- send_message entries in working memory are compacted to `send_message({}) -> sent, ok` — no repeated content tokens

## Task Commits

1. **Task 1: Short-ID mapping and XML formatObservation** - `76714c7` (feat)
2. **Task 2: triggeredAt labels and send_message trimming** - `c65fc45` (feat)

## Files Created/Modified

- `core/src/services/horizon/types.ts` - Added `replyTo?: string` to `MessageObservation`
- `core/src/services/horizon/service.ts` - Added `shortIdCounters`/`shortIdMaps` state, `assignShortId()`/`getShortId()` methods, XML `formatObservation`, channelKey derivation in `formatHorizonText`
- `core/src/services/horizon/manager.ts` - `toObservations()` passes through `replyTo` from `MessageEventData`
- `core/src/services/agent/loop.ts` - Replaced `for-of` wmLines loop with index-based loop; added channelKey derivation, triggered-by lookup, send_message compaction

## Decisions Made

- XML format is gated on `channelKey` presence — legacy `[HH:MM]` format preserved for callers that don't pass channelKey (backward compat)
- Short-ID map evicts oldest entries when size exceeds 100, keeping at most 80 (prevents unbounded growth in long-running channels)
- `send_message` compact format omits `#N` target ID because the tool result doesn't currently return the sent message's platform ID

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed stale sub-logger references in loop.ts**
- **Found during:** Task 2 (wmLines builder modification)
- **Issue:** A pre-existing refactor had consolidated multiple loggers (`logLoop`, `logModel`, `logParser`, `logTool`) into a single `this.logger`, but the call sites still referenced the removed fields — TypeScript errors on `this.logModel`, `this.logParser`, `this.logTool`
- **Fix:** The linter had already partially fixed these; confirmed all references resolved to `this.logger` with appropriate prefixes
- **Files modified:** `core/src/services/agent/loop.ts`
- **Verification:** `tsc --noEmit` passes with zero errors
- **Committed in:** `c65fc45` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug)
**Impact on plan:** Pre-existing breakage unrelated to this plan's scope. Fix was necessary to achieve clean TypeScript compilation.

## Issues Encountered

The linter was actively modifying `loop.ts` between reads, causing repeated "file modified since read" errors. Resolved by reading the file fresh immediately before each edit and using targeted `Edit` calls rather than full rewrites.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Short-ID infrastructure is in place for phase 25 plan 02+ (prompt cache, etc.)
- `assignShortId` / `getShortId` are public — any future plan can use them
- XML history format is live; prompt templates may need updating to leverage the structured format
