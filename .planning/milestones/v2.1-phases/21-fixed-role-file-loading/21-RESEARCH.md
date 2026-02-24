# Phase 21: Fixed-Role File Loading - Research

**Researched:** 2026-02-23
**Domain:** File-based prompt content loading, Mustache templating, fs.watch hot-reload
**Confidence:** HIGH

## Summary

Phase 21 fills the content gap left by Phase 20. After Phase 20 deleted the old default-*.md files and eliminated wrapper partials, the `soul` and `instructions` injection points currently emit empty tags (`<soul></soul>`, `<instructions></instructions>`). This phase introduces three fixed-role files — SOUL.md, AGENTS.md, TOOLS.md — that load from disk, support Mustache template variables, and inject content into those points.

The implementation is straightforward because all infrastructure already exists: PromptService has `inject()` with ordering support, MemoryService demonstrates the exact fs.watch + debounce pattern, MustacheRenderer handles variable interpolation, and the snippet system already provides `bot.name`, `date.now`, `sender.*`, `channel.*` variables. The primary new work is: (1) a RoleService that loads/watches/renders the three files, (2) bundled default SOUL.md/AGENTS.md/TOOLS.md content inspired by letta memgpt_v2_chat and OpenClaw's file-separation philosophy, and (3) wiring the rendered content into the existing injection points.

**Primary recommendation:** Create a new RoleService (extends Service) that owns file discovery, loading, Mustache rendering, hot-reload, and injection registration for the three fixed-role files. Keep it as a peer to MemoryService — both depend on PromptService.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Borrow OpenClaw's file-separation philosophy but design Athena's own voice and structure
- Additionally reference letta's memgpt_chat and memgpt_v2_chat system prompts — v3 was built on this lineage, proven path
- Default language: English (users can rewrite in any language)
- Internal structure: Markdown headings (## sections) — facilitates future RAG chunking/search
- SOUL.md and AGENTS.md boundary: broadly separated but cross-references allowed
- Template variable coverage: as rich as possible — expose bot info, date/time, platform/channel context, and other runtime data
- Naming convention: dot-nested (e.g. `{{bot.name}}`, `{{date.now}}`, `{{platform.name}}`)
- Data sources: predefined variables + user-defined custom variables via config + plugin-registered Snippets
- Undefined variables: render as empty string + warn log
- Default location: Koishi data directory (e.g. `data/athena/SOUL.md`), path configurable via plugin config
- SOUL.md and AGENTS.md are required; TOOLS.md is optional (silently skipped when absent)
- First launch / missing files: release bundled defaults from package into user directory
- Existing user files are never overwritten on plugin update — log a notice instead
- Reuse existing MemoryService fs.watch + debounce infrastructure — register role files into the same watcher manager
- Silent reload + debug-level log only (no user-facing notification)
- On reload: re-render Mustache template; on syntax error, warn log and retain last valid content

### Claude's Discretion
- Exact Mustache variable catalog (which runtime values to expose beyond the obvious ones)
- Internal structure of default SOUL.md/AGENTS.md/TOOLS.md content (heading hierarchy, section order)
- Compression algorithm for bundled defaults
- Watcher registration API details within MemoryService

### Deferred Ideas (OUT OF SCOPE)
- Migration command for updating user role files when bundled defaults change — requires command/instruction system (future phase)
- Per-channel dynamic SOUL.md — explicitly out of scope (Skill effects cover per-context adjustments)
- USER.md (OpenClaw user profile files) — requires per-user persistence, belongs to L1/L2/L3 memory system
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ROLE-01 | SOUL.md replaces default-identity.md + default-style.md + default persona.md, injected at soul point | RoleService loads SOUL.md, calls `prompt.inject(ctx, "soul", ...)` with rendered content |
| ROLE-02 | AGENTS.md replaces default-control-flow.md + default-basic-functions.md, injected at instructions point | RoleService loads AGENTS.md, calls `prompt.inject(ctx, "instructions", ...)` |
| ROLE-03 | TOOLS.md optional, injected at instructions point; absent = silently skipped | RoleService checks `existsSync()` before loading; no error on missing file |
| ROLE-04 | Rewrite default prompt content referencing OpenClaw/letta style | Bundled defaults in `core/resources/roles/` — SOUL.md, AGENTS.md, TOOLS.md |
| ROLE-05 | Fixed-role files support Mustache template variables | MustacheRenderer.render() with scope from buildScope(); existing snippets provide variables |
| ROLE-06 | Graceful fallback when files missing — use built-in minimal defaults, no crash | Bundled defaults copied to user dir on first launch; inline fallback string if copy fails |
| ROLE-07 | Hot-reload with fs.watch + debounce matching memory block behavior | Same pattern as MemoryService.startWatching(): `watch()` + 300ms debounce + reload callback |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| mustache | ^4.2.0 | Template variable interpolation in role files | Already in dependencies, used by MustacheRenderer |
| gray-matter | ^4.0.3 | Frontmatter parsing (if role files need metadata) | Already in dependencies, used by MemoryService and SkillLoader |
| node:fs | built-in | File reading, watching, copying | Already used throughout codebase |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| koishi Service | ^4.18.3 | Service subclass pattern for RoleService | Required by project conventions (CLAUDE.md) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New RoleService | Extend MemoryService | MemoryService has different concerns (blocks, char limits, frontmatter); separate service is cleaner |
| fs.watch | chokidar | fs.watch is already proven in MemoryService; no new dependency needed |

**Installation:** No new packages needed — all dependencies already present.

## Architecture Patterns

### Recommended Project Structure
```
core/
├── src/services/role/
│   ├── index.ts          # exports
│   ├── service.ts        # RoleService (extends Service)
│   └── types.ts          # RoleFile interface
├── resources/roles/
│   ├── SOUL.md           # bundled default soul content
│   ├── AGENTS.md         # bundled default agent instructions
│   └── TOOLS.md          # bundled default tool instructions
```

### Pattern 1: RoleService as Service Subclass
**What:** New service that loads, watches, and injects fixed-role files
**When to use:** This is the only pattern — follows project convention from CLAUDE.md

```typescript
// Source: project convention (CLAUDE.md Service Pattern)
class RoleService extends Service {
  static inject = ["yesimbot.prompt"];

  constructor(ctx: Context, config: RoleServiceConfig) {
    super(ctx, "yesimbot.role", false); // false = async init via start()
  }

  protected async start(): Promise<void> {
    await this.ensureFiles();
    this.loadAndInject();
    this.startWatching();
  }
}
```

### Pattern 2: File Loading with Bundled Fallback (from MemoryService)
**What:** Copy bundled defaults to user directory on first launch; never overwrite existing
**When to use:** First-launch seeding of SOUL.md/AGENTS.md

```typescript
// Source: MemoryService.loadBlocks() pattern + PromptService constructor seeding
private async ensureFiles(): Promise<void> {
  for (const name of ["SOUL.md", "AGENTS.md"]) {
    const userPath = join(this.config.rolePath, name);
    if (!existsSync(userPath)) {
      const bundledPath = join(builtinRolesDir, name);
      if (existsSync(bundledPath)) {
        cpSync(bundledPath, userPath);
      }
    }
  }
  // TOOLS.md: optional, only copy if bundled exists and user doesn't have one
}
```

### Pattern 3: fs.watch + Debounce Hot-Reload (from MemoryService)
**What:** Watch role file directory for changes, debounce, reload
**When to use:** ROLE-07 hot-reload requirement

```typescript
// Source: MemoryService.startWatching() — exact same pattern
private startWatching(): void {
  this.watcher = watch(this.config.rolePath, (eventType, filename) => {
    if (!filename?.endsWith(".md")) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.loadAndInject();
      this.logger.debug("Role files reloaded");
    }, 300);
  });
  this.ctx.on("dispose", () => {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.watcher?.close();
  });
}
```

### Pattern 4: Injection with Mustache Rendering
**What:** Load file content, render Mustache variables, inject into prompt point
**When to use:** ROLE-01, ROLE-02, ROLE-03

```typescript
// Source: MemoryService.registerInjection() + MustacheRenderer pattern
private loadAndInject(): void {
  // Dispose previous injections
  for (const d of this.disposers) d();
  this.disposers = [];

  // SOUL.md → soul point
  const soulContent = this.loadFile("SOUL.md");
  if (soulContent !== null) {
    this.disposers.push(
      this.prompt.inject(this.ctx, "soul", {
        name: "__role_soul",
        renderFn: (scope) => this.renderer.render(soulContent, scope),
      })
    );
  }
  // Similar for AGENTS.md → instructions, TOOLS.md → instructions (optional)
}
```

### Pattern 5: Undefined Variable Handling
**What:** Mustache renders missing variables as empty string by default; add warn log
**When to use:** ROLE-05 undefined variable behavior

```typescript
// Mustache.render() already returns "" for undefined variables (default behavior)
// The MustacheRenderer.parse() method can detect variable names in template
// Compare against available scope keys to warn about undefined ones
private warnUndefinedVars(template: string, scope: Record<string, unknown>): void {
  const { variables } = this.renderer.parse(template);
  for (const v of variables) {
    if (this.getNestedProperty(scope, v) === undefined) {
      this.logger.warn("Undefined template variable: {{%s}}", v);
    }
  }
}
```

### Anti-Patterns to Avoid
- **Merging into MemoryService:** Role files have different semantics (fixed content, not user memory blocks with frontmatter/labels). Keep separate.
- **Loading files in renderFn:** File I/O should happen at load time, not on every render call. Cache the raw content, only re-render Mustache variables per call.
- **Overwriting user files on update:** User may have customized their SOUL.md. Only seed on first launch when file is absent.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Template variable interpolation | Custom regex replacer | MustacheRenderer (already exists) | Handles nested variables, sections, escaping |
| File watching | Custom polling loop | node:fs watch() (already proven in MemoryService) | OS-level events, debounce pattern already established |
| Frontmatter parsing | Custom YAML parser | gray-matter (already in deps) | Edge cases in YAML parsing; gray-matter handles them |
| Scope building with snippets | Manual variable assembly | PromptService.buildScope() | Snippets already register bot.name, date.now, etc. |

**Key insight:** Nearly all infrastructure exists. The risk is in duplicating logic rather than reusing it.

## Common Pitfalls

### Pitfall 1: Injection Ordering Conflicts
**What goes wrong:** RoleService injects `__role_soul` but SkillRegistry also injects style overrides into `soul` point with `after: "__default_soul"`. The old name `__default_soul` no longer exists.
**Why it happens:** loop.ts line 80 references `after: "__default_soul"` for skill style overrides.
**How to avoid:** Use `__role_soul` as the injection name and update loop.ts to reference `after: "__role_soul"` for skill style overrides.
**Warning signs:** Skill style overrides appearing before soul content instead of after.

### Pitfall 2: Race Condition Between Services
**What goes wrong:** RoleService and MemoryService both depend on PromptService. If RoleService starts before PromptService is ready, inject() calls fail.
**Why it happens:** Koishi Service dependency resolution.
**How to avoid:** Declare `static inject = ["yesimbot.prompt"]` — Koishi won't start the service until PromptService exists. Use `immediate: false` (async start).
**Warning signs:** "Unrecognized injection point" errors at startup.

### Pitfall 3: Hot-Reload Disposing Old Injections
**What goes wrong:** On file change, new injections are added without removing old ones, causing duplicate content.
**Why it happens:** `prompt.inject()` returns a dispose function that must be called before re-injecting.
**How to avoid:** Store dispose functions in an array; call all of them before re-injecting on reload.
**Warning signs:** Duplicate soul/instructions content in rendered prompt.

### Pitfall 4: Mustache Rendering Errors on Malformed Templates
**What goes wrong:** User edits SOUL.md with invalid Mustache syntax (e.g., unclosed `{{#section}}`), causing render to throw.
**Why it happens:** Mustache.parse() throws on syntax errors.
**How to avoid:** Wrap render in try/catch; on error, warn log and retain last valid rendered content.
**Warning signs:** Empty soul/instructions content after user edits a file.

### Pitfall 5: fs.watch Filename Argument Unreliable on Some Platforms
**What goes wrong:** The `filename` argument to fs.watch callback can be `null` on some Linux configurations.
**Why it happens:** Known Node.js limitation — fs.watch filename support varies by OS.
**How to avoid:** When filename is null, reload all role files (same approach as MemoryService which ignores filename entirely).
**Warning signs:** Role files not reloading on Linux.

## Code Examples

### Existing Snippet Registration (already provides template variables)
```typescript
// Source: core/src/services/memory/service.ts lines 119-158
// These snippets are ALREADY registered and available in scope:
// bot.name, bot.id, date.now, sender.name, sender.id, channel.name, channel.platform
```

### Existing Injection API
```typescript
// Source: core/src/services/prompt/service.ts lines 88-104
inject(ctx: Context, point: InjectionPoint, entry: InjectionEntry): () => void
// Returns dispose function; auto-disposes on ctx dispose
```

### Existing MustacheRenderer
```typescript
// Source: core/src/services/prompt/renderer.ts
// render(template, scope, partials?, options?) — iterative rendering up to maxDepth
// parse(template) — returns { variables: Set<string>, partials: Set<string> }
```

### PromptService.render() Output Structure
```typescript
// Source: core/src/services/prompt/service.ts lines 113-141
// For each injection point, renders all entries, wraps in XML:
// <soul>\n{content}\n</soul>
// <instructions>\n{content}\n</instructions>
// <memory>\n{content}\n</memory>
// <extra>\n{content}\n</extra>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 6 injection points with wrapper partials | 4 injection points with inline XML | Phase 20 (2026-02-23) | soul and instructions points exist but emit empty content |
| default-identity.md + default-style.md | Deleted in Phase 20 | Phase 20 | No soul content until this phase fills it |
| default-control-flow.md + default-basic-functions.md | Deleted in Phase 20 | Phase 20 | No instructions content until this phase fills it |
| system.mustache template | Deleted in Phase 20 | Phase 20 | render() assembles prompt in code |

**Current state after Phase 20:**
- `core/resources/templates/` contains only: `core-memory.mustache`, `default-persona.md`, `partials/memory-block.mustache`, `partials/horizon-view.mustache`
- soul and instructions injection points are empty — no service injects content into them
- MemoryService injects into `memory` point only
- SkillRegistry injects into `extra` point (and `soul` for style overrides)
- loop.ts injects tool schema into `instructions` point per-turn

## Open Questions

1. **Where should snippets be registered — RoleService or keep in MemoryService?**
   - What we know: MemoryService currently registers all snippets (bot.name, date.now, etc.) in its `registerSnippets()` method
   - What's unclear: Should RoleService register additional snippets, or should snippet registration stay centralized in MemoryService?
   - Recommendation: Keep existing snippets in MemoryService (they serve memory blocks too). RoleService can register additional role-specific snippets if needed. The snippet system is additive — no conflict.

2. **Should TOOLS.md inject before or after the per-turn tool schema from loop.ts?**
   - What we know: loop.ts injects `__loop_tool_schema_{perceptId}` into instructions point per-turn
   - What's unclear: TOOLS.md provides static tool usage guidance; loop.ts provides dynamic tool definitions
   - Recommendation: TOOLS.md should inject with `before: "__loop_tool_schema_"` prefix matching, or simply rely on registration order (RoleService starts before loop runs). Static guidance before dynamic schema is natural reading order.

3. **Config field naming: `rolePath` vs `roleDir` vs reuse `resourcesDir`?**
   - What we know: MemoryService uses `coreMemoryPath`, PromptService uses `resourcesDir`
   - Recommendation: Use `rolePath` with Schema.path() for consistency with `coreMemoryPath` pattern. Default to `data/yesimbot/roles`.

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `core/src/services/prompt/service.ts` — PromptService inject/render API
- Codebase inspection: `core/src/services/memory/service.ts` — fs.watch + debounce pattern, snippet registration
- Codebase inspection: `core/src/services/prompt/renderer.ts` — MustacheRenderer API
- Codebase inspection: `core/src/services/prompt/types.ts` — InjectionPoint, InjectionEntry types
- Codebase inspection: `core/src/services/agent/loop.ts` — how prompt is consumed, skill injection patterns
- Codebase inspection: `core/src/index.ts` — service wiring and config composition

### Secondary (MEDIUM confidence)
- `references/openclaw/docs/reference/templates/SOUL.md` — OpenClaw SOUL.md template structure
- `references/openclaw/docs/reference/templates/AGENTS.md` — OpenClaw AGENTS.md template structure
- `references/letta/letta/prompts/system_prompts/memgpt_chat.py` — letta v1 system prompt
- `references/letta/letta/prompts/system_prompts/memgpt_v2_chat.py` — letta v2 system prompt with XML sections

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in use, no new dependencies
- Architecture: HIGH — follows established Service subclass pattern, reuses proven fs.watch pattern
- Pitfalls: HIGH — identified from direct codebase inspection of existing patterns
- Content design: MEDIUM — default SOUL.md/AGENTS.md content requires creative writing informed by references

**Research date:** 2026-02-23
**Valid until:** 2026-03-23 (stable — internal architecture, no external API changes)
