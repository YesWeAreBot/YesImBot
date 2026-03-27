# Session-Centric Runtime 方向草案

本文基于 `references/DESIGN.md`、当前讨论结果，以及现有 Athena 实现经验整理。
它描述的是一套新的 runtime 起点，不以兼容当前实现为目标，也不要求继承现有抽象。

## 定位

- Athena vNext 应被视为新的 session-centric agent runtime。
- 当前代码库的价值主要在于提供经验、边界案例、服务拆分线索，以及 Horizon / memory / arousal / prompt 等模块的实现参考。
- 这份方向文档不要求兼容当前 `Percept / Scenario / Capabilities / RoundContext` 体系，也不要求保留现有 `tool vs action` 代码边界。

## 设计目标

### 1. 频道 session 是唯一核心运行单元

- 每个频道绑定唯一 `session_id`，对应唯一 channel agent。
- channel agent 自行持有 session state、mailbox、busy 状态、turn 生命周期、中断与恢复能力。
- 系统首先管理 session，而不是管理一套共享的全局上下文对象。

### 2. listener 只负责摄入事件

- listener 继续负责监听 Koishi 事件。
- listener 收到事件后，只做路由与写入：将事件推送给匹配的 agent state / session mailbox。
- listener 不负责主循环调度，不负责组织上下文，也不负责替 agent 决定后续行为。

### 3. agent 模块自行管理执行生命周期

- 新消息、heartbeat、定时触发、恢复执行等，都由 agent runtime 自行管理。
- 若 agent 当前忙碌，新事件应进入该 session 的待处理队列，在 `turn_end` 后继续处理。
- 若单轮执行超时，runtime 可以主动 `abort()`，等待后续事件再次唤醒或立即恢复。
- 是否 `continue`、`stop`、`abort`，由 runtime 决定，不要求模型显式承担调度责任。

## 架构取向

### 4. 完全删除 capability 抽象

- 不再保留 capability 作为上游统一抽象层。
- 频道能力在 session 初始化时就应基本固定，例如发送消息、获取成员、管理群组、互动能力等。
- 这些能力可以在 channel agent 创建时直接装配成工具、平台适配器、原始 Koishi session 引用，或 agent state 上的直接字段。
- 工具内部可以手动解析 `toolCtx`，也可以直接访问原始 Koishi session 与 agent state；上层不必再提供复杂的动态能力发现与门控框架。

### 5. Horizon 收敛为历史/摘要/查询适配层

- Horizon 不再作为 orchestration center，也不再承担主循环上下文编排责任。
- Horizon 的职责收敛为：历史读取、摘要生成、归档、压缩、查询支持。
- `AgentSessionStore` 可以直接依赖 Horizon 的这些能力，把它当作 session 的长期历史与查询后端。
- listener 负责摄入事件，agent 负责运行时状态，Horizon 负责历史适配；三者边界应清晰分离。

### 6. session 持久化以 append-only 为基础

- 不手动维护临时 `messages[]` 列表作为主要状态源。
- 每次交互都视为向 session 追加事件。
- JSONL 事件流是首选持久化形式。
- 为控制恢复成本，应配合 snapshot、summary、上下文裁剪等机制。
- 长时间不活跃 session 可自然触发摘要、压缩、滚动清理或归档。

## 主循环与工具执行

### 7. 使用原生 agent runtime，不手写 JSON action loop

- 优先使用 `pi-agent` 或 ai-sdk agent 风格的特化执行流。
- 不再要求模型输出 JSON 文本，再由 runtime 手动解析 `actions`。
- 模型调用、tool call、停止条件与恢复逻辑，应尽量由 runtime 与 agent 框架承担。

### 8. 不在代码层硬区分 tool 与 action

- 从代码接口上看，action 只是特殊的 tool。
- 不必为两者建立两套独立注册、执行、调度协议。
- 但在 runtime 语义上，仍应承认某些 tool 是终局型动作：执行成功后通常不需要继续请求 LLM。

### 9. action 型 tool 执行后默认中断 loop

- 当某个 tool 属于终局型动作，且执行成功后，runtime 默认结束本轮。
- 为了满足 agent loop 对 assistant 响应的规范要求，runtime 可以手动构造一条 assistant 消息，模拟该轮已经自然完成。
- 这条消息的含义应接近“动作已成功执行，本轮不需要进一步行动”，而不是再次请求模型复述。
- 这种做法既符合实际交互，也能减少一次无意义的 LLM 往返。

### 10. 文本输出与工具调用都应贴近真实交互

- 对当前频道的用户可见文本，不需要再依赖 `send_message` 这类专门工具。
- 模型面向当前频道生成的文本，应直接作为频道消息发送。
- 工具执行结果、动作回执、控制事件，应以 session 事件形式记录，供后续恢复、摘要和查询使用。
- 若未来需要保留少量格式化输出能力，也应作为 runtime 的兼容策略，而不是主协议。

### 11. 多工具调用与输出顺序仍需进一步研究

- 原生 tool call 是否支持并发执行，需要结合目标 agent 框架和 provider 行为验证。
- 单轮中若同时存在用户可见文本与工具调用，需要明确顺序模型：先说再调、先调再说，还是拆成多个内部步骤。
- 当模型只输出文本但 runtime 判断仍需后续动作时，应由 runtime 决定是否继续，而不是沿用旧的 JSON loop 约束。

## 多 agent 协作

### 12. main agent 只管当前频道

- channel|chat|main agent 负责在当前频道内交流。
- main agent 不直接访问其他频道上下文。
- 不同频道之间通过 A2A、事件、消息或显式任务进行通信，而不是共享上下文。

### 13. heartbeat / arousal agent 负责主动唤醒

- heartbeat|arousal agent 是后台 agent，负责监控所有 main agent 的状态。
- 它可以读取 main agent 的摘要状态，例如上次回复时间、最新消息、活跃程度、待处理情况等。
- 它向目标 main agent 发出 heartbeat / arousal 事件，实现主动关怀、挑选被跳过但值得回复的话题、避免冷场、触发提醒等能力。
- 这些行为应通过事件驱动进入目标 session，而不是直接劫持主循环内部状态。

### 14. memory / knowledge agent 负责长期维护

- knowledge|memory agent 也是后台 agent，负责知识库、记忆库、摘要与长期维护。
- 它向 main agent 提供查询接口，而不是把长期记忆管理逻辑塞进主循环。
- 它还可以承担知识自动更新、记忆维护、上下文压缩等工作。

## 文档化记忆与自定义 agent

### 15. 角色与记忆文档仍然是重要载体

- `AGENTS.md`、`SOUL.md`、`USER.md`、`MEMORY.md`、`TOOLS.md` 等文件继续作为自定义 agent 与持久化记忆的重要载体。
- 这些文档在 session 初始化时自动注入，并可在 reload 时重新装载。
- 不同频道 agent 可以共享这些文档，因此需要并发锁、来源记录和更新治理。

### 16. 文档块需要具备元数据与预算

- 每个文档块应带有最后更新时间。
- 当块内容过期时，runtime 应主动提醒 agent 更新。
- 每个块应记录上次更新者信息，例如 channel、agent_id 或其他来源标识。
- 每个块都应有预算上限，超过预算时要能截断、滚动或重写。

## 保留并继承的经验

### 17. 上下文裁剪与摘要压缩继续保留

- 软裁剪、硬裁剪、summary 压缩等策略仍然有效。
- 新 runtime 虽然不复用旧主循环，但应继承现有实现中关于上下文窗口控制的经验。
- Horizon 或其后继摘要层，仍然是这些能力的合适落点。

## 对当前实现的参考态度

- 这里讨论新 runtime，是为了复用现有实现经验，而不是为了保持兼容。
- 现有代码可以作为参考来源，尤其适用于：
  - listener 与消息接入经验，
  - Horizon 的历史/压缩能力，
  - arousal 与 memory 后台服务的边界经验，
  - 角色文件注入与 prompt 管理经验，
  - 各类失败场景、聚合、排队、中断等行为经验。
- 当现有抽象与新设计冲突时，应优先选择更符合 session-centric runtime 的方案，而不是迁就旧代码。

## 仍待收敛的开放问题

- 目标 agent runtime 选型：`pi-agent`、ai-sdk agent，还是两者混合。
- session JSONL schema 设计：`channel_message`、`tool_result`、`action_receipt`、控制事件等如何统一表达。
- 终局型 tool 的声明方式：通过 metadata、约定命名，还是 runtime 注册参数。
- 文本输出与 tool call 共存时的顺序语义。
- 多工具并发、顺序执行、失败恢复的统一策略。
- 共享文档块的锁、版本与合并策略。
