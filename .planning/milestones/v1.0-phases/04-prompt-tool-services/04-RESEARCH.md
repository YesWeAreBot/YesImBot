# Phase 4: Prompt & Tool Services - Research

**Researched:** 2026-02-18
**Domain:** Mustache template rendering + Koishi plugin-based tool registration/dispatch
**Confidence:** HIGH — primary source is the verified dev version codebase

## Summary

Phase 4 builds two Koishi services: `PromptService` and `PluginService`. Both have working reference implementations in `YesImBot-dev/packages/core/src/services/prompt/` and `services/plugin/`. The v4 task is a focused port with simplifications — not a greenfield design.

`PromptService` manages Mustache template rendering with a Snippet (dynamic data provider) + Injection (plugin-contributed rule fragments) mechanism. It renders the system prompt consumed by AgentCore's heartbeat loop. `PluginService` manages tool/action registration via a `Plugin` base class, dispatches invocations with Schema validation, and exposes a `getTools()` method that AgentCore calls to build the tool list for each LLM call.

The key architectural insight from the dev version: `PluginService` maintains `plugins: Map<string, Plugin>` and traverses them on lookup — each `Plugin` owns its own tools/actions. This is cleaner than a flat global tool registry. The `Tool` vs `Action` distinction (Tool = info-fetching, triggers next heartbeat; Action = side-effect, silent on success) is already validated in production.

**Primary recommendation:** Port dev version directly, stripping features not needed in v4 (no command registration, no activators/support guards in v1, no schema dynamic fields). Keep the core data flow intact.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- Template engine: Mustache (v3, already validated)
- Storage: built-in default templates + config override (config > built-in priority)
- Template granularity: fragment composition — persona, rules, memory as independent fragments, fixed-order concatenation into system prompt
- Plugin prompt injection: plugins register rule fragments via PromptService API (name + priority), inserted into rules region
- Hybrid prompt layout confirmed (HORIZON-DESIGN.md): [system] persona+rules+memory → [user] Horizon view → [assistant/tool] standard multi-turn
- Reference impl: dev `services/prompt/` — PromptService + MustacheRenderer + Snippet/Injection mechanism
- Naming: ToolService renamed to PluginService, as future framework extension point
- Registration style: Decorator-first (`@Tool()` / `@Action()`), functional fallback (`defineTool()` / `defineAction()`)
- Schema validation: Koishi Schema for parameters, auto-converted to JSON Schema for LLM
- Namespacing: tools grouped by plugin, PluginService maintains group info
- LLM format conversion: PluginService auto-converts to ai-sdk tool format on `getTools()`
- Runtime context injection: tools needing session/view/percept receive via `FunctionContext`
- Reference impl: dev `services/plugin/` — decorators + types + base-plugin + service
- Tool = info-fetching, returns result to LLM for next loop iteration
- Action = side-effect, silent on success, error returned to LLM on failure
- Timeout: global default + per-tool override
- No permission tiers — all tools equal
- Error handling: error message returned to agent, agent decides next step
- Result format: structured object, PluginService serializes for LLM
- Async handler: unified async, future async tools return `{ taskId }` without interface change
- Built-in tools: `send_message` (core package), `get_session_info` (standalone plugin demo)

### Claude's Discretion

- Mustache renderer implementation details (reference dev MustacheRenderer)
- Global default timeout value
- PluginService internal grouping data structure
- `get_session_info` returned fields

### Deferred Ideas (OUT OF SCOPE)

- Async task system (submit_task / get_task_status / get_task_result) — future version
- Tool permission tiers (safe/dangerous marking) — add later if needed
- Slot mechanism replacing fixed-order concatenation — consider if fixed order proves insufficient
  </user_constraints>

<phase_requirements>

## Phase Requirements

| ID        | Description                                                  | Research Support                                                                            |
| --------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| PROMPT-01 | 基础提示词配置 — 人设/性格配置，系统提示词模板加载与渲染     | PromptService with Snippet/Injection mechanism; MustacheRenderer; template registration API |
| TOOL-01   | 工具注册与执行 — 注册工具、Schema 验证、执行调度、结果返回   | PluginService.register/invoke; Koishi Schema → JSON Schema conversion; ToolResult type      |
| TOOL-02   | 可扩展工具框架 — 装饰器注册模式，Agent loop 中的工具调用集成 | @Tool/@Action decorators; Plugin base class; PluginService.getTools() for AgentCore         |

</phase_requirements>

## Standard Stack

### Core

| Library  | Version | Purpose                     | Why Standard                                   |
| -------- | ------- | --------------------------- | ---------------------------------------------- |
| mustache | ^4.2.0  | Mustache template rendering | Validated in dev version; lightweight, no deps |
| koishi   | ^4.18.x | Schema, Service base class  | Project constraint                             |

### Supporting

| Library             | Version                | Purpose                                        | When to Use                                      |
| ------------------- | ---------------------- | ---------------------------------------------- | ------------------------------------------------ |
| json-schema (types) | via @types/json-schema | JSONSchema4 type for schemaToJSONSchema output | When converting Koishi Schema to LLM tool format |

**Installation:**

```bash
yarn workspace @yesimbot/core add mustache
yarn workspace @yesimbot/core add -D @types/mustache
```

Note: mustache may already be present from dev version. Verify before adding.

## Architecture Patterns

### Recommended Project Structure

```
plugins/core/src/services/
├── prompt/
│   ├── types.ts          # Snippet, Injection, IRenderer, RenderOptions interfaces
│   ├── renderer.ts       # MustacheRenderer implements IRenderer
│   ├── service.ts        # PromptService extends Service<Config>
│   └── index.ts          # re-exports
├── plugin/
│   ├── types.ts          # ToolDefinition, ActionDefinition, FunctionContext, ToolResult
│   ├── decorators.ts     # @Tool, @Action, @Metadata, defineTool, defineAction, withInnerThoughts
│   ├── base-plugin.ts    # Plugin abstract base class
│   ├── service.ts        # PluginService extends Service<Config>
│   ├── utils.ts          # Success(), Failed() helpers
│   └── index.ts          # re-exports
└── plugin/builtin/
    ├── send-message.ts   # send_message Action (core built-in)
    └── index.ts          # registers built-in plugin
```

### Pattern 1: PromptService — Snippet + Injection

**What:** Two-layer dynamic data system. Snippets provide named data values into the render scope (e.g. `bot`, `time.now`). Injections are plugin-contributed text fragments inserted at a fixed placeholder in the template.

**When to use:** Snippets for structured data (objects, dates). Injections for freeform text blocks contributed by external plugins.

```typescript
// Source: YesImBot-dev/packages/core/src/services/prompt/service.ts
export type Snippet = (currentScope: Record<string, any>) => any | Promise<any>;

export interface Injection {
  name: string; // unique name for dedup/debug
  priority: number; // lower = rendered first
  renderFn: Snippet;
}

// Registration
promptService.registerSnippet("bot", async (scope) => ({
  id: scope.session?.bot.selfId,
  name: scope.session?.bot.user.name,
}));

promptService.inject("my-plugin.rules", 10, async (scope) => {
  return "Rule: always respond in character.";
});

// Render
const systemPrompt = await promptService.render("system", { session, personality });
```

### Pattern 2: PluginService — Plugin base class + decorator registration

**What:** Each `Plugin` subclass owns its tools/actions. `PluginService` maintains `plugins: Map<string, Plugin>` and traverses on lookup. Decorators collect definitions at class prototype level; base class constructor reads them.

```typescript
// Source: YesImBot-dev/packages/core/src/services/plugin/decorators.ts
@Metadata({ name: "core", description: "Core tools", builtin: true })
class CorePlugin extends Plugin {
  @Action({
    name: "send_message",
    description: "Send a message to the current session",
    parameters: withInnerThoughts({
      content: Schema.string().required().description("Message content"),
    }),
  })
  async sendMessage(params: { content: string; inner_thoughts: string }, ctx: FunctionContext) {
    // execute and return Success() or Failed()
    return Success();
  }
}
```

### Pattern 3: Koishi Schema → JSON Schema conversion

**What:** `schemaToJSONSchema()` utility recursively converts Koishi Schema to JSONSchema4. Required for passing tool definitions to LLM.

```typescript
// Source: YesImBot-dev/packages/core/src/shared/utils/schema.ts
export function schemaToJSONSchema(schema: Schema<any>): JSONSchema4 {
  // handles: object, string, number, boolean, array, union (enum), const
  // reads schema.dict for object properties
  // reads schema.meta.required for required fields
}
```

### Pattern 4: ToolResult — Success/Failed helpers

```typescript
// Source: YesImBot-dev/packages/core/src/services/plugin/utils.ts
export function Success<T>(result?: T): ToolResult<T> {
  return { status: "success", result };
}
export function Failed(message: string): ToolResult {
  return { status: "failed", error: message };
}
```

### Pattern 5: FunctionContext — runtime context injection

```typescript
// Source: YesImBot-dev/packages/core/src/services/plugin/types.ts
export interface FunctionContext {
  session?: Session;
  view?: HorizonView;
  percept?: Percept;
  [key: string]: unknown;
}
```

AgentCore builds this context before calling `pluginService.getTools(context)` and `pluginService.invoke(name, params, context)`.

### Anti-Patterns to Avoid

- **Flat global tool registry:** Don't store all tools in a single `Map<string, Definition>` on PluginService. Each Plugin owns its tools; PluginService traverses. This enables hot-reload (Plugin dispose removes its tools automatically).
- **Eager snippet evaluation:** Don't evaluate all snippets on every render. The dev version's `getRequiredVariables()` + `isSnippetRequired()` optimization only evaluates snippets actually referenced in the template.
- **Chaining logger calls:** Per CLAUDE.md — `const logger = ctx.logger('x'); logger.info(...)` not `ctx.logger('x').info(...)`.
- **Duplicate config field:** Per CLAUDE.md — don't declare `private config` in Service subclass; it's inherited from `Service<TConfig>`.

## Don't Hand-Roll

| Problem                    | Don't Build                  | Use Instead                                              | Why                                                              |
| -------------------------- | ---------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| Template rendering         | Custom string interpolation  | Mustache via `MustacheRenderer`                          | Handles partials, sections, escaping, recursive rendering        |
| Schema → JSON Schema       | Manual type mapping          | `schemaToJSONSchema()` utility                           | Handles union/enum/array/required correctly                      |
| Tool result wrapping       | Ad-hoc `{ ok, data }` shapes | `Success()` / `Failed()` helpers                         | Consistent `ToolResult` shape expected by AgentCore              |
| Decorator metadata storage | Custom metadata maps         | Prototype property pattern (`target.staticTools ??= []`) | Works with TypeScript legacy decorators without reflect-metadata |

## Common Pitfalls

### Pitfall 1: TypeScript decorator configuration

**What goes wrong:** `@Tool()` / `@Action()` decorators fail to compile or don't attach metadata.
**Why it happens:** Legacy decorators require `"experimentalDecorators": true` in tsconfig. The dev version uses legacy decorator style (not TC39 stage 3).
**How to avoid:** Verify `tsconfig.json` has `experimentalDecorators: true`. Check existing tsconfig in `plugins/core/` — it likely already has this from Phase 3.
**Warning signs:** `TS1219: Experimental support for decorators is a feature that is subject to change` or decorators silently not running.

### Pitfall 2: Snippet scope mutation

**What goes wrong:** Snippets that mutate the scope object cause unpredictable render results.
**Why it happens:** `buildScope()` passes the same scope object to each snippet. If a snippet writes to `scope.bot` and another snippet reads it, order matters.
**How to avoid:** Snippets should return values, not mutate scope. `setNestedProperty()` handles writing the returned value into the scope.

### Pitfall 3: Plugin registration timing

**What goes wrong:** Plugin tries to register with PluginService before PluginService is ready.
**Why it happens:** Koishi service injection — if Plugin constructor calls `ctx[Services.Plugin].register()` synchronously, PluginService may not exist yet.
**How to avoid:** Dev version wraps registration in `ctx.on('ready', ...)`. PluginService must be in Plugin's `static inject` so Koishi waits for it.

### Pitfall 4: Mustache HTML escaping

**What goes wrong:** Template variables containing `<` `>` `&` get HTML-escaped, breaking XML-style prompt tags.
**Why it happens:** Mustache escapes by default. Prompt templates use XML-like tags (`<persona>`, `<rules>`).
**How to avoid:** Dev version passes `escape: (text) => text` to `Mustache.render()` to disable escaping. Use `{{{ }}}` triple-stache or the custom escape option.

### Pitfall 5: Action vs Tool heartbeat control

**What goes wrong:** AgentCore continues heartbeat after an Action succeeds, wasting an LLM call.
**Why it happens:** Caller doesn't check `def.type` after invoke.
**How to avoid:** AgentCore (Phase 5) must check `def.type === FunctionType.Action` — on success, don't set `actionContinue = true`. This is the caller's responsibility, not PluginService's. PluginService just executes and returns.

## Code Examples

### PromptService — render with session context

```typescript
// Source: YesImBot-dev/packages/core/src/services/prompt/service.ts (lines 109-120)
public async render(templateName: string, initialScope: Record<string, any> = {}): Promise<string> {
  const templateContent = this.templates.get(templateName);
  if (!templateContent) throw new Error(`Template not found: "${templateName}"`);

  const requiredVariables = this.getRequiredVariables(templateContent);
  const scope = await this.buildScope(initialScope, requiredVariables);
  const partials = Object.fromEntries(this.templates);

  return this.renderer.render(templateContent, scope, partials, { maxDepth: 3 });
}
```

### PluginService — getTools() for AgentCore

```typescript
// Source: YesImBot-dev/packages/core/src/services/plugin/service.ts (lines 437-462)
public async getTools(context?: FunctionContext): Promise<Tool[]> {
  const tools: Tool[] = [];
  for (const plugin of this.plugins.values()) {
    for (const toolDef of plugin.getFunctions().values()) {
      tools.push({
        type: 'function',
        function: {
          name: toolDef.name,
          description: toolDef.description,
          parameters: schemaToJSONSchema(toolDef.parameters) || {},
        },
        execute: async (input, options) => this.invoke(toolDef.name, input, context),
      });
    }
  }
  return tools;
}
```

### withInnerThoughts — adds inner monologue field to tool params

```typescript
// Source: YesImBot-dev/packages/core/src/services/plugin/decorators.ts (lines 81-86)
export function withInnerThoughts(params: { [T: string]: Schema<any> }): Schema<any> {
  return Schema.object({
    inner_thoughts: Schema.string().description("Deep inner monologue private to you only."),
    ...params,
  });
}
```

### Injection rendering — sorted by priority, wrapped in XML tags

```typescript
// Source: YesImBot-dev/packages/core/src/services/prompt/service.ts (lines 160-182)
// Injections sorted by priority, each wrapped: <name>\ncontent\n</name>
// Empty results filtered out, joined with \n\n
```

## State of the Art

| Old Approach                                 | Current Approach                      | When Changed               | Impact                                                                                                                                       |
| -------------------------------------------- | ------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| JSON structured output for tool calls        | Native tool_call via ai-sdk           | Evaluated in dev, rejected | v4 uses JSON output (see design/04 doc) — but PluginService still provides `getTools()` for ai-sdk format as the heartbeat processor uses it |
| Flat tool registry on service                | Plugin-owned tools, service traverses | dev version redesign       | Enables hot-reload, cleaner ownership                                                                                                        |
| File-based template loading (`readFileSync`) | In-memory template registration       | v4 simplification          | No filesystem dependency; templates registered programmatically                                                                              |

**Note on tool call format:** The dev heartbeat processor (`heartbeat-processor.ts`) actually uses ai-sdk's native tool_call format (`tools`, `toolChoice: 'required'`) in the non-streaming path, and JSON parsing in the streaming path. The `getTools()` method returns ai-sdk `Tool[]` format. Phase 5 (AgentCore) will decide which path to use — PluginService must support both by providing `getTools()` that returns ai-sdk-compatible tool definitions.

## Open Questions

1. **v4 core package location: `plugins/core/` not `packages/core/`**
   - What we know: Phase 3 artifacts are in `plugins/core/src/services/horizon/`. The dev version uses `packages/core/`.
   - What's unclear: Phase 4 files should go in `plugins/core/src/services/prompt/` and `plugins/core/src/services/plugin/` to match Phase 3's location.
   - Recommendation: Use `plugins/core/` — confirmed by Phase 3 verification report.

2. **Activators/support guards in v4**
   - What we know: Dev version has `support?: SupportGuard` and `activators?: Activator[]` on tool definitions for conditional availability.
   - What's unclear: CONTEXT.md says "no permission tiers" but doesn't explicitly address activators.
   - Recommendation: Omit activators from v4 types entirely. `isFuncAvailable()` becomes a simple pass-through. Add back in v2 if needed. This simplifies PluginService significantly.

3. **Config structure for PromptService and PluginService**
   - What we know: v4 `plugins/core/src/index.ts` has a flat `Config` interface. Phase 2 added ModelService config fields.
   - What's unclear: Whether PromptService/PluginService config should be nested under the main Config or separate.
   - Recommendation: Follow Phase 2/3 pattern — add config fields directly to the main `Config` interface in `index.ts`, pass relevant subset to each service constructor.

4. **`get_session_info` as separate plugin package or inline**
   - What we know: CONTEXT.md says it's "an independent tool plugin demo to validate third-party tool registration flow."
   - What's unclear: Whether it lives in `plugins/core/` or a separate `plugins/session-info/` package.
   - Recommendation: Implement as a separate `Plugin` subclass in `plugins/core/src/services/plugin/builtin/` for v4 simplicity. A truly separate package can be extracted later.

## Sources

### Primary (HIGH confidence)

- `YesImBot-dev/packages/core/src/services/prompt/` — complete PromptService implementation, verified working
- `YesImBot-dev/packages/core/src/services/plugin/` — complete PluginService implementation, verified working
- `YesImBot-dev/packages/core/src/shared/utils/schema.ts` — schemaToJSONSchema utility
- `YesImBot-dev/packages/core/src/agent/heartbeat-processor.ts` — shows how AgentCore consumes PromptService and PluginService
- `design/13-Plugin模块设计.md` — architectural rationale for Plugin-owned tools pattern
- `design/04-工具调用架构JSON与原生tool_call对比.md` — rationale for tool call format decisions
- `plugins/core/src/index.ts` — v4 current structure (Phase 3 output)
- `.planning/phases/03-horizon-context-system/03-VERIFICATION.md` — confirms v4 uses `plugins/core/` path

### Secondary (MEDIUM confidence)

- `design/14-赋予人格设计.md` — not read, but referenced for persona config; low risk since PromptService is template-agnostic

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — mustache version confirmed in dev package.json (not read, but used in renderer.ts import)
- Architecture: HIGH — direct port from verified dev implementation
- Pitfalls: HIGH — identified from actual dev code patterns and known TypeScript decorator behavior

**Research date:** 2026-02-18
**Valid until:** 2026-03-18 (stable domain — Koishi 4.x and Mustache APIs are stable)
