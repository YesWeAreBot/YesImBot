---
labels: [ready-for-agent]
status: open
assignee: Athena-Agent
---

# PRD: Platform Layer OOP Reconstruction

## Problem Statement

当前 `koishi-plugin-yesimbot`（core）的平台输入/输出层存在以下系统性问题：

1. **多层间接与复制（Presenter 体系）**：`PresenterCatalog`、`BasePresenter`、`PresenterRegistry` 三层动态注册架构，每个 `ChannelSession` → `AthenaBot` 内部都要 `new PresenterRegistry` 复制一份，理解成本极高。
2. **物理平台深度侵入（ChannelSession 臃肿）**：`ChannelSession` 持有 `koishiBot: Bot` 和 `AthenaBot` 控制类，测试时必须 Mock Koishi 运行时。
3. **事件类型与转换逻辑分裂**：`EventObserver`（听事件）+ `Presenter`（做呈现）分属不同抽象，事件语义定义与翻译规则分离。
4. **Speak 词汇局限与命名混淆**：`SpeakElement` 既指模型输出的标记标签，又和 Koishi 原生 `Element` 概念冲突。

## Solution

对平台输入/输出层进行控制反转（IoC）重塑：

1. **全局双向网关 `PlatformGateway`**：独占所有 Koishi 物理挂载（`ctx.middleware`、`ctx.on`），提供 `send(bot, channelId, segments, options)` 统一发送出口。
2. **策略模式 `PlatformAdapter`**：per-platform 单例，封装平台特化的发送逻辑（风控延迟、分段策略），由 Gateway 注入 Bot。
3. **事件语义拥有者 `PlatformListener`**：一类 listener 只负责一种最终事件语义，`translate()` 一步产出统一的 `PlatformEvent` 值对象，消除 Observer/Presenter 分裂。
4. **统一事件值对象 `PlatformEvent`**：合并 `AthenaEvent` + `BotPresentation` + 持久化元数据，listener 产出后不再被二次加工。`type` 字段采用 dot-separated 命名（`message`、`message.recall`、`reaction`、`member`、`poke`）。

## User Stories

1. **作为核心框架维护者**，我希望平台层具有清晰的物理边界，不再被 PresenterCatalog/AthenaBot 等多层间接所混淆。
2. **作为平台开发者**，我希望通过 `PlatformListener`（输入翻译）和 `PlatformAdapter`（输出投递）接口扩展平台支持，注册逻辑与事件语义绑定在一起。
3. **作为单元测试编写者**，我希望测试 `ChannelSession` 时无需 Mock Koishi `Context` 或 `Bot`，只需提供 MockGateway 即可验证事件流转和消息投递。
4. **作为扩展开发者**，我希望通过 `ctx.platform` 访问平台能力（如 `ctx.platform.bot` 获取当前频道的 Bot 引用），而不依赖 `Channel.bot`。
5. **作为长期聊天用户**，我希望消息发送失败时，机器人能当场捕获 `DeliveryIssue` 并写入会话历史，而不是静默失败。

## Implementation Decisions

### 1. 全局物理总线 `PlatformGateway`

- 独占所有 Koishi 物理挂载，不外泄 `ctx`/`Bot` 给 ChannelSession。
- 注册表：持有 `Map<platform, PlatformAdapter>` 和 `Map<source, PlatformListener[]>`。
- `send(bot, channelId, segments, options)`：调用方显式传入 Bot，Gateway 不做 Bot 查找，只路由到对应 Adapter。
- `registerAdapter` / `registerListener` 方法存在，但本轮不暴露为公共 API（仅 CoreApp 内部调用）。
- 不负责 Agent 运行决策，不拼装 MarkupTag。

### 2. 平台适配器 `PlatformAdapter`（策略模式）

- per-platform 单例，无状态。
- 接口：

```typescript
interface PlatformAdapter {
  platform: string;
  deliver(
    bot: Bot,
    channelId: string,
    segments: Fragment[],
    options?: DeliveryOptions,
  ): Promise<DeliveryResult>;
}
```

- 内部自行决定分段策略、拟人延迟等平台特化逻辑。
- 不感知其他平台，不做全局路由。

### 3. 事件翻译器 `PlatformListener`

- 一类 listener 只负责一种最终事件语义（`eventType`）。
- Listener 是事件语义的 owner：声明自己产出什么 `type`，`translate()` 一步到位产出 `PlatformEvent`。
- 共享类型定义仅用于校验和提示，不是外部调度中心。
- 接口：

```typescript
interface PlatformListener {
  name: string;
  eventType: PlatformEventType;
  source: { kind: "middleware" } | { kind: "koishi-event"; eventName: string };
  priority?: number;
  translate(input: RawEventInput): TranslateResult | Promise<TranslateResult>;
}
```

- source 为 `"middleware"` 时，Gateway 挂载全局 `ctx.middleware`；为 `"koishi-event"` 时动态挂载 `ctx.on(eventName)`。
- 同一原始 source 需多种事件语义时，注册多个 listener。

### 4. 统一事件值对象 `PlatformEvent`

合并 `AthenaEvent` + `BotPresentation` + 持久化元数据，listener 产出后不再经过独立 present/reshape 步骤。ChannelSession 只基于它判断是否持久化、是否触发 turn、向 LLM 送什么、向 UI 显示什么。

```typescript
type PlatformEventType =
  | "message"
  | "message.recall"
  | "reaction"
  | "member"
  | "poke"
  | (string & {});

interface PlatformEvent {
  id: string;
  type: PlatformEventType;
  timestamp: number;
  source: {
    platform: string;
    channelId: string;
    guildId?: string;
    threadId?: string;
    conversationType: "private" | "group" | "guild" | "thread";
    selfId?: string;
  };
  actor: { id: string; name?: string; avatar?: string; isSelf?: boolean };
  content: UserContent;
  visible: boolean;
  details: unknown;
  metadata: { persist: boolean; triggerCandidate: boolean };
}
```

- `type` 采用 dot-separated 规范命名（`message`、`message.recall`、`reaction`、`member`、`poke`）。
- 核心类型定义从 `bot/types.ts` 迁移到 `shared/`。

### 5. ChannelSession 脱物理化

- 彻底移除 `koishiBot: Bot` 字段。
- 移除 `AthenaBot` 实例，输出链路退化：Output Bridge → `globalMarkupRegistry.compile()` → `platformGateway.send(bot, channelId, segments, options)`。
- Bot 引用通过 `pendingReplyContexts` 队列在回合内传递（`{ bot, session }[]`），回合结束后自然消费。
- 扩展通过 `ExtensionPlatformContext.bot`（getter，per-channel 动态解析）访问 Bot 做平台特有操作。
- `Channel` 类型移除 `bot?` 字段。

### 6. MarkupTag 与 SpeakElement（本轮范围外）

- 本轮 **不改造** MarkupRegistry 作用域，保持 per-channel `SpeakElementRegistry`。
- `SpeakElement` → `MarkupTag` 重命名推迟到后续迭代。
- system-prompt 继续保持 per-channel 的 speak element 回调。

### 7. ExtensionContext 改造

- `ExtensionBotContext` → `ExtensionPlatformContext`：

```typescript
interface ExtensionPlatformContext {
  readonly name: string; // "onebot"
  readonly bot: Bot | undefined; // 当前 channel 对应的 Bot（getter）
  registerSpeakElement(definition: SpeakElementDefinition): () => void;
}
```

- `ctx.bot.registerSpeakElement()` → `ctx.platform.registerSpeakElement()`。
- 从 `ExtensionBindingHost.bot` 改为 `ExtensionBindingHost.platform`。

### 8. 输入事件监听挂载

- Gateway 在 `start()` 时扫描所有已注册 `PlatformListener`。
- `source.kind === "middleware"` → 挂载唯一 `ctx.middleware`（前置拦截）。
- `source.kind === "koishi-event"` → 动态 `ctx.on(eventName)`。
- Listener translate 返回 `{ type: "event"; event: PlatformEvent }` 时，Gateway 通过 `subscribeObservedEvents` 回调分发给 RuntimeController。

### 9. 输出投递与故障记录

- `PlatformAdapter.deliver()` 返回 `DeliveryResult`：

```typescript
interface DeliveryResult {
  ok: boolean;
  deliveredSegments: string[];
  failedSegments: string[];
  issue?: DeliveryIssue;
}
```

- ChannelSession 在调用 `send()` 后检查 `result.ok`，失败时调用 `sessionManager.recordDeliveryIssue(result.issue)` 写入会话历史。
- `Anomaly` → `DeliveryIssue` 重命名。

### 10. Fallback Listener 策略

- 仅 `core.message` listener（middleware → `message` 类型）完整实现。
- 其余 5 个 listener（`message.recall`、`reaction` × 2、`member` × 2）使用占位符：打印日志 + `{ type: "pass" }`。

## Testing Decisions

- **核心原则**：重构核心收益之一是测试便利性。业务层测试应完全基于 MockGateway。
- **ChannelSession**：提供 InMemory MockGateway，对 `handleEvent()` 的事件流转和 `send()` 投递行为进行断言。
- **PlatformGateway**：测试 Listener 优先级路由、adapter 匹配分发、fallback 逻辑。
- **MarkupRegistry**：当前 per-channel 行为保持不变，已有测试继续有效。

## Out of Scope

- 不涉及 `@yesimbot/agent` 包代码修改。
- 不涉及 AI 意愿决策（WillingnessManager）逻辑修改。
- 不涉及已持久化历史数据库 schema 破坏性改动。
- 不改造 MarkupRegistry 作用域（保持 per-channel）。
- 不暴露 Adapter/Listener 为公共 API。
- 不实现除 `core.message` 以外的 fallback listener 完整逻辑。

## Further Notes

- 重构目录建议：
  - `core/src/internal/platform/` — `gateway.ts`、`types.ts`、`fallback-listeners.ts`
  - `core/src/shared/` — 迁移 `AthenaEvent` 等核心类型，新增 `PlatformEvent`
  - 原 `core/src/internal/bot/` 目录逐步废弃，不直接删除（类型需保留迁移）
- `@yesimbot/agent` 保持为通用运行时，不吸收 Athena/Koishi 业务语义。
