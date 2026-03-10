# Athena Change Guide

This guide describes concrete edit paths for common changes.

## Quick Reference

| Change Type                     | Primary Paths                                                                      | Notes                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Add/modify agent behavior       | `core/src/services/agent/`, `core/src/services/trait/`, `core/src/services/skill/` | Keep Trait/Skill responsibilities separate                   |
| Change runtime context contract | `core/src/services/runtime/`, `core/src/services/shared/context-factory.ts`        | Prefer `Percept -> Scenario -> Capabilities -> RoundContext` |
| Add model provider capability   | `providers/provider-*/`, `packages/shared-model/`                                  | Reuse `AbstractProvider`                                     |
| Add/modify tool or action       | `core/src/services/plugin/`, `plugins/*`                                           | Preserve Tool vs Action loop semantics                       |
| Change prompt composition       | `core/src/services/prompt/`, `core/src/services/role/`, `core/resources/roles/`    | Keep 4 injection points stable                               |
| Change horizon data formatting  | `core/src/services/horizon/`                                                       | Do not embed decisions in Horizon                            |
| Change willingness algorithm    | `core/src/services/agent/willingness.ts`, `core/src/services/agent/service.ts`     | Validate deferred judge + rate limit behavior                |

## Common Change Patterns

## 1) Adding a New Service Feature

1. Define/update related types first.
2. Implement in target service module under `core/src/services/<name>/`.
3. Wire dependency via `static inject`.
4. Expose minimal API surface through service methods/events.
5. Add tests in `core/tests/`.

## 2) Adding or Updating a Tool Plugin

1. Implement or edit plugin in `plugins/<plugin>/src/index.ts`.
2. Register functions via plugin tooling (`FunctionType.Tool` or `FunctionType.Action`).
3. Keep parameter schema strict and descriptive.
4. Ensure return payload is parse-friendly and bounded.
5. Verify skill integration if the tool should be conditionally available.

Runtime context note (Phase 54+): prefer `ToolExecutionContext.roundContext` / `ToolExecutionContext.scenario` / `ToolExecutionContext.capabilities`. `ToolExecutionContext.view` (`HorizonView`) is a legacy compatibility field and should be treated as Horizon-internal / adapter-only.

## 3) Prompt and Role Changes

1. Edit role resources in `core/resources/roles/`.
2. Adjust renderer/injection behavior in `core/src/services/prompt/` only if needed.
3. Verify ordering assumptions (`__role_soul`, `__role_tools`, skill injections).
4. Test with at least one tool-calling and one no-tool conversation.

## 4) Provider Changes

1. Edit provider package (`providers/provider-*/src/index.ts`).
2. Keep provider config schema aligned with `packages/shared-model/src/providers/schema-factory.ts`.
3. Avoid leaking provider-specific behavior into shared abstractions.
4. Run typecheck across workspace.

## 5) Willingness Logic Changes

1. Update formula/config schema in `core/src/services/agent/willingness.ts`.
2. Verify call path in `core/src/services/agent/service.ts`.
3. Confirm DM/group rate limiter behavior remains consistent.
4. Add/adjust unit tests for edge thresholds and decay behavior.

## Architecture Rules

- Service creation must use `Service` subclass pattern.
- Avoid direct cross-layer shortcuts; follow declared service boundaries.
- Horizon is context data provider, not response decider.
- Tool fetch operations should continue loop; action operations should end round.

## Testing Checklist

- `yarn typecheck`
- `yarn test -p core` (or focused test command)
- `yarn build` for integrated validation

## Common Pitfalls

1. Editing service logic without updating `inject` dependencies.
2. Mixing prompt composition concerns into unrelated services.
3. Returning oversized tool payloads that exceed loop limits.
4. Forgetting provider fallback behavior when changing model call paths.
5. Breaking Tool/Action semantics and causing loop termination regressions.
