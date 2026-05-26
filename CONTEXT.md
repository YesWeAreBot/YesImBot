# Athena

Athena 是一个围绕长期会话 Agent、Koishi runtime、以及可热重载扩展构建的单一上下文项目。这里的领域语言主要描述 agent 运行时与 core 扩展系统之间的边界。

## Language

**Core App**:
core 插件内部的组合根，以具名 Koishi 子插件形式加载，从而可以通过 `inject` 安全访问 `ModelService` 和 `ExtensionService`。它创建并持有内部模块，负责按顺序启动和停止 Athena 的运行时对象，但它本身不是 Koishi Service，也不提供 `ctx["yesimbot.*"]` 服务。
_Avoid_: RuntimeService, service graph, app-wide singleton, ctx service

**Koishi Service**:
Athena 暴露给其他 Koishi 插件通过 `ctx["yesimbot.*"]` 使用的跨插件接口。只有外部插件需要注入或注册能力时才应成为 Koishi Service。
_Avoid_: internal module, lifecycle helper, implementation bucket

**Internal Module**:
只服务于 `koishi-plugin-yesimbot` 内部组合的运行时模块，由 Core App 显式创建、启动和停止。Internal Module 不作为 Koishi 子插件加载，也不通过 Koishi `Service` 暴露。
_Avoid_: Koishi Service, plugin dependency, ctx service

**Extension Service**:
外部 Koishi 插件注册 Athena Extension 的薄 Koishi Service。它拥有 extension definitions 的对外注册入口，但不拥有 per-channel `setup()`/`cleanup()`、热重载编排或 tool snapshot 下发。它不持有任何 runtime 转发，只提供 definitions 注册、卸载以及注册变化订阅。
_Avoid_: ExtensionRegistry, extension runtime manager, internal lifecycle owner

**ChannelSession**:
某个频道在运行时大一统的自治会话实体。它高内聚地持有该 channel 长期会话中所需的全部物理状态（`agentSession`、`sessionManager`、`athenaBot`、`hookRunner`、加载的 bindings、`botInfo` 与本地设置）。它自己负责 extensions 的热重载（`reloadExtensions`）、事件接收与持久化、输出桥接（原来的 `ChannelRuntime` 行为）以及生命周期的销毁。
_Avoid_: ChannelRuntimeManager, closure bag, standalone event router, standalone channel runtime

**Hook Runner**:
agent 包中的纯 hook 分发器。它只负责以类型化方式执行 hook 链，不拥有扩展定义、`setup()`、`cleanup()` 或热重载编排。
_Avoid_: ExtensionRunner, extension lifecycle manager

**Extension Tool Snapshot**:
某个 channel 当前全部扩展工具的完整快照，由 core 计算并原子下发给 agent。它不是增量补丁，也不是逐个注册命令。
_Avoid_: tool delta, incremental tool registration

**Extension Context**:
扩展 `setup()` 中接收的 Koishi 风格上下文。它按 `ctx.tools`、`ctx.session`、`ctx.bot`、`ctx.on` 进行高内聚的分组切面（Object Facet）设计，不再塞入 `ctx.channel`，也不使用零散的闭包回调进行搬运。它携带当前 `Channel`，并提供注册能力与局部副作用限制。
_Avoid_: ExtensionAPI, ExtensionHost, runner host, capability bag

**ExtensionChannelBindings**:
某个 channel 当前成功加载的所有扩展定义的绑定集与清理句柄。它只是一个纯粹的数据与生命周期容器（包含 loaded bindings, tool snapshot, errors, dispose），不包含 any 正在跑的工作流或事件处理行为。
_Avoid_: ExtensionChannelRuntime, channel runtime interface

**Channel**:
当前扩展所在的 Koishi 频道上下文，只承载 Koishi/platform 相关信息，例如 platform、channelId、channel type 和 bot。agent、session、model 等 agent runtime 能力不属于 Channel。
_Avoid_: ChannelContext, agent runtime access, session access, model access

**Athena Bot**:
Athena 自己的 agent-to-platform interaction seam，位于 Koishi `Session`/`Bot` 之上、agent/session 行为之下。它负责呈现 AthenaEvent、发送 agent 输出、处理 speak element 能力与发送异常；它不等同于 Koishi `Bot`，也不负责群聊行为决策。
_Avoid_: Koishi Bot, raw platform adapter, delivery-only sender

Athena Bot 是 per-channel 对象，与 AgentSession 并列，由 ChannelSession 持有和创建。它不包含 AgentSession，也不把事件观察方法作为外部扩展点。

**Bot Module**:
core 内部模块，拥有 Koishi 事件接入、Event Observer 注册、Koishi Bot 解析，以及 AthenaEvent 发布。它不再拥有任何 Channel Assignee 的检查，也不依赖 Session Store，只负责纯粹的全局事件归一化输入和分发。
_Avoid_: AthenaBotService, platform adapter, behavior policy, assignee checker

**Event Observer**:
把 Koishi 事件输入归一化为 AthenaEvent 的观察规则。Event Observer 可以来自 core 默认逻辑或平台插件；平台特化 observer 优先于 core 默认 observer，默认逻辑只作为降级路径。
_Avoid_: hardcoded session.type switch, behavior decision, response policy

Event Observer 只表达事件接入和归一化。它可以放弃处理或丢弃无法归一化的输入，但不负责决定 Athena 是否回应、沉默、延迟或升级判断。

**BotPresentation**:
AthenaEvent 进入 AgentSession 之前的呈现结果。它区分给 LLM 看的 `content`、是否显示的 `visible/display`、可选纯文本摘要，以及不默认进入 LLM 上下文的结构化 `details`。
_Avoid_: raw UserContent formatter result, lossy event string

**Speak Markup**:
模型最终发言文本中允许使用的受控 XML-style 消息标记子集。它不是完整 Koishi 消息元素透传；只有当前注册的 speak elements 会被升级为 Koishi Fragment，未知标签会按纯文本转义。
_Avoid_: arbitrary Koishi element passthrough, JSON message protocol

**Speak Element**:
可由 core 或 extension 注册的 Speak Markup 能力，例如内置 `<sep/>` 或扩展提供的 `<sticker name="..."/>`。Speak Element 会进入独立的 system prompt section，并由 Athena Bot 在 `speak()` 阶段解析、transform、发送。
_Avoid_: tool call, generic platform capability

第一版 core 只内置 `<sep/>`。`<at>`、`<img>`、`<sticker>` 等应通过 `ctx.bot.registerSpeakElement()` 注册，即使未来由 built-in extension 提供。

**Runtime Controller**:
core 内部模块，负责按 channel 创生和销毁 `ChannelSession` 实例。它是全局运行时状态的协调器，不作为 Koishi Service 暴露。它接收来自 Bot Module 的归一化事件，并单向路由给对应的 `channelSession.handleEvent(event)`。
_Avoid_: RuntimeService, Koishi service, extension registry, ExtensionRuntimeManager

**Session Store**:
core 内部模块，拥有 channel 会话目录、metadata、channel map 和 `SessionManager` cache。它不通过 Koishi Context 暴露，内部 session rotation 通过 Core App 的对象引用或回调传播。它不再持久化任何 `assignee` 属性。
_Avoid_: SessionService, Koishi Events, public session API

**BehaviorPolicy**:
未来 core 应用层的群聊行为决策 owner，负责是否回应、沉默、延迟、跟进或升级到 LLM判断。它不属于 Athena Bot、AgentSession、RuntimeService 或 Koishi adapter。
_Avoid_: adapter trigger decision, AgentSession social logic, RuntimeService behavior block

**Session Header**:
会话文件的头记录，只表达会话身份与树关系，不再承载文件系统路径。
_Avoid_: cwd metadata, workspace metadata

## Example Dialogue

Dev: 这个工具是 agent 自己注册，还是扩展系统注册？
Domain Expert: 扩展工具由 ChannelSession 收集成一个 Extension Tool Snapshot，再交给 agent 应用。
Dev: 那 Hook Runner 负责 reload 吗？
Domain Expert: 不负责。Hook Runner 只跑 hook；per-channel 扩展重载在 ChannelSession 的 reloadExtensions 动作中。
Dev: Extension Service 还负责 per-channel setup 吗？
Domain Expert: 不负责。Extension Service 只是 Koishi 插件注册 extension definition 的入口；内部重载编排由 Core App 订阅变化后直接通知 Runtime Controller 调用 ChannelSession 自治完成。
Dev: Extension setup 里拿到的是 API 还是上下文？
Domain Expert: 是 Extension Context。它按 tools、session、bot、on 的切面分组设计，提供注册、虚拟消息及副作用限制所需的上下文能力。
Dev: 那 ChannelSession 就是以前那个 ChannelRuntime 吗？
Domain Expert: 不是。以前的 ChannelRuntime 只是一个纯事件 Intake & Output 桥接的函数闭包；而 ChannelSession 是一个 first-class 的自治大对象，它不仅包含事件摄入逻辑，还高内聚地持有该 channel 所需的全部物理状态（agentSession, bot, sessionManager 等）和热重载逻辑。
Dev: Channel 里可以放 session manager 或 model 吗？
Domain Expert: 不要。Channel 只表达 Koishi/platform 频道上下文；agent/session/model 属于 agent runtime 层。
Dev: Athena Bot 负责决定群聊里该不该回复吗？
Domain Expert: 不负责。是否回应、沉默、延迟或升级判断属于未来 BehaviorPolicy；Athena Bot 只负责平台交互。
Dev: ctx.session.sendMessage 是向平台发消息吗？
Domain Expert: 不是。ctx.session.sendMessage 是向 AgentSession 添加 custom message；平台发送由 Athena Bot 的 speak 路径负责。
Dev: 模型可以随便输出 Koishi 消息元素吗？
Domain Expert: 不可以。模型只能使用当前注册的 Speak Markup；未知标签会作为纯文本处理。
Dev: Session Header 里还要保存 cwd 吗？
Domain Expert: 不要。Session Header 只保留会话身份和树关系。
Dev: Session Store 应该用 ctx["yesimbot.session"] 暴露吗？
Domain Expert: 不要。Session Store 是 core 内部模块，Runtime Controller 通过对象引用使用它，不通过 Koishi Service 图传递。