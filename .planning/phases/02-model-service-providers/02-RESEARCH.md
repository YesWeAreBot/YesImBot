# Phase 2: Model Service & Providers - Research

**Researched:** 2026-02-18
**Domain:** LLM provider integration, Koishi service architecture, ai-sdk abstraction
**Confidence:** HIGH

## Summary

Phase 2 implements a dual-layer architecture: ModelService as a Koishi service providing both wrapped calls (with fallback/queue/monitoring) and meta calls (direct LanguageModel access). Providers are independent Koishi plugins that register via service injection, supporting multiple instances with user-defined names.

The ai-sdk (Vercel AI SDK) provides the unified abstraction layer with LanguageModel interface, standardized error types, and built-in retry mechanisms. DeepSeek API is OpenAI-compatible, allowing reuse of OpenAI provider patterns. Koishi's plugin lifecycle and service injection handle registration/disposal automatically.

**Primary recommendation:** Use ai-sdk's createOpenAI factory pattern for both OpenAI and DeepSeek providers (DeepSeek uses custom baseURL). ModelService should expose both `call()` wrapper methods and `getModel()` meta methods, letting consumers choose their abstraction level.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Provider 注册机制:** 每个 provider 是独立的 Koishi 插件包，通过 Koishi Service 机制注入 ModelService
- **多实例支持:** 允许同一种 provider 注册多个实例（如两个不同 API key 的 OpenAI provider），用户在插件配置中自定义每个实例的名称
- **模型列表管理:** Provider 注册时声明支持的模型列表，模型列表可在运行时动态更新
- **生命周期管理:** 注册/注销跟随 Koishi 插件生命周期自动管理
- **延迟验证:** API 连通性延迟到首次调用时验证，注册时只检查配置格式
- **无事件通知:** 其他服务按需查询 ModelService 当前可用 provider 列表，无需事件通知
- **显式路由:** 调用方显式指定 provider 实例名 + 模型名（如 `modelService.call("openai-main", "gpt-4o", ...)`）
- **默认模型:** 支持默认模型概念，配置中指定默认 provider+模型组合
- **Fallback 链:** 当指定 provider 不可用时支持自动 fallback，fallback 链由用户在核心插件中配置
- **双层调用模式:**
  - **包装调用:** ModelService 提供封装方法，同时支持 streaming 和非 streaming，内置 auto fallback、请求队列、usage 监控
  - **元调用:** 调用方通过 ModelService 获取 ai-sdk 的 LanguageModel 对象 + 默认参数，自行使用 ai-sdk 的 generateText/streamText 方法调用
- **Provider 职责:** Provider 创建 LanguageModel 时已注入 API key、base URL 等连接信息，调用方拿到即用
- **默认参数:** 默认参数（temperature、topP 等）由 Provider 设置，调用方可覆盖
- **能力声明:** Provider 注册时声明每个模型的能力标签（tool calling、vision、JSON mode 等），调用方可查询
- **错误统一:** Provider 将不同 API 的错误统一为标准错误类型抛出
- **Token 追踪:** Token 用量追踪由调用方自行从 ai-sdk 返回值中获取（元调用模式），包装调用模式下由 ModelService 内置 usage 监控
- **配置体验:** 每个 provider 插件在 Koishi 控制台有独立配置页，配置项包括实例名称、API key、base URL、模型列表
- **模型列表配置:** 模型列表支持手动填写覆盖 + 可选自动发现开关
- **多实例配置:** 多实例通过配置中的实例名字段区分（非 Koishi 多实例机制）
- **Fallback 配置:** Fallback 链在核心插件中统一配置（跨 provider 编排逻辑）

### Claude's Discretion
- 统一错误类型的具体定义（错误码、错误分类）
- 请求队列的具体实现策略（并发限制、优先级等）
- 模型能力标签的具体枚举值
- 自动发现模型列表的实现方式

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MODEL-01 | Provider 插件可向核心 ModelService 注册模型，支持独立配置 | Koishi service injection mechanism + plugin lifecycle management enable automatic registration/disposal |
| MODEL-02 | OpenAI Provider 插件实现，可通过 ai-sdk 调用 OpenAI 兼容 API | ai-sdk's createOpenAI factory + LanguageModel interface provide standardized OpenAI integration |
| MODEL-03 | DeepSeek Provider 插件实现，可通过 ai-sdk 调用 DeepSeek API | DeepSeek API is OpenAI-compatible, use createOpenAI with custom baseURL |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ai | ^4.1+ | AI SDK Core - generateText/streamText/generateObject | Unified API across 25+ providers, standardized error handling, built-in retry |
| @ai-sdk/openai | ^3.0+ | OpenAI provider factory (createOpenAI) | Official ai-sdk provider, supports custom baseURL for OpenAI-compatible APIs |
| @ai-sdk/provider | ^3.0+ | LanguageModel interface types | Type-only dependency for defining custom providers |
| koishi | ^4.x | Plugin framework and service injection | Project's chosen platform, provides lifecycle and DI |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | ^3.x | Schema validation for tool calling | Optional peer dependency, only if using structured outputs |
| p-queue | ^8.x | Request queue with concurrency control | For implementing ModelService request queue |
| p-retry | ^6.x | Retry with exponential backoff | For custom retry logic beyond ai-sdk built-in |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ai-sdk | Direct API clients (openai, anthropic packages) | Lose unified interface, must handle each provider's quirks manually |
| createOpenAI | Custom LanguageModel implementation | More control but must implement retry/streaming/error handling from scratch |
| Koishi service | Singleton pattern | Lose automatic lifecycle management and plugin isolation |

**Installation:**
```bash
# In shared-model package (types only)
pnpm add -D @ai-sdk/provider

# In provider plugins
pnpm add ai @ai-sdk/openai

# In core plugin (for ModelService)
pnpm add ai p-queue
```


## Architecture Patterns

### Recommended Project Structure
```
packages/
├── shared-model/              # Shared types
│   └── src/
│       ├── model-service.ts   # ModelService interface + types
│       ├── provider.ts        # Provider registration types
│       └── errors.ts          # Unified error types
├── core/                      # Core plugin with ModelService
│   └── src/
│       ├── services/
│       │   └── model-service.ts  # ModelService implementation
│       └── index.ts
└── provider-openai/           # OpenAI provider plugin
    └── src/
        ├── provider.ts        # Provider implementation
        └── index.ts           # Koishi plugin entry
```

### Pattern 1: Koishi Service Registration
**What:** ModelService as a Koishi service that providers inject into
**When to use:** Core plugin provides ModelService, provider plugins consume it
**Example:**
```typescript
// Core plugin - provide ModelService
export const name = 'yesimbot-core';
export function apply(ctx: Context) {
  ctx.provide('modelService', new ModelService(ctx));
}

// Provider plugin - inject ModelService
export const name = 'yesimbot-provider-openai';
export const inject = ['modelService'];
export function apply(ctx: Context, config: Config) {
  const provider = new OpenAIProvider(config);
  ctx.modelService.registerProvider(config.instanceName, provider);
  
  ctx.on('dispose', () => {
    ctx.modelService.unregisterProvider(config.instanceName);
  });
}
```

### Pattern 2: Provider Registration with LanguageModel Factory
**What:** Provider exposes a factory function that returns ai-sdk LanguageModel + metadata
**When to use:** Every provider plugin implementation
**Example:**
```typescript
// Provider interface
interface Provider {
  instanceName: string;
  models: ModelInfo[];
  getModel(modelId: string): LanguageModel;
  getDefaultParams(modelId: string): Partial<GenerateTextParams>;
}

// OpenAI provider implementation
class OpenAIProvider implements Provider {
  private client: ReturnType<typeof createOpenAI>;
  
  constructor(config: OpenAIConfig) {
    this.client = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }
  
  getModel(modelId: string): LanguageModel {
    return this.client(modelId);
  }
  
  getDefaultParams(modelId: string) {
    return { temperature: 0.7, maxTokens: 2000 };
  }
}
```

### Pattern 3: Dual-Layer Call Interface
**What:** ModelService exposes both wrapped calls and meta calls
**When to use:** Wrapped for simple use cases, meta for advanced control
**Example:**
```typescript
class ModelService {
  // Wrapped call - handles fallback, queue, monitoring
  async call(
    providerName: string,
    modelId: string,
    params: CallParams
  ): Promise<CallResult> {
    return this.queue.add(async () => {
      try {
        const provider = this.getProvider(providerName);
        const model = provider.getModel(modelId);
        const result = await generateText({ model, ...params });
        this.trackUsage(providerName, modelId, result.usage);
        return result;
      } catch (error) {
        return this.handleFallback(providerName, modelId, params, error);
      }
    });
  }
  
  // Meta call - returns LanguageModel for direct use
  getModel(providerName: string, modelId: string): {
    model: LanguageModel;
    defaultParams: Partial<GenerateTextParams>;
  } {
    const provider = this.getProvider(providerName);
    return {
      model: provider.getModel(modelId),
      defaultParams: provider.getDefaultParams(modelId),
    };
  }
}
```

### Pattern 4: Fallback Chain Execution
**What:** Try providers in sequence until one succeeds
**When to use:** Wrapped call mode with configured fallback chain
**Example:**
```typescript
// Core plugin config
interface CoreConfig {
  fallbackChains: {
    [key: string]: Array<{ provider: string; model: string }>;
  };
}

// Fallback execution
async handleFallback(
  primaryProvider: string,
  primaryModel: string,
  params: CallParams,
  error: Error
): Promise<CallResult> {
  const chain = this.config.fallbackChains[`${primaryProvider}:${primaryModel}`];
  if (!chain) throw error;
  
  for (const { provider, model } of chain) {
    try {
      const fallbackProvider = this.getProvider(provider);
      const fallbackModel = fallbackProvider.getModel(model);
      return await generateText({ model: fallbackModel, ...params });
    } catch (fallbackError) {
      continue; // Try next in chain
    }
  }
  throw error; // All fallbacks failed
}
```

### Anti-Patterns to Avoid
- **Global provider registry:** Use Koishi service injection, not global singletons
- **Eager API validation:** Validate on first call, not during registration (user decision)
- **Event-driven provider updates:** Use pull-based queries, not push notifications (user decision)
- **Hardcoded model lists:** Allow runtime updates and user overrides


## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LLM API abstraction | Custom wrapper for each provider | ai-sdk LanguageModel | Handles streaming, retries, error normalization, tool calling across 25+ providers |
| Request retry logic | Custom exponential backoff | ai-sdk built-in retry + maxRetries param | Handles transient failures, rate limits, proper backoff timing |
| Streaming response handling | Manual SSE parsing | ai-sdk streamText | Handles chunking, error recovery, partial JSON parsing |
| Request queue | Custom queue with concurrency | p-queue library | Battle-tested concurrency control, priority support, timeout handling |
| Provider lifecycle | Manual register/unregister tracking | Koishi ctx.on('dispose') | Automatic cleanup, prevents memory leaks, follows framework patterns |

**Key insight:** LLM integration has many edge cases (streaming errors, rate limits, partial responses, token counting). ai-sdk has solved these problems across multiple providers. Custom solutions will miss edge cases and require ongoing maintenance.

## Common Pitfalls

### Pitfall 1: Forgetting Disposal Cleanup
**What goes wrong:** Provider registers with ModelService but doesn't unregister on plugin disable, causing memory leaks and stale provider references
**Why it happens:** Koishi's automatic disposal only covers built-in APIs (commands, middleware), not custom service registrations
**How to avoid:** Always use ctx.on('dispose') to unregister providers
**Warning signs:** Multiple instances of same provider after reload, memory usage growing over time

### Pitfall 2: Eager API Validation During Registration
**What goes wrong:** Provider tries to validate API connectivity during plugin load, causing startup failures when API is temporarily unavailable
**Why it happens:** Desire to fail fast and provide immediate feedback
**How to avoid:** Only validate configuration format during registration, defer API calls to first use
**Warning signs:** Plugin fails to load due to network issues, slow startup times

### Pitfall 3: Assuming Single Provider Instance
**What goes wrong:** Code assumes only one OpenAI provider exists, breaks when user configures multiple instances
**Why it happens:** Not considering multi-instance use case in design
**How to avoid:** Always use instance names as keys, never assume provider type uniqueness
**Warning signs:** Second instance overwrites first, configuration conflicts

### Pitfall 4: Ignoring ai-sdk Error Types
**What goes wrong:** Catching all errors as generic Error, missing retry opportunities for transient failures
**Why it happens:** Not aware of ai-sdk's error hierarchy (AI_APICallError, AI_RetryError, etc.)
**How to avoid:** Check error types and handle retryable errors differently from permanent failures
**Warning signs:** Fallback triggers on every error, no distinction between rate limits and auth failures

### Pitfall 5: Hardcoding Model Capabilities
**What goes wrong:** Code assumes all models support tool calling or vision, breaks with models that don't
**Why it happens:** Testing only with capable models like GPT-4
**How to avoid:** Declare capabilities per model, check before using features
**Warning signs:** Cryptic API errors about unsupported features, silent feature degradation


## Code Examples

Verified patterns from official sources:

### Creating OpenAI Provider with Custom BaseURL
```typescript
// Source: https://ai-sdk.dev (WebSearch 2026-02-18)
import { createOpenAI } from '@ai-sdk/openai';

// OpenAI provider
const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'https://api.openai.com/v1', // default
});

// DeepSeek provider (OpenAI-compatible)
const deepseek = createOpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com/v1',
});

const model = openai('gpt-4o');
```

### Koishi Plugin with Service Injection
```typescript
// Source: https://koishi.chat (WebSearch 2026-02-18)
import { Context, Schema } from 'koishi';

export const name = 'yesimbot-provider-openai';
export const inject = ['modelService']; // Declare dependency

export interface Config {
  instanceName: string;
  apiKey: string;
  baseURL?: string;
}

export const Config: Schema<Config> = Schema.object({
  instanceName: Schema.string().required(),
  apiKey: Schema.string().role('secret').required(),
  baseURL: Schema.string().default('https://api.openai.com/v1'),
});

export function apply(ctx: Context, config: Config) {
  const provider = createProvider(config);
  ctx.modelService.registerProvider(config.instanceName, provider);
  
  // Cleanup on disposal
  ctx.on('dispose', () => {
    ctx.modelService.unregisterProvider(config.instanceName);
  });
}
```

### Using generateText with Error Handling
```typescript
// Source: https://ai-sdk.dev (WebSearch 2026-02-18)
import { generateText } from 'ai';

try {
  const { text, usage } = await generateText({
    model: openai('gpt-4o'),
    prompt: 'Hello',
    maxRetries: 3, // Built-in retry
  });
  
  console.log(text);
  console.log(usage); // { promptTokens, completionTokens, totalTokens }
} catch (error) {
  if (error.name === 'AI_APICallError') {
    // API-level error (network, auth, etc.)
  } else if (error.name === 'AI_RetryError') {
    // Retry exhausted
  }
}
```

### Streaming with streamText
```typescript
// Source: https://ai-sdk.dev (WebSearch 2026-02-18)
import { streamText } from 'ai';

const result = await streamText({
  model: openai('gpt-4o'),
  prompt: 'Write a story',
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}

// Access usage after stream completes
const usage = await result.usage;
```


## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Provider-specific SDKs | Unified ai-sdk abstraction | 2024-2025 | Single API for 25+ providers, easier switching |
| Manual retry logic | Built-in maxRetries + exponential backoff | ai-sdk v3+ | Automatic transient failure handling |
| Custom streaming parsers | ai-sdk streamText/streamObject | ai-sdk v3+ | Handles SSE edge cases, partial JSON |
| Global configuration | Factory pattern (createOpenAI) | ai-sdk v3+ | Multiple instances with different configs |
| Tool calling per provider | Unified tool schema | ai-sdk v4+ | Same tool definition works across providers |

**Deprecated/outdated:**
- Direct use of openai package for abstraction layer (use ai-sdk instead)
- xsai library (project replaced with ai-sdk per Phase 1 decision)
- Event-driven service updates (pull-based queries preferred in Koishi ecosystem)


## Open Questions

1. **Model Capability Enumeration**
   - What we know: ai-sdk models support tool calling, vision, JSON mode
   - What's unclear: Standard way to query capabilities from LanguageModel object
   - Recommendation: Define capability enum in shared-model, providers declare manually

2. **Request Queue Strategy**
   - What we know: p-queue provides concurrency control
   - What's unclear: Default concurrency limits, priority levels needed
   - Recommendation: Start with concurrency=5, no priority (can add later)

3. **Error Type Taxonomy**
   - What we know: ai-sdk has AI_APICallError, AI_RetryError, AI_JSONParseError
   - What's unclear: How to categorize for fallback decisions (retryable vs permanent)
   - Recommendation: Define ErrorCategory enum (TRANSIENT, AUTH, RATE_LIMIT, PERMANENT)

4. **Model Auto-Discovery**
   - What we know: OpenAI has /v1/models endpoint
   - What's unclear: Whether to implement auto-discovery in v1
   - Recommendation: Manual list only for v1, add auto-discovery as enhancement


## Sources

### Primary (HIGH confidence)
- [Koishi Service Injection Documentation](https://koishi.chat) - Service injection mechanism, plugin lifecycle
- [ai-sdk Official Documentation](https://ai-sdk.dev) - LanguageModel interface, generateText/streamText APIs
- [Vercel AI SDK Blog](https://vercel.com) - AI SDK v4.1+ features, provider support

### Secondary (MEDIUM confidence)
- [ai-sdk OpenAI Provider](https://ai-sdk.dev) - createOpenAI factory pattern, custom baseURL support
- [DeepSeek API Documentation](https://deepseek.com) - OpenAI compatibility, endpoint URLs
- [Koishi Plugin Lifecycle](https://koishi.chat) - ctx.on('dispose') cleanup patterns

### Tertiary (LOW confidence)
- WebSearch results on Koishi multi-instance patterns - No official documentation found, inferred from DI patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - ai-sdk and Koishi are well-documented, widely used
- Architecture: HIGH - Patterns verified from official sources and user decisions
- Pitfalls: MEDIUM - Based on common DI/plugin patterns, not phase-specific experience

**Research date:** 2026-02-18
**Valid until:** 2026-03-20 (30 days - stable ecosystem)

**Key findings:**
1. ai-sdk provides unified abstraction with LanguageModel interface
2. DeepSeek is OpenAI-compatible, use createOpenAI with custom baseURL
3. Koishi service injection + ctx.on('dispose') handles lifecycle automatically
4. Dual-layer API (wrapped vs meta) gives flexibility without complexity
5. Built-in retry and error types reduce custom error handling code

**Research completeness:**
- Core technology (ai-sdk): ✓ Verified
- Provider patterns: ✓ Verified
- Koishi integration: ✓ Verified
- Error handling: ✓ Verified
- Streaming: ✓ Verified
- Multi-instance support: ⚠ Inferred from DI patterns (no explicit Koishi docs)

