# Phase 19: Integration & Validation - Research

**Researched:** 2026-02-23
**Domain:** Trait-Skill pipeline integration into ThinkActLoop
**Confidence:** HIGH

## Summary

This phase wires the existing TraitAnalyzer and SkillRegistry services into ThinkActLoop's execution path, and creates example skills to validate the end-to-end pipeline. All building blocks exist: TraitAnalyzer.analyze() returns TraitSignal[], SkillRegistry.resolve() returns SkillEffect with promptInjections/styleOverride/toolFilter, and PromptService.inject() supports temporary injections with dispose cleanup.

The integration point is clear: in ThinkActLoop.run(), after buildView() and before prompt.renderToString(), call trait.analyze() then skill.resolve(), then apply the three effect types via prompt.inject() calls (cleaned up in the existing finally block). Tool filtering requires a small addition to buildToolSchemaForPrompt to accept include/exclude lists.

**Primary recommendation:** Wire trait/skill calls into loop.ts between buildView and renderToString, apply effects as temporary injections with percept.id-suffixed names, and create three example skills (private-chat, image-gen with code activator, mention-aware) to validate all three effect types.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Pipeline integration point: buildView -> trait.analyze() -> skill.resolve() -> inject effects -> renderToString
- Loop calls trait/skill services directly via ctx service injection (ctx['yesimbot.trait'], ctx['yesimbot.skill'])
- trait/skill are required dependencies — agent service declares inject
- One percept triggers one trait/skill resolution (no per-round re-analysis)
- Three example skills covering three effect types:
  - `private-chat` (existing) -> style effect, scope:isDirect trigger
  - `image-gen` (rewrite) -> tools effect, code activator with keyword matching (draw/paint etc.)
  - `mention-aware` (new) -> prompt effect, scope:isMentioned trigger (actually attention:mentioned)
- Effect application:
  - promptInjections: prompt.inject() with temporary injection, dispose on loop end, unique names
  - styleOverride: inject to style point, same temporary pattern
  - toolFilter: include/exclude applied in buildToolSchemaForPrompt
- Regression: typecheck + build pass, manual e2e testing, no automated tests

### Claude's Discretion
- Injection name uniqueness scheme (percept.id suffix or other)
- buildToolSchemaForPrompt toolFilter integration details
- mention-aware skill prompt copy

### Deferred Ideas (OUT OF SCOPE)
- IntentTrait detector
- TopicTrait detector (TRAIT-06)
- RelationTrait detector (TRAIT-07)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SKILL-05 | Built-in 1-2 example skills validating the complete system | Three skills planned: private-chat (style), image-gen (tools+code activator), mention-aware (prompt). Pipeline integration in loop.ts enables all three to function end-to-end. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| koishi | 4.x | Framework — Service, Context, inject | Already in use, provides lifecycle management |
| js-yaml | existing | SKILL.md frontmatter parsing | Already used by skill loader |
| mustache | existing | Template rendering | Already used by HorizonService and PromptService |

### Supporting
No new dependencies needed. All integration uses existing service APIs.

## Architecture Patterns

### Pattern 1: Pipeline Integration in ThinkActLoop.run()

**What:** Insert trait analysis and skill resolution between buildView() and prompt rendering.
**When to use:** Every percept triggers this pipeline exactly once.

Current flow in loop.ts:
```
buildView() -> buildToolSchemaForPrompt() -> prompt.inject(tool_schema) -> renderToString()
```

New flow:
```
buildView() -> trait.analyze(scope, view) -> skill.resolve(signals, scope)
  -> apply promptInjections via prompt.inject()
  -> apply styleOverride via prompt.inject() to "style" point
  -> buildToolSchemaForPrompt(pluginService, toolCtx, toolFilter)
  -> prompt.inject(tool_schema)
  -> renderToString()
```

**Key code location:** `/home/workspace/Athena/core/src/services/agent/loop.ts` lines 38-62

```typescript
// After buildView (line 46-50), before tool schema injection (line 55-59):
const trait = this.ctx["yesimbot.trait"] as TraitAnalyzer;
const skill = this.ctx["yesimbot.skill"] as SkillRegistry;
const signals = await trait.analyze(percept.scope, view);
const effects = skill.resolve(signals, percept.scope);
```

### Pattern 2: Temporary Injection with Dispose Cleanup

**What:** Use prompt.inject() for skill effects, collect dispose functions, clean up in finally block.
**When to use:** For promptInjections and styleOverride effects.

The existing pattern in loop.ts already does this for tool schema:
```typescript
const disposeInjection = prompt.inject(this.ctx, "basic_functions", {
  name: "__loop_tool_schema",
  renderFn: () => toolSchema,
});
try { ... } finally { disposeInjection(); }
```

For skill effects, collect multiple disposers:
```typescript
const disposers: Array<() => void> = [];

// Prompt injections
for (const inj of effects.promptInjections) {
  const d = prompt.inject(this.ctx, inj.point, {
    name: `__skill_${inj.skillName}_${percept.id}`,
    renderFn: () => inj.content,
  });
  disposers.push(d);
}

// Style override
if (effects.styleOverride) {
  const d = prompt.inject(this.ctx, "style", {
    name: `__skill_style_${percept.id}`,
    after: "__default_style",
    renderFn: () => effects.styleOverride!.content,
  });
  disposers.push(d);
}

// ... in finally:
for (const d of disposers) d();
```

**Confidence:** HIGH — this pattern is already proven in the codebase.

### Pattern 3: Tool Filter in buildToolSchemaForPrompt

**What:** Extend buildToolSchemaForPrompt to accept optional include/exclude filter.
**When to use:** When skills declare tools effects.

Current signature: `buildToolSchemaForPrompt(pluginService, toolCtx)`
New signature: `buildToolSchemaForPrompt(pluginService, toolCtx, toolFilter?)`

```typescript
// In tools.ts
export function buildToolSchemaForPrompt(
  pluginService: PluginService,
  toolCtx: ToolExecutionContext,
  toolFilter?: { include: string[]; exclude: string[] },
): string {
  let entries = pluginService.getTools(toolCtx);
  if (toolFilter) {
    if (toolFilter.include.length > 0) {
      entries = entries.filter(e =>
        toolFilter.include.includes(e.function.name)
      );
    }
    if (toolFilter.exclude.length > 0) {
      entries = entries.filter(e =>
        !toolFilter.exclude.includes(e.function.name)
      );
    }
  }
  // ... rest unchanged
}
```

**Confidence:** HIGH — straightforward filter addition.

### Pattern 4: Code Activator for image-gen Skill

**What:** Replace YAML intent-based conditions with a JS code activator that checks message content for keywords.
**When to use:** When activation logic requires runtime inspection beyond trait signals.

File: `core/resources/skills/image-gen/scripts/activate.js`
```javascript
module.exports = function activate(signals) {
  // Check if any signal metadata contains trigger content with drawing keywords
  // Or: check signals for a specific trait
  // The activator receives filtered TraitSignal[]
  return false; // Default: rely on future IntentTrait
};
```

Per CONTEXT.md, the code activator should do keyword matching. But TraitSignal[] doesn't carry message content — it carries dimension/value/confidence. The activator function signature is `(signals: TraitSignal[]) => boolean`.

**Resolution options:**
1. Pass message content through TraitSignal metadata (e.g., SceneTrait emits a signal with metadata.content)
2. Have the code activator check for a specific trait signal that doesn't exist yet (making image-gen dormant until IntentTrait is added)
3. Add a lightweight "content" dimension to SceneTrait that passes through recent message text

Option 1 is simplest: SceneTrait already has access to view.history. It could emit a `content:last-message` signal with the trigger message text in metadata. But this feels like scope creep.

**Recommendation:** For Phase 19 validation, the image-gen skill can use a code activator that checks signal metadata. SceneTrait can attach `metadata.triggerContent` to the scene signal (it already has access to view.history). This is minimal and doesn't require a new detector.

### Pattern 5: Mention-Aware Skill (New)

**What:** A prompt-effect skill triggered by `attention:mentioned` signal from SceneTrait.
**When to use:** When bot is @-mentioned, inject guidance to respond attentively.

File: `core/resources/skills/mention-aware/SKILL.md`
```yaml
---
name: mention-aware
description: Respond attentively when directly mentioned
conditions:
  match:
    dimension: attention
    value: mentioned
lifecycle: per-turn
effects: {}
---
When someone mentions you by name, pay close attention and respond thoughtfully.
Address their message directly and helpfully.
```

The prompt content (after `---`) becomes `effects.prompt` via the loader. The condition matches `attention:mentioned` which SceneTrait already emits with confidence 0.9.

**Confidence:** HIGH — SceneTrait already produces this signal, loader already parses this format.

### Anti-Patterns to Avoid
- **Re-analyzing traits per loop round:** User decision says one percept = one analysis. Don't call analyze() inside the while loop.
- **Mutating tool schema after injection:** The tool schema injection happens once. Don't try to re-inject mid-loop.
- **Using non-unique injection names:** PromptService.inject() warns and ignores duplicates. Must use percept.id suffix for concurrent loop safety.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Injection lifecycle | Manual Map tracking | prompt.inject() + dispose pattern | Already handles ordering, dedup, cleanup |
| Condition evaluation | Custom matching | evaluateCondition() from condition.ts | Handles and/or/not/match recursively |
| Signal filtering | Manual threshold check | filterByConfidence() from condition.ts | Already used by SkillRegistry.resolve() |

## Common Pitfalls

### Pitfall 1: Duplicate Injection Names in Concurrent Loops
**What goes wrong:** Two concurrent loops for different channels both inject `__skill_private-chat`, second one gets silently ignored.
**Why it happens:** PromptService.inject() checks name uniqueness and warns+ignores duplicates (line 135-137 of prompt/service.ts).
**How to avoid:** Suffix injection names with percept.id: `__skill_${skillName}_${percept.id}`.
**Warning signs:** "Duplicate injection" warnings in logs during concurrent conversations.

### Pitfall 2: Style Override Ordering
**What goes wrong:** Skill style injection renders before default style, or doesn't override it.
**Why it happens:** PromptService uses topological sort on before/after constraints.
**How to avoid:** Use `after: "__default_style"` on skill style injections so they render after the default and the LLM sees the skill style last (taking precedence).
**Warning signs:** Bot style doesn't change in private chat despite skill being active.

### Pitfall 3: Tool Filter Include vs Exclude Semantics
**What goes wrong:** Include filter with empty array filters out ALL tools.
**Why it happens:** `include.length > 0` check is needed — empty include means "no filter", not "include nothing".
**How to avoid:** Only apply include filter when the array is non-empty. Same for exclude.
**Warning signs:** Bot loses all tools when a skill with empty include is active.

### Pitfall 4: AgentCore inject Declaration
**What goes wrong:** AgentCore doesn't declare trait/skill as dependencies, so it may start before they're ready.
**Why it happens:** Current AgentCore.inject only lists horizon, plugin, prompt, model.
**How to avoid:** Add "yesimbot.trait" and "yesimbot.skill" to AgentCore's static inject array.
**Warning signs:** `ctx['yesimbot.trait']` is undefined when loop runs.

### Pitfall 5: image-gen Keyword Matching Without Content Access
**What goes wrong:** Code activator receives TraitSignal[] but needs message content for keyword matching.
**Why it happens:** TraitSignal is dimension/value/confidence — no message text.
**How to avoid:** Either (a) pass content via signal metadata, or (b) accept image-gen won't activate until IntentTrait exists. Option (a) is simpler for validation.
**Warning signs:** image-gen skill never activates despite user saying "draw me a picture".

## Code Examples

### Integration Point in loop.ts (the core change)

```typescript
// In ThinkActLoop.run(), after buildView, before tool schema:

const trait = this.ctx["yesimbot.trait"];
const skill = this.ctx["yesimbot.skill"];

const signals = await trait.analyze(percept.scope, view);
const effects = skill.resolve(signals, percept.scope);

const disposers: Array<() => void> = [];

// Apply prompt injections
for (const inj of effects.promptInjections) {
  disposers.push(prompt.inject(this.ctx, inj.point, {
    name: `__skill_${inj.skillName}_${percept.id}`,
    renderFn: () => inj.content,
  }));
}

// Apply style override
if (effects.styleOverride) {
  disposers.push(prompt.inject(this.ctx, "style", {
    name: `__skill_style_${percept.id}`,
    after: "__default_style",
    renderFn: () => effects.styleOverride!.content,
  }));
}

// Build tool schema with filter
const toolSchema = buildToolSchemaForPrompt(pluginService, toolCtxWithPercept, effects.toolFilter);
const disposeToolSchema = prompt.inject(this.ctx, "basic_functions", {
  name: `__loop_tool_schema_${percept.id}`,
  renderFn: () => toolSchema,
});
disposers.push(disposeToolSchema);

try {
  // ... existing loop body
} finally {
  for (const d of disposers) d();
}
```

### AgentCore inject Update

```typescript
// In service.ts, AgentCore class:
static inject = [
  "yesimbot.horizon", "yesimbot.plugin", "yesimbot.prompt",
  "yesimbot.model", "yesimbot.trait", "yesimbot.skill"
];
```

### image-gen Code Activator

```javascript
// core/resources/skills/image-gen/scripts/activate.js
const KEYWORDS = ['画', '绘', 'draw', 'paint', 'sketch', 'generate image', '生成图'];

module.exports = function activate(signals) {
  for (const s of signals) {
    if (s.metadata?.triggerContent) {
      const text = String(s.metadata.triggerContent).toLowerCase();
      if (KEYWORDS.some(kw => text.includes(kw))) return true;
    }
  }
  return false;
};
```

### SceneTrait Enhancement (attach trigger content to metadata)

```typescript
// In scene.ts detect(), add triggerContent to scene signal metadata:
const lastMsg = view.history?.filter(o => o.type === 'message').slice(-1)[0];
signals.push({
  dimension: "scene",
  value: scope.isDirect ? "private-chat" : "group-chat",
  confidence: 1.0,
  metadata: lastMsg ? { triggerContent: lastMsg.content } : undefined,
});
```

## Open Questions

1. **Tool filter include semantics with multiple skills**
   - What we know: mergeEffects() concatenates include arrays from all active skills
   - What's unclear: If skill A includes ["image-generate"] and skill B includes ["web-search"], should the result be union (both available) or intersection (neither)?
   - Recommendation: Union semantics (concat) — this is what mergeEffects already does. If include is non-empty, only those tools are shown. This means multiple skills with include lists expand the available tool set.

2. **Existing tool schema injection name change**
   - What we know: Current code uses `__loop_tool_schema` as injection name
   - What's unclear: Changing to `__loop_tool_schema_${percept.id}` changes the name that `__default_basic_functions` uses in its `before` constraint
   - Recommendation: Keep the name `__loop_tool_schema` but make it unique per-percept only if concurrent loops are a real concern. Since loops are serialized per-channel via the queue in AgentCore, concurrent loops for the same channel don't happen. Cross-channel concurrency uses different PromptService render calls, so the injection name collision is the real risk. Use percept.id suffix.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis of all relevant source files
- `/home/workspace/Athena/core/src/services/agent/loop.ts` — ThinkActLoop implementation
- `/home/workspace/Athena/core/src/services/trait/service.ts` — TraitAnalyzer.analyze() API
- `/home/workspace/Athena/core/src/services/skill/service.ts` — SkillRegistry.resolve() API
- `/home/workspace/Athena/core/src/services/prompt/service.ts` — inject/dispose pattern
- `/home/workspace/Athena/core/src/services/agent/tools.ts` — buildToolSchemaForPrompt
- `/home/workspace/Athena/core/src/services/trait/detectors/scene.ts` — SceneTrait signals
- `/home/workspace/Athena/core/src/services/skill/loader.ts` — SKILL.md loading
- `/home/workspace/Athena/core/src/services/skill/types.ts` — SkillEffect structure

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, all existing APIs
- Architecture: HIGH — integration point is clear, patterns proven in codebase
- Pitfalls: HIGH — identified from direct code analysis of dedup logic, ordering, and concurrency

**Research date:** 2026-02-23
**Valid until:** 2026-03-23 (stable internal architecture)
