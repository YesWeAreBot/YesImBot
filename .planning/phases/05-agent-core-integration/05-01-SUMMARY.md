---
phase: 05-agent-core-integration
plan: 01
subsystem: agent
tags: [ai-sdk, koishi-service, tool-adapter, session-queue]

requires:
  - phase: 04-prompt-plugin-system
    provides: PluginService with getTools()/invoke() API
  - phase: 03-horizon-context-system
    provides: HorizonService and horizon/percept event
provides:
  - AgentCore Koishi Service at yesimbot.agent
  - buildAiSdkTools adapter converting PluginService tools to ai-sdk ToolSet
  - finishTool stop signal for think-act loop
  - Per-channel session queue with pending Percept replacement
affects: [05-02-agent-think-act-loop]

tech-stack:
  added: []
  patterns:
    - "ai-sdk v6 Tool as plain object with inputSchema (not parameters)"
    - "ToolSet satisfies constraint for type-safe tool map"
    - "Promise chain queue per channel key for session isolation"

key-files:
  created:
    - plugins/core/src/services/agent/config.ts
    - plugins/core/src/services/agent/tools.ts
    - plugins/core/src/services/agent/service.ts
    - plugins/core/src/services/agent/index.ts
  modified: []

key-decisions:
  - "ai-sdk v6 has no tool() function — Tool is a plain object type with inputSchema field"
  - "ToolSet from ai used as return type for buildAiSdkTools (avoids @ai-sdk/provider-utils direct import)"
  - "finishTool included in buildAiSdkTools output under 'finish' key"
  - "enqueue uses .finally() to clean up queues map only when chain reference matches"

patterns-established:
  - "Tool objects: { description, inputSchema: jsonSchema(...), execute } satisfies ToolSet[string]"

requirements-completed: [AGENT-01]

duration: 8min
completed: 2026-02-18
---

# Phase 5 Plan 01: AgentCore Skeleton Summary

**AgentCore Koishi Service with per-channel session queue, ai-sdk v6 tool adapter converting PluginService definitions to ToolSet, and finishTool stop signal**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-02-18T00:00:00Z
- **Completed:** 2026-02-18T00:08:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- AgentCore registered as Koishi Service at `yesimbot.agent` with `horizon/percept` listener
- Per-channel promise chain queue with latest-wins pending Percept replacement
- `buildAiSdkTools` converts all PluginService tools to ai-sdk v6 `ToolSet` format with truncation
- `finishTool` and `buildStopCondition` ready for Plan 02 think-act loop

## Task Commits

1. **Task 1: AgentCore config with AgentIdentity and tool adapter** - `ed5d59b` (feat)
2. **Task 2: AgentCore Service with session queue and percept listener** - `4281a54` (feat)

## Files Created/Modified

- `plugins/core/src/services/agent/config.ts` - AgentCoreConfig + AgentIdentity interfaces
- `plugins/core/src/services/agent/tools.ts` - buildAiSdkTools, finishTool, buildStopCondition
- `plugins/core/src/services/agent/service.ts` - AgentCore Service with queue and percept listener
- `plugins/core/src/services/agent/index.ts` - Barrel exports

## Decisions Made

- ai-sdk v6 has no `tool()` function — `Tool` is a plain object type with `inputSchema` (not `parameters`). Used `satisfies ToolSet[string]` for type safety without importing from transitive `@ai-sdk/provider-utils`.
- `finishTool` included directly in `buildAiSdkTools` output under the `"finish"` key so callers get a single complete ToolSet.
- `enqueue` uses `.finally()` with reference equality check to avoid premature queue cleanup when recursive enqueue replaces the chain.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ai-sdk v6 API mismatch: no tool() function, inputSchema not parameters**

- **Found during:** Task 1 (tools.ts implementation)
- **Issue:** Plan specified `tool()` function and `parameters` field from ai-sdk, but ai v6.0.90 uses plain object `Tool` type with `inputSchema` field. No `tool()` helper exists.
- **Fix:** Rewrote tools.ts using plain object literals with `inputSchema: jsonSchema(...)` and `satisfies ToolSet[string]` constraint. Imported `ToolSet` from `ai` instead of `Tool` from transitive `@ai-sdk/provider-utils`.
- **Files modified:** plugins/core/src/services/agent/tools.ts
- **Verification:** `npx tsc --noEmit -p plugins/core/tsconfig.json` passes
- **Committed in:** ed5d59b (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - API mismatch)
**Impact on plan:** Required fix for correctness. Functionally equivalent to plan intent.

## Issues Encountered

- ai-sdk v6 breaking change from v3/v4 API: `tool()` helper removed, `Tool` is now a plain object type. Resolved by reading package type declarations directly.

## Next Phase Readiness

- AgentCore skeleton complete, Plan 02 can implement `runLoop` with generateText/streamText
- `buildAiSdkTools` and `buildStopCondition` ready for use in think-act loop
- No blockers

---

_Phase: 05-agent-core-integration_
_Completed: 2026-02-18_

## Self-Check: PASSED

- FOUND: plugins/core/src/services/agent/config.ts
- FOUND: plugins/core/src/services/agent/tools.ts
- FOUND: plugins/core/src/services/agent/service.ts
- FOUND: plugins/core/src/services/agent/index.ts
- FOUND: commit ed5d59b (Task 1)
- FOUND: commit 4281a54 (Task 2)
