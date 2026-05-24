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

**Session Header**:
会话文件的头记录，只表达会话身份与树关系，不再承载文件系统路径。
_Avoid_: cwd metadata, workspace metadata

## Example Dialogue

Dev: 这个工具是 agent 自己注册，还是扩展系统注册？  
Domain Expert: 扩展工具由 Extension Service 收集成一个 Extension Tool Snapshot，再交给 agent 应用。  
Dev: 那 Hook Runner 负责 reload 吗？  
Domain Expert: 不负责。Hook Runner 只跑 hook；扩展生命周期在 Extension Service。  
Dev: Session Header 里还要保存 cwd 吗？  
Domain Expert: 不要。Session Header 只保留会话身份和树关系。
