# Phase 35: Skill-Driven Tool Loading - Research

**Researched:** 2026-02-27
**Domain:** Plugin tool visibility, search backend abstraction, Skill-tool wiring
**Confidence:** HIGH

## Summary

The hidden-tool infrastructure is already fully scaffolded. `FunctionDefinition.hidden?: boolean` exists in `types.ts`, `PluginService.getTools(includeHidden)` already filters on it, and `buildToolSchemaForPrompt()` already reads `effects.toolFilter` from the active Skill to un-hide tools by name. The wiring from Skill → tool visibility is complete end-to-end. Phase 35 is almost entirely about **marking existing tools hidden** and **adding the search tool** — not building new plumbing.

The search tool follows the multi-backend pattern from v3 TTS/code-executor: one abstract interface, one concrete implementation (Tavily), config selects the active backend. The LLM sees a single `search` tool regardless of backend. The tool is registered as `hidden: true` in a new `SearchPlugin` that lives in `core/src/services/plugin/builtin/`. A companion Skill file in `core/resources/skills/` exposes it via `effects.tools.include: [search]`.

The `@Tool` / `@Action` decorators do not currently pass `hidden` through to `FunctionDefinition`. The `base-plugin.ts` constructor copies decorator entries but does not include `hidden`. This means `hidden` must be set either by extending `DecoratorOpts` to include it, or by calling `registerTool()` directly with a full `FunctionDefinition` object. The direct `registerTool()` path is simpler and already used for dynamic registration.

**Primary recommendation:** Add `hidden` to `DecoratorOpts` and `StaticEntry`, propagate it in `base-plugin.ts` constructor — then use `@Tool({ hidden: true })` on all non-send_message builtins. Create `SearchPlugin` with `hidden: true` and a `search` Skill file.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

#### 搜索工具架构

- 统一接口 + 注册机制，参考 v3 的 `plugins/tts/src` 和 `plugins/code-executor/src` 模式
- LLM 只看到一个 `search` 工具，后端通过配置切换
- 配置选定活跃后端，工具参数 schema 动态反映该后端支持的参数
- Phase 35 交付：框架 + tavily 作为首个后端实现，其他后端后续 phase 添加

#### 搜索工具行为

- 参数设计：query 必填 + 可选参数（limit、language 等，由活跃后端决定）
- 结果格式：结构化摘要列表（标题+摘要+URL），token 效率优先
- 错误处理：静默返回空结果（如"未找到相关结果"），LLM 自行决定下一步
- 调用方式：单一 HTTP endpoint，通过 `ctx.http` 调用

#### 工具暴露策略

- 匹配粒度：按工具名精确匹配（Skill 的 `effects.tools.include` 写工具名如 `'search'`）
- 多 Skill 冲突：并集模式 — 只要任一活跃 Skill include 了该工具就保持可见
- 实现机制：hidden 标记切换 — 工具始终注册，Skill 激活时取消 hidden 标记

#### 常驻工具机制

- `hidden: false` = 常驻可见（如 send_message），`hidden: true` = 需 Skill 启用
- 不需要额外 `alwaysVisible` 属性，hidden 默认值本身就区分了常驻与按需
- send_message 天然 `hidden: false`，无需特殊处理

#### 工具列表动态性

- 每次构建 LLM 请求时重新计算当前活跃 Skill 的工具并集
- 对话中途 Skill 变化时无缝切换，下一轮 LLM 调用自动反映新工具列表
- 不逐次通知 LLM 工具变化，但在 system prompt 中说明工具列表是动态的

### Claude's Discretion

- 搜索接口的具体抽象层设计（trait/interface 结构）
- tavily API 的具体调用细节和参数映射
- 工具 hidden 标记的存储位置（工具定义上 vs 独立注册表）
- 结构化摘要列表的具体字段和格式

### Deferred Ideas (OUT OF SCOPE)

- 更多搜索后端实现（brave、zhipu-web-search 等）— 后续 phase 按需添加
- 工具按类别标签批量暴露 — 当前按工具名精确匹配已足够
  </user_constraints>

<phase_requirements>

## Phase Requirements

| ID      | Description                                                                | Research Support                                                                                                   |
| ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| TOOL-01 | 除 `send_message` 外的内置工具默认标记为 `hidden: true`，仅通过 Skill 暴露 | `FunctionDefinition.hidden` exists; `getTools(includeHidden)` already filters; decorator needs `hidden` prop added |
| TOOL-02 | 搜索工具以 Skill 工具形式提供，通过 `ctx.http` 调用可配置搜索 API endpoint | New `SearchPlugin` with `hidden: true`; `ctx.http.get()` pattern confirmed from v3 reference                       |
| TOOL-03 | Skill 的 `effects.tools.include` 能正确取消 hidden 标记，使工具对 LLM 可见 | `buildToolSchemaForPrompt()` already implements this; Skill YAML `effects.tools.include` already parsed by loader  |

</phase_requirements>

## Standard Stack

### Core

| Library           | Version  | Purpose                          | Why Standard                                           |
| ----------------- | -------- | -------------------------------- | ------------------------------------------------------ |
| koishi `ctx.http` | built-in | HTTP calls to search endpoint    | Already used throughout codebase; no new dep needed    |
| Koishi `Schema`   | built-in | Tool parameter schema definition | All tools use this; `schemaToJSONSchema()` converts it |
| gray-matter       | ^4.0.3   | Skill YAML frontmatter parsing   | Already in use by `loader.ts`                          |

### Supporting

| Library    | Version | Purpose | When to Use                    |
| ---------- | ------- | ------- | ------------------------------ |
| (none new) | —       | —       | Zero new dependencies required |

**Installation:** No new packages needed.

## Architecture Patterns

### Recommended Project Structure

New files to create:

```
core/src/services/plugin/builtin/
├── search/
│   ├── index.ts          # SearchPlugin (registers search tool, hidden: true)
│   ├── types.ts          # SearchBackend interface + SearchResult type
│   └── backends/
│       └── tavily.ts     # TavilyBackend implements SearchBackend

core/resources/skills/
└── search/
    └── SKILL.md          # Skill that exposes search tool
```

Modified files:

```
core/src/services/plugin/
├── decorators.ts         # Add hidden?: boolean to DecoratorOpts + StaticEntry
├── base-plugin.ts        # Propagate hidden from StaticEntry to FunctionDefinition
├── builtin/
│   ├── index.ts          # Export SearchPlugin
│   ├── demo.ts           # Add hidden: true to get_weather, web_search
│   ├── session-info.ts   # Add hidden: true to get_session_info
│   └── onebot/index.ts   # Add hidden: true to get_forward_msg
└── service.ts            # Register SearchPlugin in constructor
```

### Pattern 1: hidden flag on decorator

The `@Tool` decorator currently accepts `DecoratorOpts` which does not include `hidden`. The `base-plugin.ts` constructor copies decorator entries into `FunctionDefinition` but omits `hidden`. The fix is minimal:

```typescript
// decorators.ts — add hidden to DecoratorOpts
interface DecoratorOpts {
  name: string;
  description: string;
  parameters: Schema;
  activators?: Activator[];
  hidden?: boolean; // ADD THIS
}

export interface StaticEntry extends DecoratorOpts {
  type: FunctionType;
  methodKey: string;
  // hidden is inherited from DecoratorOpts
}
```

```typescript
// base-plugin.ts — propagate hidden in constructor
this.tools.set(entry.name, {
  name: entry.name,
  description: entry.description,
  type: entry.type,
  parameters: entry.parameters,
  handler: handler.bind(this),
  activators: entry.activators,
  hidden: entry.hidden, // ADD THIS
});
```

Then on each non-send_message builtin:

```typescript
@Tool({
  name: "get_session_info",
  description: "...",
  parameters: withInnerThoughts({}),
  activators: [requireSession()],
  hidden: true,              // ADD THIS
})
```

### Pattern 2: SearchBackend interface (Claude's discretion)

Modeled after v3 TTS `TTSAdapter` pattern — abstract interface, concrete implementations, config selects active backend:

```typescript
// search/types.ts
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchBackend {
  readonly name: string;
  search(query: string, options: SearchOptions): Promise<SearchResult[]>;
  getParameterSchema(): Record<string, Schema>; // backend-specific optional params
}

export interface SearchOptions {
  limit?: number;
  language?: string;
  [key: string]: unknown;
}
```

```typescript
// search/backends/tavily.ts
export interface TavilyConfig {
  endpoint: string;   // e.g. "https://api.tavily.com/search"
  apiKey: string;
  defaultLimit: number;
}

export class TavilyBackend implements SearchBackend {
  readonly name = "tavily";

  constructor(private ctx: Context, private config: TavilyConfig)

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    try {
      const response = await this.ctx.http.post(this.config.endpoint, {
        api_key: this.config.apiKey,
        query,
        max_results: options.limit ?? this.config.defaultLimit,
      });
      return (response.results ?? []).map((r: Record<string, string>) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.content ?? "",
      }));
    } catch {
      return [];  // silent degradation per user decision
    }
  }

  getParameterSchema(): Record<string, Schema> {
    return {
      limit: Schema.number().default(5).description("Number of results to return"),
    };
  }
}
```

### Pattern 3: SearchPlugin registration

```typescript
// search/index.ts
@Metadata({ name: "search", description: "Web search tool", builtin: true })
export class SearchPlugin extends Plugin {
  constructor(
    private ctx: Context,
    config: SearchPluginConfig,
  ) {
    super();
    const backend = createBackend(ctx, config); // factory based on config.provider
    this.registerTool({
      name: "search",
      description: "Search the web for information. Returns a list of relevant results.",
      type: FunctionType.Tool,
      hidden: true,
      parameters: withInnerThoughts({
        query: Schema.string().required().description("Search query"),
        ...backend.getParameterSchema(),
      }),
      handler: async (params, _ctx) => {
        const results = await backend.search(String(params["query"] ?? ""), {
          limit: params["limit"] as number | undefined,
        });
        if (!results.length) return Success("No results found.");
        const formatted = results
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
          .join("\n\n");
        return Success(formatted);
      },
    });
  }
}
```

Note: `registerTool()` already accepts a full `FunctionDefinition` including `hidden`, so no decorator needed here.

### Pattern 4: Search Skill YAML

```yaml
# core/resources/skills/search/SKILL.md
---
name: search
description: Enables web search when user asks about current events or needs information lookup
lifecycle: sticky
stickyTimeout: 2
effects:
  tools:
    include:
      - search
---
当用户询问需要查找最新信息、新闻、事实核查或网络内容时，使用搜索工具获取相关信息。
```

### Anti-Patterns to Avoid

- **Storing hidden state outside FunctionDefinition:** The user decision is "hidden flag on tool definition" — don't build a separate registry or Map for visibility state.
- **Modifying getTools() to accept a toolFilter:** The current design correctly separates concerns — `getTools(includeHidden)` is a low-level primitive; `buildToolSchemaForPrompt()` applies the Skill filter on top. Don't collapse these.
- **Registering SearchPlugin outside PluginService constructor:** All builtins are registered in `PluginService` constructor. SearchPlugin should follow the same pattern.
- **Dynamic schema per-request:** The tool parameter schema is fixed at registration time. The backend's `getParameterSchema()` is called once during `SearchPlugin` construction, not per LLM call.

## Don't Hand-Roll

| Problem                | Don't Build             | Use Instead                            | Why                                                                |
| ---------------------- | ----------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| HTTP to Tavily         | Custom fetch wrapper    | `ctx.http.post()`                      | Already available, handles timeouts, consistent with codebase      |
| Tool visibility toggle | Separate visibility Map | `hidden` flag on `FunctionDefinition`  | Already in types.ts; getTools() already reads it                   |
| Skill-tool wiring      | New merge logic         | Existing `buildToolSchemaForPrompt()`  | Already handles include/exclude union logic                        |
| Result truncation      | Custom truncation       | Existing `maxToolResultLength` in loop | Loop already truncates tool results to `maxToolResultLength` chars |

**Key insight:** The entire hidden-tool pipeline already exists. The work is configuration (marking things hidden) and adding one new tool.

## Common Pitfalls

### Pitfall 1: Decorator hidden not propagated

**What goes wrong:** `@Tool({ hidden: true })` is set but tool still appears — because `base-plugin.ts` constructor doesn't copy `hidden` from `StaticEntry` to `FunctionDefinition`.
**Why it happens:** `hidden` is not in `DecoratorOpts` or `StaticEntry` today; the constructor only copies known fields.
**How to avoid:** Add `hidden?: boolean` to `DecoratorOpts` and `StaticEntry`, then add `hidden: entry.hidden` in the constructor copy.
**Warning signs:** `get_session_info` appears in tool list without any active Skill.

### Pitfall 2: send_message accidentally hidden

**What goes wrong:** `send_message` gets `hidden: true` and the LLM can no longer send messages.
**Why it happens:** Bulk-adding `hidden: true` to all tools in CorePlugin.
**How to avoid:** `send_message` is an `@Action`, not `@Tool`. Only add `hidden: true` to non-send_message tools. Verify by checking `getTools()` output with no active Skills — `send_message` must appear.
**Warning signs:** LLM loop produces no output messages.

### Pitfall 3: DemoPlugin tools not hidden

**What goes wrong:** `get_weather` and `web_search` from DemoPlugin remain visible without a Skill.
**Why it happens:** DemoPlugin is registered in `PluginService` constructor and its tools default to `hidden: undefined` (falsy = visible).
**How to avoid:** Add `hidden: true` to both `@Tool` decorators in `demo.ts`.
**Warning signs:** Tool list in no-Skill channel contains `get_weather`.

### Pitfall 4: SearchPlugin config not wired into PluginServiceConfig

**What goes wrong:** SearchPlugin is registered but has no config — Tavily API key is undefined.
**Why it happens:** `PluginService` constructor passes no config to `SearchPlugin`.
**How to avoid:** Add `search?: SearchPluginConfig` to `PluginServiceConfig` and `PluginServiceConfigSchema`. Pass it when constructing `SearchPlugin`.
**Warning signs:** All search calls return empty results silently (which is the correct degradation, but the root cause is missing config).

### Pitfall 5: Tavily endpoint vs generic HTTP search endpoint

**What goes wrong:** Tavily uses a POST body with `api_key`, not a GET query string like the v3 SearXNG endpoint.
**Why it happens:** Copying v3's `ctx.http.get(url + "?q=...")` pattern directly.
**How to avoid:** Tavily API is a POST to `https://api.tavily.com/search` with JSON body `{ api_key, query, max_results }`. Use `ctx.http.post()`.
**Warning signs:** 401 or 422 HTTP errors from Tavily.

## Code Examples

### Current buildToolSchemaForPrompt (already correct)

```typescript
// Source: core/src/services/agent/tools.ts
export function buildToolSchemaForPrompt(
  pluginService: PluginService,
  toolCtx: ToolExecutionContext,
  toolFilter?: ToolFilter,
): string {
  let entries = pluginService.getTools(toolCtx); // hidden=false by default
  if (toolFilter?.include?.length) {
    const all = pluginService.getTools(toolCtx, true); // includeHidden=true
    const hidden = all.filter(
      (e) =>
        !entries.some((v) => v.function.name === e.function.name) &&
        toolFilter.include!.includes(e.function.name),
    );
    entries = entries.concat(hidden); // union: visible + skill-included hidden
  }
  // ...
}
```

This is already correct. No changes needed here.

### PluginService.getTools (already correct)

```typescript
// Source: core/src/services/plugin/service.ts
getTools(execCtx?: ToolExecutionContext, includeHidden = false) {
  for (const fn of plugin.getFunctions().values()) {
    if (fn.hidden && !includeHidden) continue;   // already filters hidden
    // ...
  }
}
```

### Skill YAML effects.tools (already parsed)

```typescript
// Source: core/src/services/skill/loader.ts
const effects: SkillDefinition["effects"] = {
  prompt: content || undefined,
  style: rawEffects?.style as StyleEffect | undefined,
  tools: rawEffects?.tools as ToolFilter | undefined, // already reads tools from YAML
};
```

### SkillRegistry.mergeEffects (already correct union logic)

```typescript
// Source: core/src/services/skill/service.ts
if (skill.effects.tools) {
  if (skill.effects.tools.include) {
    result.toolFilter.include.push(...skill.effects.tools.include); // union across skills
  }
}
```

### ctx.http usage pattern (from v3 reference)

```typescript
// v3 reference: search/index.ts
const response = await this.ctx.http.get(searchUrl, {
  headers: { "User-Agent": "..." },
  responseType: "json",
  timeout: this.config.httpTimeout,
});
```

For Tavily (POST):

```typescript
const response = await this.ctx.http.post(endpoint, {
  api_key: apiKey,
  query,
  max_results: limit,
});
```

## State of the Art

| Old Approach             | Current Approach                    | When Changed   | Impact                                   |
| ------------------------ | ----------------------------------- | -------------- | ---------------------------------------- |
| All tools always visible | hidden flag + Skill-driven exposure | Phase 35 (now) | LLM only sees relevant tools per context |
| No search tool           | search tool via Skill               | Phase 35 (now) | LLM can search web when Skill activates  |

## Open Questions

1. **Tavily vs generic HTTP search endpoint**
   - What we know: CONTEXT.md says "ctx.http 调用可配置搜索 API endpoint" — generic endpoint, not Tavily-specific
   - What's unclear: Is the backend abstraction needed if Phase 35 only delivers Tavily? Or is a simpler single-backend implementation acceptable?
   - Recommendation: Build the `SearchBackend` interface anyway (it's ~20 lines) so Phase 36+ can add backends without touching SearchPlugin. The interface cost is minimal.

2. **SearchPlugin config location**
   - What we know: `PluginServiceConfig` currently only has `defaultTimeout`
   - What's unclear: Should search config live in `PluginServiceConfig.search` or be a top-level config in the core plugin's Schema?
   - Recommendation: Add `search?: SearchPluginConfig` to `PluginServiceConfig` — consistent with how other plugin configs are nested.

3. **DemoPlugin fate**
   - What we know: DemoPlugin has `get_weather` and `web_search` (stub) tools; it's registered in PluginService constructor
   - What's unclear: Should DemoPlugin be removed entirely now that a real search tool exists, or just hidden?
   - Recommendation: Mark both DemoPlugin tools `hidden: true` for now. Removal is a separate cleanup task.

## Sources

### Primary (HIGH confidence)

- Direct codebase inspection — `core/src/services/plugin/types.ts`, `service.ts`, `base-plugin.ts`, `decorators.ts`, `agent/tools.ts`, `skill/service.ts`, `skill/loader.ts`
- v3 reference — `references/YesImBot-v3/plugins/tts/src/` (multi-backend pattern), `references/YesImBot-v3/packages/core/src/services/extension/builtin/search/index.ts` (ctx.http search pattern)

### Secondary (MEDIUM confidence)

- Tavily API shape (POST body with api_key, query, max_results) — based on training knowledge; verify against Tavily docs before implementation

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all libraries already in use, no new deps
- Architecture: HIGH — hidden flag infrastructure confirmed in codebase; multi-backend pattern confirmed in v3 reference
- Pitfalls: HIGH — identified from direct code inspection of decorator/base-plugin gap

**Research date:** 2026-02-27
**Valid until:** 2026-03-29 (stable codebase, 30-day window)
