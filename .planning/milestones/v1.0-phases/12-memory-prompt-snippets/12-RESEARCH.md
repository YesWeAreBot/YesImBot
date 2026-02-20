# Phase 12: Memory & Prompt Snippets - Research

**Researched:** 2026-02-20
**Domain:** Filesystem memory loading, YAML frontmatter parsing, Mustache template injection, dynamic prompt snippets
**Confidence:** HIGH

## Summary

Phase 12 adds two capabilities to the existing PromptService: (1) a MemoryService that loads `.md/.txt` files with YAML frontmatter from a configured directory and injects their content into every prompt, and (2) built-in dynamic snippets that supply runtime context (time, sender, channel, bot) as Mustache template variables.

The existing PromptService already has all the extension points needed: `registerSnippet()` for template variables, `inject()` for content blocks, and Mustache rendering with partials. The v3/dev references provide a proven MemoryBlock pattern with `gray-matter` for frontmatter parsing and `fs.watch` for hot-reload. The v4 implementation can simplify this significantly since CONTEXT.md decisions removed priority/tags fields and specified flat directory structure with filename-based ordering.

**Primary recommendation:** Create a MemoryService (Koishi Service subclass) that loads memory blocks on start, watches for file changes, and registers a PromptService injection. Register built-in snippets (time, sender, channel, bot) directly in the core plugin's `apply()` function using the existing `registerSnippet()` API.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- YAML frontmatter fields: label, title, description (MemGPT/Letta style, no priority/tags)
- Future limit field for memory block modification tools (not this phase)
- Only .md and .txt file formats
- Single-level directory structure, no nested subdirectories
- Hot-reload: watch file changes and auto-reload
- Full injection: all memory blocks injected every time, no context matching (future iteration)
- Sort by filename alphabetically
- Memory blocks support template variable rendering (e.g. {{ bot.name }})
- Total injection limit: default 4000 characters, truncate when exceeded
- Built-in default persona.md as fallback when no memory files found
- Neutral/generic persona style (not v3's casual group member persona)
- Persona block is optional enhancement, system works without memory blocks
- Support template variables in persona ({{ bot.name }}, {{ date.now }})
- Only 4 snippet types: current time, sender nickname/ID, channel name/platform, bot name/ID
- Natural language format output (not structured key-value)
- Snippets injected as template variables for memory blocks and system prompt templates
- Time format: Chinese-friendly (e.g. "2026年2月20日 星期五 下午3:00")

### Claude's Discretion
- Memory block injection position in prompt (system prompt inline vs separate message)
- Template variable namespace design
- Hot-reload implementation (fs.watch vs chokidar etc.)
- Default persona.md content

### Deferred Ideas (OUT OF SCOPE)
- Memory block self-modification tools (MemGPT-style core memory edit) — future phase
- Rule matching / active read injection (context-selective memory block injection) — future iteration
- L1/L2/L3 advanced memory system — marked out of scope in REQUIREMENTS.md
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MEMORY-01 | File system memory loading — scan configured path for .md/.txt files, parse YAML frontmatter (priority, tags) | MemoryService scans directory, parses frontmatter with js-yaml (already available), MemoryBlock data structure from v3/dev reference |
| MEMORY-02 | Memory injection into Prompt — loaded blocks injected into Prompt scope, built-in default fallback | PromptService.inject() API already exists; memory blocks rendered as `<core_memory>` XML section; default persona.md bundled as string constant |
| PROMPT-02 | Built-in dynamic snippets — time, sender nickname/ID, channel name/platform, bot name/ID | PromptService.registerSnippet() API already exists; snippets read from HorizonView scope passed to render() |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node:fs/promises | built-in | Read memory files from disk | Standard Node.js API, no dependency needed |
| node:fs | built-in | fs.watch for hot-reload | Standard Node.js API, sufficient for single-directory watching |
| js-yaml | (transitive) | Parse YAML frontmatter from memory files | Already available in node_modules as Koishi transitive dependency |
| mustache | ^4.2.0 | Template variable rendering in memory block content | Already a direct dependency of plugins/core |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| koishi Schema.path | built-in | Directory picker in Koishi console config UI | For the coreMemoryPath config field |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| js-yaml (transitive) | gray-matter | gray-matter is a new dependency; js-yaml is already available and frontmatter parsing is trivial (split on `---`, parse middle) |
| node:fs.watch | chokidar | chokidar adds a dependency; fs.watch is sufficient for single flat directory on modern Node.js (v24) |
| Hand-rolled frontmatter parser | gray-matter | gray-matter handles edge cases but adds ~15 transitive deps; simple regex split + js-yaml.load is adequate for our constrained format |

**Installation:**
No new dependencies needed. `js-yaml` is already a transitive dependency. `mustache` is already a direct dependency.

## Architecture Patterns

### Recommended Project Structure
```
plugins/core/src/services/memory/
├── index.ts          # Re-exports
├── service.ts        # MemoryService (Koishi Service subclass)
├── types.ts          # MemoryBlock interface, MemoryConfig
└── config.ts         # Schema definition for memory config
```

### Pattern 1: MemoryService as Koishi Service
**What:** MemoryService extends Service, loads files in `start()`, registers a PromptService injection, watches directory for changes.
**When to use:** This is the only pattern — follows project convention from CLAUDE.md.
**Example:**
```typescript
// Declaration merging
declare module "koishi" {
  interface Context {
    "yesimbot.memory": MemoryService;
  }
}

class MemoryService extends Service<MemoryConfig> {
  static inject = ["yesimbot.prompt"];

  constructor(ctx: Context, config: MemoryConfig) {
    super(ctx, "yesimbot.memory", false); // false = wait for start()
  }

  protected async start(): Promise<void> {
    await this.loadBlocks();
    this.startWatching();
    this.registerInjection();
  }
}
```

### Pattern 2: Frontmatter Parsing Without gray-matter
**What:** Split file content on `---` delimiters, parse YAML section with js-yaml, return content body.
**When to use:** For all memory block file loading.
**Example:**
```typescript
import { load as yamlLoad } from "js-yaml";

interface MemoryBlock {
  label: string;
  title?: string;
  description?: string;
  content: string;
}

function parseFrontmatter(raw: string): { meta: Record<string, unknown>; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw.trim() };
  return {
    meta: (yamlLoad(match[1]) as Record<string, unknown>) ?? {},
    content: match[2].trim(),
  };
}
```

### Pattern 3: Memory Injection via PromptService.inject()
**What:** Register a prompt injection that renders all memory blocks as an XML section.
**When to use:** To inject memory content into every rendered system prompt.
**Example:**
```typescript
// Register injection at priority 10 (before other injections)
this.ctx["yesimbot.prompt"].inject("core-memory", 10, (scope) => {
  const blocks = this.getBlocks();
  if (!blocks.length) return "";
  // Render template variables in each block's content
  const rendered = blocks.map(b => {
    const content = Mustache.render(b.content, scope);
    return `<${b.label}>\n${b.title ? `<title>${b.title}</title>\n` : ""}${content}\n</${b.label}>`;
  });
  return `<core_memory>\n${rendered.join("\n\n")}\n</core_memory>`;
});
```

### Pattern 4: Built-in Snippets via registerSnippet()
**What:** Register template variables that resolve from the HorizonView scope already passed to render().
**When to use:** For the 4 required dynamic snippets.
**Example:**
```typescript
// Snippets read from the scope that loop.ts already passes as { view }
prompt.registerSnippet("bot.name", (scope) => {
  const view = scope.view as HorizonView;
  return view?.self?.name ?? "";
});

prompt.registerSnippet("date.now", () => {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "long", day: "numeric",
    weekday: "long", hour: "numeric", minute: "2-digit",
    hour12: true,
  }).format(new Date());
});
```

### Pattern 5: Hot-Reload with fs.watch on Directory
**What:** Watch the memory directory (not individual files) for changes, debounce, and reload all blocks.
**When to use:** For the hot-reload requirement.
**Example:**
```typescript
import { watch } from "node:fs";

private startWatching(): void {
  let timer: NodeJS.Timeout | undefined;
  const watcher = watch(this.config.coreMemoryPath, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => this.loadBlocks(), 300);
  });
  // Use Koishi dispose for cleanup
  this.ctx.on("dispose", () => {
    watcher.close();
    if (timer) clearTimeout(timer);
  });
}
```

### Anti-Patterns to Avoid
- **Watching individual files:** The v3/dev reference watches each file separately. Since we have a flat directory with full reload, watch the directory once instead.
- **Using gray-matter:** Adds unnecessary dependency when js-yaml + simple regex does the job for our constrained frontmatter format.
- **Creating a separate MemoryBlock class:** The v3/dev reference has a full class with getters, watchers per block, etc. Our requirements are simpler (flat data, directory-level watch). Use a plain interface.
- **Injecting memory as a separate message:** The v3/dev reference uses `<core_memory>` in the system prompt template. Keep it in the system prompt via the injection mechanism — the LLM sees it as part of its identity context.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML parsing | Custom YAML parser | js-yaml (transitive dep) | YAML has many edge cases |
| Template rendering | Custom variable substitution | Mustache (existing dep) | Already used by PromptService, handles sections/escaping |
| Chinese date formatting | Manual date string building | Intl.DateTimeFormat with zh-CN locale | Handles weekday names, AM/PM, locale-correct formatting |
| Directory path config UI | Manual path input | Koishi Schema.path({ filters: ['directory'] }) | Provides file browser in Koishi console |

**Key insight:** The existing PromptService already provides all the extension points (snippets, injections, Mustache rendering). This phase is about wiring new data sources into those existing APIs, not building new rendering infrastructure.

## Common Pitfalls

### Pitfall 1: fs.watch Reliability on Different Platforms
**What goes wrong:** `fs.watch` behavior varies across OS (Linux inotify vs macOS FSEvents vs Windows). Events may fire multiple times for a single change.
**Why it happens:** OS-level filesystem notification differences.
**How to avoid:** Debounce with 300ms timer (as v3/dev does). Reload all blocks on any change rather than trying to detect which file changed.
**Warning signs:** Duplicate reload logs, high CPU from rapid reloads.

### Pitfall 2: Template Variable Rendering Order
**What goes wrong:** Memory block content contains `{{ bot.name }}` but the snippet hasn't been resolved yet when the injection runs.
**Why it happens:** PromptService.render() resolves snippets first, then runs injections. But injections receive the scope with snippets already resolved.
**How to avoid:** The injection renderFn receives the fully-built scope. Use Mustache.render(blockContent, scope) inside the injection to resolve template variables in memory block content. This works because snippets are resolved before injections in the existing render() flow.
**Warning signs:** Literal `{{ bot.name }}` appearing in LLM prompts.

### Pitfall 3: Character Limit Truncation Strategy
**What goes wrong:** Truncating in the middle of a memory block produces incoherent content.
**Why it happens:** Naive character counting cuts mid-sentence.
**How to avoid:** Truncate at block boundaries — include whole blocks until the limit is reached, then stop. Log a warning about which blocks were omitted.
**Warning signs:** Garbled text at the end of memory section.

### Pitfall 4: Missing label Field in Frontmatter
**What goes wrong:** File without `label` field causes rendering errors (XML tag with empty name).
**Why it happens:** User creates a memory file without proper frontmatter.
**How to avoid:** Derive label from filename (strip extension) when frontmatter label is missing. Log a warning.
**Warning signs:** Empty XML tags in system prompt.

### Pitfall 5: Circular Dependency Between MemoryService and PromptService
**What goes wrong:** MemoryService depends on PromptService (to register injection), but if PromptService also depended on MemoryService, Koishi would deadlock.
**Why it happens:** Incorrect dependency declaration.
**How to avoid:** MemoryService declares `inject = ["yesimbot.prompt"]`. PromptService has no knowledge of MemoryService. One-way dependency only.
**Warning signs:** Services never reaching ready state.

## Code Examples

### Frontmatter Parsing (verified pattern from v3/dev reference)
```typescript
import { load as yamlLoad } from "js-yaml";
import { readFile } from "node:fs/promises";

interface MemoryBlock {
  label: string;
  title?: string;
  description?: string;
  content: string;
  filename: string;
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw.trim() };
  return {
    meta: (yamlLoad(match[1]) as Record<string, string>) ?? {},
    content: match[2].trim(),
  };
}

async function loadBlock(filePath: string, filename: string): Promise<MemoryBlock> {
  const raw = await readFile(filePath, "utf-8");
  const { meta, content } = parseFrontmatter(raw);
  return {
    label: meta.label || filename.replace(/\.(md|txt)$/, ""),
    title: meta.title,
    description: meta.description,
    content,
    filename,
  };
}
```

### Chinese-Friendly Time Formatting
```typescript
function formatChineseTime(): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date());
  // Output: "2026年2月20日 星期五 下午3:00"
}
```

### Snippet Registration (using existing PromptService API)
```typescript
// In core index.ts apply(), after PromptService is created
// Snippets resolve from the { view } scope that loop.ts passes to render()
const prompt = ctx["yesimbot.prompt"] as PromptService;

prompt.registerSnippet("bot.name", (scope) => {
  const view = scope.view as HorizonView;
  return view?.self?.name ?? "";
});

prompt.registerSnippet("bot.id", (scope) => {
  const view = scope.view as HorizonView;
  return view?.self?.id ?? "";
});

prompt.registerSnippet("date.now", () => formatChineseTime());

prompt.registerSnippet("sender.name", (scope) => {
  const view = scope.view as HorizonView;
  const p = view?.percept as UserMessagePercept;
  return p?.payload?.sender?.name ?? "";
});

prompt.registerSnippet("sender.id", (scope) => {
  const view = scope.view as HorizonView;
  const p = view?.percept as UserMessagePercept;
  return p?.payload?.sender?.id ?? "";
});

prompt.registerSnippet("channel.name", (scope) => {
  const view = scope.view as HorizonView;
  return view?.environment?.name ?? "";
});

prompt.registerSnippet("channel.platform", (scope) => {
  const view = scope.view as HorizonView;
  return (view?.environment?.metadata?.platform as string) ?? "";
});
```

### Default Persona Fallback Content
```typescript
const DEFAULT_PERSONA = `## 关于我

我是一个友好的聊天伙伴。我会根据对话内容自然地回应，保持真诚和适度的好奇心。

## 交流风格

- 自然对话，不过度正式也不过度随意
- 根据对方的语气和话题调整回应方式
- 有自己的想法，但尊重不同观点`;
```

## State of the Art

| Old Approach (v3/dev) | Current Approach (v4) | Why Changed | Impact |
|---|---|---|---|
| gray-matter for frontmatter | js-yaml + regex split | Avoid new dependency; simpler format constraints | Fewer transitive deps |
| Per-file fs.watch | Directory-level fs.watch | Flat directory, full reload is simpler | Less watcher management |
| MemoryBlock class with getters | Plain interface + functions | No per-block state needed (no self-modification) | Less code |
| Priority/tags in frontmatter | label/title/description only | User decision — simpler model for v4 | Simpler sorting (filename alpha) |
| Copy default files to user dir | Inline default constant | Avoids filesystem side effects on first run | Cleaner fallback |

## Open Questions

1. **Snippet registration timing**
   - What we know: Snippets need to be registered after PromptService is created. Currently `apply()` creates services via `ctx.plugin()` which is synchronous for immediate services.
   - What's unclear: Whether snippets should be registered in core `apply()` or in MemoryService's `start()`.
   - Recommendation: Register snippets in MemoryService.start() since it already depends on PromptService. This keeps snippet registration co-located with memory injection registration. Alternatively, register in core apply() after PromptService plugin call since PromptService uses `immediate=true`.

2. **System template update for injections**
   - What we know: The current DEFAULT_SYSTEM_TEMPLATE does not include `{{{injections}}}` placeholder. The injection mechanism builds `scope.injections` but the template never renders it.
   - What's unclear: Whether the template should use `{{{injections}}}` (triple-mustache for unescaped) or a Mustache section.
   - Recommendation: Add `{{#injections}}\n{{{injections}}}\n{{/injections}}` to DEFAULT_SYSTEM_TEMPLATE. Triple-mustache prevents double-escaping of XML in memory blocks. (Note: Mustache.escape is already set to identity, so double-mustache would also work, but triple is more explicit about intent.)

3. **Config interface extension pattern**
   - What we know: Core Config extends multiple service configs (HorizonServiceConfig, PromptServiceConfig, etc.).
   - What's unclear: Whether MemoryConfig should be extended into core Config or kept separate.
   - Recommendation: Extend into core Config (same pattern as HorizonServiceConfig). Add `coreMemoryPath` and `memoryCharLimit` fields to root Schema.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `plugins/core/src/services/prompt/service.ts` — PromptService API (registerSnippet, inject, render flow)
- Existing codebase: `plugins/core/src/services/agent/loop.ts` — How render() is called with `{ view }` scope
- Existing codebase: `plugins/core/src/services/horizon/types.ts` — HorizonView, UserMessagePercept structures
- Reference: `references/YesImBot-dev/packages/core/src/services/memory/` — MemoryService, MemoryBlock, config patterns
- Reference: `references/YesImBot-v3/packages/core/resources/memory_block/persona.md` — v3 persona with template variables

### Secondary (MEDIUM confidence)
- Node.js v24 `fs.watch` API — verified available and functional in current environment
- `js-yaml` — verified loadable as transitive dependency in current node_modules
- `Intl.DateTimeFormat` with zh-CN — standard ECMAScript API, verified output format

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already available, no new dependencies
- Architecture: HIGH — existing PromptService APIs match requirements exactly, v3/dev reference validates pattern
- Pitfalls: HIGH — v3/dev reference encountered and solved these same issues

**Research date:** 2026-02-20
**Valid until:** 2026-03-20 (stable domain, no fast-moving dependencies)
