# Roadmap: Athena (YesImBot v4)

## Overview

Athena v4 is a complete rewrite of YesImBot as a Koishi plugin, enabling AI agents to participate naturally in IM platform conversations. The roadmap progresses from foundational architecture (monorepo, shared models) through core services (model abstraction, context management) to agent orchestration and intelligent decision-making. The journey delivers a functional skeleton with provider plugins, Horizon context architecture, and hybrid willingness system—establishing the foundation for future memory and lifecycle features.

v2 (功能平替) extends the v1 skeleton with the core features needed to reach v3 parity: dynamic schema linkage, willingness algorithm migration, Horizon context filling, and memory/prompt snippet injection.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation & Shared Model** - Monorepo structure, shared-model package, Koishi plugin skeleton (completed 2026-02-17)
- [x] **Phase 2: Model Service & Providers** - ModelService with provider registry, OpenAI and DeepSeek provider plugins (completed 2026-02-18)
- [x] **Phase 3: Horizon Context System** - Environment/Entity/Event abstractions, Timeline storage, Observation generation, Percept mechanism (completed 2026-02-18)
- [x] **Phase 4: Prompt & Tool Services** - PromptService for templates, PluginService for tool registration and execution (completed 2026-02-18)
- [x] **Phase 5: Agent Core & Integration** - AgentCore orchestrator, think-act loop, Koishi integration, basic messaging (completed 2026-02-18)
- [x] **Phase 6: Willingness & Polish** - Hybrid willingness system, error handling, final integration testing (completed 2026-02-18)
- [x] **Phase 7: Core Wiring Fixes** - Default system template, empty-render warnings, gap closure (completed 2026-02-19)
- [x] **Phase 8: Stream Support & Dead Code Cleanup** - Activate streamMode path, remove dead code, traceability fixes (completed 2026-02-19)
- [x] **Phase 9: Dynamic Schema Linkage** - Provider-registered models appear as dropdown options in main plugin config (completed 2026-02-19)
- [x] **Phase 10: Willingness System Migration** - Full v3 decay + heat + S-curve algorithm replacing v1 skeleton (completed 2026-02-19)
- [x] **Phase 11: Horizon Context Filling** - Populate Environment and Entity from live Koishi session data (completed 2026-02-20)
- [x] **Phase 12: Memory & Prompt Snippets** - Filesystem memory blocks loaded and injected via built-in prompt snippets (completed 2026-02-20)

## Phase Details

### Phase 1: Foundation & Shared Model

**Goal**: Establish monorepo structure and shared abstractions that all other packages depend on
**Depends on**: Nothing (first phase)
**Requirements**: PLATFORM-01 (partial - plugin skeleton only)
**Success Criteria** (what must be TRUE):
  1. Monorepo builds successfully with Turborepo and Yarn workspaces
  2. shared-model package exports core types (IModelProvider, IModel, ModelConfig interfaces)
  3. Core plugin package exists with Koishi 4.x plugin structure and can be loaded by Koishi
  4. TypeScript compilation works across all packages with proper module resolution
**Plans**: 2 plans

Plans:

- [ ] 01-01-PLAN.md — Monorepo infrastructure update + shared-model package with core types
- [ ] 01-02-PLAN.md — Koishi core plugin skeleton with lifecycle hooks

### Phase 2: Model Service & Providers

**Goal**: Enable multiple LLM providers to register and be called through unified ModelService
**Depends on**: Phase 1
**Requirements**: MODEL-01, MODEL-02, MODEL-03
**Success Criteria** (what must be TRUE):
  1. Provider plugins can register models to ModelService with independent configurations
  2. OpenAI provider plugin successfully calls OpenAI-compatible APIs via ai-sdk
  3. DeepSeek provider plugin successfully calls DeepSeek API via ai-sdk
  4. Core plugin can invoke registered models through ModelService abstraction
**Plans**: 3 plans

Plans:

- [ ] 02-01-PLAN.md — Shared-model types expansion + ModelService implementation in core
- [ ] 02-02-PLAN.md — OpenAI provider plugin
- [ ] 02-03-PLAN.md — DeepSeek provider plugin

### Phase 3: Horizon Context System

**Goal**: Provide framework-agnostic context abstraction that AgentCore consumes
**Depends on**: Phase 1
**Requirements**: HORIZON-01, HORIZON-02, HORIZON-03, HORIZON-04
**Success Criteria** (what must be TRUE):
  1. Environment/Entity/Event abstractions exist and can represent IM platform contexts
  2. Events are stored in Timeline with timestamp-based retrieval
  3. Events can be expanded into Observation objects readable by LLMs
  4. Percept objects describe agent triggers (messages, mentions) and drive AgentCore processing
**Plans**: 3 plans

Plans:

- [x] 03-01-PLAN.md — Horizon type definitions + EventManager for Timeline persistence
- [ ] 03-02-PLAN.md — EventListener with message capture, trigger classification, and aggregation
- [ ] 03-03-PLAN.md — HorizonService facade, Observation/HorizonView building, core plugin wiring

### Phase 4: Prompt & Tool Services

**Goal**: Provide template rendering and tool execution infrastructure for AgentCore
**Depends on**: Phase 1
**Requirements**: PROMPT-01, TOOL-01, TOOL-02
**Success Criteria** (what must be TRUE):
  1. PromptService loads and renders system prompt templates with personality configuration
  2. Tools can be registered with schema validation using decorator pattern
  3. PluginService dispatches tool calls and returns results to agent loop
  4. At least one built-in utility tool is registered and executable
**Plans**: 2 plans

Plans:

- [ ] 04-01-PLAN.md — PromptService with Mustache rendering, Snippet/Injection mechanism
- [ ] 04-02-PLAN.md — PluginService with decorator registration, built-in tools, core wiring

### Phase 5: Agent Core & Integration

**Goal**: Orchestrate the complete agent loop from stimulus to response
**Depends on**: Phase 2, Phase 3, Phase 4
**Requirements**: AGENT-01, AGENT-03, PLATFORM-01 (complete)
**Success Criteria** (what must be TRUE):
  1. AgentCore accepts Percept input and retrieves Observation from Horizon
  2. Think-act loop executes: context build → LLM call → tool execution → response generation
  3. Koishi plugin receives messages, creates Percepts, and sends agent responses back to platform
  4. Agent can participate in basic conversation with @mention detection
**Plans**: 2 plans

Plans:

- [ ] 05-01-PLAN.md — AgentCore service skeleton, ai-sdk tool adapter, finish tool
- [ ] 05-02-PLAN.md — Think-act loop, send_message enhancement, core plugin wiring

### Phase 6: Willingness & Polish

**Goal**: Add intelligent reply decision-making and production-ready error handling
**Depends on**: Phase 5
**Requirements**: AGENT-02
**Success Criteria** (what must be TRUE):
  1. WillingnessCalculator evaluates whether to reply using deterministic rules
  2. LLM-based willingness judgment refines rule-based decisions when needed
  3. Agent participation feels natural (not always-on, not purely random)
  4. Error handling prevents crashes from API failures or tool execution errors
**Plans**: 2 plans

Plans:

- [ ] 06-01-PLAN.md — WillingnessCalculator with rule scoring, LLM judgment, and AgentCore integration
- [ ] 06-02-PLAN.md — Error handling, channel reporting, and reply delay polish

### Phase 7: Core Wiring Fixes

**Goal**: Bundle default system template and add empty-render warnings in PromptService
**Depends on**: Phase 5, Phase 4
**Requirements**: AGENT-01, PROMPT-01
**Gap Closure:** Closes gaps from v1 audit
**Success Criteria** (what must be TRUE):
  1. A default "system" template is bundled so LLM never receives empty system prompt
  2. PromptService warns when render() returns empty string for a template key
  3. User-provided config.templates.system still overrides the default template
**Plans**: 1 plan

Plans:

- [ ] 07-01-PLAN.md — Default system template + empty-render warnings in PromptService

### Phase 8: Stream Support & Dead Code Cleanup

**Goal**: Activate streaming path and clean up dead code from audit findings
**Depends on**: Phase 7
**Requirements**: AGENT-03, HORIZON-02
**Gap Closure:** Closes gaps from v1 audit
**Success Criteria** (what must be TRUE):
  1. ThinkActLoop reads config.streamMode and uses streamText() when enabled
  2. ModelService.streamCall() uses PQueue concurrency control like call()
  3. markAsActive() dead code removed or stage transitions activated
  4. REQUIREMENTS.md traceability table accurately reflects implementation status
**Plans**: 2 plans

Plans:

- [ ] 08-01-PLAN.md — Stream support + PQueue wrap + lifecycle activation (markAsActive/archiveStale)
- [ ] 08-02-PLAN.md — REQUIREMENTS.md traceability audit with accurate statuses and Notes column

### Phase 9: Dynamic Schema Linkage

**Goal**: Provider-registered models appear as selectable dropdown options in the main plugin config UI
**Depends on**: Phase 8
**Requirements**: MODEL-04, MODEL-05
**Success Criteria** (what must be TRUE):
  1. After a provider plugin registers a model, that model ID appears in the main plugin's model selection dropdown without restart
  2. When a provider plugin is unloaded or hot-reloaded, the model list in the config UI updates automatically
  3. Selecting a model from the dropdown correctly wires it as the active model for the agent loop
**Plans**: 2 plans

Plans:

- [ ] 09-01-PLAN.md — IModelProvider.listModels() type + ModelService refreshSchemas() engine
- [ ] 09-02-PLAN.md — Core plugin dynamic Schema.dynamic dropdowns + agent loop provider:model parsing

### Phase 10: Willingness System Migration

**Goal**: Replace the v1 willingness skeleton with the full v3-derived algorithmic willingness system (decay + heat + sigmoid + fatigue)
**Depends on**: Phase 8
**Requirements**: WILLING-01, WILLING-02, WILLING-03
**Success Criteria** (what must be TRUE):
  1. Willingness value decays exponentially over time with a configurable half-life; four-tier heat detection (boiling/hot/warm/cold) modulates decay rate
  2. Sigmoid gain multiplier amplifies willingness at low values and diminishes at high values; fatigue mechanism suppresses over-activity via sliding window
  3. Keywords matched via regex boost willingness gain; @mention uses probability boost formula
  4. All algorithm parameters exposed as nested config groups (decay, gain, sigmoid, fatigue)
**Plans**: 2 plans

Plans:

- [ ] 10-01-PLAN.md — WillingnessConfig + WillingnessEngine (decay, heat, sigmoid, fatigue, keywords)
- [ ] 10-02-PLAN.md — AgentCore integration + root Config/Schema migration

### Phase 11: Horizon Context Filling

**Goal**: Populate Environment and Entity with real data from the live Koishi session
**Depends on**: Phase 8
**Requirements**: HORIZON-05, HORIZON-06
**Success Criteria** (what must be TRUE):
  1. Environment fields (channel name, platform, channel type) are populated from the Koishi session when a Percept is processed
  2. The sender's Entity (nickname, role) is populated from session user data
  3. The bot's own Entity (name, ID) is populated from the Koishi bot object
  4. LLM-visible Observation output reflects the real channel and user names rather than placeholder values
**Plans**: 1 plan

Plans:

- [ ] 11-01-PLAN.md — Environment lazy-load, Entity enrichment, bot self info, LLM output formatting

### Phase 12: Memory & Prompt Snippets

**Goal**: Load filesystem memory blocks and inject them alongside dynamic context snippets into every prompt
**Depends on**: Phase 9, Phase 11
**Requirements**: MEMORY-01, MEMORY-02, PROMPT-02
**Success Criteria** (what must be TRUE):
  1. MemoryService scans a configured directory and loads all .md/.txt files, respecting YAML frontmatter priority and tag fields
  2. Loaded memory blocks are injected into the prompt scope so the LLM receives them in every system prompt
  3. When no memory files are found, a built-in default persona block is used as fallback
  4. Built-in snippets supply current time, sender nickname/ID, channel name/platform, and bot name/ID to every rendered prompt
**Plans**: 2 plans

Plans:

- [ ] 12-01-PLAN.md — MemoryService with filesystem loading, YAML frontmatter parsing, hot-reload, prompt injection, default persona fallback
- [ ] 12-02-PLAN.md — Built-in dynamic snippets (time, sender, channel, bot) and core Config/Schema wiring

### Phase 13: Non-stream Path & Fallback Wiring

**Goal**: Route non-stream generateText() through ModelService.call() and wire parseModelId + fallbackModel
**Depends on**: Phase 12
**Requirements**: AGENT-01, AGENT-03, MODEL-01, MODEL-04, MODEL-05
**Gap Closure:** Closes integration/flow gaps from v1.0 audit
**Success Criteria** (what must be TRUE):
  1. Non-stream path calls modelService.call() instead of raw generateText(), gaining PQueue concurrency and fallback chain
  2. parseModelId is used or removed; fallbackModel is consulted on primary model failure
  3. finishTool double-inclusion is cleaned up
**Plans**: 2 plans

Plans:

- [ ] 13-01-PLAN.md — ModelService hardening: 503 classification, retry-before-fallback, per-call fallbackModel parameter, shared helpers
- [ ] 13-02-PLAN.md — Loop.ts non-stream path rewire to modelService.call() + finishTool collision guard

### Phase 14: Provider Pattern Cleanup & PLATFORM-01

**Goal**: Remove redundant ctx.get() from providers and close PLATFORM-01
**Depends on**: Phase 13
**Requirements**: PLATFORM-01, MODEL-01
**Gap Closure:** Closes requirement/integration gaps from v1.0 audit
**Success Criteria** (what must be TRUE):
  1. provider-openai and provider-deepseek use only inject pattern, no ctx.get()
  2. PLATFORM-01 marked complete — all Koishi Service patterns are idiomatic
**Plans**: 1 plan

Plans:

- [x] 14-01-PLAN.md — Replace ctx.get() with inject pattern, add koishi.service metadata

### Phase 15: LLM Deferred Judgment & Model Config Refactor

**Goal**: Add LLM deferred willingness judgment for borderline SKIP decisions; refactor model config to use fallbackChain lists with dynamic schema linkage
**Depends on**: Phase 13
**Requirements**: AGENT-02
**Success Criteria** (what must be TRUE):
  1. When willingness SKIP occurs and base willingness exceeds a configurable threshold, a deferred LLM judgment is scheduled after a delay inversely proportional to willingness
  2. If no new message arrives before the delay expires, LLM judges whether to reply; if a new message arrives, the deferred judgment is cancelled and normal willingness processing resumes
  3. Top-level defaultModel and fallbackChains removed from Config/Schema; AgentCoreConfig.fallbackModel and WillingnessConfig gain fallbackChain (array) with Schema.dynamic list UI
  4. fallbackChain fields use Schema.dynamic("registry.chatModels") and render as editable lists in Koishi config
**Plans**: 2 plans

Plans:

- [ ] 15-01-PLAN.md — Model config refactor: remove global defaultModel/fallbackChains, add per-module fallbackChain arrays and DeferredJudgmentConfig type
- [ ] 15-02-PLAN.md — Deferred LLM judgment: timer map, delay computation, binary yes/no LLM call in AgentCore

## Progress

**Execution Order:**
v1 phases: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8
v2 phases: 9 → 10 → 11 → 12 (10 and 11 can run in parallel after 8)
gap closure: 13 → 14; 15 can run in parallel with 14 (both depend on 13)

| Phase                         | Plans Complete | Status   | Completed  |
| ----------------------------- | -------------- | -------- | ---------- |
| 1. Foundation & Shared Model  | 0/2            | Complete | 2026-02-17 |
| 2. Model Service & Providers  | 3/3            | Complete | 2026-02-18 |
| 3. Horizon Context System     | 3/3            | Complete | 2026-02-18 |
| 4. Prompt & Tool Services     | 2/2            | Complete | 2026-02-18 |
| 5. Agent Core & Integration   | 2/2            | Complete | 2026-02-18 |
| 6. Willingness & Polish       | 2/2            | Complete | 2026-02-18 |
| 7. Core Wiring Fixes          | 1/1            | Complete | 2026-02-19 |
| 8. Stream & Dead Code Cleanup | 2/2            | Complete | 2026-02-19 |
| 9. Dynamic Schema Linkage     | 2/2 | Complete    | 2026-02-19 |
| 10. Willingness System Migration | 2/2 | Complete    | 2026-02-19 |
| 11. Horizon Context Filling   | 1/1 | Complete    | 2026-02-20 |
| 12. Memory & Prompt Snippets  | 2/2 | Complete    | 2026-02-20 |
| 13. Non-stream Path & Fallback | 2/2 | Complete    | 2026-02-20 |
| 14. Provider Pattern & PLATFORM-01 | 1/1     | Complete    | 2026-02-20 |
| 15. LLM Deferred Judgment & Config | 2/2 | Complete   | 2026-02-20 |
