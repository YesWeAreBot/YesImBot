---
phase: 05-agent-core-integration
plan: 02
subsystem: agent
tags: [think-act-loop, model-service, send-message, agent-wiring]

requires:
  - phase: 05-01
    provides: AgentCore skeleton, buildAiSdkTools, finishTool, buildStopCondition
  - phase: 04-prompt-plugin-system
    provides: PluginService.invoke(), PromptService.render()
  - phase: 03-horizon-context-system
    provides: HorizonService.buildView(), formatHorizonText(), EventManager.recordAgentSummary()
  - phase: 02-model-service
    provides: ModelService.call(), ModelService.streamCall()
provides:
  - ThinkActLoop class routing LLM calls through ModelService
  - Enhanced send_message with <sep/> splitting and cross-channel target
  - AgentCore wired into core plugin with full config schema
affects: []

tech-stack:
  added: []
  patterns:
    - "Route LLM calls through ModelService.call()/streamCall() — never raw generateText/streamText"
    - "as CallParams cast to pass tools/toolChoice/stopWhen through ModelService spread"
    - "Promise.race with setTimeout for global loop timeout"
    - "PerceptType enum discriminant for type guard before buildView()"

key-files:
  created:
    - plugins/core/src/services/agent/loop.ts
  modified:
    - plugins/core/src/services/agent/service.ts
    - plugins/core/src/services/plugin/builtin/send-message.ts
    - plugins/core/src/index.ts

key-decisions:
  - "Config interface does not extend AgentCoreConfig — fields declared inline to avoid Schema type inference conflict with provider/model field name collision"
  - "ThinkActLoop.run() takes Percept (not UserMessagePercept) and applies PerceptType.UserMessage type guard before buildView()"
  - "as CallParams cast used to pass tools/toolChoice/stopWhen through ModelService — these pass through generateText spread at runtime"

duration: 10min
completed: 2026-02-18
---

# Phase 5 Plan 02: Think-Act Loop Summary

**ThinkActLoop routing LLM calls through ModelService with type-guarded percept handling, <sep/>-splitting send_message, and AgentCore wired into core plugin config**

## Performance

- **Duration:** ~10 min
- **Completed:** 2026-02-18
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- `ThinkActLoop.run()` routes all LLM calls through `ModelService.call()`/`streamCall()` — preserving PQueue concurrency, fallback chains, and usage tracking
- `PerceptType.UserMessage` type guard rejects non-UserMessage percepts before `buildView()`
- Global timeout via `Promise.race` with `setTimeout` wraps the ModelService call
- `AgentSummary` recorded in Timeline after loop completion via `EventManager.recordAgentSummary()`
- `send_message` splits content on `<sep/>` and supports cross-channel `target` parameter
- `AgentCore` wired into core plugin `apply()` with full config schema

## Task Commits

1. **Task 1: ThinkActLoop and send_message enhancement** - `35a37f3` (feat)
2. **Task 2: Wire AgentCore into core plugin with config** - `fd2e398` (feat)

## Files Created/Modified

- `plugins/core/src/services/agent/loop.ts` — ThinkActLoop class with ModelService routing, type guard, timeout, summary recording
- `plugins/core/src/services/agent/service.ts` — runLoop delegates to ThinkActLoop.run() with error handling
- `plugins/core/src/services/plugin/builtin/send-message.ts` — <sep/> splitting, target parameter, cross-channel send
- `plugins/core/src/index.ts` — AgentCore plugin registration, agent config schema fields

## Decisions Made

- `Config` interface does not extend `AgentCoreConfig` — the `provider`/`model` fields in `AgentCoreConfig` conflict with Koishi Schema type inference when the object schema doesn't include them. Fields declared inline as `agentProvider`/`agentModel` instead.
- `ThinkActLoop.run()` takes `Percept` (not `UserMessagePercept`) and applies `PerceptType.UserMessage` type guard before `buildView()` — future-proofs for additional percept types.
- `as CallParams` cast used to pass `tools`/`toolChoice`/`stopWhen` through `ModelService` — these properties pass through `generateText`/`streamText` via object spread at runtime.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Config interface extends AgentCoreConfig caused Schema type error**

- **Found during:** Task 2 (index.ts update)
- **Issue:** Extending `AgentCoreConfig` in `Config` interface caused `Schema<Config>` type mismatch — the Schema object was missing `provider`/`model` fields (mapped to `agentProvider`/`agentModel`), and Koishi Schema inference requires all interface fields to be present.
- **Fix:** Removed `extends AgentCoreConfig` from `Config` interface. Declared agent fields inline as `agentProvider`/`agentModel` (already planned) plus `maxRounds`, `streamMode`, `globalTimeout`, `maxToolResultLength` directly on `Config`.
- **Files modified:** plugins/core/src/index.ts
- **Commit:** fd2e398 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - type error)
**Impact on plan:** No functional change. Config schema exposes all planned fields.

## Self-Check: PASSED

- FOUND: plugins/core/src/services/agent/loop.ts
- FOUND: plugins/core/src/services/agent/service.ts (modified)
- FOUND: plugins/core/src/services/plugin/builtin/send-message.ts (modified)
- FOUND: plugins/core/src/index.ts (modified)
- FOUND: commit 35a37f3 (Task 1)
- FOUND: commit fd2e398 (Task 2)
