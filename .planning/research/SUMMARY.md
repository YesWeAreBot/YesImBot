# Research Summary: Athena v2.0 Context-Aware Architecture

**Domain:** Context-Aware AI Chat Agent — Trait Perception + Skill Response Integration
**Researched:** 2026-02-21
**Overall confidence:** HIGH

## Executive Summary

Athena v2.0 replaces the discrete ChatMode pattern (match-first-wins) with a continuous, multi-dimensional Trait + Skill system. The existing v1.0 pipeline flows linearly from Session through EventListener, Percept, WillingnessEngine gate, ThinkActLoop, and finally to model output. The v2.0 changes insert two new layers — TraitAnalyzer (perception) and SkillRegistry (response adaptation) — between HorizonService.buildView() and PromptService.render(), without disrupting the existing willingness gate or model call infrastructure.

The current PromptService is the primary bottleneck for this integration. Its flat injection list and single-template design cannot express the multi-section, context-aware prompt composition that skills require. Redesigning PromptService into a multi-section architecture is the critical-path dependency that must come first.

TraitAnalyzer detectors are rule-based heuristics (not LLM calls), addressing the author's explicit concern about latency in group chat scenarios (books/04 section 4.12). Skills are file-based definitions (YAML frontmatter, like MemoryService's core memory blocks) that declare conditions against trait signals and effects on prompt sections, style, and tool availability. Multiple skills activate simultaneously with additive prompt/tool effects and priority-based style resolution.

The integration touches ThinkActLoop with approximately 15 lines of glue code, buildAiSdkTools with approximately 10 lines of filtering, and system.mustache with a section-based restructure. HorizonService requires no structural changes — the existing HorizonView already provides sufficient data for trait detection.

## Key Findings

**Stack:** No new dependencies needed. Existing Mustache renderer, js-yaml, and node:fs cover all requirements.
**Architecture:** Signal-Condition-Effect pipeline: TraitDetectors produce signals, SkillConditions match signals, SkillEffects modify prompt/tools/style.
**Critical pitfall:** PromptService backward compatibility — MemoryService's `inject()` calls must continue working through the redesign.

## Implications for Roadmap

Based on research, suggested phase structure:

1. **PromptService Redesign** - Foundation phase, everything depends on this
   - Addresses: Multi-section architecture, named injection points, section-based rendering
   - Avoids: Breaking existing inject() API (backward compat mapping)

2. **TraitAnalyzer** - Perception layer, independent of skills
   - Addresses: Scene/heat/topic/relation detection from HorizonView
   - Avoids: LLM-based detection (latency concern)

3. **SkillRegistry + Loader** - Response layer, depends on traits
   - Addresses: File-based skill definitions, condition matching, effect resolution
   - Avoids: Skills modifying willingness directly

4. **Pipeline Integration** - Wiring phase, depends on all above
   - Addresses: ThinkActLoop changes, tool filtering, template restructure
   - Avoids: Touching critical path before components are independently tested

**Phase ordering rationale:**
- PromptService v2 first because both trait output and skill effects need multi-section prompts to land in
- TraitAnalyzer before SkillRegistry because skills need signals to activate against
- SkillRegistry before integration because loop changes are thin glue code
- Integration last because it touches the critical ThinkActLoop path

**Research flags for phases:**
- Phase 1 (PromptService): Needs careful backward-compat design — MemoryService depends on inject()
- Phase 3 (Skills): File format and condition DSL need user-facing design decisions
- Phase 4 (Integration): Standard wiring, unlikely to need additional research

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | No new deps, all verified in codebase |
| Features | HIGH | Requirements explicit in PROJECT.md |
| Architecture | HIGH | Based on direct source analysis + design docs |
| Pitfalls | HIGH | Author's own concerns documented in books/04 |

## Gaps to Address

- Skill file format details (YAML schema, validation) — needs phase-specific design
- Token budget enforcement across multiple active skills — needs implementation research
- Whether TraitAnalyzer should be a Koishi Service or a plain class owned by AgentCore
- Hot-reload behavior when skill files change during active conversations
