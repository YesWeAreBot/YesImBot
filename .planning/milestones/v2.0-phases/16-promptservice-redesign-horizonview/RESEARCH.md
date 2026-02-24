# Phase 16: PromptService Redesign + HorizonView - Research

**Researched:** 2026-02-21
**Domain:** Prompt architecture, template composition, Koishi service lifecycle
**Confidence:** HIGH

## Summary

Phase 16 redesigns the flat PromptService into a multi-section named injection point architecture with Mustache partial composition, ctx-bound lifecycle cleanup, and structured HorizonView output. The current v4 PromptService has a single `injections[]` array with no section targeting, no ctx binding for auto-cleanup, and render() returns a single string. HorizonView currently outputs a monolithic text blob via `formatHorizonText()`. Both need restructuring.

The core technical challenge is implementing before/after chain ordering within injection points (not just numeric priority), binding injections to Koishi's ctx lifecycle for automatic disposal, and producing Section[] output that supports prompt cache optimization via multi-system-message splitting. All building blocks exist in the current stack: Mustache 4.2.0 supports partials via `{{>name}}` syntax with parse() for variable/partial extraction, and Koishi 4.18.10 provides `ctx.on('dispose', callback)` for lifecycle binding.

**Primary recommendation:** Redesign PromptService with 6 named injection points as ordered Maps, accept ctx parameter in inject() for lifecycle binding, return Section[] from render(), and split HorizonView.buildView() output into a structured object consumed by separate template partials.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- 6 named injection points ordered by change frequency (low→high): identity → style → core_memories → working_memory → environment → extra
- Remove tools and output injection points — v4 uses native tool call, tools attach directly to request
- extra as general extension point for future/third-party plugins
- Same injection point uses before/after chain ordering, anchored to other registered injections (not default content)
- Duplicate injection names within same point → error/warning
- Injection content is plain text strings, plugins fully control format
- Main template + section partial structure: system template references sections via `{{>identity}}` `{{>environment}}` etc.
- render() returns Section[] array (`{ name, content, cacheable? }`), supports multi-system-message splitting for prompt cache optimization
- Also provide renderToString() convenience method (calls render() then joins)
- Allow plugins to override default section partials — plugin can completely replace a section's rendering
- HorizonView outputs structured object `{ environment, members, history }`, template partials each render their own section
- Start with three partitions (environment/members/history), no extra analyzer dependencies, extend later
- HorizonView and PromptService decoupled — HorizonView is independent service, caller (ThinkActLoop) bridges by injecting partition data into PromptService injection points
- inject() accepts ctx parameter, binds to Koishi ctx lifecycle for auto-cleanup — sub-plugin unload removes its injections
- Hot-reload uses natural cleanup + re-register pattern, brief gap is acceptable
- PromptService provides global timeout config, slow injections silently skipped (return empty)
- Caching and fallback are plugin responsibility, PromptService does not build in caching
- memories split into core_memories (stable/long-term) and working_memory (current session), referencing LETTA's layered cache strategy

### Claude's Discretion
- Parallel rendering strategy for injection points
- Specific timeout default values
- before/after chain ordering conflict resolution (cycle detection)
- Section[] cacheable flag default strategy

### Deferred Ideas (OUT OF SCOPE)
- Structured data injection format (replacing plain text) — future iteration
- channel_state partition (channel state like topic, atmosphere) — needs extra analyzers, later
- Atomic replacement hot-reload (register new before cleaning old, no gap) — natural cleanup sufficient for now
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PROMPT-01 | PromptService supports named injection points (identity/environment/style/memories/tools/output) with independent priority queues | User decision narrows to 6 points: identity/style/core_memories/working_memory/environment/extra. Use Map<InjectionPoint, InjectionEntry[]> with before/after chain ordering. See Architecture Patterns §1. |
| PROMPT-02 | PromptService supports modular partial registration and composition, templates reference via `{{>partial}}` | Mustache 4.2.0 `{{>name}}` syntax verified working. Partials stored in templates Map, plugins can override. See Architecture Patterns §2. |
| PROMPT-03 | Injections follow Koishi ctx lifecycle auto-cleanup, sub-plugin unload removes its injections | inject() accepts ctx param, registers `ctx.on('dispose', cleanup)`. Koishi 4.18.10 ctx.on('dispose') verified working. See Architecture Patterns §3. |
| PROMPT-04 | PromptService renderer supports recursive partial variable collection and multi-pass rendering | v3/dev MustacheRenderer already implements multi-pass rendering (loop until stable or maxDepth). Mustache.parse() extracts variables and partial refs for recursive collection. See Code Examples §1. |
| PROMPT-05 | Provide out-of-box section-based system prompt template with default partials for all named injection points | New system.mustache with `{{>identity}}` `{{>style}}` etc. Default partials provide sensible fallbacks. See Code Examples §3. |
| HVIEW-01 | HorizonView render output uses structured tagged sections (environment/members/history) | New `buildStructuredView()` returns `{ environment: EnvironmentData, members: MemberData[], history: FormattedHistory }`. See Architecture Patterns §4. |
| HVIEW-02 | Prompt template reworked as modular partial composition (identity/environment/working_memory/memories/tools/output) | System template becomes partial composition. ThinkActLoop bridges HorizonView structured output → PromptService injection points. See Architecture Patterns §5. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| mustache | ^4.2.0 | Template rendering with partials | Already in use. `{{>partial}}` syntax, `Mustache.parse()` for token extraction, multi-pass rendering support. No new dependency needed. |
| koishi | 4.18.10 | Framework — Service lifecycle, ctx.on('dispose') | `ctx.on('dispose', fn)` verified working for lifecycle-bound cleanup. Service subclass pattern for auto-register/remove. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| js-yaml | ^4.1.1 | YAML frontmatter parsing in memory blocks | Already in use by MemoryService. No change needed. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Mustache partials | Handlebars | Handlebars has helpers/block partials but adds 50KB+ dependency. Mustache partials are sufficient for section composition. |
| before/after chain | Numeric priority only | Numeric priority is simpler but doesn't express relative ordering intent. before/after is user decision — locked. |

**Installation:** No new packages needed. All dependencies already present.

## Architecture Patterns

### Recommended Project Structure
```
core/src/services/prompt/
├── types.ts          # InjectionPoint enum, InjectionEntry, Section, ordering types
├── service.ts        # PromptService with named injection points, ctx lifecycle
├── renderer.ts       # MustacheRenderer with multi-pass + parse()
├── loader.ts         # Template/partial file loader (unchanged)
└── index.ts          # Re-exports

core/src/services/horizon/
├── types.ts          # Add StructuredHorizonView type
├── service.ts        # Add buildStructuredView() method
└── ...               # Other files unchanged

core/resources/templates/
├── system.mustache           # Rewritten: {{>identity}} {{>style}} etc.
└── partials/
    ├── identity.mustache     # Default identity section
    ├── style.mustache        # Default style section
    ├── core-memories.mustache # Default (delegates to memory-block)
    ├── working-memory.mustache # Default working memory
    ├── environment.mustache  # Default environment section
    ├── extra.mustache        # Default extra (empty)
    ├── memory-block.mustache # Existing (unchanged)
    └── horizon-view.mustache # Deprecated or removed
```

### Pattern 1: Named Injection Points with Before/After Ordering
**What:** Each of the 6 injection points maintains its own ordered list of injections. Ordering uses before/after anchors referencing other injection names, resolved via topological sort.
**When to use:** Every injection registration.

```typescript
// Source: Codebase analysis + user decisions
type InjectionPoint = "identity" | "style" | "core_memories" | "working_memory" | "environment" | "extra";

interface InjectionEntry {
  name: string;
  renderFn: (scope: Record<string, unknown>) => string | Promise<string>;
  before?: string;  // render before this named injection
  after?: string;   // render after this named injection
}

// Internal storage: one list per injection point
// Map<InjectionPoint, InjectionEntry[]>
```

**Ordering resolution:** Topological sort on before/after constraints. If cycle detected, log warning and fall back to registration order. This is simple — each injection point typically has 1-3 entries, so O(n^2) is fine.

### Pattern 2: Partial Registration and Override
**What:** Plugins register named partials that the system template references via `{{>name}}`. A plugin can override a default partial by registering one with the same name.
**When to use:** When a plugin needs to customize how a section renders.

```typescript
// Plugin overrides the identity section partial
promptService.registerPartial("identity", "<identity>Custom identity here</identity>");

// System template references it:
// {{>identity}}
// {{>style}}
// ...
```

**Key detail:** Partials map is passed to Mustache.render() as the third argument. Last registration wins (with warning log).

### Pattern 3: Ctx-Bound Lifecycle Cleanup
**What:** inject() accepts a Koishi `ctx` parameter. Internally registers `ctx.on('dispose', cleanup)` so when the sub-plugin unloads, its injections are automatically removed.
**When to use:** Every inject() call.

```typescript
// Source: Koishi 4.18.10 verified — ctx.on('dispose') fires on plugin unload
inject(ctx: Context, point: InjectionPoint, entry: InjectionEntry): () => void {
  // Store injection
  const list = this.injections.get(point);
  list.push(entry);

  // Cleanup function
  const dispose = () => {
    const idx = list.indexOf(entry);
    if (idx >= 0) list.splice(idx, 1);
  };

  // Bind to caller's ctx lifecycle
  ctx.on("dispose", dispose);
  return dispose;  // Also return for manual removal
}
```

**Critical:** The `ctx` parameter must be the caller's context (sub-plugin ctx), not the service's own ctx. Koishi's `ctx.on('dispose')` on a sub-plugin context fires when that sub-plugin is unloaded.

### Pattern 4: Structured HorizonView Output
**What:** HorizonView returns a structured object instead of a monolithic text string. Each partition is independently consumable by template partials.
**When to use:** When building the view for prompt rendering.

```typescript
// Source: Codebase analysis of current HorizonView + user decisions
interface StructuredHorizonView {
  environment: {
    name: string;
    type: "private" | "group";
    platform?: string;
  };
  members: Array<{
    name: string;
    badge?: string;
  }>;
  history: Array<{
    time: string;
    sender: string;
    content: string;
    isBot?: boolean;
    isSummary?: boolean;
  }>;
}
```

**Key detail:** The existing `buildView()` already fetches all this data. The new method restructures the output format without changing data fetching logic. `formatHorizonText()` can remain as a convenience wrapper but is no longer the primary output path.

### Pattern 5: ThinkActLoop as Bridge Between HorizonView and PromptService
**What:** ThinkActLoop fetches structured HorizonView data, then injects each partition into the corresponding PromptService injection point. This keeps HorizonView and PromptService decoupled.
**When to use:** Every agent loop iteration.

```typescript
// In ThinkActLoop.run():
const view = await horizon.buildView(percept);
const structured = horizon.toStructured(view);

// Bridge: inject HorizonView partitions into prompt scope
// These are passed as initialScope to render(), not as persistent injections
const scope = {
  view,
  environment: structured.environment,
  members: structured.members,
  history: structured.history,
};
const sections = await prompt.render("system", scope);
```

**Key insight:** HorizonView data is per-request, not persistent. It goes into render scope, not into inject(). Persistent injections (identity, style, core_memories) are registered once at plugin start. Per-request data (environment, working_memory from HorizonView) flows through render scope.

### Anti-Patterns to Avoid
- **Injecting HorizonView as monolithic text into a single slot:** Defeats the purpose of structured sections. Each partition must map to its own injection point/partial.
- **Using numeric priority instead of before/after:** User decision locks before/after chain ordering. Don't fall back to numeric-only.
- **Registering per-request injections persistently:** HorizonView data changes every request. Pass it through render scope, not inject().
- **Coupling PromptService to HorizonView types:** PromptService should not import HorizonView types. The bridge lives in ThinkActLoop.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Template rendering | Custom string interpolation | Mustache 4.2.0 `{{>partial}}` + `Mustache.parse()` | Partials, escaping, sections, multi-pass — all built in |
| Lifecycle cleanup | Manual dispose tracking | Koishi `ctx.on('dispose', fn)` | Framework handles plugin unload cascading automatically |
| Topological sort | Complex graph library | Simple Kahn's algorithm inline | Max ~5 entries per injection point, no need for a library |

**Key insight:** The entire redesign uses existing primitives (Mustache partials, Koishi ctx lifecycle). No new dependencies needed.

## Common Pitfalls

### Pitfall 1: Injection Ordering Cycles
**What goes wrong:** Plugin A registers `before: "B"`, Plugin B registers `before: "A"` — circular dependency.
**Why it happens:** Independent plugins don't coordinate ordering constraints.
**How to avoid:** Detect cycles during topological sort. On cycle, log warning with involved names and fall back to registration order.
**Warning signs:** Injection output order changes unpredictably between reloads.

### Pitfall 2: Stale Injections After Hot-Reload Gap
**What goes wrong:** During hot-reload, old plugin disposes (injections removed) before new plugin registers (injections re-added). Brief window where sections are empty.
**Why it happens:** Natural cleanup + re-register has inherent gap.
**How to avoid:** User decision: accept the gap. Document it. Atomic replacement is deferred.
**Warning signs:** Occasional empty sections in rendered prompts during reload.

### Pitfall 3: Timeout Silently Swallowing Critical Injections
**What goes wrong:** A slow but critical injection (e.g., core_memories) times out and is silently skipped, producing a prompt missing essential identity/personality.
**Why it happens:** Global timeout applies uniformly; no distinction between critical and optional injections.
**How to avoid:** Use a generous default timeout (5000ms recommended). Log warnings when injections are skipped. Consider per-point timeout overrides in future.
**Warning signs:** Bot personality suddenly becomes generic/default.

### Pitfall 4: MemoryService Backward Compatibility Break
**What goes wrong:** MemoryService currently calls `prompt.inject("core-memory", 10, renderFn)` with the old API signature. Redesign changes inject() to require ctx and injection point.
**Why it happens:** API signature change without updating all callers.
**How to avoid:** Update MemoryService in the same phase. It's the only internal caller of inject(). Change to `prompt.inject(this.ctx, "core_memories", { name: "core-memory", renderFn })`.
**Warning signs:** TypeScript compilation errors in MemoryService after PromptService redesign.

### Pitfall 5: Mustache Partial Whitespace Handling
**What goes wrong:** Mustache standalone partial tags (`{{>name}}` on its own line) strip the entire line including newline. This can cause sections to collapse together without separators.
**Why it happens:** Mustache spec: standalone tags consume the entire line.
**How to avoid:** Use explicit newlines or separators in the main template between partial references. Test rendered output for section separation.
**Warning signs:** Sections run together without expected whitespace.

## Code Examples

### 1. Multi-Pass Renderer with Parse (from v3/dev, verified)

```typescript
// Source: references/YesImBot-dev/packages/core/src/services/prompt/renderer.ts
// Mustache 4.2.0 — parse() returns token array, render() supports multi-pass

import Mustache from "mustache";

class MustacheRenderer {
  parse(template: string): { variables: Set<string>; partials: Set<string> } {
    const tokens = Mustache.parse(template);
    const variables = new Set<string>();
    const partials = new Set<string>();
    const traverse = (toks: unknown[][]) => {
      for (const t of toks) {
        if (t[0] === "name" || t[0] === "#" || t[0] === "^" || t[0] === "&") variables.add(t[1] as string);
        else if (t[0] === ">") partials.add(t[1] as string);
        if (t[4]) traverse(t[4] as unknown[][]);
      }
    };
    traverse(tokens as unknown[][]);
    return { variables, partials };
  }

  render(template: string, scope: Record<string, unknown>, partials?: Record<string, string>, maxDepth = 3): string {
    let output = template;
    let prev = "";
    let depth = 0;
    while (output !== prev && depth < maxDepth) {
      prev = output;
      output = Mustache.render(prev, scope, partials, { escape: (t) => t });
      depth++;
    }
    return output;
  }
}
```

### 2. Section-Based Render Output

```typescript
// Source: User decision — render() returns Section[]
interface Section {
  name: string;
  content: string;
  cacheable?: boolean;
}

// Cacheable defaults by change frequency:
// identity=true, style=true, core_memories=true, working_memory=false, environment=false, extra=false
```

### 3. Default System Template (Section-Based)

```mustache
{{! system.mustache — section-based composition }}
{{>identity}}

{{>style}}

{{>core_memories}}

{{>working_memory}}

{{>environment}}

{{>extra}}
```

Each partial has a default that renders its injection point content:

```mustache
{{! partials/identity.mustache }}
<identity>
{{identity_content}}
</identity>
```

The `identity_content` scope variable is built by collecting and joining all injections registered at the `identity` point.

### 4. MemoryService Migration Example

```typescript
// Current (v1):
this.ctx["yesimbot.prompt"].inject("core-memory", 10, renderFn);

// New (v2):
this.ctx["yesimbot.prompt"].inject(this.ctx, "core_memories", {
  name: "core-memory",
  renderFn,
});
// Auto-cleanup when MemoryService disposes — no manual removeInjection needed
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single flat injections[] array | Named injection points with per-point ordering | This phase | Enables section-based prompt caching, modular composition |
| render() → string | render() → Section[] | This phase | Enables multi-system-message splitting for LLM prompt caching |
| Manual removeInjection() | ctx-bound auto-cleanup | This phase | Eliminates injection leak bugs on plugin hot-reload |
| formatHorizonText() → monolithic string | Structured object → per-section partials | This phase | Each HorizonView partition independently consumable |

**Deprecated/outdated:**
- `formatHorizonText()`: Replaced by structured output + per-section partials. May keep as convenience but no longer primary path.
- `removeInjection(name)`: Replaced by ctx-bound auto-cleanup. Can keep for manual use but not the recommended pattern.

## Open Questions

1. **Parallel vs Sequential Injection Rendering**
   - What we know: Injections within a single point could be rendered in parallel (Promise.all) or sequentially. Most renderFn are synchronous string returns. The v3 daily-planner is the exception (LLM call).
   - What's unclear: Whether parallel rendering causes issues with shared scope mutation.
   - Recommendation: Render injection points sequentially (they depend on ordered scope), but injections within a single point can be parallel since they receive a read-only scope snapshot. Use Promise.allSettled with timeout wrapper.

2. **Section[] to ai-sdk System Message Mapping**
   - What we know: ai-sdk `generateText`/`streamText` accept `system` as a single string. Some LLM APIs support multiple system messages for prompt caching (Anthropic, OpenAI).
   - What's unclear: Whether ai-sdk exposes multi-system-message support.
   - Recommendation: For now, renderToString() joins sections. Section[] output is future-ready for when ai-sdk or direct API calls support multi-system-message. The cacheable flag is metadata for future use.

3. **Default Content When No Injections Registered**
   - What we know: User decision says "default system template renders all named sections with sensible defaults when no custom injections are registered."
   - What's unclear: What the default content should be for each section when empty.
   - Recommendation: identity gets the current default persona text. style gets current style rules. core_memories/working_memory/environment/extra render empty (section tag omitted entirely via `{{#has_content}}` conditional).

## Codebase Impact Analysis

### Files to Modify (with change scope)

| File | Change | Scope |
|------|--------|-------|
| `core/src/services/prompt/types.ts` | Rewrite — new InjectionPoint enum, InjectionEntry, Section types | Major |
| `core/src/services/prompt/service.ts` | Rewrite — named injection points, ctx lifecycle, Section[] render | Major |
| `core/src/services/prompt/renderer.ts` | Enhance — add parse() method for recursive variable collection | Medium |
| `core/src/services/horizon/types.ts` | Add StructuredHorizonView type | Minor |
| `core/src/services/horizon/service.ts` | Add toStructured() method | Medium |
| `core/src/services/agent/loop.ts` | Update bridge: structured view → prompt sections | Medium |
| `core/src/services/memory/service.ts` | Migrate to new inject() API | Medium |
| `core/resources/templates/system.mustache` | Rewrite as partial composition | Medium |
| `core/resources/templates/partials/` | Add per-section default partials | Medium |

### Downstream Consumers Affected

| Consumer | Current Usage | Required Change |
|----------|--------------|-----------------|
| ThinkActLoop | `prompt.render("system", { view })` → string | Use `prompt.render()` → Section[], `renderToString()` for backward compat |
| MemoryService | `prompt.inject("core-memory", 10, fn)` | `prompt.inject(ctx, "core_memories", { name, renderFn })` |
| MemoryService | `prompt.registerSnippet(key, fn)` | API unchanged — snippets still work the same |
| AgentCore (deferred judgment) | Uses `horizon.formatHorizonText(view)` | Can continue using formatHorizonText or switch to structured |

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `core/src/services/prompt/service.ts` — current PromptService implementation
- Codebase analysis: `core/src/services/horizon/service.ts` — current HorizonView implementation
- Codebase analysis: `core/src/services/agent/loop.ts` — ThinkActLoop consumer
- Codebase analysis: `core/src/services/memory/service.ts` — MemoryService consumer
- Codebase analysis: `references/YesImBot-dev/packages/core/src/services/prompt/` — v3/dev renderer with parse() and multi-pass
- Runtime verification: Mustache 4.2.0 — `{{>partial}}` syntax, `Mustache.parse()` token extraction confirmed
- Runtime verification: Koishi 4.18.10 — `ctx.on('dispose')` lifecycle binding confirmed working
- Runtime verification: Koishi `ctx.effect()` and `ctx.collect()` available

### Secondary (MEDIUM confidence)
- `16-CONTEXT.md` — User decisions constraining design choices
- `references/talks/上下文管理设计缺陷与解决方案.md` — Historical context management design discussions
- `references/talks/智能上下文管理器改造方案总结.md` — Multi-level memory architecture vision

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, all verified at runtime
- Architecture: HIGH — patterns derived from codebase analysis + user locked decisions
- Pitfalls: HIGH — identified from codebase analysis of current consumers and Mustache behavior

**Research date:** 2026-02-21
**Valid until:** 2026-03-21 (stable domain, no external dependency changes expected)
