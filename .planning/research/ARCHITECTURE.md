# Architecture Research

**Domain:** AI Chat Agent (Koishi Plugin)
**Researched:** 2026-02-17
**Confidence:** MEDIUM

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Koishi Application Layer                  │
│                  (Context, DI Container, Events)             │
├─────────────────────────────────────────────────────────────┤
│                      Plugin Entry Point                      │
│              (Registration, Config, Lifecycle)               │
├─────────────────────────────────────────────────────────────┤
│                      Service Layer                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │  Model   │  │  Agent   │  │  Tool    │  │  Prompt  │    │
│  │ Service  │  │  Core    │  │ Service  │  │ Service  │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │
│       │             │             │             │           │
├───────┴─────────────┴─────────────┴─────────────┴───────────┤
│                    Provider Layer                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   OpenAI     │  │  DeepSeek    │  │   Future     │       │
│  │   Provider   │  │   Provider   │  │   Provider   │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
├─────────────────────────────────────────────────────────────┤
│                    External APIs                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                   │
│  │ OpenAI   │  │ DeepSeek │  │  Tools   │                   │
│  │   API    │  │   API    │  │   APIs   │                   │
│  └──────────┘  └──────────┘  └──────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| ModelService | Model provider registry, model group management, load balancing, failover | Service class with provider map, group config, selection logic |
| AgentCore | Agent loop orchestration, decision making, conversation flow control | Service class with event handlers, state machine for agent loop |
| ToolService | Tool registration, schema validation, execution dispatch | Service class with tool registry, JSON schema validator |
| PromptService | Template rendering, dynamic fragment injection, context assembly | Service class with template engine (Mustache), fragment registry |
| Provider Plugin | Model abstraction, API client wrapper, request/response normalization | Separate plugin package, registers to ModelService |

## Recommended Project Structure

```
packages/
├── core/                    # Main plugin
│   ├── src/
│   │   ├── index.ts        # Plugin entry, service registration
│   │   ├── services/       # Core services
│   │   │   ├── model.ts    # ModelService
│   │   │   ├── agent.ts    # AgentCore
│   │   │   ├── tool.ts     # ToolService
│   │   │   └── prompt.ts   # PromptService
│   │   ├── handlers/       # Message handlers, event listeners
│   │   └── types/          # Shared types
│   └── package.json
├── shared-model/            # Provider abstraction
│   ├── src/
│   │   ├── index.ts        # Export types and base classes
│   │   ├── provider.ts     # BaseProvider interface
│   │   └── types.ts        # Common model types
│   └── package.json
plugins/
├── provider-openai/         # OpenAI provider
│   ├── src/
│   │   └── index.ts        # Provider implementation + registration
│   └── package.json
└── provider-deepseek/       # DeepSeek provider
    ├── src/
    │   └── index.ts        # Provider implementation + registration
    └── package.json
```

### Structure Rationale

- **packages/core/**: Main plugin contains all core logic, services are Koishi services registered via ctx.provide()
- **packages/shared-model/**: Shared abstractions prevent circular dependencies between core and providers
- **plugins/provider-*/**: Independent plugins that depend on core, register themselves to ModelService on load
- **Monorepo benefits**: Shared TypeScript config, unified build with Turbo, version management with Yarn workspaces


## Architectural Patterns

### Pattern 1: Service-Oriented Architecture with Koishi DI

**What:** Core functionality split into independent services registered via Koishi's dependency injection system.

**When to use:** Always for Koishi plugins. Services are singletons managed by Koishi's Context.

**Trade-offs:** 
- Pro: Clean separation of concerns, testable, services can depend on each other declaratively
- Pro: Koishi handles lifecycle (start/stop/dispose)
- Con: Must understand Koishi's Context and service resolution

**Example:**
```typescript
// packages/core/src/index.ts
export const name = 'athena'

export function apply(ctx: Context, config: Config) {
  // Register services in dependency order
  ctx.plugin(ModelService, config.model)
  ctx.plugin(ToolService, config.tools)
  ctx.plugin(PromptService, config.prompts)
  ctx.plugin(AgentCore, config.agent)
}

// packages/core/src/services/model.ts
export class ModelService extends Service {
  constructor(ctx: Context, config: ModelConfig) {
    super(ctx, 'athena.model', true) // immediate = true
    this.providers = new Map()
  }
  
  registerProvider(name: string, provider: ModelProvider) {
    this.providers.set(name, provider)
  }
}

declare module 'koishi' {
  interface Context {
    'athena.model': ModelService
  }
}
```


### Pattern 2: Provider Plugin Pattern

**What:** Model providers as separate plugins that register themselves to core service on load.

**When to use:** When you need pluggable backends with independent configuration.

**Trade-offs:**
- Pro: Each provider has its own config UI, no monolithic config
- Pro: Users only install providers they need
- Con: Requires coordination between core and provider versions

**Example:**
```typescript
// plugins/provider-openai/src/index.ts
export const name = 'athena-provider-openai'
export const inject = ['athena.model']

export function apply(ctx: Context, config: OpenAIConfig) {
  const provider = new OpenAIProvider(config)
  ctx['athena.model'].registerProvider('openai', provider)
}
```


### Pattern 3: Agent Loop with Tool Calling

**What:** Iterative loop: stimulus → context → LLM → tool execution → response.

**When to use:** AI agents that need to perform actions before responding.

**Trade-offs:**
- Pro: Enables complex multi-step reasoning
- Con: Increases latency and token cost

**Example:**
```typescript
async function agentLoop(session: Session) {
  const context = await buildContext(session)
  
  while (true) {
    const response = await llm.generate(context)
    
    if (response.toolCalls?.length) {
      for (const call of response.toolCalls) {
        const result = await toolService.execute(call)
        context.push({ role: 'tool', content: result })
      }
      continue // Loop back to LLM with tool results
    }
    
    return response.text // No more tools, return final response
  }
}
```


## Data Flow

### Message Processing Flow

```
User Message
    ↓
Koishi Event (message)
    ↓
Decision Filter (should respond?)
    ↓
AgentCore.handleMessage()
    ↓
PromptService.buildContext() → [system, history, user message]
    ↓
ModelService.generate() → LLM API call
    ↓
Tool calls? → YES → ToolService.execute() → loop back to LLM
             ↓ NO
    ↓
Response text
    ↓
session.send()
```

### Provider Registration Flow

```
Koishi starts
    ↓
Core plugin loads → ModelService registered
    ↓
Provider plugin loads → inject: ['athena.model']
    ↓
Provider calls modelService.registerProvider()
    ↓
ModelService adds to registry
    ↓
AgentCore can now use provider via ModelService
```


### Tool Calling Integration

```
LLM Response with tool_calls
    ↓
ToolService.execute(toolName, args)
    ↓
Validate args against JSON schema
    ↓
Execute registered tool function
    ↓
Return result to LLM context
    ↓
LLM generates next response (with tool results)
```

### Key Data Flows

1. **Provider Registration:** Provider plugin → ModelService.registerProvider() → Available for use
2. **Message Handling:** Koishi event → Decision → AgentCore → ModelService → ToolService (if needed) → Response
3. **Tool Execution:** LLM tool_call → ToolService validation → Tool function → Result back to LLM


## Anti-Patterns

### Anti-Pattern 1: Tight Coupling Between Core and Providers

**What people do:** Import provider implementations directly in core package.

**Why it's wrong:** Creates circular dependencies, forces users to install all providers.

**Do this instead:** Use shared-model package for abstractions, providers register at runtime.

### Anti-Pattern 2: Synchronous Tool Execution

**What people do:** Block the agent loop waiting for all tools to complete sequentially.

**Why it's wrong:** Increases latency when tools could run in parallel.

**Do this instead:** Execute independent tools concurrently, only wait for dependencies.


### Anti-Pattern 3: Stateful Services Without Proper Scoping

**What people do:** Store conversation state in service singleton.

**Why it's wrong:** State leaks between users/channels, causes race conditions.

**Do this instead:** Use Koishi's session/channel scoping or external state store with proper keys.

### Anti-Pattern 4: Ignoring Koishi Lifecycle

**What people do:** Start background tasks in constructor, don't clean up on dispose.

**Why it's wrong:** Memory leaks, tasks continue after plugin unload.

**Do this instead:** Use ctx.on('ready') for initialization, ctx.on('dispose') for cleanup.


## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-100 users | Monolithic core, in-memory state, single model provider |
| 100-1k users | Add model groups with load balancing, consider Redis for state |
| 1k-10k users | Separate decision service (rule engine), cache prompt templates |
| 10k+ users | Distributed state, queue-based tool execution, multiple bot instances |

### Scaling Priorities

1. **First bottleneck:** LLM API rate limits → Add multiple providers, implement retry with backoff
2. **Second bottleneck:** Memory from conversation history → Implement sliding window or summarization
3. **Third bottleneck:** Tool execution latency → Async execution, result caching


## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| OpenAI API | HTTP client via ai-sdk | Rate limits, streaming support |
| DeepSeek API | HTTP client via ai-sdk | Compatible with OpenAI format |
| Tool APIs | Direct HTTP/SDK calls | Executed by ToolService |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Core ↔ Provider | Service registration | Providers inject 'athena.model' |
| AgentCore ↔ ModelService | Direct method calls | Synchronous registry access |
| AgentCore ↔ ToolService | Async method calls | Tool execution may be slow |
| PromptService ↔ AgentCore | Direct method calls | Template rendering is fast |


## Build Order Implications

### Phase 1: Foundation
1. **shared-model package** - Define provider interfaces first
2. **ModelService skeleton** - Registry without providers
3. **Basic plugin structure** - Entry point, config schema

### Phase 2: Provider System
4. **ModelService implementation** - Registration, selection logic
5. **First provider** (OpenAI) - Validate provider pattern
6. **Model groups** - Load balancing, failover

### Phase 3: Agent Core
7. **PromptService** - Template rendering needed before agent
8. **ToolService skeleton** - Registry without tools
9. **AgentCore** - Message handling, decision logic

### Phase 4: Tool System
10. **Tool execution** - Validation, dispatch
11. **Agent loop** - Integrate tool calling
12. **Built-in tools** - Basic utilities

### Dependencies
- ModelService must exist before providers can register
- PromptService needed before AgentCore (context building)
- ToolService can be parallel with PromptService
- Providers can be built in parallel after ModelService


## Sources

**Confidence Level: MEDIUM**

- **Koishi Architecture:** Based on training data knowledge of Koishi 4.x service system and DI patterns (official docs not accessible)
- **AI Agent Patterns:** Based on training data knowledge of LangChain, AutoGPT, and similar agent frameworks
- **Tool Calling:** Based on OpenAI function calling and ai-sdk patterns from training data
- **Monorepo Structure:** Based on common TypeScript monorepo patterns (Turbo, Yarn workspaces)

**Verification Status:**
- Could not access Koishi official documentation or Context7 for verification
- Could not access ai-sdk documentation for current patterns
- Recommendations based on training data (Jan 2025 cutoff) and project context provided

**Recommended Validation:**
- Verify Koishi service registration patterns against official docs
- Verify ai-sdk tool calling integration patterns
- Check for Koishi 4.18.x specific changes to service system

---
*Architecture research for: AI Chat Agent (Koishi Plugin)*
*Researched: 2026-02-17*
