---
labels: [ready-for-agent]
status: draft
---

# PRD: 大一统 ChannelSession 架构重构

## Problem Statement

Athena Core 当前的 per-channel 生命周期管理仍然分散在多个 owner 里：

- `RuntimeController` 持有 `SessionContext` 和 `channelBotInfo`。
- `ExtensionRuntimeManager` 另持有一套 channel runtime map。
- `core/src/internal/runtime/channel.ts` 用闭包承载事件摄入和 assistant output bridge。
- `BotModule` 仍通过 Koishi database 和 `SessionStore` metadata 做 assignee pre/post gate。
- `ExtensionService` 仍持有 runtime manager 并转发 per-channel runtime 方法。

这些路径让 Core App composition 仍然偏宽：创建一个 channel 需要在 Runtime Controller、Extension Runtime Manager、Channel Runtime、Athena Bot、Hook Runner、Session Store 之间手动同步状态。扩展 setup 依赖 `CreateExtensionChannelRuntimeOptions` 这种宽 capability bag，导致 extension context、runtime lifecycle、agent session 能力和 platform channel 概念混杂。

本重构的目标是把某个 channel 的物理状态和生命周期收束到一个自治 `ChannelSession`，让 Core App 保持直观对象组合，同时删除不需要的旧抽象和 assignee 路径。

## Goals

1. 用 `ChannelSession` 统一持有单个 channel 的 `AgentSession`、`SessionManager`、`HookRunner`、`AthenaBot`、extension bindings、tool snapshot、bot info、本地 settings 和 cleanup 状态。
2. 让 `RuntimeController` 只负责按 channel 创建、缓存、替换、销毁 `ChannelSession`，并把 `BotModule` 发布的 observed event 路由到 `channelSession.handleEvent()`。
3. 让 `ExtensionService` 退回为薄 public registry：只保存 extension definitions，提供注册、卸载、读取和定义变化订阅，不返回 reload 结果，不转发任何 per-channel runtime 方法。
4. 删除 `ExtensionRuntimeManager`、`ExtensionChannelRuntime`、`CreateExtensionChannelRuntimeOptions`、`core/src/internal/runtime/channel.ts` 等旧 lifecycle/capability bag 抽象。
5. 将 `ExtensionContext` 收窄为分组接口：只保留只读 `ctx.channel` 作为 platform/channel 身份；工具能力放在 `ctx.tool`；session 写入和虚拟消息能力放在 `ctx.session`；平台输出扩展能力放在 `ctx.bot`；hook 注册使用 `ctx.on(...)`。
6. 删除 assignee 机制：`BotModule` 不依赖 `SessionStore`，`SessionStore` 不再新写入 `assignee`，旧 metadata 中的 `assignee` 只作为 ignored legacy field。
7. 让 per-channel presenter registry 成为 `AthenaBot` 的构造细节，`ChannelSession` 不接收 `applyPresentersTo()` 这类 BotModule callback。
8. 保持 Core App 直观 composition，不引入 runtime shell、DI container 或新的 Koishi Service。

## Non-Goals

- 不改变模型 provider 注册方式。
- 不把 `RuntimeController`、`SessionStore`、`BotModule` 或 `ChannelSession` 暴露为 `ctx["yesimbot.*"]` Koishi Service。
- 不设计完整 BehaviorPolicy，不扩大到群聊回复策略重写。
- 不改变历史 session 文件主体格式；只停止新写入 `assignee`，并忽略历史字段。
- 不引入新的多 bot 调度策略。
- 不将 core runtime 迁入 `@yesimbot/agent`。
- 不做无关目录重排或格式化清理。

## Scope

### In Scope

- `core/src/internal/runtime/`
  - 新增 `session.ts`，实现 `ChannelSession`。
  - 重构 `controller.ts`，改为 `Map<ChannelKey, ChannelSession>`。
  - 删除 `channel.ts`，将事件摄入和 assistant output bridge 并入 `ChannelSession`。
  - 更新 `index.ts` 导出。
- `core/src/internal/extension/`
  - 删除 `runtime.ts`。
  - 重构 `context.ts`，从 `ChannelSession` 依赖创建分组 `ExtensionContext`。
  - 重构 `types.ts`，删除 `ExtensionChannelRuntime` 和旧 runtime options 类型。
- `core/src/services/extension/`
  - 删除 `runtimeManager` 字段、`attachRuntimeManager()` 和所有 per-channel forwarding methods。
  - 将 `registerExtension()` / `unregisterExtension()` 改为 registration-only API，不返回 `ReloadSummary`。
- `core/src/internal/bot/`
  - 删除 assignee pre/post gate。
  - 删除对 `SessionStore` 的依赖。
  - 保留 observer 注册、source listener、presenter catalog、Koishi bot resolution 和 observed event 发布。
- `core/src/internal/session/`
  - 删除 `GetOrCreateSessionInput.assignee`。
  - 删除新 metadata 写入中的 `assignee`。
  - 对历史 metadata 中的 `assignee` 只读忽略，不迁移、不报错。
- `core/src/internal/core-app.ts`
  - 按对象引用组合 internal modules。
  - 订阅 extension definition change 并调用 `runtimeController.reloadAllChannels()`。
  - 按新的 dispose 顺序释放资源。
- 现有 extension 插件和 built-in extension 的 `ExtensionContext` 调用迁移。
- 相关 core tests 迁移和新增。

### Out of Scope

- `providers/*` 的 model service 逻辑。
- chat-history 工具内部检索算法。
- delivery timing/segmenter 行为。
- session compaction 策略。
- Koishi database schema 变更。

## User Stories

1. 作为 Athena maintainer，我希望某个 channel 的运行时状态集中在 `ChannelSession`，这样 channel 生命周期可以通过一个对象理解和测试。
2. 作为 Athena maintainer，我希望 `RuntimeController` 不再构造所有底层对象和转发 extension runtime，这样它只保留路由与缓存职责。
3. 作为 extension author，我希望 extension setup context 的能力按 `channel`、`tool`、`session`、`bot`、`on` 分组，这样不需要理解 core runtime wiring。
4. 作为 Athena maintainer，我希望 `ExtensionService` 不再知道 internal runtime，这样 public Koishi Service 不会泄漏 core lifecycle。
5. 作为 Athena maintainer，我希望删除 assignee 路径，这样当前不需要的 multi-bot dispatch 不再扩大 Bot Module、Session Store 和 Runtime Controller 的接口。
6. 作为 Athena maintainer，我希望 extension reload 失败是 fail-open 且状态更新可预测，这样单个 extension 失败不会破坏整个 channel。

## Product Decisions

### ChannelSession Ownership

`ChannelSession` 是 per-channel 物理生命周期 owner。它创建并持有 `AgentSession`、`HookRunner`、`AthenaBot`、extension bindings 和 output bridge。它负责 `reloadExtensions()`、`handleEvent()`、prompt context 查询和 `dispose()`。

`ChannelSession` 不应成为 BotModule presenter catalog 的调用方。Presenter registration/coverage 是 BotModule 的全局事件归一化职责，per-channel presenter registry 是 Athena Bot 的内部呈现状态。ChannelSession 可以创建并持有 AthenaBot，但不应接收或调用 `applyPresentersTo(registry)` 这种 callback capability。

### Extension Service Return Value

`ExtensionService.registerExtension()` 和 `unregisterExtension()` 不再返回 `ReloadSummary`。它们只表达 definition registry 变更成功。reload 是 Core App 内部副作用，由 definition change subscription 触发，结果由 `RuntimeController` 记录日志或内部 summary，不暴露在 public registry API 上。

### Extension Context Shape

`ctx.channel` 保留，但只读且只表达 platform/channel 身份。不得向 `Channel` 添加 agent、session、model、tool 或 runtime 能力。

工具分组使用单数命名：

- `ctx.tool.register(...)`
- `ctx.tool.unregister(...)`
- `ctx.tool.getActive()`
- `ctx.tool.setActive(...)`
- `ctx.session.getName()`
- `ctx.session.setName(...)`
- `ctx.session.appendEntry(...)`
- `ctx.session.sendMessage(...)`
- `ctx.session.sendUserMessage(...)`
- `ctx.bot.registerSpeakElement(...)`
- `ctx.on(event, handler)`

### Reload Semantics

`ChannelSession.reloadExtensions(definitions)` 使用先构建后替换的 fail-open 策略：

1. 用当前 definitions 构建 next bindings。
2. setup 失败的 extension 记录错误并排除，其他 extension 继续加载。
3. 构建完成后统一 swap live state。
4. swap 时清理旧 live registrations，安装 next hooks/speak elements，并原子应用完整 Extension Tool Snapshot。
5. 单个 channel reload 失败不阻断其他 channel reload。

### Bot Selection Without Assignee

删除 assignee 后，发送 bot 选择规则为：

- Session-backed event 使用 `input.session.bot`。
- 如果 observer 事件提供了 `event.source.selfId`，非 session event 按该 selfId 解析 bot。
- 如果没有 selfId 且同 platform 只有一个 bot，使用该唯一 bot。
- 如果多候选且无法确定 selfId，warn 并丢弃该 observed event。

不查询 Koishi channel assignee，不读取 session metadata assignee，不引入新的多 bot routing policy。

### Core App Disposal Order

Core App 停止时先断开 extension definition subscription，再调用 `runtimeController.stop()` dispose 所有 `ChannelSession`，然后停止 `botModule`，最后停止 `sessionStore`。这样 channel cleanup 不会在 session manager cache 已清空后才执行。

## Acceptance Criteria

1. `core/src/internal/extension/runtime.ts` 不存在，源码主路径不再出现 `ExtensionRuntimeManager`。
2. 源码主路径不再出现 `ExtensionChannelRuntime` 或 `CreateExtensionChannelRuntimeOptions`。
3. `core/src/internal/runtime/channel.ts` 不存在，旧 `createChannelRuntime()` 行为由 `ChannelSession` 测试覆盖。
4. `RuntimeController` 持有 `Map<ChannelKey, ChannelSession>`，不再持有 `channelBotInfo` 独立 map。
5. `ExtensionService` 没有 `runtimeManager` 字段，没有 `attachRuntimeManager()`，没有 per-channel runtime forwarding methods。
6. `ExtensionService.registerExtension()` / `unregisterExtension()` 不返回 `ReloadSummary`。
7. `BotModuleDeps` 不包含 `sessionStore`，`core/src/internal/bot` 不 import session store。
8. `SessionStore.getOrCreate()` 不接收 `assignee`，metadata 新写入不包含 `assignee`。
9. Extension plugins 和 built-in extensions 使用 `ctx.tool`、`ctx.session`、`ctx.bot`、`ctx.on` 的新分组接口。
10. `ChannelSessionDeps` 不包含 `applyPresentersTo()`，`ChannelSession` 不直接 materialize presenter registry。
11. `rg -n "assignee" core/src core/tests` 只允许出现历史兼容说明、fixture 或迁移测试，不允许出现在 runtime 主路径。
12. `yarn workspace koishi-plugin-yesimbot exec vitest run` 的相关 core tests 通过。
13. `yarn turbo run check-types --filter=koishi-plugin-yesimbot` 通过。

## Verification Plan

- 单元测试：`ChannelSession` 构造、事件摄入、assistant output bridge、extension reload、dispose。
- 单元测试：`ExtensionService` registry-only 行为和 definition change subscriber。
- 单元测试：`BotModule` observer priority、session-backed bot selection、non-session bot resolution、ambiguous bot drop。
- 单元测试：`SessionStore` metadata 不再写入 assignee，旧 assignee 字段被忽略。
- 集成测试：`RuntimeController` first event 创建 channel session、session rotation 替换 channel session、reload all channels、stop disposal。
- 回归测试：system prompt tool context 和 speak element prompt context 在 reload 后正确反映 live bindings。
