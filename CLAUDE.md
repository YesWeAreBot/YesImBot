@AGENTS.md

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Athena Core — 会话与响应控制流**

Athena Core 是一个基于 Koishi 框架的 LLM 智能体运行时，让 AI 能像真人一样自然地参与 IM 平台群聊和私聊。本轮工作聚焦单频道主代理（main agent）的完整响应生命周期：事件接入、会话状态演进、模型回合控制、工具回合衔接、超时与恢复。

**Core Value:** 频道内有效输入事件均可靠进入 agent session，每次响应都能收敛到明确结束态，中断后可在同一会话目标下恢复推进。

### Constraints

- **Tech Stack**: Koishi 框架 + TypeScript strict mode — 插件生态要求
- **Runtime**: 基于 pi-coding-agent SessionManager — 已确定的 agent 底座选型
- **Formatting**: oxfmt, 2-space indent, double quotes, semicolons — 仓库规范
- **Dependencies**: 不引入 `any`，不引入动态 capability — 类型安全与能力固定性要求
- **Compatibility**: 插件变更仅影响后续新建 session — 能力冻结语义
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Executive Summary
## Recommended Stack
### Core Agent Runtime
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| @mariozechner/pi-coding-agent | Latest (2026) | Agent session foundation | Already selected. Provides SessionManager with JSONL persistence, native tool_call support, abort/continue control flow, extension hooks, and built-in compaction/summary. Minimal, proven architecture from Mario Zechner. |
| Koishi | Current | Plugin framework & IM integration | Already in use. Provides service lifecycle, middleware, event system, and multi-platform IM adapter layer. |
| TypeScript | 5.x | Type system | Already in use. Strict mode enabled, provides compile-time safety for agent state contracts. |
### Session Persistence
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| JSONL (JSON Lines) | N/A (format) | Append-only session state | Industry standard for agent session persistence in 2026. Each message/event is one line. Enables crash-safe writes, incremental loading, constant-memory parsing, and easy replay for context reconstruction. Built into pi-coding-agent SessionManager. |
| Node.js fs module | Built-in | File I/O | Sufficient for JSONL append operations. No additional dependencies needed. |
- [JSONL append-only persistence patterns](https://medium.com/)
- [Agent session management with JSONL](https://towardsai.net/)
### Tool Call Orchestration
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Native tool_call (OpenAI/Anthropic format) | N/A (protocol) | Tool invocation protocol | All major providers (OpenAI, Anthropic, Google, DeepSeek) support native function calling in 2026. Eliminates JSON parsing fragility, provides structured tool schemas, and enables streaming tool calls. pi-coding-agent has native tool_call support via `registerTool()`. |
| Zod | 3.x | Tool schema validation | TypeScript-first schema validation. Provides runtime type safety for tool parameters and can generate JSON schemas for LLM tool definitions. |
### Context Window Management
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Built-in compaction (pi-coding-agent) | N/A | Session history pruning | pi-coding-agent includes compaction and summarization primitives. Sufficient for V1-V2 phases. |
| Custom summarization prompts | N/A | Context compression | Use provider-native summarization via system prompts. No additional library needed for initial phases. |
- Letta (MemGPT) for OS-inspired tiered memory (Core/Recall/Archival)
- LangChain Memory for document-aware context
- Mem0 for cross-session long-term memory
- [Context window management strategies 2026](https://medium.com/)
- [Token optimization techniques](https://towardsai.net/)
### Workspace Isolation & Sandboxing
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Path validation (custom) | N/A | Workspace boundary enforcement | Lightweight approach: validate all file operations against workspace root. Sufficient for V1-V2. No external dependencies. |
| Docker containers | 20.x+ | Optional: High-risk code execution | For V3 or when executing untrusted code. Industry standard for LLM code execution sandboxing in 2026. Provides filesystem, network, and process isolation. |
- gVisor: Application kernel for syscall interception
- Firecracker/Kata Containers: MicroVM isolation with dedicated kernels
- E2B: Specialized AI agent sandbox service
- [Docker container sandboxing for LLM agents 2026](https://langchain.com/)
- [Sandbox isolation best practices](https://northflank.com/)
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Zod | 3.x | Schema validation | Tool parameter validation, config validation, runtime type safety |
| oxfmt | Current | Code formatting | Already in use. Maintains consistent code style across monorepo |
| Vitest | Current | Testing framework | Already in use. Test session lifecycle, tool execution, state transitions |
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| Yarn 4 | Package management | Already in use. Workspace management for monorepo |
| Turbo | Build orchestration | Already in use. Parallel builds and caching |
| oxlint | Linting | Already in use. Fast TypeScript linting |
## Alternatives Considered
| Category | Recommended | Alternative | When to Use Alternative |
|----------|-------------|-------------|------------------------|
| Agent Foundation | pi-coding-agent | LangGraph | If need complex multi-agent orchestration with state machines. Overkill for single-channel agents. |
| Agent Foundation | pi-coding-agent | Letta (MemGPT) | If need OS-inspired tiered memory from day one. More complex than needed for V1-V2. |
| Agent Foundation | pi-coding-agent | OpenAI Agents SDK | If locked into OpenAI ecosystem. Less provider-agnostic than pi-coding-agent. |
| Session Persistence | JSONL | SQLite | If need complex queries over session history. JSONL sufficient for append-only + replay pattern. |
| Session Persistence | JSONL | PostgreSQL | If need multi-user session management with ACID guarantees. Overkill for single-channel isolation. |
| Tool Orchestration | Native tool_call | JSON parsing from text | Never. Obsolete pattern from 2023-2024. Fragile and error-prone. |
| Sandboxing | Path validation → Docker | vm2 / isolated-vm | If need in-process JavaScript sandboxing. Less isolation than Docker. vm2 has known security issues. |
| Sandboxing | Path validation → Docker | WebAssembly (WASM) | If need portable sandboxing without Docker. Immature for general code execution in 2026. |
| Context Management | Built-in compaction | RAG with vector DB | If need semantic search over long-term memory. Defer to V3 unless required earlier. |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| JSON-in-text tool calling | Obsolete pattern. Fragile parsing, no streaming support, error-prone. | Native tool_call protocol (OpenAI/Anthropic format) |
| vm2 | Known security vulnerabilities. Maintenance concerns. | Docker containers for strong isolation, or path validation for lightweight boundaries |
| Dynamic capability discovery | Violates project constraint: "能力集合在 session 初始化时冻结". Causes non-deterministic behavior. | Freeze capabilities at session init, register tools upfront |
| Rewriting entire session files | Inefficient, not crash-safe, breaks append-only semantics. | JSONL append-only writes |
| LangChain (full framework) | Heavy dependency for what pi-coding-agent already provides. Adds complexity without clear benefit. | pi-coding-agent for session management, selective LangChain utilities if needed |
| AutoGen / CrewAI | Multi-agent frameworks. Out of scope for V1-V2 single-channel main agent. | Defer to V3+ if multi-agent coordination needed |
| Custom session serialization | Reinventing the wheel. JSONL is proven and standard. | JSONL format with pi-coding-agent SessionManager |
## Installation & Integration
### Core Dependencies (New)
# Agent runtime foundation
# Schema validation for tools
### No Additional Dependencies Needed
- JSONL: Native format, use Node.js `fs` module
- Path validation: Custom implementation
- Tool calling: Protocol-level, no library needed
- Context management: Built into pi-coding-agent
### Optional (V3+)
# If Docker sandboxing needed
# Install Docker Engine on host system (not a Node.js dependency)
# If advanced memory needed
## Architecture Integration Points
### How pi-coding-agent Fits with Koishi
### Custom Components to Build
### What pi-coding-agent Provides Out-of-Box
- SessionManager.create() / continueRecent() / open()
- session.prompt() with streamingBehavior: "followUp"
- session.abort() / agent.continue()
- agent.appendMessage() for non-triggering message injection
- registerTool() for custom tool registration
- Extension hooks: agent_start, tool_call, agent_end
- Built-in compaction and summarization
## Phase-Specific Stack Recommendations
### V1: Main Chain Stability
- pi-coding-agent SessionManager (JSONL persistence)
- Native tool_call orchestration
- Basic path validation for workspace boundaries
- Zod for tool parameter validation
### V2: Multi-Step Coordination
- Enhanced willingness judge (rule + optional LLM)
- Robust tool error handling
- Session state recovery patterns
### V3: Robustness & Degradation Quality
- Docker containers for high-risk code execution
- Advanced context strategies (RAG, tiered memory, semantic search)
- Monitoring and observability for session health
## Key Technology Decisions
| Decision | Rationale | Trade-offs |
|----------|-----------|------------|
| Use pi-coding-agent as foundation | Provides SessionManager, tool_call, abort/continue, hooks out-of-box. Minimal, proven architecture. | Less control over internals vs building from scratch. Acceptable trade-off for faster delivery. |
| JSONL for persistence | Industry standard, crash-safe, append-only, easy replay. Built into pi-coding-agent. | No complex queries without external indexing. Not needed for current use case. |
| Native tool_call protocol | All providers support it in 2026. Eliminates JSON parsing fragility. | None. Clear winner over text-based approaches. |
| Path validation before Docker | Lightweight, no operational overhead. Sufficient for V1-V2. | Less isolation than containers. Acceptable for workspace-scoped file operations. |
| Defer vector memory to V3 | Built-in compaction sufficient for V1-V2. Avoid premature complexity. | May need refactoring if memory needs emerge earlier. Acceptable risk. |
| Freeze capabilities at session init | Ensures deterministic behavior, aligns with project constraints. | Can't hot-reload plugins mid-session. Intentional design choice. |
## Sources
### Primary Research Sources
- [JSONL append-only persistence for agent state](https://medium.com/)
- [Agent session management patterns](https://towardsai.net/)
- [OpenClaw documentation](https://openclaw.ai/)
- [LangChain and LangGraph session management](https://langchain.com/)
- [Letta (MemGPT) memory architecture](https://letta.com/)
- [Mem0 intelligent memory layer](https://github.com/)
- [OpenAI Agents SDK](https://openai.com/)
- [Redis for LLM session memory](https://redis.io/)
- [pi-coding-agent on npm](https://npmjs.com/)
- [Mario Zechner's blog on building Pi](https://mariozechner.at/)
- [OpenClaw using pi-coding-agent](https://medium.com/)
- [Docker container sandboxing for LLM code execution](https://docker.com/)
- [LangSmith Sandboxes](https://langchain.com/)
- [Security best practices for AI code execution](https://northflank.com/)
- [gVisor and microVM isolation](https://dev.to/)
- [LLM context window token management strategies](https://medium.com/)
- [Context engineering and optimization](https://towardsai.net/)
- [RAG and memory-augmented networks](https://redis.io/)
- [Token optimization techniques](https://prompthub.us/)
- Industry knowledge: OpenAI, Anthropic, Google, DeepSeek all support native function calling as of 2025-2026
- Training data: Native tool_call replaced JSON-in-text patterns in 2024-2025
### Confidence Assessment by Area
| Area | Confidence | Basis |
|------|------------|-------|
| pi-coding-agent selection | HIGH | Already decided by project, documented in references |
| JSONL persistence | HIGH | Industry standard, multiple authoritative sources, built into pi-coding-agent |
| Native tool calling | HIGH | All major providers support it, training data + web search confirmation |
| Path validation approach | HIGH | Standard practice, aligns with project constraints |
| Docker for sandboxing | HIGH | Industry standard for LLM code execution, extensive documentation |
| Context management (V1-V2) | MEDIUM | Built-in capabilities sufficient, but may need enhancement sooner than V3 |
| Advanced memory (V3) | MEDIUM | Multiple options available (Letta, Mem0, LangChain), choice depends on specific V3 requirements |
## Summary
- **Minimal dependencies**: pi-coding-agent + Zod, everything else is built-in or custom
- **Proven patterns**: JSONL, native tool_call, Docker sandboxing are industry standards
- **Incremental complexity**: Start lightweight (path validation), add isolation (Docker) only when needed
- **Provider agnostic**: Works with OpenAI, Anthropic, Google, DeepSeek
- **Crash-safe**: Append-only JSONL ensures session state survives failures
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
