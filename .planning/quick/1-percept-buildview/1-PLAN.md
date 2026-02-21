---
phase: quick
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - core/src/services/shared/types.ts
  - core/src/services/agent/types.ts
  - core/src/services/horizon/types.ts
  - core/src/services/horizon/service.ts
  - core/src/services/horizon/listener.ts
  - core/src/services/agent/loop.ts
  - core/src/services/agent/service.ts
  - core/src/services/agent/willingness.ts
  - core/src/services/plugin/types.ts
autonomous: true
requirements: [QUICK-01]

must_haves:
  truths:
    - "No bidirectional imports between agent/ and horizon/ modules"
    - "buildView accepts a single percept object with optional session, not separate args"
    - "Shared types (TriggerType, Scope, BasePerceptRef) live in one shared location"
    - "All existing functionality unchanged — typecheck passes"
  artifacts:
    - path: "core/src/services/shared/types.ts"
      provides: "TriggerType, Scope, BasePerceptRef shared types"
    - path: "core/src/services/agent/types.ts"
      provides: "Percept types importing from shared"
    - path: "core/src/services/horizon/types.ts"
      provides: "Horizon types importing from shared"
  key_links:
    - from: "core/src/services/agent/types.ts"
      to: "core/src/services/shared/types.ts"
      via: "import { Scope, TriggerType, BasePerceptRef }"
      pattern: "from.*shared/types"
    - from: "core/src/services/horizon/types.ts"
      to: "core/src/services/shared/types.ts"
      via: "import { TriggerType, Scope, BasePerceptRef }"
      pattern: "from.*shared/types"
---

<objective>
Unify shared types and simplify the buildView interface.

Purpose: Eliminate bidirectional imports between agent/ and horizon/ modules, consolidate BasePerceptRef/TriggerType/Scope into a shared location, and simplify buildView's signature so callers pass a single percept (with optional runtime) instead of separate args.

Output: Clean type hierarchy with no circular dependencies, simpler buildView call site.
</objective>

<context>
@core/src/services/agent/types.ts
@core/src/services/agent/loop.ts
@core/src/services/agent/service.ts
@core/src/services/agent/willingness.ts
@core/src/services/horizon/types.ts
@core/src/services/horizon/service.ts
@core/src/services/horizon/listener.ts
@core/src/services/plugin/types.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extract shared types into core/src/services/shared/types.ts</name>
  <files>
    core/src/services/shared/types.ts
    core/src/services/agent/types.ts
    core/src/services/horizon/types.ts
    core/src/services/horizon/listener.ts
    core/src/services/agent/willingness.ts
    core/src/services/plugin/types.ts
  </files>
  <action>
    Create `core/src/services/shared/types.ts` containing:
    - `TriggerType` (move from agent/types.ts)
    - `Scope` (move from horizon/types.ts)
    - `BasePerceptRef` (move from horizon/types.ts)

    Update imports in all consumers:
    - `agent/types.ts`: import `Scope`, `TriggerType`, `BasePerceptRef` from `../shared/types` (remove `Scope` import from `../horizon/types`)
    - `horizon/types.ts`: import `TriggerType`, `Scope`, `BasePerceptRef` from `../shared/types` (remove `TriggerType` import from `../agent/types`, remove local `Scope` and `BasePerceptRef` definitions, re-export them for backward compat)
    - `horizon/listener.ts`: import `TriggerType` from `../shared/types` (instead of `../agent/types`)
    - `agent/willingness.ts`: import `TriggerType` from `./types` still works (agent/types re-exports it)
    - `plugin/types.ts`: imports from `../agent/types` and `../horizon/types` remain valid (re-exports)

    Key constraint: horizon/types.ts MUST re-export `{ Scope, BasePerceptRef }` so existing external consumers are not broken. agent/types.ts MUST re-export `{ TriggerType }` similarly.
  </action>
  <verify>Run `yarn typecheck` from repo root — must pass with zero errors.</verify>
  <done>TriggerType, Scope, BasePerceptRef defined once in shared/types.ts. No direct imports between agent/types and horizon/types. Re-exports preserve backward compatibility.</done>
</task>

<task type="auto">
  <name>Task 2: Simplify buildView signature and call sites</name>
  <files>
    core/src/services/horizon/service.ts
    core/src/services/agent/loop.ts
    core/src/services/agent/service.ts
  </files>
  <action>
    In `core/src/services/shared/types.ts` (created in Task 1), add a `PerceptInput` interface:
    ```ts
    export interface PerceptInput extends BasePerceptRef {
      runtime?: { session: Session };
    }
    ```
    Import `Session` from koishi as type-only.

    In `horizon/service.ts`:
    - Change `buildView(percept: BasePerceptRef, runtime?: HorizonMessageEvent["runtime"])` to `buildView(percept: PerceptInput)`.
    - Inside buildView, replace `runtime` references with `percept.runtime`.
    - Remove the now-unused `HorizonMessageEvent` import if it becomes unused (check — it may still be used elsewhere; only remove if truly unused).

    In `agent/loop.ts`:
    - Change `horizon.buildView(userPercept, userPercept.runtime)` to `horizon.buildView(userPercept)`.
    - `UserMessagePercept` already has `runtime?: { session: Session }` and extends `BasePercept` which has `id, type, scope, timestamp` — it satisfies `PerceptInput` structurally.

    In `agent/service.ts`:
    - Change `horizon.buildView(percept, percept.runtime)` (in executeDeferredJudgment) to `horizon.buildView(percept)`.
    - Remove the `HorizonMessageEvent` type import if no longer needed.
  </action>
  <verify>Run `yarn typecheck` from repo root — must pass. Grep for `buildView(.*,` to confirm no two-arg calls remain.</verify>
  <done>buildView accepts a single PerceptInput object. All call sites pass one argument. No `HorizonMessageEvent["runtime"]` type extraction in signatures.</done>
</task>

</tasks>

<verification>
1. `yarn typecheck` passes with zero errors
2. `grep -rn "buildView(.*," core/src/` shows no two-argument calls
3. `grep -rn "from.*agent/types" core/src/services/horizon/` returns no results (no horizon->agent imports)
4. `grep -rn "from.*horizon/types" core/src/services/agent/` returns no results (no agent->horizon imports)
</verification>

<success_criteria>
- Shared types in one location, no bidirectional module imports
- buildView takes single percept argument
- All typecheck passes, no runtime behavior changes
</success_criteria>

<output>
After completion, create `.planning/quick/1-percept-buildview/1-SUMMARY.md`
</output>
