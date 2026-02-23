# Phase 20: Injection Point Merge & Wrapper Elimination - Context

**Gathered:** 2026-02-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Consolidate 6 injection points to 4 (identity+style→soul, control_flow+basic_functions→instructions, keep memory and extra). Eliminate all wrapper partial templates and system.mustache — PromptService.render() generates XML tags and assembles prompt entirely in code. This is a conceptual merge: old injection point names cease to exist.

</domain>

<decisions>
## Implementation Decisions

### Injection Point Merge Strategy
- Conceptual merge, not content concatenation — old names (identity/style/control_flow/basic_functions) are fully eliminated
- Hard cutover: all call sites (loop.ts, SkillRegistry, PromptService) switch to new names, no backward compatibility
- Old default-*.md files (default-identity.md, default-style.md, default-control-flow.md, default-basic-functions.md) are deleted — empty output is acceptable until Phase 21 fills content via SOUL.md/AGENTS.md
- InjectionPoint type becomes `soul | instructions | memory | extra` — compilation failure on old names is the intended guard

### XML Tag Generation
- Each injection point uses its name as the XML tag: `<soul>...</soul>`, `<instructions>...</instructions>`, etc.
- Snippets within an injection point each have their own sub-tags (snippet brings its own tag name at registration time)
- PromptService only wraps the outer injection point tag; inner structure is snippet's responsibility
- Empty injection points still output their tags (e.g. `<soul></soul>`) — always present for structural consistency

### Template Migration
- system.mustache is deleted — render() assembles the complete system prompt via code string concatenation
- All wrapper partials (identity.mustache, style.mustache, control_flow.mustache, basic_functions.mustache, memory.mustache) are deleted
- Mustache library dependency is retained — prompt content still supports Mustache variable resolution (e.g. `{{bot.name}}`)
- Only .mustache template files are removed, not the rendering capability

### Runtime Guards
- inject() throws Error on unrecognized injection point names — fail fast, no silent ignore
- CACHEABLE_POINTS derived from InjectionPoint type — type-safe automatic sync
- render() outputs injection points in fixed order: soul → instructions → memory → extra
- All 4 injection points are cacheable

</decisions>

<specifics>
## Specific Ideas

- "这一阶段不是简单的内容合并，而是概念合并" — old injection point concepts disappear entirely
- "所有提示词内部仍然支持使用 Mustache 变量解析" — Mustache stays for variable interpolation, just not for template structure

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 20-injection-point-merge-wrapper-elimination*
*Context gathered: 2026-02-23*
