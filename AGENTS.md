# Project: Athena (YesImBot v4)

Koishi 4.x plugin monorepo. See `.planning/PROJECT.md` for full context.

## Project Overview

Athena enables AI language models to participate naturally in IM platform conversations as unique virtual community members. The system transforms generic LLMs into agents with personality, memory, and context-aware behavior through:

- **Continuity**: Layered memory system (working/semantic/long-term)
- **Relationality**: Social network understanding and context adaptation
- **Agency**: Internal state, goals, and autonomous decision-making

Current status: v2.4 shipped (6,029 LOC), v2.5 in progress (multimodal & rich interaction).

## How to Use This Documentation

When working on Athena, follow this decision tree:

**Starting a Task:**

- New feature? → Check this file for patterns + `.planning/PROJECT.md` for requirements
- Refactor? → Review Development Notes below + Key Decisions in PROJECT.md
- Bug fix? → Check relevant service README or test files

**Understanding Change Impact:**

```
Message event → Willingness decision → Agent loop → Tool execution → Response
     ↓                ↓                    ↓              ↓
  Horizon        Rule + LLM         Trait + Skill    Native tool call
```

**Steps:**

1. Read service code in `core/src/services/`
2. Check Koishi Service Pattern section below
3. Find references with `grep -r "ServiceName" core/`
4. Verify injection dependencies in `inject` declarations
5. Check schema in provider `package.json` for service metadata

## Quick Component Summary

**Core (`core/`)**: Main plugin with all services

- `services/agent/` - ThinkActLoop, tool execution, response generation
- `services/horizon/` - Environment/Entity/Event data layer, Timeline storage
- `services/model/` - ModelService, Provider registration, PQueue concurrency
- `services/prompt/` - PromptService, injection points, partial composition
- `services/role/` - RoleService, SOUL.md/AGENTS.md/TOOLS.md loading
- `services/trait/` - TraitAnalyzer, Scene/Heat detection, per-channel state
- `services/skill/` - Skill loading, conditional activation, effect merging
- `services/willingness/` - Willingness algorithm, TokenBucket rate limiting
- `resources/roles/` - Fixed role files (SOUL.md, AGENTS.md, TOOLS.md)
- `resources/skills/` - Skill folders with conditions and effects

**Packages (`packages/`):**

- `shared-model/` - Shared types and interfaces

**Providers (`providers/`):**

- `provider-anthropic/` - Anthropic Claude integration + prompt caching
- `provider-deepseek/` - DeepSeek integration
- `provider-google/` - Google Gemini integration
- `provider-openai/` - OpenAI GPT integration

**Plugins (`plugins/`):**

- `persona/` - Form-based persona customization with presets
- `search-service/` - Web search tool integration
- `memory-keeper/` - Memory persistence (in development)
- `mcp-client/` - Model Context Protocol client

## Key Runtime Flows

**Message ingestion:**
`middleware` → willingness check (rule + LLM judge) → queue or respond immediately → DM aggregation (3-8s window) or group direct response

**Willingness decision:**
`WillingnessService.shouldRespond()` → exponential decay + conversation heat + S-curve boost → rule threshold → LLM delayed judgment (if borderline) → TokenBucket rate limit

**Agent response:**
`AgentService.respond()` → Horizon context fill → Trait analysis (Scene/Heat) → Skill activation → Prompt render (4 injection points) → ThinkActLoop → tool execution → send_message or silence

**Tool execution:**
Native ai-sdk tool calling → Tool (info retrieval, heartbeat continuation) vs Action (execution, ends round) → JSON text output with manual heartbeat

**Prompt caching (Anthropic only):**
Stable blocks (soul/instructions) + dynamic blocks (memory/extra) → SystemModelMessage[] with cache_control → ephemeral cache

## Implementation Strategy

When implementing new features in Athena:

1. **Start with types** - Define interfaces in `packages/shared-model` or service files
2. **Create service** - Extend `Service` class following Koishi Service Pattern below
3. **Register provider** - If model-related, use AbstractProvider pattern
4. **Add injection points** - Use PromptService for prompt modifications
5. **Wire dependencies** - Declare `inject` array for service dependencies
6. **Add tests** - Create vitest tests in `core/tests/`

**Incremental Development**: Make small changes, use `yarn typecheck` frequently (runs before build).

## Testing Conventions

- **Unit tests**: Add to `core/tests/` with `.test.ts` suffix
- **Test framework**: vitest with `describe`/`it`/`expect`
- **Existing coverage**: JSON parser (27 cases), TokenBucket, Willingness, HorizonText formatting
- **Run tests**: `yarn test` (workspace root) or `yarn test -p core` (specific package)
- **Mock services**: Use vitest `vi.fn()` for service mocking

## Development Notes

**Architectural Principles:**

- **Horizon is data, not decision** - Provides Environment/Entity/Event access, doesn't make choices
- **Trait + Skill separation** - Trait analyzes context (Scene/Heat), Skill responds with effects
- **Tool/Action distinction** - Tools retrieve info (continue loop), Actions execute (end round)
- **Per-channel isolation** - Each channel (platform + channelId) has independent context
- **Explicit over implicit** - Required fields enforced by type system, no optional chaining
- **Service subclass pattern** - Auto-registration, dependency injection, hot-reload support

**Key Design Patterns:**

- **4 injection points**: soul/instructions/memory/extra (merged from 6 to reduce abstraction)
- **Working memory trimming**: softTrim/hardClear two-tier strategy with initialContextCharBudget
- **Willingness algorithm**: Exponential decay + conversation heat + S-curve boost + LLM judge
- **Skill lifecycles**: per-turn (one-shot) / sticky (countdown) / trait-bound (immediate removal)
- **Provider unification**: AbstractProvider base class eliminates 36-61% duplication
- **Fixed role files**: SOUL.md/AGENTS.md/TOOLS.md replace free-form persona.md

**Technology Choices:**

- **ai-sdk over xsai** - Richer ecosystem, native tool calling
- **Turbo monorepo** - Fast builds, task dependencies (typecheck before build)
- **Service subclass** - Koishi 4.x pattern, not ctx.provide()
- **JSON text output** - Supports manual heartbeat and custom parsing (jsonrepair fallback)
- **TraceContext explicit passing** - No AsyncLocalStorage (Koishi event system doesn't guarantee propagation)

## File Reference

| File                             | Purpose                                         |
| -------------------------------- | ----------------------------------------------- |
| `.planning/PROJECT.md`           | Full project context, requirements, milestones  |
| `core/src/services/agent/`       | Agent loop, tool execution, response generation |
| `core/src/services/willingness/` | Willingness algorithm, rate limiting            |
| `core/src/services/horizon/`     | Context data layer (Environment/Entity/Event)   |
| `core/src/services/trait/`       | Trait analysis (Scene/Heat detection)           |
| `core/src/services/skill/`       | Skill loading, activation, effect merging       |
| `core/src/services/prompt/`      | Prompt rendering, injection points              |
| `core/src/services/role/`        | SOUL.md/AGENTS.md/TOOLS.md loading              |
| `core/resources/roles/`          | Fixed role files (SOUL/AGENTS/TOOLS)            |
| `core/resources/skills/`         | Skill folders with conditions and effects       |
| `core/tests/`                    | Vitest unit tests                               |
| `providers/provider-*/`          | Model provider plugins                          |
| `plugins/persona/`               | Persona customization plugin                    |
| `references/YesImBot-v3/`        | v3 reference implementation                     |
| `references/talks/`              | Architecture discussion documents               |

## Build and Test Commands

```bash
# Build (runs typecheck first via turbo)
yarn build

# Typecheck only
yarn typecheck

# Run tests
yarn test
yarn test -p core  # specific package

# Development
yarn dev  # if available

# Lint
yarn lint
```

## Remember

- Always use Service subclass pattern, never ctx.provide()
- Run `yarn build` (includes typecheck) before committing
- Create logger once: `const logger = ctx.logger("name")`, then reuse
- Declare `inject` array for service dependencies
- Use ChannelKey (platform + channelId) for channel identification
- Check `.planning/PROJECT.md` for current milestone and requirements
- Reference `references/YesImBot-v3/` when migrating v3 features
- Anthropic prompt caching is provider-specific, not abstracted
- Tool = info retrieval (continues), Action = execution (ends)
- When in doubt about patterns, check existing service implementations

## Reference Materials

### Previous Versions

- `references/YesImBot-v3/` — v3 发布版，功能最完整的版本。基于 xsai，Bun monorepo。包含动态 Schema 联动、Circuit breaker 熔断、成熟的意愿值系统（指数衰减+S 曲线增益）、6 个内置工具扩展、核心记忆块系统。迁移功能时优先参考。
- `references/YesImBot-dev/` — v3→v4 过渡版。已迁移到 Yarn monorepo，引入 Horizon 替代 WorldState，增加 ChatMode 机制。仍基于 xsai。意愿值系统在 v3 基础上增强（对话热度检测、弹性衰减）。

### Design Documents

- `references/books/` — 作者关于架构的思考记录（仅人类发言，去除了 AI 回复）。涵盖模块化模型服务、异步任务系统、记忆系统演进、工具调用范式、拟人化唤醒机制、记忆检索方案。体现对系统的核心愿景：连续性（L1/L2/L3 记忆）、关系性（社交网络理解）、主体性（内部状态与目标）。
- `references/talks/` — 完整的架构讨论文档。包含 Horizon 模块重构、Plugin 模块设计、上下文管理缺陷分析、智能上下文管理器方案等。关键设计决策：Horizon 作为数据访问层而非决策层、ChatMode 动态注册、Tool/Action 分离、反自我强化机制。

### Koishi Documentation

- `references/koishi-docs/zh-CN/` — Koishi 框架完整中文文档。包含 API、指南、Schema 配置、插件开发等。查阅 Schema 用法时参考 `schema/` 目录。
