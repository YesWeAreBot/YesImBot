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
候选领域词，表示 Athena 自己的 agent-to-platform interaction seam。它可能统一当前 adapter 的平台事件归一化/消息元素格式化职责与 delivery 的输出投递/失败一致性职责，但不等同于 Koishi `Bot`。
_Avoid_: Koishi Bot, raw platform adapter, delivery-only sender

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
Domain Expert: 不是。Koishi Bot 是平台 SDK 对象；Athena Bot 是候选的 Athena 内部交互 seam，用来统一平台输入归一化、消息格式化、输出投递和失败一致性。  
Dev: Session Header 里还要保存 cwd 吗？  
Domain Expert: 不要。Session Header 只保留会话身份和树关系。
