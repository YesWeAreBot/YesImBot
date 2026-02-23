---
phase: 20-injection-point-merge-wrapper-elimination
plan: 02
subsystem: prompt
tags: [injection-points, mustache, xml-assembly, template-cleanup]

requires:
  - phase: 20-01
    provides: "InjectionPoint type merged to soul/instructions/memory/extra"
provides:
  - "render() generates inline XML tags without Mustache template indirection"
  - "Empty injection points emit their tags (e.g. <soul></soul>)"
  - "All snippets evaluated unconditionally (no template-based filtering)"
  - "11 obsolete template/default files deleted"
affects: [21-soul-agents-content, prompt-service]

tech-stack:
  added: []
  patterns: [inline-xml-assembly, unconditional-snippet-evaluation]

key-files:
  created: []
  modified:
    - core/src/services/prompt/service.ts

key-decisions:
  - "render() assembles XML tags in code — no Mustache partials for prompt structure"
  - "Empty injection points always emit tags for structural consistency"
  - "Constructor seeds on core-memory.mustache instead of system.mustache"
  - "All snippets evaluated unconditionally — removed template-variable-based filtering"

patterns-established:
  - "Inline XML assembly: render() outputs <point>\\n...\\n</point> per injection point"
  - "Unconditional snippet evaluation: buildScope() runs all registered snippets"

requirements-completed: [PROMPT-02, PROMPT-03]

duration: 4min
completed: 2026-02-23
---

# Phase 20 Plan 02: Wrapper Elimination Summary

**render() rewritten to generate inline XML tags, 11 wrapper templates and default files deleted**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-23T12:29:53Z
- **Completed:** 2026-02-23T12:33:42Z
- **Tasks:** 2
- **Files modified:** 1 modified, 11 deleted

## Accomplishments
- render() generates `<soul>`, `<instructions>`, `<memory>`, `<extra>` XML tags inline via code
- Empty injection points always emit their tags for structural consistency
- Removed getRequiredVariables(), isSnippetRequired(), and template-based snippet filtering
- Constructor no longer registers system template or wrapper partials
- Deleted 11 obsolete files: system.mustache, 6 wrapper partials, 4 default-*.md files

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite render() and clean constructor** - `f787650` (feat)
2. **Task 2: Delete obsolete template and default files** - `8020d04` (chore)

## Files Created/Modified
- `core/src/services/prompt/service.ts` - Rewritten render() with inline XML, cleaned constructor, removed dead methods
- `core/resources/templates/system.mustache` - Deleted
- `core/resources/templates/partials/identity.mustache` - Deleted
- `core/resources/templates/partials/style.mustache` - Deleted
- `core/resources/templates/partials/control_flow.mustache` - Deleted
- `core/resources/templates/partials/basic_functions.mustache` - Deleted
- `core/resources/templates/partials/memory.mustache` - Deleted
- `core/resources/templates/partials/extra.mustache` - Deleted
- `core/resources/templates/default-identity.md` - Deleted
- `core/resources/templates/default-style.md` - Deleted
- `core/resources/templates/default-control-flow.md` - Deleted
- `core/resources/templates/default-basic-functions.md` - Deleted

## Decisions Made
- render() assembles XML tags in code rather than via Mustache partials
- Empty injection points always emit their tags (`<soul></soul>`) for structural consistency
- Constructor seeds on core-memory.mustache (only retained template MemoryService needs)
- All snippets evaluated unconditionally — removed template-variable-based filtering (getRequiredVariables/isSnippetRequired deleted)
- Kept MustacheRenderer field and related infrastructure (loadTemplate, registerPartial, etc.) for MemoryService/HorizonService use

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Prompt assembly is now fully code-driven with inline XML tags
- Only 4 resource files remain: core-memory.mustache, default-persona.md, memory-block.mustache, horizon-view.mustache
- Ready for Phase 21: SOUL.md/AGENTS.md content injection into soul/instructions points

---
*Phase: 20-injection-point-merge-wrapper-elimination*
*Completed: 2026-02-23*
