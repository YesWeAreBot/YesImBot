# Athena

Athena 是一个围绕长期会话 Agent、Koishi runtime、以及可热重载扩展构建的单一上下文项目。这里的领域语言主要描述 agent 运行时与 core 扩展系统之间的边界。

## Language

**Extension Service**:
core 中扩展系统的唯一真实来源。它拥有扩展定义、扩展生命周期、per-channel 重载，以及向 agent 下发扩展工具状态的职责。
_Avoid_: ExtensionRegistry, runner manager

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
Athena 自己的 agent-to-platform interaction seam，位于 Koishi `Session`/`Bot` 之上、agent/session 行为之下。它负责 Koishi 事件观察接入、呈现 AthenaEvent、发送 agent 输出、处理 speak element 能力与发送异常；它不等同于 Koishi `Bot`，也不负责群聊行为决策。
_Avoid_: Koishi Bot, raw platform adapter, delivery-only sender

Athena Bot 采用 global service + per-channel runtime 形态。global service 是 Koishi 事件观察注册表的 owner；per-channel Athena Bot 是 Channel Runtime 的一部分，与 AgentSession 并列；它不包含 AgentSession，也不把事件观察方法作为外部扩展点。

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

**BehaviorPolicy**:
未来 core 应用层的群聊行为决策 owner，负责是否回应、沉默、延迟、跟进或升级到 LLM 判断。它不属于 Athena Bot、AgentSession、RuntimeService 或 Koishi adapter。
_Avoid_: adapter trigger decision, AgentSession social logic, RuntimeService behavior block

**Session Header**:
会话文件的头记录，只表达会话身份与树关系，不再承载文件系统路径。
_Avoid_: cwd metadata, workspace metadata

## Example Dialogue

Dev: 这个工具是 agent 自己注册，还是扩展系统注册？  
Domain Expert: 扩展工具由 Extension Service 收集成一个 Extension Tool Snapshot，再交给 agent 应用。  
Dev: 那 Hook Runner 负责 reload 吗？  
Domain Expert: 不负责。Hook Runner 只跑 hook；扩展生命周期在 Extension Service。  
Dev: Extension setup 里拿到的是 API 还是上下文？  
Domain Expert: 是 Extension Context。它携带当前 Channel，并提供扩展注册 hook、工具和副作用所需的上下文能力。  
Dev: Channel 里可以放 session manager 或 model 吗？  
Domain Expert: 不要。Channel 只表达 Koishi/platform 频道上下文；agent/session/model 属于 agent runtime 层。  
Dev: Athena Bot 和 Koishi Bot 是一回事吗？  
Domain Expert: 不是。Koishi Bot 是平台 SDK 对象；Athena Bot 是 Athena 内部交互 seam，用来统一 Koishi 事件观察接入、事件呈现、输出投递、Speak Markup 和失败一致性。  
Dev: Athena Bot 负责决定群聊里该不该回复吗？  
Domain Expert: 不负责。是否回应、沉默、延迟或升级判断属于未来 BehaviorPolicy；Athena Bot 只负责平台交互。  
Dev: ctx.sendMessage 是向平台发消息吗？  
Domain Expert: 不是。ctx.sendMessage 是向 AgentSession 添加 custom message；平台发送应由 Athena Bot 的 speak 路径负责。  
Dev: 模型可以随便输出 Koishi 消息元素吗？  
Domain Expert: 不可以。模型只能使用当前注册的 Speak Markup；未知标签会作为纯文本处理。  
Dev: Session Header 里还要保存 cwd 吗？  
Domain Expert: 不要。Session Header 只保留会话身份和树关系。
