---
phase: 04-prompt-tool-services
plan: 02
subsystem: plugin
tags: [koishi-service, decorators, tool-calling, json-schema, ai-sdk]

requires:
  - phase: 02-model-service
    provides: Service subclass pattern used for PluginService
  - phase: 03-horizon-context-system
    provides: HorizonView/Percept types used in FunctionContext
  - phase: 04-01
    provides: PromptService pattern and index.ts wiring approach

provides:
  - PluginService Koishi Service registered as yesimbot.plugin
  - FunctionType/ToolResult/FunctionContext/FunctionDefinition types
  - Success/Failed result helpers
  - schemaToJSONSchema Koishi->JSON Schema converter
  - "@Tool/@Action/@Metadata legacy TS decorators"
  - Plugin abstract base class with tools/actions Maps
  - CorePlugin with send_message Action
  - SessionInfoPlugin with get_session_info Tool

affects: [05-agent-core, phase-5]

tech-stack:
  added: []
  patterns:
    - Decorator-based tool registration via @Tool/@Action on Plugin subclass methods
    - Plugin base class reads prototype metadata arrays in constructor to populate Maps
    - PluginService traverses all registered plugins to dispatch by function name

key-files:
  created:
    - plugins/core/src/services/plugin/types.ts
    - plugins/core/src/services/plugin/utils.ts
    - plugins/core/src/services/plugin/schema.ts
    - plugins/core/src/services/plugin/decorators.ts
    - plugins/core/src/services/plugin/base-plugin.ts
    - plugins/core/src/services/plugin/service.ts
    - plugins/core/src/services/plugin/index.ts
    - plugins/core/src/services/plugin/builtin/send-message.ts
    - plugins/core/src/services/plugin/builtin/session-info.ts
    - plugins/core/src/services/plugin/builtin/index.ts
  modified:
    - plugins/core/src/index.ts
    - tsconfig.base.json

key-decisions:
  - "experimentalDecorators added to tsconfig.base.json for legacy TS decorator support"
  - "Schema.dict (not schema.list) stores object properties in Koishi Schema — schemaToJSONSchema uses dict iteration"
  - "Plugin base class reads __staticTools/__staticActions from prototype (set by decorators) in constructor"
  - "PluginService.invoke() uses Promise.race with setTimeout for timeout — no external dependency"

patterns-established:
  - "Plugin pattern: extend Plugin, use @Metadata/@Tool/@Action decorators, register with PluginService"
  - "FunctionContext pattern: pass session/view/percept through invoke() for handler access"

requirements-completed: [TOOL-01, TOOL-02]

duration: 8min
completed: 2026-02-18
---

# Phase 4 Plan 02: PluginService Summary

**Decorator-based PluginService with @Tool/@Action registration, Koishi Schema->JSON Schema conversion, timeout-guarded invoke(), and two built-in tools (send_message, get_session_info)**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-02-18
- **Completed:** 2026-02-18
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments

- PluginService registered as `yesimbot.plugin` Koishi Service with full declaration merging
- @Tool/@Action/@Metadata legacy TS decorators attach metadata to Plugin subclass prototypes
- Plugin base class reads decorator metadata in constructor and populates tools/actions Maps
- schemaToJSONSchema converts Koishi Schema (using `dict` field for object properties) to JSON Schema
- PluginService.invoke() dispatches by name with configurable timeout via Promise.race
- getTools() returns ai-sdk compatible tool format array
- CorePlugin (send_message Action) and SessionInfoPlugin (get_session_info Tool) registered on ready

## Task Commits

1. **Task 1: Types, utils, schema converter, decorators, Plugin base class** - `8df2a67` (feat)
2. **Task 2: PluginService, built-in tools, core plugin wiring** - `60a1d77` (feat)

## Files Created/Modified

- `plugins/core/src/services/plugin/types.ts` - FunctionType enum, ToolResult, FunctionContext, FunctionDefinition, PluginMetadata, PluginServiceConfig
- `plugins/core/src/services/plugin/utils.ts` - Success/Failed result helpers
- `plugins/core/src/services/plugin/schema.ts` - schemaToJSONSchema using Schema.dict for object properties
- `plugins/core/src/services/plugin/decorators.ts` - @Tool/@Action/@Metadata decorators, defineTool/defineAction, withInnerThoughts
- `plugins/core/src/services/plugin/base-plugin.ts` - Plugin abstract base class reading decorator metadata
- `plugins/core/src/services/plugin/service.ts` - PluginService with register/invoke/getTools/listPlugins
- `plugins/core/src/services/plugin/index.ts` - Re-exports for plugin module
- `plugins/core/src/services/plugin/builtin/send-message.ts` - CorePlugin with send_message Action
- `plugins/core/src/services/plugin/builtin/session-info.ts` - SessionInfoPlugin with get_session_info Tool
- `plugins/core/src/services/plugin/builtin/index.ts` - Built-in plugin exports
- `plugins/core/src/index.ts` - Wires PromptService + PluginService, registers built-ins on ready
- `tsconfig.base.json` - Added experimentalDecorators: true

## Decisions Made

- experimentalDecorators added to tsconfig.base.json — required for legacy TS decorator syntax used by @Tool/@Action
- Koishi Schema stores object properties in `schema.dict` (not `schema.list`) — discovered during typecheck, fixed schemaToJSONSchema accordingly
- Plugin base class reads `__staticTools`/`__staticActions` from prototype (populated by decorators at class definition time) in constructor — enables decorator-to-instance binding
- Promise.race with setTimeout for invoke() timeout — no external dependency needed

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] schemaToJSONSchema used schema.list for object properties instead of schema.dict**

- **Found during:** Task 1 (schema.ts creation)
- **Issue:** Plan specified iterating `schema.list` for object properties, but Koishi Schema stores object properties in `schema.dict` (a `Dict<Schema>` / `Record<string, Schema>`)
- **Fix:** Changed to iterate `Object.entries(schema.dict ?? {})` — key comes from dict entry, not from meta.key
- **Files modified:** plugins/core/src/services/plugin/schema.ts
- **Verification:** tsc --noEmit passes with no TS2339 errors
- **Committed in:** 8df2a67 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug in plan spec)
**Impact on plan:** Essential correctness fix — schemaToJSONSchema would have produced empty properties for all object schemas without this fix.

## Issues Encountered

None beyond the schema.dict deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- PluginService ready for AgentCore (Phase 5) to consume via `ctx["yesimbot.plugin"]`
- AgentCore can call `getTools()` to get ai-sdk compatible tool definitions for LLM
- AgentCore can call `invoke(name, params, { session })` to execute tool calls from LLM
- Both PromptService and PluginService are wired and registered in core plugin

---

_Phase: 04-prompt-tool-services_
_Completed: 2026-02-18_
