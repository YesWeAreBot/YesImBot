# Phase 3: Horizon Context System - Research

**Researched:** 2026-02-18
**Domain:** Koishi database ORM, event-driven context modeling, IM session enrichment
**Confidence:** HIGH

## Summary

Phase 3 builds the context layer that sits between raw Koishi sessions and AgentCore. The dev version (`YesImBot-dev`) contains a complete, working Horizon implementation that serves as the primary reference — the v4 implementation is a deliberate simplification of it, not a greenfield design.

The core insight from the dev version: the three-table design (Entity + Timeline, with Environment stored inline in Entity records) maps cleanly to Koishi's `ctx.model.extend` + `ctx.database` API. The `scope` object (platform + channelId + guildId + isDirect) is the universal key for all queries. The `EventManager` class wraps `ctx.database.select().where().orderBy().limit().execute()` for Timeline queries, and `ctx.database.create/set/get` for Entity upserts.

The v4 simplification removes: ChatModeManager (deferred to Phase 4), AssetService dependency (image transform), MemoryService dependency, CommandService dependency. What remains is the pure data layer: types, EventManager, EventListener (Koishi middleware + after-send), and HorizonService as a Koishi Service subclass injecting only `database`.

**Primary recommendation:** Port the dev version's Horizon implementation directly, stripping the deferred dependencies. The types, database schema, EventManager query patterns, and EventListener middleware pattern are all production-ready and should be reused verbatim.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

#### 架构方向

- 不做复杂的 Observation 转换层，v4 先用简单的消息历史拼接
- Environment/Entity/Event 不是对 Koishi session 的重复抽象，而是 session 的"富化缓存"——持久化存储 Koishi 不直接保存的信息（群名、公告、用户昵称、头衔等）
- Prompt 构建采用混合方案：Horizon 视图（聚合群聊上下文）+ 标准多轮格式（工具调用）

#### 实体建模

- Environment = channel（1:1 映射），一个群聊/私聊 = 一个 Environment，保持频道隔离
- Entity = 用户，承载跨频道连续性（同一用户在不同 Environment 中是同一个 Entity）
- Entity 默认按平台隔离（platform + userId），支持手动关联不同平台账号
- Event 类型 v4 只覆盖：消息（message）和 Bot 自身消息（含工具调用摘要）

#### Timeline 存储策略

- 使用 Koishi 数据库服务持久化存储 Timeline
- 检索方式：时间窗口 + 数量上限，兼顾对话节奏和 token 控制
- Environment 和 Entity 元数据也持久化存储到数据库
- 元数据更新策略：定期批量刷新，减少 API 调用

#### 消息流与 Prompt 构建

- 一次触发 = 一次完整 think-act 循环，期间不注入新消息
- 必要时（响应过慢、积累太多消息、用户明确 @）可插入 [system] 更新
- Agent 响应过程（思考、工具调用、结果、最终回复）压缩为单个摘要 Event 存入 Timeline
- 第二轮触发时，Horizon 视图更新，包含上一轮 agent 行为摘要，保持连贯性

#### Observation 生成（Horizon 视图）

- v4 先用聊天记录式逐条列出（带时间戳和发送者），后续迭代加摘要压缩
- Horizon 视图包含四部分：Environment 信息、Entity 信息、消息历史、触发上下文
- Phase 3 只提供触发上下文数据，chat-mode 选择逻辑留给 Phase 4/5

#### Percept 触发语义

- v4 支持四种触发类型：@提及/回复、关键词匹配、随机触发、私聊消息
- Percept 只提供数据，不做"是否应该回复"的判断（留给 Phase 6 意愿系统）
- Percept 携带：触发类型、触发消息引用、Environment/Entity 引用
- 群聊消息聚合后触发（防止连续消息导致 bot 刷屏）

### Claude's Discretion

- Timeline 数据库表结构设计
- Environment/Entity 元数据的具体字段
- 消息聚合的时间窗口和策略
- Horizon 视图的具体文本格式
- 元数据批量刷新的周期

### Deferred Ideas (OUT OF SCOPE)

- chat-mode 选择逻辑 — Phase 4（PromptService）
- 意愿判断系统 — Phase 6
- 成员变更事件、群信息变更事件 — 未来版本
- 跨平台账号自动关联 — 未来版本
- Observation 摘要压缩（分组摘要式） — 未来迭代
- 多 agent 协同（chat-mode 演化为独立 agent） — 未来版本
- 记忆系统 / 用户画像 — 未来版本
  </user_constraints>

<phase_requirements>

## Phase Requirements

| ID         | Description                                                                         | Research Support                                                                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HORIZON-01 | Horizon 上下文架构 — Environment/Entity/Event 三元组抽象，替代 per-channel 会话隔离 | Dev version types.ts provides complete, verified type definitions for all three abstractions; Scope object is the universal channel key                                |
| HORIZON-02 | Timeline 存储 — Event 按时间序列的数据库存储架构                                    | Koishi ctx.model.extend + ctx.database.select/create/set API verified; dev EventManager shows exact query patterns with scope filter + orderBy + limit                 |
| HORIZON-03 | Observation 生成 — Event 展开为 LLM 可直接阅读的 Observation 数据                   | Dev EventManager.toObservations() shows the MessageRecord → MessageObservation transform; v4 simplifies to chat-log format (timestamp + sender + content)              |
| HORIZON-04 | Percept 触发机制 — 描述智能体被触发的原因（消息、定时任务等），驱动 AgentCore 处理  | Dev listener.ts shows Koishi middleware pattern for message capture + ctx.emit('horizon/percept'); v4 adds trigger-type classification (mention/keyword/random/direct) |

</phase_requirements>

## Standard Stack

### Core

| Library           | Version  | Purpose                                              | Why Standard                                                       |
| ----------------- | -------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| koishi            | ^4.18.3  | Service base class, database injection, event system | Already in project; Service subclass pattern required by CLAUDE.md |
| koishi (database) | built-in | ctx.model.extend + ctx.database CRUD                 | Koishi's built-in ORM via Minato; no extra dependency needed       |

### Supporting

| Library       | Version  | Purpose                            | When to Use                                       |
| ------------- | -------- | ---------------------------------- | ------------------------------------------------- |
| koishi Random | built-in | Random.id() for Timeline entry IDs | Generating unique string IDs for Timeline records |

### Alternatives Considered

| Instead of               | Could Use               | Tradeoff                                                                                                        |
| ------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| Koishi database (Minato) | External SQLite/Prisma  | Koishi database is already injected, zero extra deps, works with any Minato driver the user configures          |
| string IDs (Random.id)   | auto-increment integers | String IDs allow external generation before DB insert; required for Timeline entries created before persistence |

**No new dependencies needed.** Phase 3 uses only Koishi built-ins already present in the project.

## Architecture Patterns

### Recommended Project Structure

```
plugins/core/src/
├── services/
│   └── horizon/
│       ├── index.ts          # re-exports
│       ├── types.ts          # all type definitions (Scope, Entity, Environment, Timeline, Percept, HorizonView)
│       ├── service.ts        # HorizonService extends Service — registers DB models, exposes EventManager
│       ├── event-manager.ts  # EventManager — Timeline read/write/query/toObservations
│       └── listener.ts       # EventListener — Koishi middleware + after-send hook
```

HorizonService lives inside `plugins/core` (not a separate package) because it depends on Koishi and the database service. It is a Koishi Service subclass registered via `ctx.plugin(HorizonService, config)` in the core plugin's `apply()`.

### Pattern 1: Koishi Service Subclass with Database Injection

**What:** HorizonService extends Service, declares `static inject = ['database']`, registers DB models in `start()`, exposes EventManager as a public property.

**When to use:** Always — required by CLAUDE.md and Koishi architecture.

```typescript
// Source: dev version service.ts + CLAUDE.md pattern
declare module "koishi" {
  interface Context {
    "yesimbot.horizon": HorizonService;
  }
  interface Tables {
    "yesimbot.timeline": TimelineEntry;
    "yesimbot.entity": EntityRecord;
  }
}

class HorizonService extends Service<HorizonConfig> {
  static inject = ["database"];
  readonly events: EventManager;

  constructor(ctx: Context, config: HorizonConfig) {
    super(ctx, "yesimbot.horizon", false); // false = wait for start()
    this.events = new EventManager(ctx);
  }

  protected async start() {
    this.ctx.model.extend(
      "yesimbot.timeline",
      {
        id: "string(32)",
        scope: "object",
        type: "string(32)",
        priority: "unsigned",
        stage: "string(16)",
        timestamp: "timestamp",
        data: "json",
      },
      { primary: ["id"], autoInc: false },
    );

    this.ctx.model.extend(
      "yesimbot.entity",
      {
        id: "string(64)",
        type: "string(32)",
        name: "string(255)",
        parentId: "string(255)",
        refId: "string(255)",
        attributes: "json",
        updatedAt: "timestamp",
      },
      { primary: ["id"] },
    );

    new EventListener(this.ctx, this).start();
  }
}
```

### Pattern 2: EventManager — Timeline Query with Scope Filter

**What:** Wraps `ctx.database.select().where().orderBy().limit().execute()` for Timeline queries. The `scope` object is the channel key — always filter by `platform + channelId`.

**When to use:** Any time AgentCore or HorizonService needs to retrieve history.

```typescript
// Source: dev version event-manager.ts
async query(options: EventQueryOptions): Promise<TimelineEntry[]> {
  let q = this.ctx.database.select('yesimbot.timeline').where(options.scope
    ? { scope: options.scope } : {})

  if (options.types?.length) {
    q = q.where({ type: { $in: options.types } })
  }
  if (options.since) q = q.where({ timestamp: { $gte: options.since } })
  if (options.until) q = q.where({ timestamp: { $lte: options.until } })
  if (options.orderBy) q = q.orderBy('timestamp', options.orderBy)
  if (options.limit) q = q.limit(options.limit)

  return q.execute() as Promise<TimelineEntry[]>
}
```

### Pattern 3: EventListener — Koishi Middleware for Message Capture

**What:** Uses `ctx.middleware()` to intercept messages (record + emit Percept) and `ctx.on('after-send')` to record bot responses. The middleware calls `next()` before emitting the Percept so other middleware runs first.

**When to use:** The only correct way to intercept all messages in Koishi without missing platform-specific events.

```typescript
// Source: dev version listener.ts
ctx.middleware(async (session, next) => {
  if (!isAllowedChannel(session)) return next();
  if (session.author?.isBot) return next();

  await recordUserMessage(session); // write to Timeline
  await next(); // let other middleware run

  const percept = buildPercept(session);
  ctx.emit("horizon/percept", percept); // fire-and-forget to AgentCore
});

ctx.on("after-send", (session) => {
  if (!isAllowedChannel(session)) return;
  recordBotMessage(session);
});
```

### Pattern 4: Percept Trigger Classification

**What:** v4 adds trigger-type classification to the Percept. The listener inspects the session to determine which of the four trigger types applies, then sets `triggerType` on the Percept payload.

**When to use:** During Percept construction in EventListener, before emitting.

```typescript
// v4 addition — not in dev version
type TriggerType = "mention" | "reply" | "keyword" | "random" | "direct";

function classifyTrigger(session: Session, config: HorizonConfig): TriggerType {
  if (session.isDirect) return "direct";
  if (session.quote?.user?.id === session.bot.selfId) return "reply";
  if (session.elements?.some((e) => e.type === "at" && e.attrs?.id === session.selfId))
    return "mention";
  if (config.keywords?.some((kw) => session.content.includes(kw))) return "keyword";
  return "random";
}
```

### Pattern 5: Message Aggregation Window

**What:** Debounce Percept emission to prevent bot spam from rapid consecutive messages. Use a per-channel timer: reset on each new message, emit Percept only after silence window expires.

**When to use:** Group chat channels only (`!session.isDirect`). Private chats emit immediately.

```typescript
// Discretion area — recommended implementation
private pendingPercepts = new Map<string, { timer: NodeJS.Timeout; percept: UserMessagePercept }>()

private schedulePercept(channelKey: string, percept: UserMessagePercept, windowMs = 1500) {
  const existing = this.pendingPercepts.get(channelKey)
  if (existing) clearTimeout(existing.timer)

  const timer = setTimeout(() => {
    this.pendingPercepts.delete(channelKey)
    this.ctx.emit('horizon/percept', percept)
  }, windowMs)

  this.pendingPercepts.set(channelKey, { timer, percept })
}
```

### Pattern 6: Observation Text Format (v4 Simple Format)

**What:** Convert Timeline entries to a chat-log string for the LLM. Each line: `[HH:MM] SenderName: content`. Bot messages marked with `[Bot]` prefix.

**When to use:** In `EventManager.toObservations()` and when building the HorizonView history array.

```typescript
// Discretion area — recommended format
function formatObservation(entry: MessageRecord, selfId: string): string {
  const time = entry.timestamp.toTimeString().slice(0, 5);
  const isBot = entry.data.senderId === selfId;
  const prefix = isBot ? "[Bot]" : "";
  return `[${time}] ${prefix}${entry.data.senderName}: ${entry.data.content}`;
}
```

### Anti-Patterns to Avoid

- **Storing Environment as a separate DB table in v4:** The design doc shows Environment as a runtime object. For v4, derive it from EntityRecord (type='channel') or build it on-the-fly from session data. A separate Environment table adds complexity without benefit at this stage.
- **Querying Timeline without scope filter:** Always include `platform + channelId` in queries. Without scope, queries return cross-channel data.
- **Emitting Percept synchronously inside middleware before `next()`:** The dev version correctly calls `next()` first, then emits. Emitting before `next()` can cause AgentCore to respond before other middleware (e.g., command handlers) have processed the message.
- **Using `ctx.logger('name').info()` inline:** CLAUDE.md requires creating logger once: `const logger = ctx.logger('horizon')`.
- **Declaring `private config` in Service subclass:** CLAUDE.md: use `Service<Config>` generic, don't redeclare config field.

## Don't Hand-Roll

| Problem                   | Don't Build              | Use Instead                           | Why                                                   |
| ------------------------- | ------------------------ | ------------------------------------- | ----------------------------------------------------- |
| Unique ID generation      | Custom UUID/nanoid       | `Random.id()` from koishi             | Already available, consistent with rest of codebase   |
| Database schema migration | Custom migration scripts | `ctx.model.extend()`                  | Koishi/Minato handles schema sync automatically       |
| Event debouncing          | Custom timer management  | Simple `setTimeout` + Map per channel | Sufficient for message aggregation; no library needed |
| Channel filtering         | Custom allow-list logic  | Simple array `.some()` check          | Already proven in dev version `isChannelAllowed()`    |

**Key insight:** This phase is almost entirely a port of existing dev code. The main work is stripping dependencies (AssetService, MemoryService, CommandService, ChatModeManager) and adding the trigger classification logic.

## Common Pitfalls

### Pitfall 1: scope Object Equality in Koishi Queries

**What goes wrong:** Querying `{ scope: { platform: 'qq', channelId: '123' } }` returns no results even though records exist with those values.

**Why it happens:** Koishi's Minato ORM stores `scope` as a JSON column (`'object'` type). Querying nested JSON fields requires using the exact field path syntax, not object equality. The dev version uses `Query.Expr<Scope>` which Minato resolves correctly.

**How to avoid:** Use `ctx.database.select().where({ scope: { platform: x, channelId: y } })` — Minato handles JSON field matching. Don't use `ctx.database.get()` with nested object queries; use `select().where()` chain instead.

**Warning signs:** Empty results from Timeline queries despite records existing in DB.

### Pitfall 2: ctx.model.extend Must Run Before Any DB Operations

**What goes wrong:** `ctx.database.create('yesimbot.timeline', ...)` throws "table not found" or silently fails.

**Why it happens:** Koishi's database plugin syncs schema on startup. If `model.extend()` is called after the database has already initialized, the table may not exist.

**How to avoid:** Call `ctx.model.extend()` in `start()` (or constructor), before any database operations. The dev version does this in `registerModels()` called from `start()`.

**Warning signs:** Database errors on first write after plugin load.

### Pitfall 3: after-send Event Timing

**What goes wrong:** Bot messages are not recorded in Timeline, or are recorded with wrong messageId.

**Why it happens:** `after-send` fires after the message is sent to the platform. The `session.messageId` at this point is the bot's outgoing message ID. If you try to record it during the agent loop (before send), you don't have the final messageId yet.

**How to avoid:** Always record bot messages in the `after-send` handler, not during the agent loop. The dev version's `recordBotSentMessage()` pattern is correct.

**Warning signs:** Timeline shows bot messages with undefined messageId.

### Pitfall 4: Message Aggregation Timer Leak on Plugin Dispose

**What goes wrong:** Pending timers from the aggregation window continue firing after the plugin is disposed, causing "cannot read property of undefined" errors.

**Why it happens:** `setTimeout` callbacks hold references to the plugin's context. If the plugin disposes before the timer fires, the context is gone.

**How to avoid:** Use `ctx.setTimeout()` instead of raw `setTimeout` — Koishi automatically cancels ctx-scoped timers on dispose. Or clear all pending timers in the listener's `stop()` method.

**Warning signs:** Errors in logs after plugin hot-reload.

### Pitfall 5: Percept Trigger Type for Aggregated Messages

**What goes wrong:** When multiple messages arrive in the aggregation window, the Percept carries only the last message's trigger type, losing earlier @mentions.

**Why it happens:** The aggregation window replaces the pending Percept with each new message. If the first message was a mention and the second was not, the mention is lost.

**How to avoid:** When updating the pending Percept, preserve the highest-priority trigger type seen in the window. Priority: `mention > reply > keyword > random`. The aggregated Percept should carry the most significant trigger.

**Warning signs:** Bot fails to respond to @mentions when followed quickly by other messages.

## Code Examples

### Database Table Declaration

```typescript
// Source: dev version service.ts registerModels()
// In HorizonService.start():
this.ctx.model.extend(
  "yesimbot.timeline",
  {
    id: "string(32)",
    scope: "object",
    type: "string(32)",
    priority: "unsigned",
    stage: "string(16)",
    timestamp: "timestamp",
    data: "json",
  },
  { primary: ["id"], autoInc: false },
);

this.ctx.model.extend(
  "yesimbot.entity",
  {
    id: "string(64)",
    type: "string(32)",
    name: "string(255)",
    parentId: "string(255)",
    refId: "string(255)",
    attributes: "json",
    updatedAt: "timestamp",
  },
  { primary: ["id"] },
);
```

### Timeline Write

```typescript
// Source: dev version event-manager.ts recordMessage()
import { Random } from "koishi";

await this.ctx.database.create("yesimbot.timeline", {
  id: Random.id(),
  scope: { platform, channelId, guildId, isDirect },
  type: TimelineEventType.Message,
  priority: TimelinePriority.Normal,
  stage: TimelineStage.New,
  timestamp: new Date(session.timestamp),
  data: {
    messageId: session.messageId,
    senderId: session.author.id,
    senderName: session.author.nick || session.author.name,
    content: session.content,
  },
});
```

### Entity Upsert

```typescript
// Source: dev version listener.ts updateMemberInfo()
const id = `${session.platform}:${session.author.id}@guild:${session.guildId}`;
const existing = await this.ctx.database.get("yesimbot.entity", { id });
if (existing.length > 0) {
  await this.ctx.database.set(
    "yesimbot.entity",
    { id },
    {
      name: session.author.nick || session.author.name,
      attributes: { roles: session.author.roles || [] },
      updatedAt: new Date(),
    },
  );
} else {
  await this.ctx.database.create("yesimbot.entity", {
    id,
    type: "member",
    name: session.author.nick || session.author.name,
    parentId: `guild:${session.guildId}`,
    attributes: { roles: session.author.roles || [], platform: session.platform },
    updatedAt: new Date(),
  });
}
```

### Koishi Tables Declaration Merging

```typescript
// Source: dev version service.ts — required for TypeScript type safety
declare module "koishi" {
  interface Tables {
    "yesimbot.timeline": TimelineEntry;
    "yesimbot.entity": EntityRecord;
  }
  interface Events {
    "horizon/percept": (percept: Percept) => void;
  }
}
```

### HorizonView Construction (v4 Simple Format)

```typescript
// v4 simplified — no ChatModeManager, no template system yet
async buildView(percept: UserMessagePercept): Promise<HorizonView> {
  const { scope } = percept
  const entries = await this.events.query({
    scope: { platform: scope.platform, channelId: scope.channelId },
    types: [TimelineEventType.Message, TimelineEventType.AgentSummary],
    limit: 30,
    orderBy: 'asc',
  })

  return {
    percept,
    self: { id: percept.runtime.session.selfId, name: percept.runtime.session.bot.user.name },
    history: this.events.toObservations(entries),
    environment: await this.getEnvironment(scope),
    entities: await this.getEntities(scope),
  }
}
```

## State of the Art

| Old Approach                              | Current Approach                            | When Changed   | Impact                                              |
| ----------------------------------------- | ------------------------------------------- | -------------- | --------------------------------------------------- |
| Per-channel in-memory session state (v3)  | Persistent Timeline in DB (v4)              | Phase 3        | Survives restarts, enables cross-session continuity |
| system + user two-message prompt (dev/v3) | Hybrid: Horizon view + standard multi-turn  | Phase 3 design | Better agentic capability, enables prompt caching   |
| Agent responses not stored                | Agent responses compressed to summary Event | Phase 3 design | Cross-turn coherence, tool call continuity          |

## Open Questions

1. **Environment metadata source**
   - What we know: Environment = channel enrichment (name, announcement, background). Koishi can fetch guild info via `session.bot.getGuild(guildId)`.
   - What's unclear: When to fetch and cache it. The dev version's `getEnvironment()` returns null (stub). The batch refresh period is a discretion area.
   - Recommendation: On first message in a channel, fetch and store. Refresh every 24h or on explicit command. Store as EntityRecord with `type='channel'` to avoid a third table.

2. **AgentSummary Event type**
   - What we know: v4 decision says agent responses are compressed to a single summary Event. The dev version has `AgentThought/AgentTool/AgentAction/ToolResult` as separate types.
   - What's unclear: Whether to add a new `TimelineEventType.AgentSummary` or reuse `AgentAction`.
   - Recommendation: Add `AgentSummary = 'agent.summary'` as a new type. It carries the compressed text of the full think-act cycle. Keeps the Timeline clean and avoids the dev version's complex working-memory query.

3. **Allowed channels configuration**
   - What we know: The dev version has `config.allowedChannels` as an array of `{ platform, type, id }` objects.
   - What's unclear: Whether Phase 3 should include this config or defer to Phase 5 (platform integration).
   - Recommendation: Include a minimal `allowedChannels` config in HorizonService. Without it, the listener has no way to filter channels and would process all messages.

## Sources

### Primary (HIGH confidence)

- `D:/Codespace/koishi-dev/YesWeAreBot/YesImBot-dev/packages/core/src/services/horizon/` — Complete working Horizon implementation (types, service, event-manager, listener, chat-mode)
- `D:/Codespace/koishi-dev/YesWeAreBot/YesImBot-dev/packages/core/src/shared/constants.ts` — Table names and service names
- `D:/Codespace/koishi-dev/YesWeAreBot/YesImBot/.planning/HORIZON-DESIGN.md` — v4 design decisions and data model
- CLAUDE.md — Service subclass pattern, logger pattern, config typing rules

### Secondary (MEDIUM confidence)

- WebSearch: Koishi `ctx.model.extend` API — confirmed field types (`string(N)`, `object`, `json`, `timestamp`, `unsigned`), primary key config, `autoInc` flag
- WebSearch: Koishi `ctx.database.get/create/set/upsert` — confirmed query expression syntax (`$in`, `$gte`, `$lte`), `select().where().orderBy().limit().execute()` chain
- WebSearch: Koishi Session properties — confirmed `session.isDirect`, `session.quote`, `session.elements`, `session.author`, `session.guildId`, `session.channelId`, `session.platform`

### Tertiary (LOW confidence)

- None — all critical claims verified against dev source or official docs

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new dependencies; Koishi built-ins verified
- Architecture: HIGH — direct port of working dev implementation with documented simplifications
- Database patterns: HIGH — verified against Koishi official docs via WebSearch
- Pitfalls: HIGH — derived from dev source code analysis and Koishi API behavior
- Discretion areas (aggregation window, text format, refresh period): MEDIUM — reasonable defaults, not verified against production load

**Research date:** 2026-02-18
**Valid until:** 2026-03-20 (Koishi 4.x API is stable; dev implementation is the ground truth)
