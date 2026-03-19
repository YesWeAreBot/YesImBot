# Hook Coverage Contract

> **Phase 64 update:** Message-hook interception was removed. Athena hooks now cover only agent and tool lifecycle interception. Message send operations proceed without hook interception.

## Runtime Activation Status

Hook coverage is only meaningful when runtime activation order is correct.

- Activation precondition: `HookService` must be registered before `PluginService` and `AgentCore`.
- Current startup wiring: `core/src/index.ts` calls `ctx.plugin(HookService)` before both runtime consumers.
- Runtime assertion coverage: `core/tests/hook-runtime-registration.test.ts` guards startup registration and ordering.

This contract reflects the activated runtime used by Phase 47 hook-runtime regression tests.

## Overview

Athena hooks are interception points for user-facing runtime flows. The system distinguishes:

- Hooked runtime paths: tool, message, and agent interception chains.
- Hooked runtime paths: tool and agent interception chains.
- intentionally unhooked path: internal error-reporting transport for fail-safe reliability.

## Hooked Runtime Paths

### 1. Tool Path (`HookType.Tool`)

- Entry point: `PluginService.executeRoundActions` (coordination facade called by `ThinkActLoop`)
- Source: `core/src/services/plugin/service.ts`
- Hook calls:
  - `executeBefore(HookType.Tool, ...)`
  - `executeAfter(HookType.Tool, ...)`

Ownership boundary:

- `yesimbot.plugin` is the coordination facade + tool runtime owner for round execution orchestration.
- `yesimbot.hook` remains the hook runtime owner and executes before/after/error semantics.
- `yesimbot.skill` remains the skill runtime owner; skill registration/lifecycle are not absorbed into hook runtime.

Coverage evidence:

- `core/tests/hook-runtime-interception.test.ts` (before/skip propagation)
- `core/tests/hook-timeout.test.ts` (timeout precedence contract)
- `core/tests/hook-error-isolation.test.ts` (unit isolation guarantees)
- `core/tests/hook-runtime-resilience.test.ts` (runtime timeout/error isolation)

### 2. Agent Path (`HookType.Agent`)

- Entry point: `ThinkActLoop.run`
- Source: `core/src/services/agent/loop.ts`
- Hook calls:
  - `executeAgentStart(...)` / `executeBefore(HookType.Agent, ...)` (`lifecycle=start`)
  - `executeAgentEnd(...)` / `executeAfter(HookType.Agent, ...)` (`lifecycle=end`)
- End settlement payload:
  - canonical `roundContext` snapshot used by runtime consumers
  - `endSummary.finalOutcome` for settled status and action/tool counts
  - `endSummary.incidents` for recovered/non-recovered diagnostics

Coverage evidence:

- `core/tests/hook-runtime-interception.test.ts` (context mutation propagation)
- `core/tests/hook-runtime-resilience.test.ts` (runtime continuation when hooks fail)
- `core/tests/agent-lifecycle-end.test.ts` (exactly-once end boundary across success/silent/skip/failure/recovered-error)

## intentionally unhooked Path (Fail-Safe Boundary)

### Error Reporting Transport

- Path: direct `bot.sendMessage(channelId, summary).catch(() => {})`
- Source: `core/src/services/agent/service.ts` (`reportError`)
- Coverage: intentionally unhooked
- Ordering rule: run only after started-round lifecycle closure has settled (`agent end` first, fail-safe transport second)

Rationale:

- Error reporting is a system-level reliability channel.
- Hook interception here could suppress or mutate critical failure notifications.
- If hooks are unhealthy, error reporting still must succeed best-effort.

## Timeout and Error Isolation Guarantees

### Timeout contract

- Precedence: call override > hook timeout > default timeout (5000ms).
- Timeout behavior:
  - Slow before hooks fail open (runtime continues with original params).
  - Slow after hooks do not block completed user-facing outcomes.

Evidence:

- `core/tests/hook-timeout.test.ts`
- `core/tests/hook-runtime-resilience.test.ts`
- `core/tests/agent-lifecycle-end.test.ts`

### Error isolation contract

- Throwing hooks are isolated (warning logged, chain continues).
- Later hooks in the same phase still execute.
- Runtime tool/agent outcomes remain available by default.

Evidence:

- `core/tests/hook-error-isolation.test.ts`
- `core/tests/hook-runtime-resilience.test.ts`

## Requirement Trace (Phase 47)

- HOOK-03: runtime activation/order is enforced by startup and registration tests.
- HOOK-06: timeout semantics verified both at unit hook API level and runtime interception level.
- HOOK-07: error isolation verified both at unit hook API level and runtime interception level.

Phase 47 regression anchor:

- `core/tests/hook-runtime-resilience.test.ts` (hook-runtime timeout and error isolation continuation)

## Related References

- Hook API: `core/src/services/hook/service.ts`
- Runtime tool/agent loop: `core/src/services/agent/loop.ts`
- Fail-safe error reporting: `core/src/services/agent/service.ts`
