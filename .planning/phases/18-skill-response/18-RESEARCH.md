# Phase 18: Skill Response - Research

**Researched:** 2026-02-22
**Domain:** File-based skill loading, trait-signal condition matching, layered prompt/style/tool effect merging
**Confidence:** HIGH

## Summary

Phase 18 builds the Skill Response layer — the counterpart to Phase 17's Trait Perception. Skills are behavioral modules that activate based on TraitSignal conditions and modify the agent's prompt, style, and tool availability. The system has two loading sources: file-based skill folders (SKILL.md with YAML frontmatter) and plugin-registered skill definitions via `ctx.skillRegistry.register()`. Both coexist in a unified SkillRegistry service.

The codebase already has all necessary infrastructure: PromptService with named injection points and ordered entries (Phase 16), TraitAnalyzer producing TraitSignal arrays (Phase 17), PluginService managing tool definitions, and MemoryService demonstrating the exact file-loading + YAML-frontmatter + hot-reload pattern to reuse. No new dependencies are needed — `js-yaml` and `mustache` are already in core's package.json, and `node:fs` watch is already used by MemoryService.

**Primary recommendation:** Build SkillRegistry as a Koishi Service that loads skill definitions from multiple directory sources, accepts plugin registrations, evaluates activation conditions against TraitSignal arrays, and produces a SkillEffect that the ThinkActLoop applies to prompt injections, style overrides, and tool filtering before each response.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Skill discovery accepts multiple sources: core built-in resources directory (shipped with package) + user custom directory (runtime managed), no need to release built-in resources to user directory
- SKILL.md format: YAML frontmatter declares metadata and activation conditions, Markdown body serves as prompt content
- scripts/ directory holds precompiled JS files (code activators, custom effect logic)
- references/ directory holds few-shot example conversations (future RAG support can extend reference docs)
- Declarative conditions use AND/OR/NOT logical combination expressions (not simple key-value matching)
- Code activators: scripts/ exports `activate(signals) => boolean` function interface
- Global confidence threshold: TraitSignals below threshold are treated as non-existent, don't participate in condition matching
- Prompt layer: additive stacking per injection point (reuses existing PromptService mechanism)
- Style layer: override by condition specificity (more specific conditions = higher priority, like CSS specificity)
- Tools layer: supports include/exclude declarations, exclude takes priority
- Manual reload trigger (no automatic file watching)
- In-flight requests unaffected, new requests use new definitions
- Malformed skill files are skipped with logging, don't affect other skills
- Tagged injection: LLM can perceive skill source (e.g. `<skill name="...">content</skill>`)
- Few-shot examples truncated by token budget (control total when multiple skills activate)
- Style effects expressed through style injection point
- Skill self-declares persistence strategy, three types: per-turn, sticky, trait-bound
- Sticky type has global default timeout rounds, skill can override in frontmatter
- Plugin registration is primary, file-based is supplementary — both coexist in unified SkillRegistry
- API: `ctx.skillRegistry.register()` registers skill definition objects
- Registered skills have full ctx service access (database, HTTP, other plugins)
- Follow Koishi ctx lifecycle for automatic cleanup (skill auto-removed on plugin unload)

### Claude's Discretion
- YAML condition expression concrete syntax design
- Confidence threshold default value
- Condition specificity calculation algorithm
- Sticky default timeout rounds
- Few-shot truncation strategy implementation
- File-based skill to registered skill internal conversion mechanism

### Deferred Ideas (OUT OF SCOPE)
- RAG-style reference document querying (references/ directory extension) — wait for RAG support
- Per-skill token budget — requirements doc explicitly out of scope, use per-injection-point budget instead
- User interface skill toggle — requirements doc explicitly out of scope, auto-activation only
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SKILL-01 | Skill folder spec (SKILL.md + scripts/ + references/), YAML frontmatter declares metadata and activation conditions | MemoryService parseFrontmatter pattern reusable; js-yaml already available; folder structure well-defined in CONTEXT.md |
| SKILL-02 | SkillRegistry loads and manages skill folders, supports hot-reload | MemoryService loadBlocks + manual reload pattern; node:fs readdir/readFile; Koishi Service subclass pattern |
| SKILL-03 | Skills activate based on TraitSignal condition matching, supports declarative conditions and code activators | TraitSignal interface defined in shared/types.ts; AND/OR/NOT expression tree evaluator; scripts/ require() for code activators |
| SKILL-04 | Layered effect merging — Prompt additive, Style specificity override, Tools include/exclude | PromptService.inject() for prompt; style injection point exists; PluginService.getTools() filterable by name |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| js-yaml | ^4.1.1 | Parse YAML frontmatter in SKILL.md | Already in core dependencies, used by MemoryService |
| mustache | ^4.2.0 | Render skill prompt content with scope variables | Already in core dependencies, used throughout |
| node:fs | built-in | readdir, readFile, watch for skill directories | Already used by MemoryService for same pattern |
| koishi Service | 4.18.x | SkillRegistry as Service subclass | Project convention per CLAUDE.md |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:path | built-in | resolve/join for skill directory paths | Path construction |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| js-yaml frontmatter parsing | gray-matter | gray-matter adds dependency; manual regex + js-yaml already proven in MemoryService |
| node:fs.watch for reload | chokidar | Decision is manual reload only, so no file watcher needed at all |
| Custom condition DSL | JSON Logic / json-rules-engine | Overkill; simple AND/OR/NOT tree over dimension/value pairs is sufficient |

**Installation:** No new packages needed.

## Architecture Patterns

### Recommended Project Structure
```
core/src/services/skill/
  types.ts          # SkillDefinition, SkillEffect, ConditionNode, LifecycleStrategy
  service.ts        # SkillRegistry extends Service
  condition.ts      # evaluateCondition(node, signals) => boolean + specificity calc
  loader.ts         # loadSkillFolder(dir) => SkillDefinition (file parsing)
  index.ts          # re-exports
core/resources/skills/
  private-chat/     # Built-in example skill
    SKILL.md
  image-gen/        # Built-in example skill
    SKILL.md
```

### Pattern 1: SkillRegistry as Koishi Service
**What:** SkillRegistry extends Service, registered in core index.ts alongside TraitAnalyzer and AgentCore. Provides `register()` for plugin-registered skills and `loadDirectory()` for file-based skills.
**When to use:** Always — this is the central skill management service.
**Example:**
```typescript
// Source: Project convention from CLAUDE.md + existing services
declare module "koishi" {
  interface Context {
    "yesimbot.skill": SkillRegistry;
  }
}

class SkillRegistry extends Service<SkillRegistryConfig> {
  static inject = ["yesimbot.prompt", "yesimbot.trait"];

  private skills = new Map<string, SkillDefinition>();

  constructor(ctx: Context, config: SkillRegistryConfig) {
    super(ctx, "yesimbot.skill", false);
  }

  register(def: SkillDefinition): () => void {
    this.skills.set(def.name, def);
    const dispose = () => { this.skills.delete(def.name); };
    // Follows Koishi lifecycle pattern
    return dispose;
  }
}
```

### Pattern 2: YAML Frontmatter Condition Expression
**What:** SKILL.md YAML frontmatter declares activation conditions as a nested AND/OR/NOT tree of dimension-value matchers.
**When to use:** For declarative (file-based) skill activation.
**Example:**
```yaml
---
name: private-chat
description: Intimate conversation style for private chats
lifecycle: trait-bound
conditions:
  match:
    dimension: scene
    value: private-chat
effects:
  style:
    content: |
      Use a warm, intimate tone. Be more detailed in responses.
      Share personal thoughts freely.
  tools:
    include: []
    exclude: []
---
You are now in a private conversation. The user has chosen to talk with you one-on-one.
Adjust your communication style to be more personal and attentive.
```

### Pattern 3: Condition Evaluation with Specificity
**What:** Conditions are tree nodes (match/and/or/not). Specificity = count of leaf match nodes. More specific conditions override less specific ones for style merging.
**When to use:** Style layer conflict resolution.
**Example:**
```typescript
interface MatchNode { match: { dimension: string; value: string } }
interface AndNode { and: ConditionNode[] }
interface OrNode { or: ConditionNode[] }
interface NotNode { not: ConditionNode }
type ConditionNode = MatchNode | AndNode | OrNode | NotNode;

function evaluateCondition(node: ConditionNode, signals: TraitSignal[]): boolean {
  if ("match" in node) {
    return signals.some(s => s.dimension === node.match.dimension && s.value === node.match.value);
  }
  if ("and" in node) return node.and.every(c => evaluateCondition(c, signals));
  if ("or" in node) return node.or.some(c => evaluateCondition(c, signals));
  if ("not" in node) return !evaluateCondition(node.not, signals);
  return false;
}

function specificity(node: ConditionNode): number {
  if ("match" in node) return 1;
  if ("and" in node) return node.and.reduce((s, c) => s + specificity(c), 0);
  if ("or" in node) return Math.max(...node.or.map(specificity));
  if ("not" in node) return specificity(node.not);
  return 0;
}
```

### Pattern 4: SkillEffect Merging in ThinkActLoop
**What:** Before each agent loop run, SkillRegistry evaluates active skills and produces a merged SkillEffect. The loop applies prompt injections, style overrides, and tool filters.
**When to use:** Every agent loop invocation.
**Example:**
```typescript
// In ThinkActLoop.run(), after building view and before rendering system prompt:
const trait = ctx["yesimbot.trait"] as TraitAnalyzer;
const skillRegistry = ctx["yesimbot.skill"] as SkillRegistry;
const signals = await trait.analyze(percept.scope, view);
const effect = skillRegistry.resolve(signals, percept.scope);

// effect.promptInjections -> inject into prompt service
// effect.styleOverride -> inject into style point
// effect.toolFilter -> { include: string[], exclude: string[] }
```

### Pattern 5: Lifecycle Management (per-turn / sticky / trait-bound)
**What:** Skills declare their persistence strategy. Per-turn re-evaluates every turn. Sticky persists for N rounds after activation. Trait-bound follows the trait signal's presence.
**When to use:** Determining which skills are active for a given turn.
**Example:**
```typescript
// Per-channel skill state tracking
interface ActiveSkillState {
  name: string;
  lifecycle: "per-turn" | "sticky" | "trait-bound";
  activatedAt: number;      // timestamp
  roundsSinceActive: number; // for sticky timeout
  stickyTimeout: number;     // rounds before deactivation
}
```

### Anti-Patterns to Avoid
- **Skill modifying willingness directly:** Out of scope per requirements. Skills only affect prompt/style/tools.
- **Skill inheritance/composition:** Out of scope. Use flat definitions + shared partials.
- **Automatic file watching:** Decision is manual reload only. Don't use fs.watch or chokidar.
- **Per-skill token budget:** Out of scope. Use per-injection-point budget via PromptService.
- **Creating new logger per call:** Per CLAUDE.md, create logger once in constructor.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML parsing | Custom parser | js-yaml `load()` | Already in deps, battle-tested |
| Frontmatter extraction | Complex parser | Regex + js-yaml (MemoryService pattern) | Proven pattern in codebase |
| Template rendering | String concatenation | Mustache.render() | Already in deps, handles partials |
| Injection ordering | Custom sort | PromptService.inject() with before/after | Kahn's algorithm already implemented |
| Service lifecycle | Manual ctx[name] = ... | Service subclass | CLAUDE.md mandates this pattern |

**Key insight:** The codebase already has every building block. MemoryService demonstrates file loading + frontmatter parsing + hot-reload. PromptService demonstrates injection + ordering + lifecycle cleanup. The Skill system is primarily an orchestration layer connecting TraitSignals to PromptService effects.

## Common Pitfalls

### Pitfall 1: Circular Import Between Skill and Agent
**What goes wrong:** SkillRegistry needs TraitSignal (from shared/types), and AgentCore needs SkillRegistry. If SkillRegistry imports from agent, circular dependency occurs.
**Why it happens:** Tight coupling between skill evaluation and agent loop.
**How to avoid:** SkillRegistry only depends on shared/types.ts for TraitSignal and prompt service for injection. Agent loop calls skillRegistry.resolve() — dependency flows one way.
**Warning signs:** TypeScript import cycle warnings.

### Pitfall 2: Stale Skill Injections Not Cleaned Up
**What goes wrong:** Prompt injections from a previous skill activation persist into the next turn.
**Why it happens:** PromptService.inject() returns a dispose function that must be called.
**How to avoid:** Always dispose skill injections at the end of each loop run (in finally block), same pattern as `disposeInjection()` for tool schema in current loop.ts.
**Warning signs:** Prompt content growing unexpectedly across turns.

### Pitfall 3: Style Specificity Ties
**What goes wrong:** Two skills with equal specificity both try to override style, producing unpredictable results.
**Why it happens:** No tiebreaker defined.
**How to avoid:** Use registration order as tiebreaker (later registration wins). Document this behavior.
**Warning signs:** Style flickering between turns.

### Pitfall 4: Code Activator require() Caching
**What goes wrong:** After manual reload, `require()` returns cached module from before reload.
**Why it happens:** Node.js module cache.
**How to avoid:** Delete `require.cache[resolvedPath]` before re-requiring on reload.
**Warning signs:** Code activator changes not taking effect after reload.

### Pitfall 5: Sticky Lifecycle State Leak
**What goes wrong:** Sticky skills never deactivate because round counter isn't incremented.
**Why it happens:** Round counting must happen per-channel, and channels may go idle.
**How to avoid:** Increment roundsSinceActive on every resolve() call for that channel. Reset to 0 when skill's conditions match again.
**Warning signs:** Skills staying active indefinitely.

### Pitfall 6: Tool Exclude Conflicts
**What goes wrong:** One skill includes a tool, another excludes it. Unclear which wins.
**Why it happens:** No defined precedence.
**How to avoid:** Decision already made: exclude takes priority. Implement as: final tools = (base + all includes) - all excludes.
**Warning signs:** Tools appearing when they shouldn't.

## Code Examples

### File-Based Skill Loading (reusing MemoryService pattern)
```typescript
// Source: Adapted from core/src/services/memory/service.ts
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";

async function loadSkillsFromDir(dir: string): Promise<SkillDefinition[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const skills: SkillDefinition[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = join(dir, entry.name);
    const skillMdPath = join(skillDir, "SKILL.md");

    try {
      const raw = await readFile(skillMdPath, "utf-8");
      const { meta, content } = parseFrontmatter(raw);
      skills.push({
        name: meta.name as string ?? entry.name,
        description: meta.description as string ?? "",
        conditions: meta.conditions as ConditionNode,
        lifecycle: meta.lifecycle as LifecycleStrategy ?? "per-turn",
        stickyTimeout: meta.stickyTimeout as number | undefined,
        effects: {
          prompt: content,  // Markdown body = prompt content
          style: meta.effects?.style as StyleEffect | undefined,
          tools: meta.effects?.tools as ToolFilter | undefined,
        },
        source: "file",
      });
    } catch (e) {
      // Skip malformed, log warning
    }
  }
  return skills;
}

function parseFrontmatter(raw: string): { meta: Record<string, unknown>; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw.trim() };
  return { meta: (yamlLoad(match[1]) as Record<string, unknown>) ?? {}, content: match[2].trim() };
}
```

### Plugin-Registered Skill (Koishi lifecycle)
```typescript
// Source: Project convention from CLAUDE.md
// In an external Koishi plugin:
export const inject = ["yesimbot.skill"];

export function apply(ctx: Context) {
  const dispose = ctx["yesimbot.skill"].register({
    name: "image-gen",
    description: "Image generation skill",
    conditions: { match: { dimension: "scene", value: "group-chat" } },
    lifecycle: "sticky",
    stickyTimeout: 5,
    effects: {
      prompt: "You can generate images using the generate_image tool.",
      tools: { include: ["generate_image"], exclude: [] },
    },
    // Plugin-registered skills can have programmatic activators
    activate: (signals) => signals.some(s => s.dimension === "intent" && s.value === "image-request"),
    source: "plugin",
  });

  ctx.on("dispose", dispose);
}
```

### Applying SkillEffect in Loop
```typescript
// Source: Adapted from core/src/services/agent/loop.ts
// Inside ThinkActLoop.run(), after view is built:
const disposers: Array<() => void> = [];
try {
  // ... existing code ...

  // Skill activation
  const signals = await trait.analyze(percept.scope, view);
  const effect = skillRegistry.resolve(signals, percept.scope);

  // Apply prompt injections
  for (const injection of effect.promptInjections) {
    disposers.push(prompt.inject(ctx, injection.point, {
      name: `__skill_${injection.skillName}`,
      renderFn: () => `<skill name="${injection.skillName}">${injection.content}</skill>`,
    }));
  }

  // Apply style override (highest specificity wins)
  if (effect.styleOverride) {
    disposers.push(prompt.inject(ctx, "style", {
      name: "__skill_style",
      after: "__default_style",
      renderFn: () => effect.styleOverride!.content,
    }));
  }

  // ... render system prompt, run loop ...
} finally {
  for (const d of disposers) d();
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ChatMode discrete switching | Trait + Skill continuous multi-dimensional | v2.0 design (2026-02) | Skills replace ChatMode entirely |
| Manual prompt string building | PromptService injection points | Phase 16 (2026-02) | Skills plug into existing injection infrastructure |
| No context awareness | TraitAnalyzer parallel detection | Phase 17 (2026-02) | Skills consume TraitSignal as activation input |

**Deprecated/outdated:**
- ChatMode (YesImBot-dev): Replaced by Trait + Skill. ChatModeManager.resolve() picked one mode; Skills allow multiple simultaneous activations with layered merging.

## Open Questions

1. **Confidence threshold default value**
   - What we know: TraitSignals below threshold are filtered out before condition matching
   - What's unclear: What's a good default? Signals currently range 0.0-1.0
   - Recommendation: Default 0.3 — filters noise while keeping medium-confidence signals. Configurable in SkillRegistryConfig.

2. **Sticky default timeout rounds**
   - What we know: Sticky skills persist for N rounds without re-activation
   - What's unclear: How many rounds is reasonable?
   - Recommendation: Default 3 rounds. Image generation use case: user asks to generate, then refines 1-2 times, then moves on.

3. **Few-shot truncation strategy**
   - What we know: references/ holds example conversations, multiple skills may activate
   - What's unclear: How to divide budget across skills
   - Recommendation: Equal share of remaining budget after prompt content. E.g., 2000 chars total few-shot budget / N active skills with references. Defer complex implementation — references/ is future RAG territory per deferred decisions.

4. **Where does resolve() get called?**
   - What we know: ThinkActLoop.run() is the integration point
   - What's unclear: Should AgentCore.buildPercept or loop.run() call trait.analyze + skill.resolve?
   - Recommendation: loop.run() — it already has access to view and manages injection lifecycle via try/finally. Keep AgentCore thin.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `core/src/services/prompt/service.ts` — PromptService injection mechanism
- Codebase analysis: `core/src/services/trait/service.ts` — TraitAnalyzer.analyze() producing TraitSignal[]
- Codebase analysis: `core/src/services/memory/service.ts` — File loading + YAML frontmatter + hot-reload pattern
- Codebase analysis: `core/src/services/agent/loop.ts` — ThinkActLoop injection lifecycle (try/finally dispose)
- Codebase analysis: `core/src/services/plugin/service.ts` — PluginService.getTools() for tool filtering
- Codebase analysis: `core/src/services/shared/types.ts` — TraitSignal interface definition

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions — User-locked design choices for activation, merging, lifecycle
- YesImBot-dev ChatModeManager — Prior art for mode matching (replaced by Skill system)

### Tertiary (LOW confidence)
- None — all findings verified against codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in use, no new dependencies
- Architecture: HIGH — patterns directly derived from existing codebase (MemoryService, PromptService, TraitAnalyzer)
- Pitfalls: HIGH — identified from actual code patterns (injection dispose, require cache, specificity ties)

**Research date:** 2026-02-22
**Valid until:** 2026-03-22 (stable — internal architecture, no external API changes)
