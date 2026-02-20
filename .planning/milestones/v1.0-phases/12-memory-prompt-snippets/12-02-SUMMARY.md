---
phase: 12-memory-prompt-snippets
plan: 02
subsystem: memory
tags: [memory, snippets, prompt-injection, koishi-config, intl]

requires:
  - phase: 12-memory-prompt-snippets
    provides: MemoryService with filesystem block loading and prompt injection
  - phase: 04-prompt-template-engine
    provides: PromptService with registerSnippet() and inject() methods
provides:
  - 7 built-in dynamic snippets (date.now, sender.name/id, channel.name/platform, bot.name/id)
  - MemoryService wired into core plugin with Koishi config UI fields
affects: [prompt, agent]

tech-stack:
  added: []
  patterns: [snippet-registration-from-horizonview, intl-dateformat-zh-cn]

key-files:
  created: []
  modified:
    - plugins/core/src/services/memory/service.ts
    - plugins/core/src/index.ts

key-decisions:
  - "Intl.DateTimeFormat zh-CN for Chinese-friendly time (no external date library)"
  - "HorizonView cast from scope.view with optional chaining for safe access"
  - "Schema.path with directory filter for coreMemoryPath config UI"

patterns-established:
  - "Snippet registration pattern: service registers snippets in start() reading from HorizonView scope"

requirements-completed: [PROMPT-02]

duration: 2min
completed: 2026-02-20
---

# Phase 12 Plan 02: Built-in Snippets and Config Wiring Summary

**7 dynamic snippets (time/sender/channel/bot) registered from HorizonView scope, MemoryService wired into core plugin with directory picker config**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-20T15:27:50Z
- **Completed:** 2026-02-20T15:29:33Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- 7 built-in snippets registered: date.now, sender.name, sender.id, channel.name, channel.platform, bot.name, bot.id
- Chinese-friendly time format via Intl.DateTimeFormat("zh-CN") with year/month/day/weekday/hour/minute
- MemoryService wired into core plugin with Schema.path directory picker and memoryCharLimit number field
- Config interface extends MemoryConfig; yesimbot.memory added to service readiness check

## Task Commits

Each task was committed atomically:

1. **Task 1: Register built-in snippets in MemoryService** - `5b4f002` (feat)
2. **Task 2: Wire MemoryService into core plugin Config and Schema** - `e4b800d` (feat)

## Files Created/Modified
- `plugins/core/src/services/memory/service.ts` - Added registerSnippets() with 7 snippet registrations from HorizonView
- `plugins/core/src/index.ts` - Import MemoryService, extend Config, add Schema fields, plugin wiring, service readiness

## Decisions Made
- Used Intl.DateTimeFormat("zh-CN") for time formatting — no external date library needed
- Cast scope.view as HorizonView with optional chaining throughout for safe access when view is missing
- Schema.path with `{ filters: ["directory"] }` provides native directory browser in Koishi console UI

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Memory prompt snippet system complete — all memory blocks and dynamic snippets available in every rendered prompt
- Phase 12 fully complete (both plans done)

## Self-Check: PASSED

- [x] service.ts exists
- [x] index.ts exists
- [x] Commit 5b4f002 found
- [x] Commit e4b800d found

---
*Phase: 12-memory-prompt-snippets*
*Completed: 2026-02-20*
