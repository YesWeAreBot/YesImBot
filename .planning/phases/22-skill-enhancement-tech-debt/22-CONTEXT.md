# Phase 22: Skill Enhancement & Tech Debt - Context

**Gathered:** 2026-02-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Skills can inject prompt content at any of the 4 injection points (soul/instructions/memory/extra) instead of hardcoded `extra`. Trait-bound lifecycle gets runtime distinction from per-turn. TraitAnalyzerConfig type export debt is resolved. No new capabilities — this enhances existing skill mechanics and fixes known debt items (SKILL-01, SKILL-02, DEBT-01, DEBT-02).

</domain>

<decisions>
## Implementation Decisions

### Injection Point Configuration
- Single-point injection: one skill's prompt effect targets exactly one injection point
- Default to `extra` when `injection_point` is not specified in SKILL.md frontmatter (backward compatible)
- prompt and style effects can independently specify different injection points
- Two independent frontmatter fields: `injection_point` (for prompt content) and `style_injection_point` (for style effect)

### Trait-bound Lifecycle Behavior
- Trait signal disappears → skill immediately removed from active list (no grace period)
- Reuse existing `conditions` tree to determine whether the bound trait is still present
- Core distinction from per-turn: trait-bound maintains persistent active state in channelState, queryable at runtime
- State isolation: per-channel, consistent with existing sticky behavior

### Skill Effect Conflict Resolution
- Multiple skills injecting to the same point: prompt content concatenated, ordered by specificity (higher specificity first)
- Style conflict: global unique — highest specificity wins across all injection points (existing logic preserved)
- No changes to tool filter merge logic (existing include/exclude union)

### Tech Debt Scope
- Strictly DEBT-01 and DEBT-02 only, no scope expansion
- DEBT-01: TraitAnalyzerConfig becomes type-only export in `trait/index.ts`
- DEBT-02: trait-bound skills recorded in shared channelState Map (alongside sticky), distinguished by `lifecycle` field; each turn re-evaluates conditions, removes immediately when unmet; lifecycle type logged for observability

### Claude's Discretion
- Exact field naming for `style_injection_point` (may adjust if better name emerges)
- ActiveSkillState interface changes to accommodate trait-bound entries
- Log format and verbosity for lifecycle distinction
- Loader validation for invalid injection_point values

</decisions>

<specifics>
## Specific Ideas

- Backward compatibility is key: existing SKILL.md files without `injection_point` must work exactly as before (default `extra`)
- trait-bound and sticky share the same channelState Map but are distinguishable via the `lifecycle` field — no separate data structures
- prompt injections sorted by specificity before concatenation at each injection point

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 22-skill-enhancement-tech-debt*
*Context gathered: 2026-02-24*
