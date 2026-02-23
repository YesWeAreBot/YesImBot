# Feature Landscape

**Domain:** OpenClaw-style fixed-role memory files, injection point simplification, prompt system polish
**Researched:** 2026-02-23
**Confidence:** HIGH (direct codebase analysis, OpenClaw reverse-engineering analysis, existing v2.0 implementation)

## Context: What Already Exists (v2.0)

- MemoryService: loads `.md` files from `data/yesimbot/memories/`, parses frontmatter with gray-matter, renders with Mustache, injects to `memory` point
- PromptService: 6 injection points (`identity/style/control_flow/basic_functions/memory/extra`), 5 wrapper partials (each wraps content in XML tags via Mustache), topological sort ordering, timeout protection
- Default injections: `default-identity.md`, `default-style.md`, `default-control-flow.md`, `default-basic-functions.md` loaded from `resources/templates/`
- Skill effects inject to `extra` point only (hardcoded)
- `system.mustache` wraps all 6 points inside `<base_instructions>` then appends `{{> extra }}`

## Table Stakes

Features required for v2.1 to be coherent. Missing any of these means the refactor is incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| SOUL.md fixed-role file | OpenClaw paradigm: soul = identity + personality, always loaded, not user-editable per-session | LOW | Replaces `default-identity.md` + `default-style.md`. Loaded by MemoryService at startup, injected to `soul` point |
| AGENTS.md fixed-role file | OpenClaw paradigm: agent instructions = behavioral rules, tool usage rules, always loaded | LOW | Replaces `default-control-flow.md` + `default-basic-functions.md`. Injected to `instructions` point |
| TOOLS.md fixed-role file | OpenClaw paradigm: tool usage guide, loaded when tools are active | LOW-MEDIUM | Optional file; injected to `instructions` point after AGENTS.md content, or omitted if absent |
| Injection point merge 6→4 | `identity+style→soul`, `control_flow+basic_functions→instructions` reduces abstraction layers with no loss of expressiveness | MEDIUM | New points: `soul/instructions/memory/extra`. Existing `inject()` callers targeting old points must be remapped |
| Eliminate wrapper partials | 5 `.mustache` partials each do `{{#has_X}}<X>{{{X_content}}}</X>{{/has_X}}` — this is boilerplate that belongs in code | LOW | Generate XML wrapper tags in `PromptService.render()` directly; delete `identity.mustache`, `style.mustache`, `control_flow.mustache`, `basic_functions.mustache`, `memory.mustache` |
| Fixed-role files are not user memory | SOUL.md/AGENTS.md/TOOLS.md live in `resources/templates/` (or a config-specified path), not in `data/yesimbot/memories/` | LOW | MemoryService loads user memory blocks; a new or extended loader handles fixed-role files separately |
| Hot-reload for fixed-role files | Consistent with existing memory block hot-reload behavior | LOW | Same `fs.watch` + debounce pattern already in MemoryService |

## Differentiators

Features that make the refactor meaningfully better, not just a rename.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| SOUL.md as Mustache template | Fixed-role files can reference `{{bot.name}}`, `{{date.now}}` etc. — same as user memory blocks | LOW | Already supported by existing Mustache render pipeline; just apply it to fixed-role files too |
| Skill effects target `soul` or `instructions` | Skills can now augment identity or behavioral rules, not just `extra` | LOW-MEDIUM | Remove hardcoded `extra`-only constraint in SkillRegistry effect merger |
| Graceful fallback when fixed-role files absent | If SOUL.md missing, fall back to hardcoded minimal identity string; never crash | LOW | Prevents blank system prompts on fresh installs |
| Vitest coverage for PromptService + MemoryService | Injection point merge is a breaking internal change; tests catch regressions | MEDIUM | Cover: inject/render/dispose lifecycle, point ordering, XML tag generation, fixed-role file loading |

## Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Dynamic SOUL.md per-channel | Defeats the "fixed role" purpose; reintroduces ChatMode complexity | One SOUL.md per bot instance; Skill effects handle per-context personality adjustments |
| Merging MemoryService and fixed-role file loading into one class | Different lifecycles: fixed-role = startup-loaded, user memory = per-session injected | Keep separate loaders; MemoryService handles user blocks, PromptService (or a thin FixedRoleLoader) handles SOUL/AGENTS/TOOLS |
| Keeping wrapper partials alongside code-generated tags | Dual paths for the same thing; confusion about which is authoritative | Delete partials, generate tags in code only |
| Adding new injection points beyond 4 | More points = more cognitive overhead for plugin authors | 4 points cover all cases: soul (who), instructions (how), memory (what I know), extra (context-specific) |
| USER.md (OpenClaw user profile file) | Out of scope for v2.1; requires per-user persistence not yet built | Defer to L1/L2/L3 memory milestone |

## Feature Dependencies

```
Fixed-role files (SOUL.md/AGENTS.md/TOOLS.md)
  → requires: injection point rename (soul/instructions)
  → requires: wrapper partial elimination (so new point names don't need new partials)

Injection point merge (6→4)
  → requires: update PromptService INJECTION_POINTS array
  → requires: remap existing inject() callers (MemoryService → memory, SkillRegistry → extra, default injections → soul/instructions)
  → requires: update system.mustache to use new point names

Wrapper partial elimination
  → requires: PromptService.render() generates <soul>...</soul> etc. in code
  → requires: delete 5 partial .mustache files (identity/style/control_flow/basic_functions/memory)
  → keep: horizon-view.mustache (complex, not a simple wrapper), memory-block.mustache (used inside memory rendering), extra.mustache (skills inject here, may have complex structure)

Vitest coverage
  → depends on: all above changes complete
  → tests: PromptService inject/render/dispose, MemoryService block loading + injection, fixed-role file loading
```

## MVP Recommendation

Prioritize in this order:

1. Injection point merge (6→4) — foundational, everything else depends on it
2. Wrapper partial elimination — simplifies the render path before adding new loaders
3. Fixed-role file loading (SOUL.md/AGENTS.md/TOOLS.md) — replaces hardcoded default .md files
4. Vitest coverage for changed services — validates the refactor

Defer:
- Skill effects targeting `soul`/`instructions` points — nice-to-have, not blocking release
- TOOLS.md conditional loading — can ship as always-loaded empty file initially

## Sources

- Direct codebase analysis: `core/src/services/prompt/service.ts`, `core/src/services/memory/service.ts`, `core/src/services/prompt/types.ts`
- `core/resources/templates/` — existing partials and default .md files
- `references/从OpenClaw看Agnet记忆范式.md` — OpenClaw reverse-engineering: SOUL.md/AGENTS.md/TOOLS.md/USER.md paradigm, two-tier memory architecture, fixed-role vs user memory distinction
- `references/openclaw/AGENTS.md` — OpenClaw's own AGENTS.md as a live example of the pattern
- `.planning/PROJECT.md` — v2.1 target features and key decisions table
