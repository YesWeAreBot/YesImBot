# Session-Centric Runtime 绿地实现建议

本文是对 `docs/ideas/session-centric-runtime.md` 的补充。
它讨论的不是运行时内部机制本身，而是 Athena vNext 应如何在当前仓库中落地实现。

## 结论

- 推荐在单独分支中推进 Athena vNext。
- 推荐在仓库内创建全新顶层目录承载 vNext，而不是在现有 `core/` 主干内渐进式改造。
- 推荐把现有代码库视为参考资产库，而不是迁移起点。
- 推荐主动放弃大部分中间兼容层，只保留少量稳定接口边界。

这意味着：

- 不再要求旧 runtime 逐步演化为新 runtime。
- 不再要求新 runtime 继承当前 `Percept / Scenario / Capabilities / RoundContext` 抽象。
- 不再要求设计一套长期存在的双栈桥接层来维持旧 loop 与新 loop 并存。

## 为什么推荐绿地实现

### 1. 可以显著降低心智负担

- 当前主运行时的组织方式是围绕频道事件、聚合窗口、队列、手写 JSON action loop 展开的。
- vNext 的目标则是围绕 `session -> mailbox -> runtime loop -> append-only state` 展开。
- 如果在旧目录中直接重构，设计过程会持续受到旧抽象牵制，开发者需要反复思考映射关系、兼容方式与临时过渡结构。
- 如果在新目录中绿地实现，设计时只需要面向目标态，不必反复处理旧系统的语义债务。

### 2. 更符合方向文档本身的前提

- `docs/ideas/session-centric-runtime.md` 已明确说明：新 runtime 不以兼容当前实现为目标。
- 既然目标是切换运行时范式，那么“在旧骨架内渐进改良”通常只会增加复杂度，而不会真正降低风险。

### 3. 现有仓库的价值主要是参考与复用外围资产

- 当前仓库仍然有高价值资产，例如 model provider、prompt 组装、角色文件、部分 plugin 基础设施、压缩与摘要经验。
- 这些资产可以被选择性复用，但不需要倒逼核心 runtime 继承旧边界。
- 绿地实现让“复用资产”与“继承架构”彻底解耦。

## 这不代表完全不需要边界设计

不考虑中间过渡态，并不等于可以完全不考虑集成边界。

应当放弃的是：

- 旧 runtime 如何一步步演变成新 runtime 的路径设计。
- 旧 runtime 与新 runtime 的长期双向兼容。
- 为了复用旧代码而保留不合适的中间抽象。

仍然必须提前定义的是：

- vNext 与模型层之间的接口。
- vNext 与 prompt / role 文档资产之间的接口。
- vNext 与 tool/plugin 注册机制之间的接口。
- vNext 与历史、摘要、记忆后端之间的数据边界。

换句话说，应该避免“运行时过渡态”，但应该保留“基础设施契约”。

## 推荐的仓库落地方式

### 分支策略

- 在独立长期分支中推进 vNext，例如 `feat/session-runtime-vnext`。
- 默认假设该分支允许较大规模结构调整，不以频繁回合并为首要目标。
- 当 vNext 主链路跑通后，再决定是整体替换、并行发布，还是按能力回迁。

### 目录策略

- 在仓库内新增全新顶层目录，例如 `vnext/`。
- 不建议把新实现直接放进现有 `core/src/services/` 下，以免新旧服务图互相污染。
- 不建议在旧 runtime 目录中新增大量 `v2`、`next`、`experimental` 文件与条件分支。

一个建议性的目录轮廓如下：

```text
vnext/
  runtime/
    session/
    loop/
    lifecycle/
    mailbox/
  history/
    store/
    summary/
    archive/
  prompt/
  role/
  tools/
  adapters/
    koishi/
    model/
  background/
    arousal/
    memory/
  shared/
```

这只是逻辑分层示意，不要求与最终 workspace 切分完全一致。

## 哪些资产应直接参考或复用

### 优先复用

- `packages/shared-model/`：继续作为 provider/model contract 的主要来源。
- `core/src/services/model/`：优先复用 provider 注册、fallback、限流、调用包装等能力。
- `core/src/services/prompt/`：优先复用 prompt fragment、section、render pipeline 的成熟实现经验。
- `core/src/services/role/`：继续复用 `SOUL.md`、`AGENTS.md`、`TOOLS.md` 等文档资产装配经验。

### 参考实现但不要整体搬运

- `core/src/services/horizon/listener.ts`：参考事件摄入、消息格式化、成员信息更新经验。
- `core/src/services/horizon/compressor.ts`：参考摘要触发、归档和压缩节奏。
- `core/src/services/plugin/`：参考插件注册、schema 暴露、生命周期管理，但不要继承 capability/action 语义。
- `core/src/services/memory-agent/`：参考 background agent 的职责边界，以及 ai-sdk tool loop 的使用方式。
- `core/src/services/arousal/`：参考主动唤醒策略与后台调度边界。

### 明确禁止继承为核心骨架

- `core/src/services/agent/`
- `core/src/services/runtime/`
- 旧的 `Percept / Scenario / Capabilities / RoundContext` 契约
- 旧的 `send_message` 主协议
- 旧的 tool / action 二元执行模型

## vNext 应遵守的实现纪律

### 1. 不为兼容旧 runtime 而设计核心对象

- `session state`、`runtime context`、`tool context` 的字段应直接服务于新 loop。
- 若某个字段只是为了映射旧的 `Scenario` 或 `RoundContext`，则不应保留。

### 2. 不复制旧的 orchestration 边界

- listener 只负责 ingress。
- runtime 自行管理 mailbox、busy、abort、resume。
- history / summary 层只负责持久化与查询支持。
- background agent 通过事件进入 session，而不是劫持主循环内部状态。

### 3. 不把旧协议语义包装成新接口皮肤

- 不要在新目录里用新名字重写一遍旧的 JSON action loop。
- 不要把 capability gating 改个壳后继续作为核心调度手段。
- 不要把 `send_message` 继续当作当前频道可见输出的主要协议。

## 第一阶段最小目标

建议第一阶段只追求一个最小闭环，而不是一开始复刻 Athena 全功能。

最小闭环应至少包含：

- 一个 Koishi 入口适配器，把消息写入 session mailbox。
- 一个 `SessionRuntimeService`，管理 `sessionId -> state`。
- 一个 append-only session event store，优先使用 JSONL。
- 一个基础 prompt 装配器，可注入 `SOUL.md` / `AGENTS.md` / `TOOLS.md`。
- 一个原生 tool-call loop，支持当前频道直接文本输出。
- 一个最小工具集，例如读取角色信息、写入事件、少量平台能力。
- 一个基础 summary 机制，用于长 session 回收与恢复。

第一阶段不必强求：

- 完整 memory agent
- 完整 arousal agent
- 跨频道协作
- 复杂工具并发
- 与旧 runtime 的互操作

## 与主仓库未来合流的方式

未来若需要把 vNext 接回主仓库，优先方式应是：

- 以新目录作为独立子系统接入。
- 通过少量稳定接口复用现有 provider、prompt、role、部分 plugin 资产。
- 在新 runtime 跑稳后，再决定旧 `core/` 是保留、裁剪，还是替换。

不建议的方式是：

- 在 vNext 成型后再回头强行对齐旧抽象。
- 为了看起来“迁移平滑”而引入长期双栈耦合。
- 在主干里大量散布条件分支来同时维护两套运行时语义。

## 最终建议

- 把 Athena vNext 视为仓库内的绿地子系统。
- 把当前仓库视为资产库、经验库和对照样本。
- 研发阶段尽量不考虑中间过渡态。
- 只提前约束少量真正需要复用的接口边界。

如果这个原则成立，那么“全新目录 + 独立分支”不是额外成本，而是主动降低复杂度的手段。
