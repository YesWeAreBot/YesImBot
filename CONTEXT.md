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
外部 Koishi 插件注册 Athena Extension 的薄 Koishi Service。它拥有 extension definitions 的对外注册入口，但不拥有 per-channel `setup()`/`cleanup()`、热重载编排或 tool snapshot 下发。
_Avoid_: ExtensionRegistry, extension runtime manager, internal lifecycle owner

**Extension Runtime Manager**:
core 内部模块，拥有 per-channel extension `setup()`/`cleanup()`、热重载、Hook Runner 安装、Speak Element 安装和 Extension Tool Snapshot 下发。它消费 Extension Service 中的定义，但不作为 Koishi Service 暴露。
_Avoid_: Extension Service, Hook Runner, Extension Host

**Hook Runner**:
agent 包中的纯 hook 分发器。它只负责以类型化方式执行 hook 链，不拥有扩展定义、`setup()`、`cleanup()` 或热重载编排。
_Avoid_: ExtensionRunner, extension lifecycle manager

**Extension Tool Snapshot**:
某个 channel 当前全部扩展工具的完整快照，由 core 计算并原子下发给 agent。它不是增量补丁，也不是逐个注册命令。
_Avoid_: tool delta, incremental tool registration

**Extension Context**:
扩展 `setup()` 中接收的 Koishi 风格上下文。它暴露扩展注册 hook、工具和扩展侧副作用所需的能力，并携带当前 `Channel`。
_Avoid_: ExtensionAPI, ExtensionHost, runner host

未来收窄 Extension Context 时，agent/session/model 相关能力应优先按子上下文分组，例如 `ctx.session` 与 `ctx.tools`，而不是塞入 `ctx.channel` 或恢复为宿主能力包。

**Channel**:
当前扩展所在的 Koishi 频道上下文，只承载 Koishi/platform 相关信息，例如 platform、channelId、channel type 和 bot。agent、session、model 等 agent runtime 能力不属于 Channel。
_Avoid_: ChannelContext, agent runtime access, session access, model access

**Athena Bot**:
Athena 自己的 agent-to-platform interaction seam，位于 Koishi `Session`/`Bot` 之上、agent/session 行为之下。它负责呈现 AthenaEvent、发送 agent 输出、处理 speak element 能力与发送异常；它不等同于 Koishi `Bot`，也不负责群聊行为决策。
_Avoid_: Koishi Bot, raw platform adapter, delivery-only sender

Athena Bot 是 per-channel 对象，与 AgentSession 并列，由 Bot Module 创建。它不包含 AgentSession，也不把事件观察方法作为外部扩展点。

**Bot Module**:
core 内部模块，拥有 Koishi 事件接入、Event Observer 注册、Channel Assignee 检查、Koishi Bot 解析，以及 per-channel Athena Bot 创建。它不是 Koishi Service，除非未来需要把 observer 注册开放给独立 Koishi 插件。
_Avoid_: AthenaBotService, platform adapter, behavior policy

**Event Observer**:
把 Koishi 事件输入归一化为 AthenaEvent 的观察规则。Event Observer 可以来自 core 默认逻辑或平台插件；平台特化 observer 优先于 core 默认 observer，默认逻辑只作为降级路径。
_Avoid_: hardcoded session.type switch, behavior decision, response policy

Event Observer 只表达事件接入和归一化。它可以放弃处理或丢弃无法归一化的输入，但不负责决定 Athena 是否回应、沉默、延迟或升级判断。

**Channel Assignee**:
Koishi 语义中的频道「受理人」，表示同一 Koishi 应用多 bot 场景下负责该频道响应与主动发送的 bot 账号。Athena 的 channel metadata 可以沿用 Koishi 的 `assignee` 字段记录该 bot 的 `selfId`。
_Avoid_: human assignee, task assignee, maintainer owner

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

**Event Intake**:
Channel Runtime 内部的事件进入会话规则。它负责把 AthenaEvent + BotPresentation 写入 AgentSession、决定是否持久化和是否触发 turn；第一版不需要独立 Router 模块。
_Avoid_: RuntimeService handler blob, Athena Bot behavior policy, platform event normalization

**Runtime Controller**:
core 内部模块，负责按 channel 创建和销毁 Agent、AgentSession、Hook Runner、Channel Runtime、Athena Bot 与 extension runtime。它是运行时编排者，不是 Koishi Service，也不是对外插件接口。
_Avoid_: RuntimeService, Koishi service, extension registry

**Session Store**:
core 内部模块，拥有 channel 会话目录、metadata、channel map 和 `SessionManager` cache。它不通过 Koishi Context 暴露，内部 session rotation 通过 Core App 的对象引用或回调传播。
_Avoid_: SessionService, Koishi Events, public session API

**BehaviorPolicy**:
未来 core 应用层的群聊行为决策 owner，负责是否回应、沉默、延迟、跟进或升级到 LLM 判断。它不属于 Athena Bot、AgentSession、RuntimeService 或 Koishi adapter。
_Avoid_: adapter trigger decision, AgentSession social logic, RuntimeService behavior block

**Session Header**:
会话文件的头记录，只表达会话身份与树关系，不再承载文件系统路径。
_Avoid_: cwd metadata, workspace metadata

## Example Dialogue

Dev: 这个工具是 agent 自己注册，还是扩展系统注册？  
Domain Expert: 扩展工具由 Extension Runtime Manager 收集成一个 Extension Tool Snapshot，再交给 agent 应用。  
Dev: 那 Hook Runner 负责 reload 吗？  
Domain Expert: 不负责。Hook Runner 只跑 hook；per-channel 扩展生命周期在 Extension Runtime Manager。  
Dev: Extension Service 还负责 per-channel setup 吗？  
Domain Expert: 不负责。Extension Service 只是 Koishi 插件注册 extension definition 的入口；内部编排由 Core App 持有的 Extension Runtime Manager 完成。  
Dev: Extension setup 里拿到的是 API 还是上下文？  
Domain Expert: 是 Extension Context。它携带当前 Channel，并提供扩展注册 hook、工具和副作用所需的上下文能力。  
Dev: Channel 里可以放 session manager 或 model 吗？  
Domain Expert: 不要。Channel 只表达 Koishi/platform 频道上下文；agent/session/model 属于 agent runtime 层。  
Dev: Athena Bot 和 Koishi Bot 是一回事吗？  
Domain Expert: 不是。Koishi Bot 是平台 SDK 对象；Athena Bot 是 Athena 内部交互 seam，用来统一 Koishi 事件观察接入、事件呈现、输出投递、Speak Markup 和失败一致性。  
Dev: 事件观察注册表属于 Athena Bot 吗？  
Domain Expert: 属于 Bot Module。Athena Bot 是 per-channel 发送与呈现对象；Bot Module 才负责全局 Koishi event intake 和 observer 注册。  
Dev: Athena Bot 负责决定群聊里该不该回复吗？  
Domain Expert: 不负责。是否回应、沉默、延迟或升级判断属于未来 BehaviorPolicy；Athena Bot 只负责平台交互。  
Dev: ctx.sendMessage 是向平台发消息吗？  
Domain Expert: 不是。ctx.sendMessage 是向 AgentSession 添加 custom message；平台发送应由 Athena Bot 的 speak 路径负责。  
Dev: 模型可以随便输出 Koishi 消息元素吗？  
Domain Expert: 不可以。模型只能使用当前注册的 Speak Markup；未知标签会作为纯文本处理。  
Dev: Session Header 里还要保存 cwd 吗？  
Domain Expert: 不要。Session Header 只保留会话身份和树关系。
Dev: Session Store 应该用 ctx["yesimbot.session"] 暴露吗？  
Domain Expert: 不要。Session Store 是 core 内部模块，Runtime Controller 通过对象引用使用它，不通过 Koishi Service 图传递。
