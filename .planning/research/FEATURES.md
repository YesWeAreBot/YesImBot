# Feature Research

**Domain:** AI Chat Agent Plugin for IM Platforms (QQ, Discord, Telegram via Koishi)
**Researched:** 2026-02-17
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Basic message reply | Core functionality - bot must respond to messages | LOW | Simple text response to user input |
| @mention detection | Standard IM bot behavior - respond when called | LOW | Parse @mentions from platform adapters |
| Multi-model support | Users expect choice of AI providers (OpenAI, Claude, local) | MEDIUM | Provider abstraction layer needed |
| Configurable reply rate | Prevent spam, control bot activity level | LOW | Threshold/probability system |
| Context window management | AI needs conversation history to be coherent | MEDIUM | Message queue with size limits |
| Basic prompt/personality | Users want to customize bot character | LOW | System prompt configuration |
| Error handling & fallback | Bot shouldn't crash on API failures | MEDIUM | Retry logic, graceful degradation |
| Platform message format support | Handle text, images, @mentions, replies | MEDIUM | Platform adapter integration |
| Rate limiting & cost control | Prevent runaway API costs | MEDIUM | Request throttling, token limits |
| Basic tool calling | Modern AI agents need function calling | HIGH | Tool registry, parameter validation, execution |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Hybrid reply decision (willingness system) | Natural human-like participation vs always-on bots | MEDIUM | v3's willingness accumulation is unique, feels organic |
| Heartbeat/autonomous loop | Bot can initiate conversation proactively, not just reactive | HIGH | Scheduled checks, context-aware decision making |
| Load balancing across providers | High availability, cost optimization, automatic failover | MEDIUM | Round-robin or weighted distribution |
| Extensible tool framework | Plugin ecosystem for custom capabilities | HIGH | Decorator-based registration (v3 pattern) |
| Structured prompt system | Composable prompts vs monolithic system message | MEDIUM | Template rendering, variable injection |
| Session-aware context | Different memory per group/channel | MEDIUM | Memory slot system (v3 has this) |
| Typing indicators & delays | Simulate human typing speed for realism | LOW | Calculate delay based on message length |
| Multi-turn tool orchestration | Chain multiple tool calls intelligently | HIGH | Agent loop with planning |
| MCP (Model Context Protocol) support | Standardized tool integration | MEDIUM | MCP client implementation |
| Streaming responses | Real-time message updates as AI generates | MEDIUM | SSE/streaming API support |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Full conversation history storage | "Bot should remember everything" | Unbounded storage, privacy issues, context pollution | Sliding window + summarization, explicit memory tools |
| Always-on reply mode | "Bot should respond to every message" | Spam, unnatural, dominates conversation | Willingness/threshold system with @mention override |
| Per-user personality customization | "Each user gets custom bot behavior" | Inconsistent experience, management nightmare | Per-channel/group personality, user preferences for minor tweaks |
| Automatic web search on every query | "Bot should always have latest info" | Slow, expensive, often irrelevant | Tool-based search only when AI decides it's needed |
| Real-time learning from chat | "Bot should learn from conversations" | Prompt injection, quality degradation, bias | Explicit memory management tools, admin-curated knowledge |
| Unlimited tool call depth | "Let AI chain as many tools as needed" | Infinite loops, cost explosion, timeout issues | Max depth limit (3-5 calls), require explicit continuation |
| Global shared memory across all groups | "Bot should know everything everywhere" | Privacy violations, context confusion | Isolated memory slots per session group |


## Feature Dependencies

```
Reply Decision System
    ├──requires──> Context Window Management
    └──requires──> @mention Detection

Tool Calling Framework
    ├──requires──> Model Service (function calling support)
    ├──requires──> Parameter Validation
    └──enhances──> Multi-turn Orchestration

Prompt System
    ├──requires──> Context Window Management
    └──enhances──> Personality Configuration

Load Balancing
    ├──requires──> Multi-model Support
    └──requires──> Error Handling & Fallback

Heartbeat Loop
    ├──requires──> Reply Decision System
    ├──requires──> Context Window Management
    └──conflicts──> Always-on Reply Mode (anti-feature)

Session-aware Context
    ├──requires──> Context Window Management
    └──conflicts──> Global Shared Memory (anti-feature)

MCP Support
    └──enhances──> Tool Calling Framework
```

### Dependency Notes

- **Tool Calling requires Model Service**: Only models with native function calling (GPT-4, Claude 3+) can use structured tools. Fallback to prompt-based for others.
- **Heartbeat conflicts with Always-on**: Autonomous initiation only makes sense with selective reply logic.
- **Session-aware conflicts with Global Memory**: Architectural decision - either isolated or shared, not both.
- **Load Balancing enhances Reliability**: Multiple providers prevent single point of failure.
- **Prompt System enhances all features**: Well-structured prompts improve every interaction.


## MVP Definition

### Launch With (v1)

Minimum viable product — what's needed to validate the concept.

- [x] **Basic message reply** — Core functionality
- [x] **@mention detection** — Standard bot behavior
- [x] **Multi-model support** — Provider flexibility (OpenAI, Anthropic minimum)
- [x] **Hybrid reply decision** — Differentiator, natural participation
- [x] **Context window management** — Coherent conversations
- [x] **Basic tool calling framework** — Modern AI agent requirement
- [x] **Prompt system** — Personality configuration
- [x] **Error handling & fallback** — Production reliability
- [x] **Rate limiting** — Cost control

### Add After Validation (v1.x)

Features to add once core is working.

- [ ] **Load balancing** — When multi-provider usage increases
- [ ] **Heartbeat loop** — After reply decision is stable
- [ ] **Streaming responses** — UX improvement, not critical
- [ ] **MCP support** — When tool ecosystem matures
- [ ] **Typing indicators** — Polish feature

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] **Advanced memory system** — RAG, knowledge graphs (explicitly out of v1 scope)
- [ ] **Multi-turn orchestration** — Complex agent workflows
- [ ] **Web UI for management** — Admin tooling
- [ ] **Analytics & monitoring** — Usage insights


## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Basic message reply | HIGH | LOW | P1 |
| @mention detection | HIGH | LOW | P1 |
| Multi-model support | HIGH | MEDIUM | P1 |
| Hybrid reply decision | HIGH | MEDIUM | P1 |
| Context window management | HIGH | MEDIUM | P1 |
| Basic tool calling | HIGH | HIGH | P1 |
| Prompt system | HIGH | MEDIUM | P1 |
| Error handling & fallback | HIGH | MEDIUM | P1 |
| Rate limiting | HIGH | MEDIUM | P1 |
| Load balancing | MEDIUM | MEDIUM | P2 |
| Session-aware context | MEDIUM | MEDIUM | P2 |
| Extensible tool framework | MEDIUM | HIGH | P2 |
| Heartbeat loop | MEDIUM | HIGH | P2 |
| Typing indicators | LOW | LOW | P3 |
| Streaming responses | MEDIUM | MEDIUM | P3 |
| MCP support | MEDIUM | MEDIUM | P3 |
| Multi-turn orchestration | MEDIUM | HIGH | P3 |

**Priority key:**
- P1: Must have for launch (v1.0)
- P2: Should have, add when possible (v1.x)
- P3: Nice to have, future consideration (v2+)


## Competitor Feature Analysis

| Feature | Discord Bots (typical) | Telegram Bots (typical) | YesImBot v3 | v4 Approach |
|---------|------------------------|-------------------------|-------------|-------------|
| Reply mechanism | Command-based or always-on | Command-based | Willingness system | Hybrid (willingness + @mention) |
| Context handling | Per-command or none | Per-command or none | Memory slots | Session-aware slots |
| Tool calling | Custom commands | Custom commands | Decorator framework | Enhanced decorator + MCP |
| Model support | Single provider | Single provider | Multi-provider | Multi-provider + load balancing |
| Personality | Static prompt | Static prompt | File-based | Structured prompt system |
| Proactive behavior | Rare | Rare | None in v3 | Heartbeat loop (v1 scope) |


## Feature Implementation Notes

### Reply Decision Mechanisms

**Observed patterns in ecosystem:**
- Command-based: Traditional, explicit invocation (e.g., `/ask`)
- Always-on: Responds to every message (spammy, unnatural)
- Keyword triggers: Responds to specific words (brittle, limited)
- Probability-based: Random chance per message (unpredictable)
- **Willingness accumulation**: Messages increase "desire to reply" until threshold (v3's approach, most natural)

**Recommendation**: Hybrid willingness system is the differentiator. Keep and enhance.

### Tool Calling Patterns

**Industry standard (2026):**
- OpenAI function calling format (JSON schema)
- Anthropic tool use format (similar)
- MCP (Model Context Protocol) for standardized tools

**Implementation approach:**
- Decorator-based registration (v3 pattern works well)
- Schema validation before execution (prevent bad calls)
- Retry logic for transient failures
- Result formatting for AI consumption

### Context Management

**Common approaches:**
- Fixed window (last N messages)
- Token-based window (fit within model limit)
- Summarization (compress old context)
- Hybrid (recent full + old summarized)

**Recommendation**: Token-based sliding window for v1, summarization in v2.


### Prompt Management

**Patterns observed:**
- Monolithic system prompt (simple but inflexible)
- Template-based (variables + rendering)
- Composable blocks (persona + context + tools)
- Dynamic injection (runtime context awareness)

**Recommendation**: Composable prompt system with template rendering.

### Model Management

**Key requirements:**
- Provider abstraction (OpenAI, Anthropic, local models)
- Capability detection (function calling, vision, streaming)
- Load balancing (round-robin, weighted, health-based)
- Fallback chains (primary fails → secondary)

**v4 approach**: ai-sdk as abstraction layer, provider plugins for each service.


## Domain-Specific Insights

### IM Platform Considerations

**QQ (via OneBot):**
- Rich message formats (CQ codes, images, @mentions)
- Group dynamics (multiple users, fast-paced)
- Rate limiting (platform-enforced)

**Discord:**
- Thread support, reactions, embeds
- Slash commands expected
- Webhook-based responses

**Telegram:**
- Inline keyboards, callback queries
- Bot API limitations
- Group vs supergroup differences

**Koishi abstraction**: Handles platform differences, but bot must be aware of capabilities.

### AI Agent Patterns (2026)

**ReAct (Reasoning + Acting):**
- Think → Act → Observe loop
- Industry standard for tool-using agents
- Requires "inner thoughts" in tool calls

**Function calling evolution:**
- Parallel tool calls (multiple at once)
- Streaming tool calls (results as they complete)
- Tool choice control (force/auto/none)

**Best practices:**
- Limit tool call depth (prevent loops)
- Validate parameters before execution
- Provide clear error messages to AI
- Log tool usage for debugging


## Sources

### Primary Sources

- **YesImBot v3 codebase analysis**: D:/Codespace/koishi-dev/YesWeAreBot/YesImBot-v3/
  - Extension system documentation (packages/core/src/services/extension/README.md)
  - Memory system implementation
  - Tool calling framework with decorators
  - Willingness-based reply decision system

### Domain Knowledge (Training Data)

- **Confidence: HIGH** - AI agent patterns (ReAct, function calling, tool use)
- **Confidence: HIGH** - IM platform bot behaviors (Discord, Telegram, QQ)
- **Confidence: MEDIUM** - MCP (Model Context Protocol) - emerging standard as of 2026
- **Confidence: HIGH** - LLM provider capabilities (OpenAI, Anthropic, local models)

### Limitations

- No web search access during research (permission denied)
- No Brave API access (BRAVE_API_KEY not set)
- Research based on v3 codebase analysis + domain expertise from training data
- MCP adoption status may have evolved since training cutoff (January 2025)

---
*Feature research for: AI Chat Agent Plugin (Koishi)*
*Researched: 2026-02-17*
*Confidence: HIGH (based on v3 codebase + domain knowledge)*
