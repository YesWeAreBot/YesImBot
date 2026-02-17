# Project Research Summary

**Project:** Athena (YesImBot v4)
**Domain:** AI Chat Agent Plugin (Koishi)
**Researched:** 2026-02-17
**Confidence:** MEDIUM-HIGH

## Executive Summary

YesImBot v4 is an AI chat agent plugin for Koishi, enabling natural conversation across IM platforms (QQ, Discord, Telegram). The recommended approach uses a service-oriented architecture with provider plugins, leveraging Vercel AI SDK for LLM abstraction and Koishi's dependency injection for clean separation of concerns. The core differentiator is the hybrid willingness system that makes bot participation feel organic rather than command-driven or always-on.

The architecture centers on four core services (ModelService, AgentCore, ToolService, PromptService) with independent provider plugins that register at runtime. This avoids the v3 pitfall of monolithic configuration and tight coupling. The monorepo structure (Turborepo + Yarn 4) enables independent provider development while maintaining shared abstractions through a dedicated shared-model package.

Critical risks include over-engineering model abstractions, configuration complexity explosion, and tool calling reliability assumptions. Mitigation strategies: adopt provider plugin pattern from start, isolate configs per provider, implement strict tool validation with fallbacks. The v3 codebase provides valuable lessons learned, particularly around willingness randomness, task executor over-design, and memory system complexity.

## Key Findings

### Recommended Stack

The stack leverages modern TypeScript tooling with Koishi 4.18+ as the foundation. Vercel AI SDK replaces the deprecated xsai library, providing unified access to OpenAI, Anthropic, and custom providers with better streaming and tool calling support. The monorepo uses Turborepo for build orchestration and Yarn 4 for workspace management, with pkgroll handling dual ESM/CJS output for plugin packages.

**Core technologies:**
- **Koishi ^4.18.0**: Bot framework with service injection and lifecycle management
- **Vercel AI SDK ^4.1.0**: LLM abstraction with streaming and tool calling support
- **TypeScript ^5.7.0**: Type system with improved inference and decorator support
- **Turborepo ^2.3.0**: Monorepo orchestration with incremental builds and caching
- **Minato ^3.0.0**: Database ORM for conversation history and vector storage
- **oxlint/oxfmt**: Fast Rust-based linting and formatting (50-100x faster than ESLint)

### Expected Features

Research identified 9 table stakes features, 10 differentiators, and 7 anti-features to avoid.

**Must have (table stakes):**
- Basic message reply with @mention detection
- Multi-model support (OpenAI, Anthropic minimum)
- Context window management (token-based sliding window)
- Basic tool calling framework with validation
- Configurable reply rate and error handling
- Prompt/personality system
- Rate limiting and cost control

**Should have (competitive):**
- Hybrid willingness system (v3's key differentiator)
- Load balancing across providers with failover
- Extensible tool framework with decorator registration
- Session-aware context (isolated memory per channel)
- Streaming responses with typing indicators
- MCP (Model Context Protocol) support

**Defer (v2+):**
- Advanced memory system (RAG, knowledge graphs)
- Heartbeat/autonomous loop (proactive conversation)
- Multi-turn tool orchestration
- Web UI for management

### Architecture Approach

Service-oriented architecture using Koishi's dependency injection system. Core plugin contains four services registered via ctx.plugin(), with provider plugins as separate packages that inject 'athena.model' and register themselves at runtime. This pattern prevents tight coupling and enables users to install only needed providers.

**Major components:**
1. **ModelService** — Provider registry, model group management, load balancing, failover
2. **AgentCore** — Agent loop orchestration, decision making, conversation flow control
3. **ToolService** — Tool registration, schema validation, execution dispatch
4. **PromptService** — Template rendering, dynamic fragment injection, context assembly
5. **Provider Plugins** — Independent packages implementing model abstraction (OpenAI, DeepSeek, etc.)

**Data flow:** User message → Decision filter → AgentCore → PromptService builds context → ModelService calls LLM → Tool calls loop back → Final response

### Critical Pitfalls

1. **Over-engineered model abstractions** — Use ai-sdk's provider-specific adapters directly, accept provider differences, design for plugins not unified abstraction
2. **Configuration complexity explosion** — Provider-specific plugins with isolated configs, core plugin limited to 10-15 options max
3. **Tool calling reliability assumptions** — Validate schemas strictly, implement fallback when tools aren't called, use tool choice hints, monitor success rates
4. **Prompt injection vulnerability** — Use message role separation strictly, validate tool permissions per user, implement content filtering
5. **Willingness system randomness** — Hybrid approach with deterministic rules + optional randomness, make randomness configurable for testing

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Foundation & Provider System
**Rationale:** Must establish provider plugin pattern and service architecture before building features. Architecture research shows ModelService must exist before providers can register, and PromptService is needed before AgentCore.

**Delivers:**
- Monorepo structure with shared-model package
- Core plugin skeleton with service registration
- ModelService with provider registry
- First provider (OpenAI) to validate pattern
- Basic config schema (minimal, <15 fields)

**Addresses:**
- Over-engineered abstractions pitfall (Phase 1 prevention)
- Configuration complexity pitfall (isolated configs from start)
- Monorepo dependency hell (proper workspace setup)

**Avoids:** Tight coupling between core and providers, unified config window

### Phase 2: Agent Core & Messaging
**Rationale:** With provider system proven, build the agent loop. PromptService needed before AgentCore for context building. Basic tool framework skeleton enables testing agent loop with simple tools.

**Delivers:**
- PromptService with template rendering
- AgentCore with message handling and decision logic
- Context window management (token-based sliding window)
- Basic @mention detection and reply logic
- ToolService skeleton (registry without complex execution)

**Uses:** Vercel AI SDK for LLM calls, Koishi session handling

**Implements:** AgentCore component, message processing flow

**Avoids:** Stateful services without proper scoping, ignoring Koishi lifecycle

### Phase 3: Tool System & Willingness
**Rationale:** Agent core working enables tool integration. Willingness system is the key differentiator and should be built carefully with deterministic core + optional randomness.

**Delivers:**
- Tool execution with validation and dispatch
- Agent loop with tool calling integration
- Hybrid willingness system (deterministic rules + configurable randomness)
- Built-in utility tools
- Error handling for tool failures

**Addresses:**
- Tool calling reliability pitfall (validation and fallback from start)
- Willingness randomness pitfall (deterministic core with optional layer)

**Avoids:** Synchronous tool execution, pure random behavior

### Phase 4: Streaming & Rate Limiting
**Rationale:** Core functionality proven, add production-ready features. Streaming improves UX, rate limiting prevents cost overruns.

**Delivers:**
- Streaming response support with error handling
- Request queue with concurrency limits
- Per-user and global rate limiting
- Cost tracking and alerts
- Typing indicators and delays

**Addresses:**
- Streaming error handling pitfall (robust retry and recovery)
- Rate limiting naivety pitfall (queuing and backpressure)

### Phase 5: Load Balancing & Advanced Features
**Rationale:** After core is stable, add reliability and polish features.

**Delivers:**
- Model groups with load balancing
- Provider failover chains
- Session-aware context (memory slots)
- MCP support for standardized tools

**Addresses:** Scaling considerations from architecture research

### Phase Ordering Rationale

- **Foundation first:** Provider plugin pattern must be established before building features to avoid v3's tight coupling
- **Services in dependency order:** ModelService → PromptService → AgentCore → ToolService matches architectural dependencies
- **Willingness after basics:** Need working agent loop before adding sophisticated decision logic
- **Streaming/rate limiting after core:** Production features added once functionality proven
- **Memory deferred:** Architecture research warns about memory over-engineering; defer to v2+ until clear need emerges

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Willingness):** Complex decision logic, needs careful design to avoid v3's randomness issues
- **Phase 5 (MCP):** Emerging standard, may need protocol research if adoption evolved since training cutoff

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** Monorepo setup well-documented, Koishi service patterns established
- **Phase 2 (Agent Core):** Standard agent loop patterns, ai-sdk documentation sufficient
- **Phase 4 (Streaming):** Well-documented streaming patterns in ai-sdk

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Vercel AI SDK versions based on training data, project context confirms Turborepo/Yarn 4 setup |
| Features | HIGH | Based on v3 codebase analysis and domain expertise, clear table stakes vs differentiators |
| Architecture | MEDIUM | Koishi patterns from training data, could not verify against official docs |
| Pitfalls | HIGH | Strong confidence from v3 lessons learned and explicit design doc warnings |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Vercel AI SDK current version:** Training data from Jan 2025, verify latest version and API changes before implementation
- **Koishi 4.18.x specifics:** Could not access official documentation, verify service registration patterns
- **MCP adoption status:** Emerging standard as of training cutoff, check current ecosystem support
- **ai-sdk tool calling patterns:** Verify current best practices for tool choice hints and parallel execution

During planning, validate these areas with official documentation and current ecosystem state.

## Sources

### Primary (HIGH confidence)
- YesImBot v3 codebase (D:/Codespace/koishi-dev/YesWeAreBot/YesImBot-v3/) — Extension system, memory implementation, tool framework, willingness system
- Project context (package.json, tsconfig, turbo.json) — Existing Turborepo/Yarn 4 setup confirmed
- Design docs — Explicit warnings about LLM tool calling, memory retrieval, entity confusion

### Secondary (MEDIUM confidence)
- Training data (Jan 2025 cutoff) — Koishi 4.x architecture, Vercel AI SDK patterns, TypeScript 5.x features
- Domain knowledge — AI agent patterns (ReAct, function calling), IM platform bot behaviors

### Tertiary (LOW confidence, needs validation)
- Vercel AI SDK version numbers — Based on training data, may not reflect latest releases
- MCP ecosystem maturity — Emerging standard, adoption may have evolved

---
*Research completed: 2026-02-17*
*Ready for roadmap: yes*
