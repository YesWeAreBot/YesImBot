---
phase: 12-memory-prompt-snippets
plan: 01
subsystem: memory
tags: [memory, filesystem, yaml, mustache, xml, prompt-injection]

requires:
  - phase: 04-prompt-template-engine
    provides: PromptService with inject() and render() methods
provides:
  - MemoryService Koishi Service loading filesystem memory blocks
  - MemoryBlock/MemoryConfig type interfaces
  - Prompt injection rendering memory as XML core_memory section
  - DEFAULT_SYSTEM_TEMPLATE injections placeholder
affects: [12-02, prompt, agent]

tech-stack:
  added: [js-yaml, "@types/js-yaml"]
  patterns: [filesystem-memory-blocks, yaml-frontmatter-parsing, fs-watch-hot-reload, xml-prompt-injection]

key-files:
  created:
    - plugins/core/src/services/memory/types.ts
    - plugins/core/src/services/memory/service.ts
    - plugins/core/src/services/memory/index.ts
  modified:
    - plugins/core/src/services/prompt/service.ts
    - plugins/core/package.json

key-decisions:
  - "js-yaml added as direct dependency (was transitive) with @types/js-yaml for type safety"
  - "Hand-rolled frontmatter parsing with regex + js-yaml instead of gray-matter"
  - "Default persona fallback inline constant, not a file"

patterns-established:
  - "Memory block pattern: YAML frontmatter + markdown content loaded from configurable directory"
  - "Prompt injection pattern: service registers injection via ctx['yesimbot.prompt'].inject(name, priority, renderFn)"

requirements-completed: [MEMORY-01, MEMORY-02]

duration: 3min
completed: 2026-02-20
---

# Phase 12 Plan 01: Memory Prompt Snippets Summary

**MemoryService loading filesystem .md/.txt blocks with YAML frontmatter, injected as XML core_memory into every system prompt**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-20T15:22:13Z
- **Completed:** 2026-02-20T15:25:12Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- MemoryService Koishi Service with filesystem memory block loading and YAML frontmatter parsing
- Hot-reload via fs.watch with 300ms debounce for live memory editing
- Prompt injection at priority 10 rendering blocks as XML with configurable character limit
- DEFAULT_SYSTEM_TEMPLATE updated with conditional injections placeholder

## Task Commits

Each task was committed atomically:

1. **Task 1: MemoryService types, service, and injection** - `1aad1c2` (feat)
2. **Task 2: Update DEFAULT_SYSTEM_TEMPLATE with injections placeholder** - `9e7c189` (feat)

## Files Created/Modified
- `plugins/core/src/services/memory/types.ts` - MemoryBlock and MemoryConfig interfaces
- `plugins/core/src/services/memory/service.ts` - MemoryService with load, watch, parse, inject
- `plugins/core/src/services/memory/index.ts` - Re-exports
- `plugins/core/src/services/prompt/service.ts` - Added injections Mustache section to template
- `plugins/core/package.json` - Added js-yaml dependency and @types/js-yaml

## Decisions Made
- Added js-yaml as direct dependency (was only transitive) plus @types/js-yaml for type safety
- Hand-rolled frontmatter parsing with regex + js-yaml per plan specification (no gray-matter)
- Default persona is an inline constant, not loaded from a file

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing @types/js-yaml and js-yaml direct dependency**
- **Found during:** Task 1 (MemoryService implementation)
- **Issue:** js-yaml had no type declarations, causing TS7016 error
- **Fix:** Added @types/js-yaml as devDependency and js-yaml as direct dependency
- **Files modified:** plugins/core/package.json
- **Verification:** yarn typecheck passes
- **Committed in:** 1aad1c2 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential for compilation. No scope creep.

## Issues Encountered
None beyond the dependency fix above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- MemoryService ready for Plan 02 (MemorySchema config integration, plugin wiring)
- Prompt injection system proven — other services can register injections at different priorities

## Self-Check: PASSED

- [x] types.ts exists
- [x] service.ts exists
- [x] index.ts exists
- [x] Commit 1aad1c2 found
- [x] Commit 9e7c189 found

---
*Phase: 12-memory-prompt-snippets*
*Completed: 2026-02-20*
