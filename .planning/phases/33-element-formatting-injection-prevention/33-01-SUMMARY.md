---
phase: 33-element-formatting-injection-prevention
plan: 01
subsystem: core
tags: [koishi, element-formatter, xml-escaping, injection-prevention, service]

# Dependency graph
requires: []
provides:
  - ElementFormatterService registered as yesimbot.element-formatter
  - Built-in handlers for at, face, img, audio, video, file, message, quote elements
  - formatQuotePrefix utility for session.quote inline display
  - wrapIfLong utility for <unverified> injection defense wrapping
affects: [33-02, phase-38-multimodal]

# Tech tracking
tech-stack:
  added: []
  patterns: [handler-map-with-fallback, unverified-wrapper, quote-prefix-inline]

key-files:
  created:
    - core/src/services/element-formatter/service.ts
    - core/src/services/element-formatter/handlers.ts
    - core/src/services/element-formatter/index.ts
  modified:
    - core/src/index.ts

key-decisions:
  - "Text length threshold for <unverified> wrapping set to 200 chars (more permissive than dev version's 100)"
  - "Quote preview truncation at 80 chars with ellipsis"
  - "Image src attribute escaped via h.escape for safety even though Phase 38 will override"

patterns-established:
  - "Handler map pattern: register(type, handler) with <unsupported> fallback for unknown types"
  - "Element formatting as Koishi Service subclass with extensible registration"

requirements-completed: [ELEM-01, ELEM-02]

# Metrics
duration: 3min
completed: 2026-02-27
---

# Phase 33 Plan 01: ElementFormatterService Summary

**Koishi Service with handler map for 8 element types, quote prefix utility, and <unverified> long-message wrapping for injection defense**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-27T12:20:22Z
- **Completed:** 2026-02-27T12:23:48Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- ElementFormatterService extends Koishi Service with handler map for all standard element types
- Text nodes use el.toString() for framework-level XML auto-escaping
- Long messages (text > 200 chars) wrapped in <unverified> tags for LLM scrutiny
- Quote prefix utility produces [回复 Name: preview...] format for session.quote

## Task Commits

Each task was committed atomically:

1. **Task 1: Create ElementFormatterService and handler implementations** - `63a3c5e` (feat)
2. **Task 2: Register ElementFormatterService in core plugin** - `109247e` (feat)

## Files Created/Modified

- `core/src/services/element-formatter/service.ts` - ElementFormatterService class extending Service with handler map and format() method
- `core/src/services/element-formatter/handlers.ts` - Built-in handlers for 8 element types, formatQuotePrefix, wrapIfLong utilities
- `core/src/services/element-formatter/index.ts` - Re-exports for service, type, and utilities
- `core/src/index.ts` - Register ElementFormatterService before HorizonService, add to waitForServiceReady

## Decisions Made

- Text length threshold for <unverified> wrapping: 200 chars (Claude's discretion per CONTEXT.md; more permissive than dev version's 100 to reduce false positives)
- Quote preview max: 80 chars with "..." ellipsis appended when truncated
- Image src attribute escaped with h.escape(str, true) for defense-in-depth even though Phase 38 will override the img handler

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- ElementFormatterService is ready for Plan 02 to integrate into EventListener.recordUserMessage()
- formatQuotePrefix and wrapIfLong exported for Plan 02 to call at message-receive time
- Phase 38 can override the img handler via register("img", multimodalHandler) for multimodal support

## Self-Check: PASSED

- All 4 files exist on disk
- Commit 63a3c5e found (Task 1)
- Commit 109247e found (Task 2)
- TypeScript compiles with zero errors

---

_Phase: 33-element-formatting-injection-prevention_
_Completed: 2026-02-27_
