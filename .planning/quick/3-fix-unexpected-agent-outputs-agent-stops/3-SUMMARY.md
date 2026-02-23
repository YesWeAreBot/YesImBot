---
phase: quick-3
plan: 01
subsystem: agent
tags: [json-parsing, prompt-engineering, fallback, loop]

requires:
  - phase: 21-02
    provides: RoleService rendering AGENTS.md/TOOLS.md into prompt
provides:
  - Unified JSON format enforcement in AGENTS.md (single source of truth)
  - Raw-text fallback in agent loop preventing premature termination
  - Format-reinforcing tool result messages
affects: [agent, prompt, roles]

tech-stack:
  added: []
  patterns: [single-source-of-truth for LLM response format, graceful degradation on malformed output]

key-files:
  created: []
  modified:
    - core/resources/roles/AGENTS.md
    - core/resources/roles/TOOLS.md
    - core/src/services/agent/loop.ts

key-decisions:
  - "AGENTS.md is single source of truth for JSON response format; TOOLS.md only describes tool mechanics"
  - "Raw text fallback wraps as send_message rather than breaking loop"
  - "Format reminder appended to tool results to reinforce JSON output across rounds"

requirements-completed: [FIX-AGENT-JSON-DRIFT]

duration: 2min
completed: 2026-02-23
---

# Quick Task 3: Fix Unexpected Agent Output / Agent Stops

**Hardened JSON format enforcement in AGENTS.md, removed conflicting spec from TOOLS.md, and added raw-text fallback + format reminder in loop.ts**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-23T17:24:19Z
- **Completed:** 2026-02-23T17:26:52Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- AGENTS.md now has explicit CRITICAL JSON-only constraint with common mistakes warning
- TOOLS.md no longer has its own Response Format section (eliminated conflicting `thoughts` field definition)
- Loop handles bare text output gracefully by wrapping as send_message instead of terminating
- Tool result messages now reinforce expected JSON output format between rounds

## Task Commits

1. **Task 1: Unify and harden JSON format spec** - `cf49fda` (fix)
2. **Task 2: Improve loop raw-text fallback and format reminder** - `b030d54` (fix)

## Files Created/Modified
- `core/resources/roles/AGENTS.md` - Added CRITICAL constraint block and common mistakes warning
- `core/resources/roles/TOOLS.md` - Removed duplicate Response Format section, added reference to AGENTS.md
- `core/src/services/agent/loop.ts` - Added raw-text fallback branch, format reminder in formatToolResults

## Decisions Made
- AGENTS.md is the single source of truth for response format; TOOLS.md defers to it
- Raw text fallback wraps content as send_message (graceful degradation over hard failure)
- Format reminder is a short one-liner appended to tool results (minimal token cost)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Self-Check: PASSED
- FOUND: core/resources/roles/AGENTS.md
- FOUND: core/resources/roles/TOOLS.md
- FOUND: core/src/services/agent/loop.ts
- FOUND: cf49fda (Task 1 commit)
- FOUND: b030d54 (Task 2 commit)
