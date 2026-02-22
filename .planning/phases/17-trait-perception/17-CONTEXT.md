# Phase 17: Trait Perception - Context

**Gathered:** 2026-02-22
**Status:** Ready for planning

<domain>
## Phase Boundary

多维度对话上下文分析框架。多个 TraitDetector 并行分析 HorizonView，产出类型化的 TraitSignal 供下游 Skill 系统消费。不包含 Skill 定义、激活和效果合并（Phase 18）。

</domain>

<decisions>
## Implementation Decisions

### Signal 协议设计
- 枚举维度 + 值结构：`{ dimension: string, value: string, confidence: number, metadata?: Record<string, unknown> }`
- 所有 Detector 输出汇总为 TraitSignal 数组，多值共存
- 一个 Detector 可输出多个 Signal（如 SceneTrait 同时输出 group-chat + mentioned）
- Skill 匹配采用"存在即匹配"——只看 Signal 是否存在，不看 confidence 阈值
- confidence 作为参考信息保留，不参与激活判定
- Detector 内部负责过滤低 confidence 结果，只输出它认为成立的 Signal

### 场景检测逻辑（SceneTrait）
- 四场景：group-chat、private-chat、mentioned、ignored
- 组内互斥，跨组共存：group-chat | private-chat 互斥；mentioned | ignored 互斥；跨组可组合（如 group-chat + mentioned）
- ignored 双触发条件：bot 发言后无人回应 OR 长时间未被提及，任一成立即触发
- mentioned 含名字提及：@ 符号或消息中出现 bot 名字均算 mentioned

### 热度追踪行为（HeatTrait）
- 衡量维度：纯消息频率（不考虑参与人数）
- 热度等级三档：low / medium / high
- 趋势方向三种：heating / cooling / stable
- heat level 和 trend 作为两个独立 Signal 输出（dimension 分别为 'heat' 和 'heat-trend'）

### 有状态 Trait 持久化
- 纯内存存储，重启后状态丢失（持久化留给后续迭代）
- TraitAnalyzer 提供统一状态 API（getState/setState），Detector 通过它读写状态
- 状态 scope 粒度：per-channel（与 Horizon 的 Scope 一致）
- 事件驱动实时更新：Detector 监听 horizon/message 等事件持续更新内部状态，detect() 时直接读取已有状态输出 Signal，不阻塞主路径

### Claude's Discretion
- TraitAnalyzer 的并行调度实现细节
- 统一状态 API 的具体接口设计
- HeatTrait 的时间窗口大小和阈值参数
- ignored 判定的具体消息数/时间阈值
- mentioned 名字匹配的模糊度策略

</decisions>

<specifics>
## Specific Ideas

- 用户强调 Trait 是全新概念，与之前系统（ChatMode 离散切换）完全不同——需要在设计中体现"连续感知"而非"模式切换"
- 事件驱动选择的考量：主路径零开销、未来可扩展更多事件源、接受最终一致性（可能读到略旧状态）

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 17-trait-perception*
*Context gathered: 2026-02-22*
