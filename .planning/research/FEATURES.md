# Feature Research

**Domain:** Context-aware AI agent prompt management, perception, and behavior adaptation
**Researched:** 2026-02-21
**Confidence:** HIGH (codebase analysis, reference implementations v3/dev, design documents)

## Feature Landscape

### Table Stakes (Users Expect These)

Features the v2.0 redesign must have. Missing these means the redesign doesn't justify itself over v1.0.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Multi-injection-point prompt architecture | v1 has single `{{injections}}` placeholder — plugins, memory, tools all compete for one slot | MEDIUM | Named slots: `identity`, `environment`, `style`, `memories`, `tools`, `instructions`, `output` |
| Modular prompt partials (composition) | Monolithic `system.mustache` cannot adapt to different contexts | LOW-MEDIUM | Mustache `{{>partial}}` already works. Need: partial registry, per-render selection |
| Injection lifecycle management | v1 `inject()` pushes to array with no dispose path; Koishi hot-reload requires cleanup | MEDIUM | `ctx.on('dispose', ...)` pattern. Each injection tied to caller context for auto-cleanup |
| Context-aware snippet rendering | v1 renders ALL registered snippets if template references them; v2 must scope to current context | LOW | Extend existing `getRequiredVariables()` to respect injection-point scoping |
| Structured HorizonView rendering | v1 `formatHorizonText()` renders flat text; LLMs understand structured context (XML tags) better | LOW-MEDIUM | Restructure into tagged sections: `<environment>`, `<members>`, `<history>` |
| Backward-compatible inject() API | MemoryService and PluginService depend on current `inject(name, priority, renderFn)` signature | LOW | Map existing calls to a "legacy" section in multi-section system |
| Default prompt template out-of-box | Users expect working system prompt without manual config; v1 has this | LOW | Ship section-based template with sensible defaults for each partial |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Trait perception layer | Multi-dimensional parallel analysis replaces discrete ChatMode switching | HIGH | Rule-based detectors, no LLM cost. Output: TraitSignal vector |
| Skill response layer (file-based) | Non-developers create/modify behaviors via YAML + Mustache files | MEDIUM-HIGH | Folder-based: manifest.yaml + prompt.mustache per skill |
| Layered effect merging | Prompt=additive, Style=priority-override, Tools=additive | MEDIUM | Willingness stays outside skill control |
| Trait-to-Skill signal protocol | Clean decoupling between perception and response layers | MEDIUM | Enables third-party skills |
| Skill-based tool filtering | Context-aware tool activation instead of always-on | LOW-MEDIUM | enableTools/disableTools in skill effects |

### Anti-Features (Do NOT Build)

| Feature | Why Avoid | Alternative |
|---------|-----------|-------------|
| LLM-based trait analysis | 200-500ms latency + cost per message | Rule-based heuristic detectors |
| Dynamic template selection per-message | ChatMode reinvented, personality discontinuity | Trait+Skill layering on same base template |
| Skill inheritance/composition | Dependency chains, ordering problems | Flat definitions, shared partials |
| Per-skill token budgets | Combinatorial explosion | Per-section budgets |
| Skills modifying willingness | Breaks separation of concerns | Skills only affect prompt/style/tools |

## Feature Dependencies

PromptService v2 is the foundation -- SkillRegistry requires it to target sections. TraitAnalyzer reads from existing HorizonView (no changes needed) and is required by SkillRegistry for activation signals. MemoryService inject() must survive the PromptService redesign via backward-compat mapping.

## MVP Recommendation

Prioritize: (1) PromptService multi-section architecture, (2) TraitAnalyzer with scene+heat detectors, (3) SkillRegistry with file loader and 1 example skill, (4) ThinkActLoop integration wiring.

Defer: Token-aware context budgeting, relation trait detector, HorizonView structured rendering optimization.

## Sources

- Direct codebase analysis of PromptService, HorizonService, ThinkActLoop, PluginService
- YesImBot-dev ChatMode pattern (replaced by Trait+Skill)
- Design docs: books/04 sections 4.9, 4.12, 4.13
- PROJECT.md v2.0 requirements and key decisions
