# Domain Pitfalls: Athena v2.0 Trait + Skill Integration

**Domain:** Context-Aware AI Chat Agent — v2.0 Milestone
**Researched:** 2026-02-21
**Confidence:** HIGH (based on direct codebase analysis, v3 lessons, design documents)

## Critical Pitfalls

### Pitfall 1: Breaking MemoryService inject() During PromptService Redesign

**What goes wrong:** PromptService v2 introduces multi-section architecture but removes or changes the `inject()` / `removeInjection()` API. MemoryService (and any future plugins) immediately breaks because it calls `ctx["yesimbot.prompt"].inject("core-memory", 10, renderFn)` during startup.

**Why it happens:** Desire for clean new API leads to removing "legacy" methods. The redesign focuses on the new section system without auditing existing callers.

**Consequences:** MemoryService fails to register its core-memory injection. System prompt loses persona and knowledge blocks. Agent responds without personality.

**Prevention:** Map existing `inject(name, priority, renderFn)` to `contributeToSection("injections", name, priority, renderFn)` internally. Keep the method signature identical. Deprecate gradually after all callers migrate.

**Detection:** MemoryService logs "MemoryService started, N blocks loaded" but system prompt contains no `<core_memory>` section.

### Pitfall 2: LLM-Based Trait Detection Adding Latency

**What goes wrong:** Trait detectors use LLM calls to analyze conversation context (topic classification, sentiment analysis). Each message now requires a pre-analysis LLM call before the actual response generation, doubling latency.

**Why it happens:** LLM-based analysis seems more accurate than heuristics. Developer assumes the latency is acceptable.

**Consequences:** Response time doubles from ~3s to ~6s+. In fast-paced group chats, the bot is "always a beat behind" (author's exact concern in books/04 section 4.12). Users perceive the bot as slow and unresponsive.

**Prevention:** All trait detectors must be rule-based heuristics. Keyword matching, frequency counting, entity attribute lookup — no LLM calls. The existing WillingnessEngine already demonstrates this pattern successfully.

**Detection:** Measure time between percept arrival and model call start. If >50ms, a detector is doing something expensive.

### Pitfall 3: Skill Effects Modifying Willingness

**What goes wrong:** A skill's effect includes willingness modifiers (e.g., "when technical topic detected, boost willingness by 20%"). This creates feedback loops where skills influence whether the agent responds at all, not just how it responds.

**Why it happens:** Natural desire to make the agent "more interested" in topics it has skills for. Seems logical but violates architectural boundaries.

**Consequences:** Willingness behavior becomes unpredictable. Skills that activate frequently create self-reinforcing loops. Debugging willingness decisions requires understanding the full skill activation state.

**Prevention:** Architectural rule: skills ONLY affect prompt content, style overrides, and tool availability. Willingness engine operates independently, before skill resolution. This is explicitly stated in PROJECT.md's key decisions.

**Detection:** If `SkillEffect` type contains any willingness-related fields, the design has drifted.

## Moderate Pitfalls

### Pitfall 4: Unbounded Prompt Growth from Multiple Active Skills

**What goes wrong:** Five skills activate simultaneously, each contributing 200+ tokens of prompt content. System prompt grows from 500 to 1500+ tokens, consuming context window budget meant for conversation history.

**Prevention:** Per-section character limits (like MemoryService's `memoryCharLimit`). When a section exceeds its budget, truncate lowest-priority contributions first. Log warnings when truncation occurs.

### Pitfall 5: Skill Condition Evaluation Order Dependencies

**What goes wrong:** Skill A's condition depends on Skill B being active, creating circular or order-dependent activation. "If technical AND code-help is active" — but code-help also checks for technical.

**Prevention:** Skills match against TraitSignals only, never against other skills' activation state. Conditions are evaluated independently in a single pass. No skill-to-skill dependencies.

### Pitfall 6: Hot-Reload Race Conditions

**What goes wrong:** Skill files change on disk while a ThinkActLoop is mid-execution. The skill registry reloads, changing active skills between trait analysis and prompt rendering within the same loop iteration.

**Prevention:** Snapshot skill definitions at the start of each loop iteration. File watcher triggers reload into a staging buffer; swap happens between loop iterations, not during.

### Pitfall 7: TraitAnalyzer Becoming a God Object

**What goes wrong:** TraitAnalyzer accumulates stateful caches, cross-detector dependencies, and complex aggregation logic. What started as parallel independent detectors becomes a tightly coupled analysis engine.

**Prevention:** Each detector is a pure function: `(view, percept) => TraitSignal | null`. No shared state between detectors. TraitAnalyzer is just a runner that calls detectors in parallel and collects results.

## Minor Pitfalls

### Pitfall 8: Over-Specifying Skill File Format

**What goes wrong:** Skill manifest schema becomes complex with many optional fields, nested structures, and validation rules. Skill authors find it harder to write skills than to modify code directly.

**Prevention:** Start with minimal manifest: `name`, `conditions[]`, `effects`. Add fields only when concrete need emerges. The simplest skill should be 5-10 lines of YAML.

### Pitfall 9: Template Section Ordering Assumptions

**What goes wrong:** Code assumes sections render in a fixed order (identity, style, memories, tools). A skill contributes to "style" but the content only makes sense after "identity" has been rendered.

**Prevention:** Sections have explicit numeric priority. Render order is deterministic. Document the default ordering. Skills can specify which section to target but cannot control cross-section ordering.

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| PromptService redesign | Breaking inject() API | Backward-compat wrapper mapping to sections |
| TraitAnalyzer | Detectors becoming stateful/expensive | Enforce pure-function detector interface |
| SkillRegistry | Complex manifest schema | Start minimal, 5-10 lines per skill |
| Pipeline integration | Race condition with hot-reload | Snapshot skills at loop start |
| Template restructure | Hardcoded section assumptions | Explicit priority-based ordering |

## Sources

- Direct codebase analysis: MemoryService inject() usage, ThinkActLoop pipeline, WillingnessEngine patterns
- Design documents: books/04 section 4.12 (latency concerns), 4.9 (LLM cost reduction)
- PROJECT.md: Key decision "Skill 分层效果叠加" and "Willingness 不直接干预"
- YesImBot-dev ChatMode: lessons from discrete mode switching problems

---
*Pitfalls research for: Athena v2.0 Trait + Skill Integration*
*Researched: 2026-02-21*
