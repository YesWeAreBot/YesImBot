# Roadmap: Athena (YesImBot v4)

## Overview

Athena v4 is a complete rewrite of YesImBot as a Koishi plugin, enabling AI agents to participate naturally in IM platform conversations. The roadmap progresses from foundational architecture (monorepo, shared models) through core services (model abstraction, context management) to agent orchestration and intelligent decision-making. The journey delivers a functional skeleton with provider plugins, Horizon context architecture, and hybrid willingness system—establishing the foundation for future memory and lifecycle features.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation & Shared Model** - Monorepo structure, shared-model package, Koishi plugin skeleton (completed 2026-02-17)
- [x] **Phase 2: Model Service & Providers** - ModelService with provider registry, OpenAI and DeepSeek provider plugins (completed 2026-02-18)
- [x] **Phase 3: Horizon Context System** - Environment/Entity/Event abstractions, Timeline storage, Observation generation, Percept mechanism (completed 2026-02-18)
- [ ] **Phase 4: Prompt & Tool Services** - PromptService for templates, ToolService for registration and execution
- [ ] **Phase 5: Agent Core & Integration** - AgentCore orchestrator, think-act loop, Koishi integration, basic messaging
- [ ] **Phase 6: Willingness & Polish** - Hybrid willingness system, error handling, final integration testing

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
3. ToolService dispatches tool calls and returns results to agent loop
4. At least one built-in utility tool is registered and executable
   **Plans**: TBD

Plans:

- [ ] 04-01: TBD
- [ ] 04-02: TBD

### Phase 5: Agent Core & Integration

**Goal**: Orchestrate the complete agent loop from stimulus to response
**Depends on**: Phase 2, Phase 3, Phase 4
**Requirements**: AGENT-01, AGENT-03, PLATFORM-01 (complete)
**Success Criteria** (what must be TRUE):

1. AgentCore accepts Percept input and retrieves Observation from Horizon
2. Think-act loop executes: context build → LLM call → tool execution → response generation
3. Koishi plugin receives messages, creates Percepts, and sends agent responses back to platform
4. Agent can participate in basic conversation with @mention detection
   **Plans**: TBD

Plans:

- [ ] 05-01: TBD
- [ ] 05-02: TBD
- [ ] 05-03: TBD

### Phase 6: Willingness & Polish

**Goal**: Add intelligent reply decision-making and production-ready error handling
**Depends on**: Phase 5
**Requirements**: AGENT-02
**Success Criteria** (what must be TRUE):

1. WillingnessCalculator evaluates whether to reply using deterministic rules
2. LLM-based willingness judgment refines rule-based decisions when needed
3. Agent participation feels natural (not always-on, not purely random)
4. Error handling prevents crashes from API failures or tool execution errors
   **Plans**: TBD

Plans:

- [ ] 06-01: TBD
- [ ] 06-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase                        | Plans Complete | Status      | Completed  |
| ---------------------------- | -------------- | ----------- | ---------- |
| 1. Foundation & Shared Model | 0/2            | Complete    | 2026-02-17 |
| 2. Model Service & Providers | 3/3            | Complete    | 2026-02-18 |
| 3. Horizon Context System    | 3/3            | Complete    | 2026-02-18 |
| 4. Prompt & Tool Services    | 0/2            | Not started | -          |
| 5. Agent Core & Integration  | 0/3            | Not started | -          |
| 6. Willingness & Polish      | 0/2            | Not started | -          |
