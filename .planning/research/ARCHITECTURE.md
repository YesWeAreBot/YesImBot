# Architecture Research

**Domain:** OpenClaw-style memory blocks + injection point merge into Koishi plugin (v2.1)
**Researched:** 2026-02-23
**Confidence:** HIGH (direct source reading)

## Current Architecture (v2.0 Baseline)

### System Overview

```
ThinkActLoop (agent/loop.ts)
  trait.analyze() → signals
  skill.resolve(signals) → effects
  prompt.inject(ctx, "style", skill_style_override)
  prompt.inject(ctx, "basic_functions", tool_schema)
  prompt.inject(ctx, "extra", skill_prompt_N)
  prompt.renderToString("system", {view, percept})
  → disposers cleanup in finally
        │
        ▼
PromptService (prompt/service.ts)
  injections: Map<InjectionPoint, InjectionEntry[]>
  6 points: identity | style | control_flow | basic_functions | memory | extra
  render():
    buildScope() → run snippets
    for each point: resolveOrder → renderWithTimeout → join fragments
    set scope[point_content] + scope[has_point]
    look up partial by point name → Mustache.render(partial, scope)
    → Section[]
        │
        ▼
5 Wrapper Partials (all structurally identical except "extra")
  identity.mustache:        {{#has_identity}}<identity>{{{identity_content}}}</identity>{{/has_identity}}
  style.mustache:           {{#has_style}}<style>{{{style_content}}}</style>{{/has_style}}
  control_flow.mustache:    {{#has_control_flow}}<control_flow>...</control_flow>{{/has_control_flow}}
  basic_functions.mustache: {{#has_basic_functions}}<basic_functions>...</basic_functions>{{/has_basic_functions}}
  memory.mustache:          {{#has_memory}}<memory>{{{memory_content}}}</memory>{{/has_memory}}
  extra.mustache:           {{#has_extra}}{{{extra_content}}}{{/has_extra}}  ← no XML wrap
        │
        ▼
MemoryService (memory/service.ts)
  loadBlocks(): reads all .md/.txt from coreMemoryPath
  parseFrontmatter(): gray-matter → {label, title, content}
  registerInjection(): ONE injection to "memory" point for ALL blocks
    renderFn: accumulates blocks, enforces memoryCharLimit, renders core-memory.mustache
```

### Component Responsibilities

| Component | Responsibility | Key Detail |
|-----------|----------------|------------|
| `PromptService` | Injection registry, topological ordering, Mustache render | `inject(ctx, point, entry)` auto-disposes on ctx dispose |
| `MemoryService` | File-system memory blocks, hot-reload watcher, snippet registration | All blocks → single "memory" point regardless of label |
| `ThinkActLoop` | Per-percept skill injections, tool schema injection, system prompt assembly | Injects to style/extra/basic_functions; disposes in finally |
| `SkillRegistry` | Trait signal → skill effect resolution | Skill prompts always go to "extra" point |
| Wrapper partials | XML tag wrapping per injection point | 5 of 6 are structurally identical |

### Default Injections Registered in PromptService Constructor

| Name | Point | Source |
|------|-------|--------|
| `__default_identity` | `identity` | `default-identity.md` |
| `__default_style` | `style` | `default-style.md` |
| `__default_control_flow` | `control_flow` | `default-control-flow.md` |
| `__default_basic_functions` | `basic_functions` | `default-basic-functions.md` |

MemoryService adds at start():
| Name | Point | Source |
|------|-------|--------|
| `core-memory` | `memory` | all blocks in coreMemoryPath |

ThinkActLoop adds per-percept:
| Name | Point | Source |
|------|-------|--------|
| `__loop_tool_schema_{id}` | `basic_functions` | buildToolSchemaForPrompt() |
| `__skill_style_{id}` | `style` | effects.styleOverride |
| `__skill_{name}_{id}` | `extra` | effects.promptInjections |

---

## Target Architecture (v2.1)

### What Changes

**Injection points: 6 → 4**

```
identity        ─┐
style           ─┴──→  soul          (character + style merged)

control_flow    ─┐
basic_functions ─┴──→  instructions  (behavioral rules merged)

memory               →  memory        (name unchanged, routing changes)
extra                →  extra         (unchanged)
```

**Memory block routing by label**

```
SOUL.md   (frontmatter label: soul)   → "soul" injection point
AGENTS.md (frontmatter label: agents) → "instructions" injection point
TOOLS.md  (frontmatter label: tools)  → "instructions" injection point
*.md      (any other label)           → "memory" injection point (default)
```

**Wrapper partials eliminated**

The 5 identical `{{#has_X}}<X>{{{X_content}}}</X>{{/has_X}}` partials are replaced by inline XML tag generation inside `render()`. This removes 5 template files and one indirection layer.

### Target System Overview

```
ThinkActLoop
  prompt.inject(ctx, "soul", skill_style_override)
  prompt.inject(ctx, "instructions", tool_schema)
  prompt.inject(ctx, "extra", skill_prompt_N)
  prompt.renderToString("system", {view, percept})
        │
        ▼
PromptService (modified)
  4 points: soul | instructions | memory | extra
  CACHEABLE_POINTS: soul | instructions | memory
  XML_WRAP_POINTS: soul | instructions | memory
  render():
    buildScope() → run snippets
    for each point: resolveOrder → renderWithTimeout → join fragments
    if XML_WRAP_POINTS: emit <point>\ncontent\n</point>
    else (extra): emit raw content
    → Section[]
        │
        ▼
MemoryService (modified)
  FIXED_ROUTES: { soul→"soul", agents→"instructions", tools→"instructions" }
  routeBlock(label) → InjectionPoint
  registerInjection(): N injections (one per block) to routed points
  char limit: pre-filter at loadBlocks() time, not inside renderFn
```

---

## Component Boundaries: New vs Modified

### Modified: `core/src/services/prompt/types.ts`

Remove `identity | style | control_flow | basic_functions`, add `soul | instructions`.

```typescript
export type InjectionPoint = "soul" | "instructions" | "memory" | "extra";
export const INJECTION_POINTS: InjectionPoint[] = ["soul", "instructions", "memory", "extra"];
```

### Modified: `core/src/services/prompt/service.ts`

1. `CACHEABLE_POINTS`: update to `new Set(["soul", "instructions", "memory"])`
2. Constructor default injections: replace 4 with 2
   - `__default_identity` + `__default_style` → `__default_soul` (loads `default-soul.md`)
   - `__default_control_flow` + `__default_basic_functions` → `__default_instructions` (loads `default-instructions.md`)
3. `partialMap`: remove `identity | style | control_flow | basic_functions | memory` entries; keep `horizon-view` and `memory-block`
4. `render()`: replace partial-lookup section building with inline XML wrap

```typescript
// Replace the current sections loop with:
const XML_WRAP = new Set<InjectionPoint>(["soul", "instructions", "memory"]);
for (const point of INJECTION_POINTS) {
  const content = scope[`${point}_content`] as string;
  if (!content?.trim()) continue;
  const wrapped = XML_WRAP.has(point) ? `<${point}>\n${content}\n</${point}>` : content;
  sections.push({ name: point, content: wrapped, cacheable: CACHEABLE_POINTS.has(point) });
}
```

### Modified: `core/src/services/memory/service.ts`

1. Add `FIXED_ROUTES` static map and `routeBlock()` method
2. Replace single `core-memory` injection with per-block injections
3. Move char limit enforcement to `loadBlocks()` (pre-filter, not inside renderFn)

```typescript
private static readonly FIXED_ROUTES: Partial<Record<string, InjectionPoint>> = {
  soul: "soul",
  agents: "instructions",
  tools: "instructions",
};

private routeBlock(label: string): InjectionPoint {
  return MemoryService.FIXED_ROUTES[label.toLowerCase()] ?? "memory";
}
```

Per-block injection replaces the single `core-memory` injection:

```typescript
for (const block of this.blocks) {
  const point = this.routeBlock(block.label);
  this.prompt.inject(this.ctx, point, {
    name: `__memory_${block.label}`,
    renderFn: (scope) => {
      const rendered = Mustache.render(block.content, scope);
      return `<${block.label}>${rendered}</${block.label}>`;
    },
  });
}
```

### Modified: `core/src/services/agent/loop.ts`

Update injection point references:

| Current | Target |
|---------|--------|
| `prompt.inject(ctx, "style", ...)` | `prompt.inject(ctx, "soul", ...)` |
| `prompt.inject(ctx, "basic_functions", ...)` | `prompt.inject(ctx, "instructions", ...)` |

### Modified: `core/resources/templates/system.mustache`

The current template uses `{{> identity}}`, `{{> style}}`, etc. With partials eliminated and `render()` producing sections directly, the template simplifies or is bypassed. The `render()` method already iterates `INJECTION_POINTS` and builds sections — `system.mustache` is only used if `renderToString` is called with it as the template name.

Current behavior: `render()` uses partials to wrap each point. Target behavior: `render()` wraps inline. The `system.mustache` file can be reduced to a passthrough or removed from the flow entirely (sections are returned directly from `render()`).

Minimal change: update `system.mustache` to reference the 4 new point names if it's still used as a structural template. If `render()` fully owns section assembly, `system.mustache` becomes vestigial.

### Deleted: 5 wrapper partials

```
core/resources/templates/partials/identity.mustache       ← delete
core/resources/templates/partials/style.mustache          ← delete
core/resources/templates/partials/control_flow.mustache   ← delete
core/resources/templates/partials/basic_functions.mustache← delete
core/resources/templates/partials/memory.mustache         ← delete
```

Keep: `horizon-view.mustache`, `memory-block.mustache`, `extra.mustache`

### New: default template files

```
core/resources/templates/default-soul.md         ← merge of default-identity.md + default-style.md
core/resources/templates/default-instructions.md ← merge of default-control-flow.md + default-basic-functions.md
```

The old files (`default-identity.md`, `default-style.md`, `default-control-flow.md`, `default-basic-functions.md`) are deleted after the new ones are in place.

### No change: `core/src/services/skill/service.ts`

`mergeEffects()` already routes skill prompts to `"extra"` — no change needed. The style override injection point change happens in `loop.ts`, not here.

---

## Data Flow

### Prompt Assembly (target)

```
Percept → ThinkActLoop.run()
  trait.analyze() + skill.resolve()
  prompt.inject(ctx, "soul", style_override)       [if skill has style effect]
  prompt.inject(ctx, "instructions", tool_schema)  [always]
  prompt.inject(ctx, "extra", skill_prompt_N)      [per active skill]
        ↓
  prompt.renderToString("system", {view, percept})
        ↓
  PromptService.render():
    buildScope() → snippets
    for "soul":         resolve → render → "<soul>\n...\n</soul>"
    for "instructions": resolve → render → "<instructions>\n...\n</instructions>"
    for "memory":       resolve → render → "<memory>\n...\n</memory>"
    for "extra":        resolve → render → raw content (no XML wrap)
    → Section[]
        ↓
  join sections → systemPrompt string → modelService.call()
        ↓
  finally: disposers() remove all per-percept injections
```

### Memory Block Routing (target)

```
MemoryService.start()
  loadBlocks(): read .md files, parse frontmatter, pre-filter by charLimit
  for each block:
    point = routeBlock(block.label)
      "soul"   → "soul"
      "agents" → "instructions"
      "tools"  → "instructions"
      *        → "memory"
    prompt.inject(ctx, point, {
      name: "__memory_" + block.label,
      renderFn: scope → "<label>Mustache.render(content, scope)</label>"
    })
  hot-reload: watcher → loadBlocks() → re-register injections
```

---

## Build Order

Dependencies flow bottom-up. Steps 2, 3, 4 can proceed in parallel after step 1.

| Step | What | Files | Depends On |
|------|------|-------|------------|
| 1 | Update `InjectionPoint` type + `INJECTION_POINTS` | `prompt/types.ts` | — |
| 2 | Update `PromptService`: defaults, partialMap, inline XML wrap in `render()` | `prompt/service.ts` | Step 1 |
| 3 | Add `default-soul.md`, `default-instructions.md`; update `system.mustache` | `resources/templates/` | Step 2 |
| 4 | Update `MemoryService`: `routeBlock()`, per-block injection, pre-filter charLimit | `memory/service.ts` | Step 1 |
| 5 | Update `ThinkActLoop`: `"style"` → `"soul"`, `"basic_functions"` → `"instructions"` | `agent/loop.ts` | Step 1 |
| 6 | Delete dead files (5 wrapper partials, 4 old default .md files) | `resources/templates/` | Steps 2–5 passing |

---

## Integration Points

### Internal Boundaries

| Boundary | Communication | Change in v2.1 |
|----------|---------------|----------------|
| MemoryService → PromptService | `prompt.inject(ctx, point, entry)` | Point values change; N injections instead of 1 |
| ThinkActLoop → PromptService | `prompt.inject(ctx, point, entry)` | `"style"` → `"soul"`, `"basic_functions"` → `"instructions"` |
| SkillRegistry → ThinkActLoop | `SkillEffect.promptInjections[].point` | `"extra"` unchanged; style override point changes in loop.ts |
| PromptService → Mustache partials | `partials` map lookup in `render()` | 5 wrapper partials removed; XML generation inlined |

### Char Limit Migration

Current: single `renderFn` accumulates all blocks and enforces `memoryCharLimit` across them with a shared `used` counter.

Target: per-block injections have no shared accumulator. Solution: pre-filter in `loadBlocks()` — compute cumulative size across all blocks before registering injections, drop blocks that exceed the limit. This happens once at load time, not per-render.

---

## Anti-Patterns

### Anti-Pattern 1: Routing in renderFn instead of at inject() time

**What people do:** Check `block.label` inside the single `renderFn` to decide what XML tag to emit, while still injecting to one point.
**Why it's wrong:** The block still lands in one injection point. `soul` content appears inside `<memory>` in the system prompt — wrong semantic position for the LLM.
**Do this instead:** Call `prompt.inject(ctx, routeBlock(label), ...)` so the block lands in the correct point.

### Anti-Pattern 2: Keeping wrapper partials alongside inline XML generation

**What people do:** Add inline XML generation in `render()` but leave old partials registered in `partialMap`.
**Why it's wrong:** `render()` checks `allPartials[point]` first — if the partial exists, it uses it and bypasses the inline path. The two paths conflict silently.
**Do this instead:** Remove partials from `partialMap` before enabling inline generation. Delete the files in the same step.

### Anti-Pattern 3: Default soul content loaded via MemoryService file

**What people do:** Create `default-soul.md` in `coreMemoryPath` without frontmatter, expecting MemoryService to pick it up.
**Why it's wrong:** MemoryService uses `meta.label || basename(file)` — the label becomes `default-soul`, which routes to "memory" not "soul". The content appears in the wrong section.
**Do this instead:** Register `__default_soul` in `PromptService` constructor (same pattern as current `__default_identity`), loading from `resourcesDir`. MemoryService handles user-provided files; PromptService handles built-in defaults.

---

## Sources

- Direct source reading: `core/src/services/prompt/service.ts`, `types.ts`
- Direct source reading: `core/src/services/memory/service.ts`, `types.ts`
- Direct source reading: `core/src/services/agent/loop.ts`
- Direct source reading: `core/src/services/skill/service.ts`
- Direct source reading: `core/resources/templates/system.mustache` + all partials
- Project context: `.planning/PROJECT.md` (v2.1 milestone goals)

---
*Architecture research for: OpenClaw memory block integration, Athena v2.1*
*Researched: 2026-02-23*
