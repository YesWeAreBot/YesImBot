# Phase 22: Skill Enhancement & Tech Debt - Research

**Researched:** 2026-02-24
**Domain:** Skill injection point routing, trait-bound lifecycle runtime distinction, type-only export cleanup
**Confidence:** HIGH

## Summary

Phase 22 enhances the existing SkillRegistry (built in Phase 18) to support configurable injection points per skill and resolves two specific tech debt items. The current implementation hardcodes all skill prompt effects to the `"extra"` injection point in `mergeEffects()`. This phase makes that configurable via SKILL.md frontmatter fields (`injection_point` and `style_injection_point`), adds the fields to `SkillDefinition`, and updates the loader and merger accordingly.

The trait-bound lifecycle type already exists in the type system (`LifecycleStrategy = "per-turn" | "sticky" | "trait-bound"`) and is already declared in the `private-chat` SKILL.md. However, `resolve()` currently only handles `per-turn` and `sticky` — trait-bound skills have no special runtime behavior (they are treated as per-turn). DEBT-02 requires trait-bound skills to persist in `channelState` and re-evaluate conditions each turn, removing immediately when conditions are unmet.

DEBT-01 is a straightforward type export fix: `TraitAnalyzerConfig` is currently exported as both a runtime value (empty interface + Schema) and re-exported through `trait/index.ts` and `core/index.ts`. The interface should become type-only.

**Primary recommendation:** Add `injectionPoint` and `styleInjectionPoint` optional fields to `SkillDefinition`, parse them from SKILL.md frontmatter in the loader, use them in `mergeEffects()` instead of hardcoded `"extra"`, and add trait-bound handling to `resolve()` alongside the existing sticky logic.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Single-point injection: one skill's prompt effect targets exactly one injection point
- Default to `extra` when `injection_point` is not specified in SKILL.md frontmatter (backward compatible)
- prompt and style effects can independently specify different injection points
- Two independent frontmatter fields: `injection_point` (for prompt content) and `style_injection_point` (for style effect)
- Trait signal disappears → skill immediately removed from active list (no grace period)
- Reuse existing `conditions` tree to determine whether the bound trait is still present
- Core distinction from per-turn: trait-bound maintains persistent active state in channelState, queryable at runtime
- State isolation: per-channel, consistent with existing sticky behavior
- Multiple skills injecting to the same point: prompt content concatenated, ordered by specificity (higher specificity first)
- Style conflict: global unique — highest specificity wins across all injection points (existing logic preserved)
- No changes to tool filter merge logic (existing include/exclude union)
- Strictly DEBT-01 and DEBT-02 only, no scope expansion
- DEBT-01: TraitAnalyzerConfig becomes type-only export in `trait/index.ts`
- DEBT-02: trait-bound skills recorded in shared channelState Map (alongside sticky), distinguished by `lifecycle` field; each turn re-evaluates conditions, removes immediately when unmet; lifecycle type logged for observability

### Claude's Discretion
- Exact field naming for `style_injection_point` (may adjust if better name emerges)
- ActiveSkillState interface changes to accommodate trait-bound entries
- Log format and verbosity for lifecycle distinction
- Loader validation for invalid injection_point values

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SKILL-01 | Skill effects can specify injection to soul/instructions/memory/extra (not hardcoded extra) | `mergeEffects()` in service.ts line 138 hardcodes `point: "extra"` — add `injectionPoint` field to `SkillDefinition`, read it in `mergeEffects()` with fallback to `"extra"` |
| SKILL-02 | Skill definition file can configure injection point field | Loader (`loader.ts`) parses frontmatter but does not read `injection_point` or `style_injection_point` — add parsing for both fields with validation against `InjectionPoint` type |
| DEBT-01 | TraitAnalyzerConfig becomes type-only export (no runtime value leak) | `trait/index.ts` line 1 exports `TraitAnalyzerConfig` as value export; `trait/service.ts` line 15 defines it as `interface` — change to `export type { TraitAnalyzerConfig }` in index.ts, update `core/index.ts` import accordingly |
| DEBT-02 | trait-bound skills persist across turns until trait deactivates, distinguishable from per-turn at runtime | `resolve()` in service.ts has no trait-bound branch — add channelState tracking for trait-bound (parallel to sticky), re-evaluate conditions each turn, remove immediately when unmet |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| koishi Service | 4.18.x | SkillRegistry extends Service | Project convention per CLAUDE.md |
| gray-matter | ^4.0.3 | Parse YAML frontmatter in SKILL.md | Already in core deps (replaced js-yaml in quick-2) |
| node:fs | built-in | readdir, readFile for skill directories | Already used by loader.ts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:path | built-in | resolve/join for skill directory paths | Path construction in loader |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| String literal validation for injection_point | Zod schema | Overkill for 4-value enum; simple `includes()` check sufficient |

**Installation:** No new packages needed.

## Architecture Patterns

### Relevant File Map
```
core/src/services/skill/
  types.ts          # SkillDefinition, SkillEffect, ConditionNode — ADD injectionPoint fields
  service.ts        # SkillRegistry.resolve() + mergeEffects() — MODIFY both methods
  loader.ts         # loadSkillsFromDir() — ADD frontmatter field parsing + validation
  condition.ts      # evaluateCondition, specificity — NO CHANGES
  index.ts          # re-exports — NO CHANGES
core/src/services/trait/
  service.ts        # TraitAnalyzerConfig interface + Schema — MODIFY export
  index.ts          # re-exports — CHANGE to type-only export for TraitAnalyzerConfig
core/src/index.ts   # Config intersection type — UPDATE import to type-only
core/resources/skills/
  private-chat/SKILL.md   # trait-bound skill — optionally add injection_point demo
  mention-aware/SKILL.md  # per-turn skill — no changes needed
  image-gen/SKILL.md      # sticky skill — no changes needed
```

### Pattern 1: Injection Point Field on SkillDefinition
**What:** Add optional `injectionPoint` and `styleInjectionPoint` fields to `SkillDefinition` interface. Both default to their current hardcoded values when absent.
**When to use:** Every skill definition (file-based and plugin-registered).
**Current state (service.ts:137-141):**
```typescript
// HARDCODED — always "extra"
result.promptInjections.push({
  skillName: skill.name,
  point: "extra",
  content: `<skill name="${skill.name}">${skill.effects.prompt}</skill>`,
});
```
**Target state:**
```typescript
result.promptInjections.push({
  skillName: skill.name,
  point: skill.injectionPoint ?? "extra",
  content: `<skill name="${skill.name}">${skill.effects.prompt}</skill>`,
});
```

### Pattern 2: Frontmatter Parsing for Injection Points
**What:** Loader reads `injection_point` and `style_injection_point` from SKILL.md frontmatter, validates against `INJECTION_POINTS` array, and maps to `SkillDefinition` fields.
**When to use:** File-based skill loading in `loader.ts`.
**Example SKILL.md:**
```yaml
---
name: private-chat
description: Adjusts tone for private/direct message conversations
conditions:
  match:
    dimension: scene
    value: private-chat
lifecycle: trait-bound
injection_point: soul
style_injection_point: soul
effects:
  style:
    content: >
      Use a more casual, intimate tone.
---
```
**Loader change (loader.ts):**
```typescript
import { INJECTION_POINTS, type InjectionPoint } from "../prompt/types";

function validateInjectionPoint(val: unknown, logger: Logger, skillName: string): InjectionPoint | undefined {
  if (val == null) return undefined;
  if (typeof val === "string" && (INJECTION_POINTS as readonly string[]).includes(val)) {
    return val as InjectionPoint;
  }
  logger.warn("Invalid injection_point '%s' in skill %s, using default", val, skillName);
  return undefined;
}

// In loadSkillsFromDir, after parsing frontmatter:
const def: SkillDefinition = {
  // ...existing fields...
  injectionPoint: validateInjectionPoint(meta.injection_point, logger, entry.name),
  styleInjectionPoint: validateInjectionPoint(meta.style_injection_point, logger, entry.name),
};
```

### Pattern 3: Trait-Bound Lifecycle in resolve()
**What:** Add a trait-bound branch to `resolve()` that persists active state in `channelState` and re-evaluates conditions each turn. Unlike sticky (which counts down rounds), trait-bound removes immediately when conditions are unmet.
**When to use:** Every `resolve()` call for skills with `lifecycle: "trait-bound"`.
**Current state (service.ts:88-121):** Only `per-turn` and `sticky` are handled. Trait-bound falls through with no special behavior (acts as per-turn).
**Target state:**
```typescript
if (activated) {
  active.push(skill);
  if (skill.lifecycle === "sticky") {
    state.set(skill.name, {
      lifecycle: "sticky",
      roundsSinceActive: 0,
      stickyTimeout: skill.stickyTimeout ?? this.config.stickyDefaultTimeout ?? 3,
    });
  } else if (skill.lifecycle === "trait-bound") {
    state.set(skill.name, {
      lifecycle: "trait-bound",
      roundsSinceActive: 0,
      stickyTimeout: 0, // unused for trait-bound
    });
  }
} else if (skill.lifecycle === "sticky" && state.has(skill.name)) {
  // ...existing sticky countdown logic...
} else if (skill.lifecycle === "trait-bound" && state.has(skill.name)) {
  // Trait signal gone → immediate removal, no grace period
  state.delete(skill.name);
  this.logger.info("trait-bound skill %s deactivated (trait signal lost)", skill.name);
}
```

### Pattern 4: Prompt Injection Ordering by Specificity
**What:** When multiple skills inject to the same point, sort by specificity (higher first) before concatenation. This is a user-locked decision.
**When to use:** In `mergeEffects()` when building `promptInjections` array.
**Implementation:** Sort the `active` array by specificity before iterating, or sort `promptInjections` per-point after collection.
**Example:**
```typescript
// Sort active skills by specificity descending before merging
const sorted = [...active].sort((a, b) => {
  const specA = a.conditions ? specificity(a.conditions) : 0;
  const specB = b.conditions ? specificity(b.conditions) : 0;
  return specB - specA;
});
```

### Pattern 5: Type-Only Export for TraitAnalyzerConfig (DEBT-01)
**What:** Change `TraitAnalyzerConfig` from a value export to a type-only export in `trait/index.ts` and update the import in `core/index.ts`.
**Current state:**
```typescript
// trait/index.ts line 1
export { TraitAnalyzer, TraitAnalyzerConfig, TraitAnalyzerConfigSchema } from "./service";

// core/index.ts line 19
import type { TraitAnalyzerConfig } from "./services/trait";
```
**Target state:**
```typescript
// trait/index.ts — separate type export
export { TraitAnalyzer, TraitAnalyzerConfigSchema } from "./service";
export type { TraitAnalyzerConfig } from "./service";
```
Note: `core/index.ts` already uses `import type` for `TraitAnalyzerConfig`, so it needs no change. The fix is purely in `trait/index.ts` to prevent the interface from being a runtime export.

### Anti-Patterns to Avoid
- **Adding new injection points:** Out of scope. The 4 points (soul/instructions/memory/extra) are fixed per v2.1 decisions.
- **Grace period for trait-bound:** User decision is immediate removal. Don't add countdown logic like sticky.
- **Separate data structure for trait-bound:** Share `channelState` Map with sticky, distinguish via `lifecycle` field.
- **Validating injection_point at runtime in mergeEffects:** Validate once at load time in loader.ts. By the time `mergeEffects()` runs, the value is already validated or defaulted.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Injection point validation | Custom enum check | `INJECTION_POINTS.includes()` from prompt/types.ts | Single source of truth, already exported |
| Condition re-evaluation for trait-bound | New evaluator | Existing `evaluateCondition()` from condition.ts | Same logic, already tested |
| Specificity calculation | New algorithm | Existing `specificity()` from condition.ts | Already implemented and used for style |
| Channel state tracking | New Map structure | Existing `channelState` Map in SkillRegistry | Already per-channel, just needs trait-bound entries |

**Key insight:** Every building block already exists. The changes are wiring — connecting existing `injectionPoint` field to `mergeEffects()`, connecting existing `evaluateCondition()` to trait-bound lifecycle, and fixing an export keyword.

## Common Pitfalls

### Pitfall 1: Backward Compatibility Break for Existing SKILL.md Files
**What goes wrong:** Existing SKILL.md files without `injection_point` field stop working or inject to wrong point.
**Why it happens:** Loader or mergeEffects doesn't default to `"extra"` when field is absent.
**How to avoid:** Always use `skill.injectionPoint ?? "extra"` in mergeEffects. Loader should leave field as `undefined` when not present in frontmatter (not set to empty string).
**Warning signs:** Existing skills (mention-aware, image-gen) stop appearing in prompt output.

### Pitfall 2: Style Injection Point Ignored by Loop
**What goes wrong:** `styleInjectionPoint` is set in SKILL.md but style still injects to `"soul"` point.
**Why it happens:** Style override injection happens in `loop.ts` (line 82-88), not in `mergeEffects()`. The loop hardcodes `prompt.inject(this.ctx, "soul", ...)` for style.
**How to avoid:** `mergeEffects()` must propagate the winning style's injection point in the `styleOverride` result. The `SkillEffect.styleOverride` type needs a `point` field. Loop reads `effects.styleOverride.point` instead of hardcoding `"soul"`.
**Warning signs:** Style effects always land in `<soul>` regardless of `style_injection_point` setting.

### Pitfall 3: Trait-Bound State Never Cleaned Up on Channel Inactivity
**What goes wrong:** channelState grows unbounded as trait-bound entries accumulate for inactive channels.
**Why it happens:** Trait-bound entries are only removed when conditions are re-evaluated (i.e., when a new message arrives). If a channel goes silent, entries persist forever.
**How to avoid:** This is the same issue sticky already has — both share channelState. Not a new problem for this phase. If needed later, a periodic cleanup can sweep stale channel keys. For now, trait-bound follows the same pattern as sticky (acceptable).
**Warning signs:** Memory growth in long-running instances with many channels.

### Pitfall 4: Type-Only Export Breaking Runtime Schema Access
**What goes wrong:** Making `TraitAnalyzerConfig` type-only accidentally removes `TraitAnalyzerConfigSchema` from exports.
**Why it happens:** Careless edit of the export line in `trait/index.ts`.
**How to avoid:** Split the export line: keep `TraitAnalyzerConfigSchema` as a value export, only change `TraitAnalyzerConfig` to `export type`. The Schema value is still needed at runtime by `core/index.ts` for config validation.
**Warning signs:** Build error: "TraitAnalyzerConfigSchema is not exported".

### Pitfall 5: Specificity Sort Instability
**What goes wrong:** Skills with equal specificity appear in different order across turns, causing prompt content to shift.
**Why it happens:** JavaScript's `Array.sort()` is not guaranteed stable in all engines (though V8 is stable since Node 12+).
**How to avoid:** Use a stable sort or add registration order as tiebreaker. Since Node 12+ (V8) sort is stable, this is low risk but worth noting.
**Warning signs:** Prompt content order flickering between turns for same-specificity skills.

## Code Examples

Verified patterns from codebase analysis:

### SkillDefinition Type Changes (types.ts)
```typescript
// Add to SkillDefinition interface:
export interface SkillDefinition {
  name: string;
  description?: string;
  conditions?: ConditionNode;
  activate?: (signals: TraitSignal[]) => boolean;
  lifecycle: LifecycleStrategy;
  stickyTimeout?: number;
  injectionPoint?: InjectionPoint;       // NEW — defaults to "extra"
  styleInjectionPoint?: InjectionPoint;  // NEW — defaults to "soul"
  effects: SkillEffects;
  source: "file" | "plugin";
}
```

### SkillEffect StyleOverride with Point (types.ts)
```typescript
// Update styleOverride to include injection point:
export interface SkillEffect {
  promptInjections: Array<{
    skillName: string;
    point: InjectionPoint;
    content: string;
  }>;
  styleOverride: { content: string; specificity: number; point: InjectionPoint } | null;
  toolFilter: { include: string[]; exclude: string[] };
}
```

### Updated mergeEffects() (service.ts)
```typescript
private mergeEffects(active: SkillDefinition[]): SkillEffect {
  // Sort by specificity descending for prompt injection ordering
  const sorted = [...active].sort((a, b) => {
    const specA = a.conditions ? specificity(a.conditions) : 0;
    const specB = b.conditions ? specificity(b.conditions) : 0;
    return specB - specA;
  });

  const result: SkillEffect = {
    promptInjections: [],
    styleOverride: null,
    toolFilter: { include: [], exclude: [] },
  };

  let bestStyle: { content: string; specificity: number; point: InjectionPoint } | null = null;

  for (const skill of sorted) {
    if (skill.effects.prompt) {
      result.promptInjections.push({
        skillName: skill.name,
        point: skill.injectionPoint ?? "extra",  // USE FIELD, default "extra"
        content: `<skill name="${skill.name}">${skill.effects.prompt}</skill>`,
      });
    }

    if (skill.effects.style) {
      const spec = skill.conditions ? specificity(skill.conditions) : 0;
      if (!bestStyle || spec >= bestStyle.specificity) {
        bestStyle = {
          content: skill.effects.style.content,
          specificity: spec,
          point: skill.styleInjectionPoint ?? "soul",  // USE FIELD, default "soul"
        };
      }
    }

    // ...tool filter logic unchanged...
  }

  result.styleOverride = bestStyle;
  return result;
}
```

### Updated Loop Style Injection (loop.ts)
```typescript
// Current (hardcoded "soul"):
if (effects.styleOverride) {
  disposers.push(
    prompt.inject(this.ctx, "soul", {
      name: `__skill_style_${percept.id}`,
      after: "__role_soul",
      renderFn: () => effects.styleOverride!.content,
    }),
  );
}

// Target (reads point from effect):
if (effects.styleOverride) {
  disposers.push(
    prompt.inject(this.ctx, effects.styleOverride.point, {
      name: `__skill_style_${percept.id}`,
      ...(effects.styleOverride.point === "soul" ? { after: "__role_soul" } : {}),
      renderFn: () => effects.styleOverride!.content,
    }),
  );
}
```

### Loader Validation (loader.ts)
```typescript
import { INJECTION_POINTS, type InjectionPoint } from "../prompt/types";

function validateInjectionPoint(
  val: unknown,
  logger: Logger,
  skillName: string,
): InjectionPoint | undefined {
  if (val == null) return undefined;
  if (typeof val === "string" && (INJECTION_POINTS as readonly string[]).includes(val)) {
    return val as InjectionPoint;
  }
  logger.warn("Invalid injection_point '%s' in skill %s, using default", val, skillName);
  return undefined;
}
```

### DEBT-01: Type-Only Export Fix (trait/index.ts)
```typescript
// Current:
export { TraitAnalyzer, TraitAnalyzerConfig, TraitAnalyzerConfigSchema } from "./service";

// Target:
export { TraitAnalyzer, TraitAnalyzerConfigSchema } from "./service";
export type { TraitAnalyzerConfig } from "./service";
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded `"extra"` injection point | Configurable per-skill injection point | Phase 22 (this phase) | Skills can target soul/instructions/memory/extra |
| trait-bound treated as per-turn | trait-bound persists in channelState with re-evaluation | Phase 22 (this phase) | Trait-bound skills distinguishable from per-turn at runtime |
| TraitAnalyzerConfig value export | Type-only export | Phase 22 (this phase) | Cleaner module boundary, no runtime leak |

**Deprecated/outdated:**
- Hardcoded `point: "extra"` in `mergeEffects()` — replaced by `skill.injectionPoint ?? "extra"`
- Hardcoded `"soul"` for style injection in loop.ts — replaced by `effects.styleOverride.point`

## Open Questions

1. **Style `after` ordering when injecting to non-soul points**
   - What we know: Currently style override uses `after: "__role_soul"` to position after the role's soul content. When `styleInjectionPoint` is not `"soul"`, this `after` reference is meaningless (no `__role_soul` entry exists in that point).
   - What's unclear: Should there be a default `after` for other points? E.g., `after: "__role_agents"` for instructions point?
   - Recommendation: Only set `after` when the target point has a known anchor. For `"soul"` use `after: "__role_soul"`, for `"instructions"` use `after: "__role_agents"`, for others omit `after` (append to end). This is Claude's discretion per CONTEXT.md.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `core/src/services/skill/service.ts` — SkillRegistry.resolve() and mergeEffects() with hardcoded `"extra"` (line 138)
- Codebase analysis: `core/src/services/skill/types.ts` — SkillDefinition, SkillEffect, LifecycleStrategy types
- Codebase analysis: `core/src/services/skill/loader.ts` — loadSkillsFromDir() frontmatter parsing
- Codebase analysis: `core/src/services/agent/loop.ts` — ThinkActLoop skill effect consumption (lines 66-88)
- Codebase analysis: `core/src/services/trait/service.ts` — TraitAnalyzerConfig interface and Schema export
- Codebase analysis: `core/src/services/trait/index.ts` — Value export of TraitAnalyzerConfig (DEBT-01 target)
- Codebase analysis: `core/src/services/prompt/types.ts` — InjectionPoint type and INJECTION_POINTS array
- Codebase analysis: `core/resources/skills/private-chat/SKILL.md` — Existing trait-bound skill example

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions — User-locked design choices for injection points, trait-bound lifecycle, conflict resolution
- Phase 18 research — Original skill system design rationale and patterns

### Tertiary (LOW confidence)
- None — all findings verified against codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, all libraries already in use
- Architecture: HIGH — changes are surgical modifications to existing code (4 files touched, ~30 lines changed)
- Pitfalls: HIGH — identified from actual code paths and data flow analysis

**Research date:** 2026-02-24
**Valid until:** 2026-03-24 (stable — internal architecture, no external API changes)
