# Architecture Patterns: Trait + Skill Integration

**Domain:** Context-Aware AI Chat Agent (Koishi Plugin) — v2.0 Milestone
**Researched:** 2026-02-21
**Confidence:** HIGH (based on direct codebase analysis)

## Current Architecture (v1.0 Baseline)

### Data Flow

```
Session (Koishi)
  → EventListener (horizon/listener.ts)
    → Percept (UserMessagePercept)
      → AgentCore.handlePercept()
        → WillingnessEngine.processMessage() — gate
          → ThinkActLoop.run()
            → HorizonService.buildView(percept) → HorizonView
            → PromptService.render("system", { view }) → system prompt
            → HorizonService.formatHorizonText(view) → user message
            → PluginService.getTools() → ToolSet (all tools, always)
            → ModelService.call/streamCall()
              → send_message tool or fallback text
```

### Key Observations

1. **PromptService is flat.** Single `render()` entry point. One template ("system"). Injections are a flat priority-sorted list appended to `{{injections}}` placeholder. No concept of injection points, sections, or context-awareness.

2. **HorizonView is monolithic.** `buildView()` always returns the same shape. `formatHorizonText()` always renders the same template. No hooks for enriching the view with trait/skill analysis.

3. **Tools are always-on.** `buildAiSdkTools()` grabs every registered tool from PluginService. No conditional activation based on context.

4. **System prompt is static.** `system.mustache` has hardcoded style directives. No mechanism for traits to modify tone, or skills to inject domain-specific instructions.

5. **Willingness is context-blind.** The engine uses numerical signals (keyword regex, fatigue, decay) but has no semantic understanding of conversation context.

## Recommended Architecture: Trait + Skill Layers

### Design Philosophy

**Trait** = perception ("what is happening in this conversation?")
**Skill** = response adaptation ("how should I behave given what's happening?")

This replaces ChatMode's discrete `match() → buildContext()` with a continuous, multi-dimensional system where multiple traits can fire simultaneously and multiple skills can layer their effects.

### Component Boundaries

| Component | Responsibility | New/Modified | Communicates With |
|-----------|---------------|--------------|-------------------|
| **TraitAnalyzer** | Runs trait detectors in parallel, produces TraitSignals | NEW | HorizonView (reads), PromptService (feeds signals) |
| **SkillRegistry** | Stores skill definitions, resolves active skills from signals | NEW | TraitAnalyzer (reads signals), PromptService (injects), PluginService (conditional tools) |
| **PromptService v2** | Multi-section rendering with named injection points | MODIFIED | TraitAnalyzer, SkillRegistry, MemoryService, ThinkActLoop |
| **ThinkActLoop** | Orchestrates trait→skill→prompt→model pipeline | MODIFIED | All services |
| **HorizonService** | Unchanged core, but buildView gains optional enrichment hook | MINOR MOD | TraitAnalyzer (provides view) |

### System Diagram

```
                         ┌─────────────────┐
                         │  HorizonService  │
                         │   buildView()    │
                         └────────┬─────────┘
                                  │ HorizonView
                                  ▼
                         ┌─────────────────┐
                         │  TraitAnalyzer   │
                         │  (parallel)      │
                         │                  │
                         │  ┌─────────────┐ │
                         │  │ SceneTrait   │ │  ← "private_chat" | "group_active" | ...
                         │  │ TopicTrait   │ │  ← "technical" | "casual" | "emotional"
                         │  │ HeatTrait    │ │  ← "heated" | "cooling" | "cold"
                         │  │ RelationTrait│ │  ← "familiar" | "stranger" | ...
                         │  └─────────────┘ │
                         └────────┬─────────┘
                                  │ TraitSignals
                                  ▼
                         ┌─────────────────┐
                         │  SkillRegistry   │
                         │  resolve()       │
                         │                  │
                         │  Matches skills  │
                         │  by conditions   │
                         └────────┬─────────┘
                                  │ ActiveSkill[]
                                  ▼
                    ┌─────────────────────────────┐
                    │     PromptService v2         │
                    │                              │
                    │  Sections:                   │
                    │   [identity]                 │
                    │   [environment]              │
                    │   [style] ← skill overlays   │
                    │   [memories]                 │
                    │   [tools] ← skill additions  │
                    │   [instructions] ← skill     │
                    │   [output]                   │
                    └──────────────┬───────────────┘
                                   │ system prompt
                                   ▼
                         ┌─────────────────┐
                         │  ThinkActLoop   │
                         │  (+ tool filter)│
                         └─────────────────┘
```

## New Components

### 1. TraitAnalyzer

A lightweight analysis layer that runs multiple "trait detectors" in parallel against the current HorizonView. Each detector produces a signal with a dimension name and value.

```typescript
interface TraitSignal {
  dimension: string;    // e.g. "scene", "topic", "heat", "relation"
  value: string;        // e.g. "group_active", "technical", "heated"
  confidence: number;   // 0-1
  metadata?: Record<string, unknown>;
}

interface TraitDetector {
  dimension: string;
  detect(view: HorizonView, percept: UserMessagePercept): TraitSignal | null;
}

class TraitAnalyzer {
  private detectors: TraitDetector[] = [];

  register(detector: TraitDetector): void;

  analyze(view: HorizonView, percept: UserMessagePercept): TraitSignal[] {
    // Run all detectors in parallel, filter nulls
    // No LLM calls — pure heuristic/rule-based for cost control
  }
}
```

**Key design decisions:**
- Detectors are rule-based, not LLM-based (cost control per 4.9 in books)
- Runs in parallel (Promise.all) — each detector is independent
- Returns signals, not decisions — SkillRegistry decides what to do
- Registered via `traitAnalyzer.register()`, extensible by plugins

**Built-in detectors:**
- **SceneDetector**: private vs group, active vs quiet (from HorizonView.environment + entity count)
- **HeatDetector**: message frequency, participant count in recent history
- **TopicDetector**: keyword matching against history content (reuses willingness keyword infra)
- **RelationDetector**: entity attributes, interaction frequency with trigger sender

### 2. SkillRegistry

Skills are folder-based definitions that declare: conditions for activation, and effects to apply when active. Multiple skills can be active simultaneously with layered effects.

```typescript
interface SkillCondition {
  dimension: string;     // trait dimension to match
  values: string[];      // acceptable values (OR)
  minConfidence?: number;
}

interface SkillEffect {
  // Prompt layer — additive, all active skills contribute
  promptSections?: Record<string, string>;  // section name → content to append
  // Style layer — priority-based, highest priority wins per property
  styleOverrides?: Record<string, string>;
  stylePriority?: number;
  // Tool layer — additive
  enableTools?: string[];   // tool names to activate
  disableTools?: string[];  // tool names to suppress
}

interface SkillDefinition {
  name: string;
  description: string;
  conditions: SkillCondition[];  // ALL must match (AND)
  conditionMode?: "all" | "any"; // default "all"
  effects: SkillEffect;
  priority: number;  // for style conflict resolution
}

class SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map();

  register(skill: SkillDefinition): void;

  resolve(signals: TraitSignal[]): ActiveSkill[] {
    // For each skill, check if all conditions match against signals
    // Return matched skills sorted by priority
  }
}
```

**Effect layering rules (from PROJECT.md):**
- **Prompt/Tools layer**: additive — all active skills contribute their sections and tools
- **Style layer**: priority-based — highest priority skill's style wins per property
- **Willingness**: skills do NOT directly modify willingness (separation of concerns)

### 3. PromptService v2 (Modified)

The current PromptService needs a multi-section architecture replacing the flat injection list.

```typescript
// New concept: named sections with ordered contributions
interface PromptSection {
  name: string;           // "identity" | "style" | "memories" | "tools" | "instructions" | ...
  priority: number;       // render order
  contributions: SectionContribution[];
}

interface SectionContribution {
  source: string;         // "core" | "skill:technical-helper" | "memory" | ...
  priority: number;       // within section
  content: string | Snippet;
}
```

**What changes from v1:**
- `injections` array → `sections` map with named injection points
- `render()` builds scope, then renders each section in order, composing the final prompt
- Skills contribute to specific sections rather than a flat list
- Backward compatible: existing `inject()` calls map to a "legacy" section

### 4. ThinkActLoop Modifications

The loop gains trait/skill awareness in its pipeline:

```
// Current (v1):
buildView → render("system") → formatHorizonText → buildAiSdkTools(ALL) → model.call

// New (v2):
buildView → traitAnalyzer.analyze(view) → skillRegistry.resolve(signals)
  → promptService.render("system", { view, traits, skills })
  → formatHorizonText(view)
  → buildAiSdkTools(pluginService, activeSkills)  // filtered tools
  → model.call
```

Changes to `loop.ts`:
- After `buildView()`, call `traitAnalyzer.analyze(view, percept)`
- Pass signals to `skillRegistry.resolve()`
- Pass active skills to prompt render scope
- Filter tools based on skill `enableTools`/`disableTools`

## Patterns to Follow

### Pattern 1: Signal-Condition-Effect Pipeline

**What:** Separate perception (signals) from decision (conditions) from execution (effects).
**When:** Any context-aware behavior adaptation.
**Why:** Each layer is independently testable and extensible. Adding a new trait detector doesn't require changing skills. Adding a new skill doesn't require changing detectors.

### Pattern 2: Additive Composition Over Mode Switching

**What:** Multiple skills layer their effects simultaneously instead of one mode winning.
**When:** The agent needs to be "technical AND empathetic" or "casual AND helpful" at the same time.
**Why:** ChatMode's `match() → first wins` couldn't express multi-dimensional behavior. Real conversations have multiple simultaneous qualities.

### Pattern 3: File-Based Skill Definitions

**What:** Skills defined as files (YAML/MD with frontmatter) in a skills directory, loaded at startup, hot-reloadable.
**When:** Users want to customize agent behavior without code changes.
**Why:** Same pattern as MemoryService's core memory blocks — proven in v1, users understand it.

```yaml
---
name: technical-helper
description: Activates when technical topics are detected
conditions:
  - dimension: topic
    values: [technical, programming, debugging]
effects:
  promptSections:
    instructions: |
      When discussing technical topics:
      - Provide accurate, specific answers
      - Use code examples when helpful
      - Cite sources if known
  enableTools: [code_executor, web_search]
  styleOverrides:
    verbosity: detailed
  stylePriority: 60
---
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: LLM-Based Trait Detection

**What:** Using an LLM call to analyze conversation traits before generating a response.
**Why bad:** Doubles latency and cost. The author explicitly flagged this concern in books/04 section 4.12 — "双阶段响应与延迟权衡". Group chats are fast-paced; adding a pre-analysis LLM call makes the bot "always a beat behind."
**Instead:** Use rule-based heuristics for trait detection. Reserve LLM for the actual response generation.

### Anti-Pattern 2: Skills Modifying Willingness Directly

**What:** Letting skills adjust willingness scores or bypass the willingness gate.
**Why bad:** Breaks separation of concerns. Willingness is a pre-gate decision; skills are post-gate response shaping. Mixing them creates unpredictable behavior.
**Instead:** Skills only affect prompt content, style, and tool availability. Willingness remains independent.

### Anti-Pattern 3: Monolithic Skill Effects

**What:** A single skill that tries to control everything — prompt, tools, style, model selection.
**Why bad:** Skills should be composable. A "technical" skill and a "friendly" skill should layer cleanly.
**Instead:** Keep effects granular. Use the layering rules (additive for prompt/tools, priority for style).

### Anti-Pattern 4: Breaking the Existing Injection API

**What:** Removing `inject()` / `removeInjection()` from PromptService.
**Why bad:** MemoryService and future plugins depend on this API. Breaking it forces simultaneous changes across the codebase.
**Instead:** Map existing `inject()` calls to a "legacy" section in the new multi-section system. Deprecate gradually.

## Modified Components: Detailed Change Analysis

### PromptService (core/src/services/prompt/service.ts)

**Current state:** templates Map, snippets Map, injections array, single render().
**Required changes:**
- Add `sections` Map alongside existing `injections` (backward compat)
- Add `registerSection(name, priority)` method
- Add `contributeToSection(sectionName, source, priority, content)` method
- Modify `render()` to compose sections in order, with skill contributions merged
- Existing `inject()` maps to `contributeToSection("injections", name, priority, renderFn)`

### ThinkActLoop (core/src/services/agent/loop.ts)

**Current state:** Linear pipeline buildView → render → formatHorizon → buildTools → call.
**Required changes:**
- After `buildView()`, invoke TraitAnalyzer
- After trait analysis, invoke SkillRegistry
- Pass `{ view, traits, activeSkills }` to prompt render scope
- Pass active skills to `buildAiSdkTools()` for tool filtering
- ~15 lines of new code in `run()` method

### buildAiSdkTools (core/src/services/agent/tools.ts)

**Current state:** Iterates all tools from PluginService unconditionally.
**Required changes:**
- Accept optional `ActiveSkill[]` parameter
- If skills present, compute enabled/disabled tool sets
- Filter tools accordingly before building ToolSet
- ~10 lines of filtering logic

### system.mustache Template

**Current state:** Hardcoded `<identity>`, `<style>`, `<how_you_work>`, `{{injections}}`.
**Required changes:**
- Replace with section-based template: `{{#sections}}{{> section}}{{/sections}}`
- Or: named section placeholders `{{{section.identity}}}`, `{{{section.style}}}`, etc.
- Core content moves to default section contributions (not hardcoded in template)

### HorizonService (core/src/services/horizon/service.ts)

**Minimal changes.** TraitAnalyzer reads HorizonView as-is. No structural changes needed to buildView() or formatHorizonText(). The view already contains environment, entities, and history — sufficient for trait detection.

## Suggested Build Order

The build order is driven by dependency chains:

```
Phase 1: PromptService v2 (foundation — everything depends on this)
  ├── Multi-section architecture
  ├── Backward-compatible inject() mapping
  └── Section-based template rendering

Phase 2: TraitAnalyzer (perception layer)
  ├── TraitDetector interface + TraitAnalyzer service
  ├── Built-in detectors (scene, heat, topic, relation)
  └── Registration in core index.ts

Phase 3: SkillRegistry + Skill loading (response layer)
  ├── SkillDefinition types + SkillRegistry service
  ├── File-based skill loader (YAML frontmatter, like MemoryService)
  ├── Condition matching against TraitSignals
  └── Effect resolution (prompt sections, style, tools)

Phase 4: Pipeline integration (wiring)
  ├── ThinkActLoop: trait→skill→prompt pipeline
  ├── buildAiSdkTools: skill-based tool filtering
  ├── system.mustache: section-based template
  └── End-to-end testing
```

**Why this order:**
1. PromptService v2 first because both TraitAnalyzer output and SkillRegistry effects need somewhere to land. Without multi-section prompts, skills have no way to contribute targeted content.
2. TraitAnalyzer before SkillRegistry because skills depend on trait signals to activate. Building skills first would require mock signals.
3. SkillRegistry before pipeline integration because the loop changes are thin glue code — they just wire the pieces together.
4. Pipeline integration last because it touches the critical path (ThinkActLoop) and should only happen when all pieces are tested independently.

## Scalability Considerations

| Concern | Current (v1) | With Trait+Skill (v2) |
|---------|-------------|----------------------|
| Prompt size | Fixed template, ~500 tokens | Variable by active skills, needs token budget |
| Latency | Single render pass | Trait detection + skill resolution + render (~1-5ms overhead, no LLM) |
| Extensibility | Flat injections only | Sections + skills + detectors, all pluggable |
| Customization | Edit mustache template | Add skill files, no code changes |

**Token budget concern:** With multiple skills contributing prompt sections, total prompt size could grow unbounded. PromptService v2 should enforce a per-section character limit (similar to MemoryService's `memoryCharLimit`).

## Sources

- **Direct codebase analysis** — all findings verified against actual source files (HIGH confidence)
- **Design documents** — `books/04_系统架构重审.md` sections 4.9, 4.12, 4.13 for design constraints
- **Reference implementations** — `references/YesImBot-dev/` ChatMode pattern (replaced by Trait+Skill)
- **PROJECT.md** — v2.0 milestone requirements and key decisions

---
*Architecture research for: Athena v2.0 Trait + Skill Integration*
*Researched: 2026-02-21*
