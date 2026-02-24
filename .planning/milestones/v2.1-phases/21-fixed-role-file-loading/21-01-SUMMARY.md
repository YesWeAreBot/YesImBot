---
phase: 21-fixed-role-file-loading
plan: 01
subsystem: prompt
tags: [markdown, mustache, role-files, system-prompt]

requires:
  - phase: 20-injection-point-merge
    provides: Empty soul and instructions injection points ready for content
provides:
  - Bundled default SOUL.md with bot identity, personality, communication style
  - Bundled default AGENTS.md with control flow, response format, group chat behavior
  - Bundled default TOOLS.md with tool calling guidance and action format
affects: [21-02-role-service, prompt-rendering]

tech-stack:
  added: []
  patterns: [mustache-template-variables-in-markdown, markdown-heading-structure-for-rag]

key-files:
  created:
    - core/resources/roles/SOUL.md
    - core/resources/roles/AGENTS.md
    - core/resources/roles/TOOLS.md
  modified: []

key-decisions:
  - "English defaults with natural conversational tone, not corporate"
  - "Markdown ## heading structure for future RAG chunking compatibility"
  - "SOUL.md covers identity/personality/style/boundaries; AGENTS.md covers control-flow/format/monologue/group-chat/memory"
  - "TOOLS.md explains Tool vs Action distinction and JSON action format"

patterns-established:
  - "Role files use Mustache variables ({{bot.name}}, {{date.now}}) for runtime interpolation"
  - "## heading sections are self-contained chunks suitable for RAG retrieval"

requirements-completed: [ROLE-04]

duration: 4min
completed: 2026-02-23
---

# Phase 21 Plan 01: Default Role Files Summary

**Bundled SOUL.md/AGENTS.md/TOOLS.md with Mustache template variables, letta-inspired control flow, and OpenClaw-inspired anti-sycophancy**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-23T14:22:47Z
- **Completed:** 2026-02-23T14:26:39Z
- **Tasks:** 2
- **Files created:** 3

## Accomplishments

- SOUL.md defines bot identity with immersive persona philosophy from letta and anti-sycophancy from OpenClaw
- AGENTS.md defines JSON thoughts/actions response format, inner monologue, and group chat participation rules
- TOOLS.md explains tool calling mechanics, Tool vs Action distinction, and heartbeat chaining

## Task Commits

Each task was committed atomically:

1. **Task 1: Write bundled default SOUL.md and AGENTS.md** - `5dcac1f` (feat)
2. **Task 2: Write bundled default TOOLS.md** - `0515fe9` (feat)

## Files Created/Modified

- `core/resources/roles/SOUL.md` - Bot identity, personality, communication style, boundaries
- `core/resources/roles/AGENTS.md` - Control flow, JSON response format, inner monologue, group chat behavior, memory awareness
- `core/resources/roles/TOOLS.md` - Tool calling mechanics, action format, Tool vs Action distinction

## Decisions Made

- English defaults with natural conversational tone inspired by letta immersion and OpenClaw directness
- SOUL.md uses {{bot.name}} and {{date.now}}; AGENTS.md uses {{bot.name}} in group chat section
- TOOLS.md kept focused on HOW to use tools, not WHAT tools exist (dynamic schema injected per-turn)
- Markdown ## heading structure chosen for future RAG chunking compatibility

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Three bundled role files ready for RoleService (Plan 02) to load, render, and inject
- Files use Mustache variables that existing snippet system already provides
- ## heading structure supports future RAG chunking

## Self-Check: PASSED

All 3 created files verified on disk. Both task commits (5dcac1f, 0515fe9) verified in git log.

---
*Phase: 21-fixed-role-file-loading*
*Completed: 2026-02-23*
