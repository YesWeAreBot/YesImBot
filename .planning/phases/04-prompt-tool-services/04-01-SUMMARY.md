---
phase: 04-prompt-tool-services
plan: 01
subsystem: prompt
tags: [mustache, template-rendering, koishi-service]

requires:
  - phase: 02-model-service
    provides: Service subclass pattern used for PromptService
  - phase: 03-horizon-context-system
    provides: HorizonView context that will be passed as render scope
provides:
  - PromptService Koishi Service registered as yesimbot.prompt
  - Snippet/Injection/IRenderer/RenderOptions type interfaces
  - MustacheRenderer with HTML escaping disabled
  - registerTemplate/registerSnippet/inject/render API
affects: [05-agent-core, phase-5]

tech-stack:
  added: [mustache@4.2.0, "@types/mustache@4.2.6"]
  patterns: [Koishi Service subclass with immediate=true, config-override-priority pattern]

key-files:
  created:
    - plugins/core/src/services/prompt/types.ts
    - plugins/core/src/services/prompt/renderer.ts
    - plugins/core/src/services/prompt/service.ts
    - plugins/core/src/services/prompt/index.ts
  modified:
    - plugins/core/package.json

key-decisions:
  - "Config-provided templates override built-in defaults (config > registerTemplate priority)"
  - "Snippets evaluated lazily — only those whose keys appear in the template are called"
  - "Injections sorted ascending by priority, joined with double newline into scope.injections"
  - "MustacheRenderer sets Mustache.escape = identity to disable HTML escaping globally"

patterns-established:
  - "Snippet pattern: named async data providers evaluated per-render against required variables"
  - "Injection pattern: plugin-contributed text fragments with priority ordering"

requirements-completed: [PROMPT-01]

duration: 5min
completed: 2026-02-18
---

# Phase 4 Plan 01: PromptService Summary

**Mustache-based PromptService Koishi Service with lazy Snippet evaluation, priority-ordered Injection fragments, and config-override template priority**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-02-18
- **Completed:** 2026-02-18
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- PromptService registered as `yesimbot.prompt` Koishi Service with full declaration merging
- MustacheRenderer with HTML escaping disabled for LLM prompt safety
- Snippet/Injection registration API with lazy evaluation and priority ordering

## Task Commits

1. **Task 1: PromptService types and MustacheRenderer** - `2cb50d7` (feat)
2. **Task 2: PromptService Koishi Service with Snippet/Injection registration** - `867cf80` (feat)

## Files Created/Modified

- `plugins/core/src/services/prompt/types.ts` - Snippet, Injection, IRenderer, RenderOptions interfaces
- `plugins/core/src/services/prompt/renderer.ts` - MustacheRenderer with HTML escaping disabled
- `plugins/core/src/services/prompt/service.ts` - PromptService with full render pipeline
- `plugins/core/src/services/prompt/index.ts` - Re-exports for prompt module
- `plugins/core/package.json` - Added mustache + @types/mustache dependencies

## Decisions Made

- Config-provided templates override built-in defaults — allows user customization without code changes
- Snippets evaluated lazily using `getRequiredVariables()` regex scan — avoids unnecessary async calls
- Injections joined as `scope.injections` so templates can place them with `{{injections}}`
- `Mustache.escape = (text) => text` set at render time to disable HTML escaping globally

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- PromptService ready for AgentCore (Phase 5) to consume via `ctx["yesimbot.prompt"]`
- AgentCore can call `registerTemplate("system", ...)` and `render("system", horizonScope)` to build LLM prompts

---

_Phase: 04-prompt-tool-services_
_Completed: 2026-02-18_
