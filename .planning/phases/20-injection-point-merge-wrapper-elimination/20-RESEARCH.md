# Phase 20: Injection Point Merge & Wrapper Elimination - Research

**Researched:** 2026-02-23
**Domain:** Prompt system refactor — injection point consolidation and template elimination
**Confidence:** HIGH

## Summary

Phase 20 is a structural refactor of the prompt system. The current PromptService uses 6 injection points (`identity`, `style`, `control_flow`, `basic_functions`, `memory`, `extra`) with Mustache wrapper partials that generate XML section tags. This phase merges them to 4 (`soul`, `instructions`, `memory`, `extra`), deletes all wrapper `.mustache` partials and `system.mustache`, and moves XML tag generation into `PromptService.render()` code.

The change surface is well-bounded: one type definition file, one service file, one template directory, and three call sites (loop.ts, SkillRegistry, MemoryService). The Mustache library stays for variable interpolation within snippet content, but template-based prompt assembly is replaced by code string concatenation.

**Primary recommendation:** Change the `InjectionPoint` type first (compiler errors reveal all call sites), then update `render()` to generate XML inline, then delete all wrapper partials and `system.mustache`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Conceptual merge, not content concatenation — old names (identity/style/control_flow/basic_functions) are fully eliminated
- Hard cutover: all call sites (loop.ts, SkillRegistry, PromptService) switch to new names, no backward compatibility
- Old default-*.md files (default-identity.md, default-style.md, default-control-flow.md, default-basic-functions.md) are deleted — empty output is acceptable until Phase 21 fills content via SOUL.md/AGENTS.md
- InjectionPoint type becomes `soul | instructions | memory | extra` — compilation failure on old names is the intended guard
- Each injection point uses its name as the XML tag: `<soul>...</soul>`, `<instructions>...</instructions>`, etc.
- Snippets within an injection point each have their own sub-tags (snippet brings its own tag name at registration time)
- PromptService only wraps the outer injection point tag; inner structure is snippet's responsibility
- Empty injection points still output their tags (e.g. `<soul></soul>`) — always present for structural consistency
- system.mustache is deleted — render() assembles the complete system prompt via code string concatenation
- All wrapper partials (identity.mustache, style.mustache, control_flow.mustache, basic_functions.mustache, memory.mustache) are deleted
- Mustache library dependency is retained — prompt content still supports Mustache variable resolution (e.g. `{{bot.name}}`)
- Only .mustache template files are removed, not the rendering capability
- inject() throws Error on unrecognized injection point names — fail fast, no silent ignore
- CACHEABLE_POINTS derived from InjectionPoint type — type-safe automatic sync
- render() outputs injection points in fixed order: soul -> instructions -> memory -> extra
- All 4 injection points are cacheable

### Claude's Discretion
None specified — all decisions are locked.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PROMPT-01 | Injection points merge from 6 to 4 (identity+style->soul, control_flow+basic_functions->instructions, keep memory and extra) | Type change in `types.ts`, call site updates in `service.ts`, `loop.ts`, `skill/service.ts`, `memory/service.ts` |
| PROMPT-02 | Eliminate 5 wrapper partials, PromptService.render() generates XML tags in code | Delete 5 partial `.mustache` files, rewrite `render()` to concatenate `<point>...</point>` strings |
| PROMPT-03 | system.mustache adapts to new 4-point structure | Delete `system.mustache` entirely — `render()` assembles full prompt in code, no template needed |
| PROMPT-04 | CACHEABLE_POINTS syncs with InjectionPoint type | Derive from `INJECTION_POINTS` array (all 4 cacheable), or remove the separate set entirely |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| mustache | (existing) | Variable interpolation within snippet content | Already in project; retained per user decision |
| koishi | 4.x | Service framework, Context lifecycle | Project foundation |
| TypeScript | (existing) | Type-safe injection point union | Compiler enforces migration completeness |

### Supporting
No new libraries needed. This phase only modifies existing code and deletes files.

### Alternatives Considered
None — all decisions are locked by user.

## Architecture Patterns

### Current Architecture (BEFORE)

```
types.ts:     InjectionPoint = "identity" | "style" | "control_flow" | "basic_functions" | "memory" | "extra"
              INJECTION_POINTS = [all 6]

service.ts:   CACHEABLE_POINTS = Set(["identity", "style", "control_flow", "memory"])
              constructor: registers 8 partials, 4 default injections (identity, control_flow, basic_functions, style)
              render(): iterates INJECTION_POINTS, renders via Mustache partials, returns Section[]

Templates:    system.mustache -> references {{> identity}} {{> style}} etc.
              partials/identity.mustache -> wraps {{{identity_content}}} in <identity> XML
              partials/style.mustache -> wraps {{{style_content}}} in <style> XML
              (same pattern for control_flow, basic_functions, memory, extra)

Call sites:   loop.ts: injects into "style" and "basic_functions"
              skill/service.ts: hardcodes point: "extra" for prompt injections
              memory/service.ts: injects into "memory"
```

### Target Architecture (AFTER)

```
types.ts:     InjectionPoint = "soul" | "instructions" | "memory" | "extra"
              INJECTION_POINTS = ["soul", "instructions", "memory", "extra"]

service.ts:   CACHEABLE_POINTS derived from INJECTION_POINTS (all 4 cacheable)
              constructor: NO partials registered, NO default injections (Phase 21 fills content)
              inject(): throws Error on unrecognized point names
              render(): iterates INJECTION_POINTS in fixed order, wraps each in <point>...</point> XML inline
              render() no longer uses system.mustache — assembles prompt string in code

Templates:    system.mustache DELETED
              All 5 wrapper partials DELETED (identity, style, control_flow, basic_functions, memory)
              extra.mustache DELETED
              Retained: core-memory.mustache, memory-block.mustache, horizon-view.mustache (used by other services)

Call sites:   loop.ts: "style" -> "soul", "basic_functions" -> "instructions"
              skill/service.ts: "extra" stays "extra" (no change needed)
              memory/service.ts: "memory" stays "memory" (no change needed)
```

### Pattern: Inline XML Tag Generation in render()

**What:** Instead of Mustache partials wrapping content in XML tags, `render()` generates `<soul>...</soul>` etc. directly via string concatenation.

**Example:**
```typescript
// For each injection point, after collecting fragments:
const content = fragments.join("\n\n");
// Always emit the tag, even if empty (per user decision)
sections.push({
  name: point,
  content: `<${point}>\n${content}\n</${point}>`,
  cacheable: true, // all 4 are cacheable
});
```

### Pattern: Type-Safe CACHEABLE_POINTS

**What:** Derive CACHEABLE_POINTS from INJECTION_POINTS instead of maintaining a separate hardcoded Set.

**Example:**
```typescript
// All 4 points are cacheable — derive from the source of truth
const CACHEABLE_POINTS = new Set<InjectionPoint>(INJECTION_POINTS);
```

### Pattern: Runtime Guard in inject()

**What:** `inject()` validates the point parameter and throws on unrecognized values.

**Example:**
```typescript
inject(ctx: Context, point: InjectionPoint, entry: InjectionEntry): () => void {
  const list = this.injections.get(point);
  if (!list) {
    throw new Error(`Unrecognized injection point: "${point}"`);
  }
  // ... rest of existing logic
}
```

### Anti-Patterns to Avoid
- **Keeping backward compatibility shims:** The user explicitly wants hard cutover. No `identity` -> `soul` aliases.
- **Concatenating old content into new points:** This is a conceptual merge. Old default-*.md files are deleted, not merged.
- **Wrapping XML tags in a helper that re-introduces template indirection:** Keep it simple — inline string concatenation in `render()`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Mustache variable interpolation | Custom template engine | Existing `MustacheRenderer` | Already works, retained per decision |
| Topological sort for injection ordering | New sort algorithm | Existing `resolveOrder()` | Already handles before/after constraints |

**Key insight:** This phase removes complexity (templates, partials) rather than adding it. The risk is in missing a call site, not in building something new.

## Common Pitfalls

### Pitfall 1: Missing Call Site Updates
**What goes wrong:** Changing the type but forgetting a string literal reference causes runtime errors instead of compile errors.
**Why it happens:** String literals in non-TypeScript files (skill YAML/MD frontmatter) or dynamic references bypass the compiler.
**How to avoid:** After changing the type, run `yarn build` — the compiler will catch all `.ts` call sites. Then grep for old names in `.md`, `.mustache`, and `.yaml` files.
**Warning signs:** Runtime "Unrecognized injection point" errors after deployment.

### Pitfall 2: Forgetting to Delete Files
**What goes wrong:** Old `.mustache` partials or `default-*.md` files remain on disk, causing confusion or being accidentally loaded.
**Why it happens:** File deletion is easy to forget when focused on code changes.
**How to avoid:** Explicit file deletion step with verification. The constructor's `partialMap` must be updated to remove references to deleted partials.
**Warning signs:** `loadPartial()` calls for non-existent files throw ENOENT at runtime.

### Pitfall 3: Breaking the Scope Variable Contract
**What goes wrong:** The current `render()` sets `${point}_content` and `has_${point}` scope variables. If any remaining template (like `core-memory.mustache`) references these, it breaks.
**Why it happens:** Scope variables were used by the old partial system.
**How to avoid:** Check that `core-memory.mustache`, `memory-block.mustache`, and `horizon-view.mustache` do NOT reference `identity_content`, `style_content`, etc. (They don't — verified.)
**Warning signs:** Empty sections in rendered output.

### Pitfall 4: extra.mustache Has No XML Wrapper
**What goes wrong:** The current `extra.mustache` partial does NOT wrap content in `<extra>` tags (unlike all other partials). The new system wraps ALL points uniformly.
**Why it happens:** Historical inconsistency in the template design.
**How to avoid:** This is actually desired — the new system normalizes behavior. Just be aware that `extra` output will now be wrapped in `<extra>...</extra>` tags, which is a behavioral change.
**Warning signs:** None — this is intentional normalization.

### Pitfall 5: system.mustache Seeding Logic
**What goes wrong:** The constructor checks for `system.mustache` existence to decide whether to seed the resources directory. After deleting `system.mustache`, this check always triggers seeding.
**Why it happens:** The seeding guard uses `existsSync(resolve(this.resourcesDir, "system.mustache"))`.
**How to avoid:** Update or remove the seeding logic. Since templates are no longer used for prompt assembly, the seeding check should reference a different file or be removed entirely.
**Warning signs:** Unnecessary directory copies on every startup.

## Code Examples

### Change 1: types.ts — New InjectionPoint Type

```typescript
// BEFORE
export type InjectionPoint = "identity" | "style" | "control_flow" | "basic_functions" | "memory" | "extra";
export const INJECTION_POINTS: InjectionPoint[] = ["identity", "style", "control_flow", "basic_functions", "memory", "extra"];

// AFTER
export type InjectionPoint = "soul" | "instructions" | "memory" | "extra";
export const INJECTION_POINTS: InjectionPoint[] = ["soul", "instructions", "memory", "extra"];
```

### Change 2: service.ts — Constructor Cleanup

```typescript
// BEFORE: registers 8 partials, 4 default injections, loads system.mustache
// AFTER: no partials, no default injections, no system template

constructor(ctx: Context, config: PromptServiceConfig) {
  super(ctx, "yesimbot.prompt", true);
  this.config = config;
  this.logger = this.ctx.logger("yesimbot.prompt");
  this.resourcesDir = config.resourcesDir ?? builtinResourcesDir;
  // Seeding logic: update guard (no longer checks system.mustache)
  for (const point of INJECTION_POINTS) {
    this.injections.set(point, []);
  }
  // No registerTemplate("system", ...) — render() assembles inline
  // No partialMap registration — wrapper partials deleted
  // No default injections — Phase 21 provides content via SOUL.md/AGENTS.md
}
```

### Change 3: service.ts — render() Inline XML Assembly

```typescript
// AFTER: render() generates XML tags inline, no template needed
async render(
  _templateName: string,
  initialScope?: Record<string, unknown>,
): Promise<Section[]> {
  const scope = { ...(initialScope ?? {}) };
  const timeout = this.config.timeout ?? 5000;
  const sections: Section[] = [];

  for (const point of INJECTION_POINTS) {
    const ordered = this.resolveOrder(this.injections.get(point)!);
    const results = await Promise.allSettled(
      ordered.map((entry) => this.renderWithTimeout(entry, scope, timeout)),
    );
    const fragments: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "fulfilled" && r.value) {
        fragments.push(r.value);
      } else if (r.status === "rejected") {
        this.logger.warn(`Injection "${ordered[i].name}" in "${point}" failed: ${r.reason}`);
      }
    }
    const content = fragments.join("\n\n");
    // Always emit tag, even if empty (user decision)
    sections.push({
      name: point,
      content: `<${point}>\n${content}\n</${point}>`,
      cacheable: true,
    });
  }

  return sections;
}
```

### Change 4: service.ts — inject() Runtime Guard

```typescript
inject(ctx: Context, point: InjectionPoint, entry: InjectionEntry): () => void {
  const list = this.injections.get(point);
  if (!list) {
    throw new Error(`Unrecognized injection point: "${point}"`);
  }
  // ... existing duplicate check and disposal logic
}
```

### Change 5: loop.ts — Call Site Migration

```typescript
// BEFORE
prompt.inject(this.ctx, "style", { name: `__skill_style_${percept.id}`, ... });
prompt.inject(this.ctx, "basic_functions", { name: `__loop_tool_schema_${percept.id}`, ... });

// AFTER
prompt.inject(this.ctx, "soul", { name: `__skill_style_${percept.id}`, ... });
prompt.inject(this.ctx, "instructions", { name: `__loop_tool_schema_${percept.id}`, ... });
```

## Inventory of Files to Modify

### TypeScript Files (4)
| File | Change |
|------|--------|
| `core/src/services/prompt/types.ts` | InjectionPoint type + INJECTION_POINTS array |
| `core/src/services/prompt/service.ts` | CACHEABLE_POINTS, constructor, inject(), render(), remove partials/templates logic |
| `core/src/services/agent/loop.ts` | "style" -> "soul", "basic_functions" -> "instructions" |
| `core/src/services/prompt/index.ts` | No change needed (re-exports types) |

### Files to Delete (10)
| File | Reason |
|------|--------|
| `core/resources/templates/system.mustache` | Replaced by code assembly |
| `core/resources/templates/partials/identity.mustache` | Wrapper partial eliminated |
| `core/resources/templates/partials/style.mustache` | Wrapper partial eliminated |
| `core/resources/templates/partials/control_flow.mustache` | Wrapper partial eliminated |
| `core/resources/templates/partials/basic_functions.mustache` | Wrapper partial eliminated |
| `core/resources/templates/partials/memory.mustache` | Wrapper partial eliminated |
| `core/resources/templates/partials/extra.mustache` | Wrapper partial eliminated |
| `core/resources/templates/default-identity.md` | Old default content, Phase 21 replaces |
| `core/resources/templates/default-style.md` | Old default content, Phase 21 replaces |
| `core/resources/templates/default-control-flow.md` | Old default content, Phase 21 replaces |
| `core/resources/templates/default-basic-functions.md` | Old default content, Phase 21 replaces |

### Files NOT Deleted (retained)
| File | Reason |
|------|--------|
| `core/resources/templates/core-memory.mustache` | Used by MemoryService internally |
| `core/resources/templates/partials/memory-block.mustache` | Used by MemoryService internally |
| `core/resources/templates/partials/horizon-view.mustache` | Used by HorizonService (user message, not system prompt) |
| `core/resources/templates/default-persona.md` | Used by MemoryService for initial persona seeding |

### Files That Need NO Changes (verified)
| File | Reason |
|------|--------|
| `core/src/services/skill/types.ts` | Imports `InjectionPoint` — type change propagates automatically |
| `core/src/services/skill/service.ts` | Hardcodes `point: "extra"` — "extra" is unchanged |
| `core/src/services/memory/service.ts` | Injects into `"memory"` — "memory" is unchanged |
| `core/src/services/prompt/renderer.ts` | MustacheRenderer unchanged — still used for variable interpolation |

## Open Questions

1. **Seeding logic after system.mustache deletion**
   - What we know: Constructor checks `existsSync(resolve(this.resourcesDir, "system.mustache"))` to decide whether to seed custom resources dir
   - What's unclear: What should the new guard be? The retained templates (core-memory, memory-block, horizon-view) are still needed by MemoryService
   - Recommendation: Change the guard to check for `core-memory.mustache` instead, or remove seeding entirely if the retained templates are always loaded from `builtinResourcesDir` directly

2. **buildScope() simplification**
   - What we know: `buildScope()` calls `getRequiredVariables()` which parses template content for Mustache variables. With no system template, the `templateContent` parameter to `render()` becomes meaningless
   - What's unclear: Whether snippets still need the "required variables" optimization or can just all be evaluated
   - Recommendation: Simplify — evaluate all registered snippets unconditionally since there's no template to parse. Or keep the optimization but pass a synthetic "template" that references known variables. Planner should decide.

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection of all files in `core/src/services/prompt/`, `core/src/services/agent/loop.ts`, `core/src/services/skill/`, `core/src/services/memory/`
- Direct inspection of all `.mustache` template files in `core/resources/templates/`
- CONTEXT.md user decisions (locked)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries, only modifying existing code
- Architecture: HIGH - all files inspected, change surface fully mapped
- Pitfalls: HIGH - identified from direct code analysis, not speculation

**Research date:** 2026-02-23
**Valid until:** 2026-03-23 (stable — internal refactor, no external dependencies)
