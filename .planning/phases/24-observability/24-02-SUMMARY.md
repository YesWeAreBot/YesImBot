---
phase: 24-observability
plan: 02
subsystem: observability
tags: [judgment, persona, structured-json, willingness, koishi]

requires:
  - phase: 24-observability
    provides: traceId threading, namespace loggers, debugLevel gating
  - phase: 23-agent-loop
    provides: AgentCore service, deferred judgment, willingness system
provides:
  - Structured JSON judge response with decision/confidence/reasoning/factors
  - Persona-aware judgment prompt via RoleService.getSoulSummary()
  - Legacy yes/no fallback for robustness
  - Judge decision/factors logging at debugLevel >= 1 and >= 2
affects: [observability, willingness, debugging]

tech-stack:
  added: []
  patterns: [structured-judge-response, persona-injection, json-fallback-parsing]

key-files:
  created: []
  modified:
    - core/src/services/agent/service.ts
    - core/src/services/role/service.ts

key-decisions:
  - "confidence is log-only — does NOT affect reply decision, only decision (bool) matters"
  - "getSoulSummary trims at sentence/paragraph boundary to avoid mid-word cutoff"
  - "Reuses JsonParser<JudgeResponse> for structured parsing with legacy yes/no fallback"

patterns-established:
  - "Persona injection: RoleService.getSoulSummary() extracts rendered SOUL.md excerpt for cross-service use"
  - "Structured judge response: JSON with decision/confidence/reasoning/factors replaces bare yes/no"

requirements-completed: [WILL-03]

duration: 2min
completed: 2026-02-25
---

# Plan 24-02: Persona-Aware Structured Judge Prompt Summary

**Structured JSON judge response with persona context from SOUL.md, factor-level logging, and legacy yes/no fallback**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-02-25T13:54:38Z
- **Completed:** 2026-02-25T13:56:58Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- RoleService.getSoulSummary() extracts first ~300 chars of rendered SOUL.md with sentence-boundary trimming
- buildJudgmentPrompt() includes persona summary, enumerates 4 judgment factors, requests JSON output schema
- Judge response parsed as structured JSON via JsonParser<JudgeResponse> with decision/confidence/reasoning/factors
- Legacy yes/no string fallback preserved for robustness when JSON parsing fails
- maxOutputTokens increased from 8 to 256 for JSON response
- Judge decision/confidence logged at debugLevel>=1, factor breakdown at debugLevel>=2
- yesimbot.role added to AgentCore.inject for persona access

## Task Commits

1. **Task 1: Add getSoulSummary to RoleService and upgrade Judge prompt + response parsing** - `46e59af` (feat)

## Files Created/Modified
- `core/src/services/role/service.ts` - Added getSoulSummary() method for persona excerpt extraction
- `core/src/services/agent/service.ts` - JudgeResponse interface, buildJudgmentPrompt(), structured JSON parsing with fallback, RoleService dependency

## Decisions Made
- confidence field is log-only — does not participate in decision logic, only `decision` (boolean) determines reply
- getSoulSummary trims at last sentence boundary (period or newline) within maxChars to avoid mid-word cutoff
- Reused existing JsonParser with JudgeResponse generic for structured parsing, keeping legacy fallback path

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Structured judge logging ready for dashboard/metrics consumption
- Persona injection pattern available for other cross-service persona needs

## Self-Check: PASSED

- FOUND: core/src/services/role/service.ts
- FOUND: core/src/services/agent/service.ts
- FOUND: commit 46e59af

---
*Phase: 24-observability*
*Completed: 2026-02-25*
