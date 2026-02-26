# Phase 29: Runtime Bug Fixes - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

修复三个已知运行时缺陷：消息积压丢失（REQ-01）、空 Bot Action 记录（REQ-02）、working memory 无限增长（REQ-03）。系统在消息突发、沉默选择和长对话场景下行为正确。

</domain>

<decisions>
## Implementation Decisions

### 消息队列合并策略（REQ-01）
- pending 从单槽 Map 改为数组队列存储
- drain 时全部拼接，按时间顺序组织
- trigger 语义扩展：不再仅限于 status=new 的消息，而是"时间段内的消息集合"，起始点为第一条积压消息
- 积压期间 bot 自己发送的消息也纳入 trigger 作为上下文（bot 消息比积压消息新但不是未读）
- drain 后复用现有聚合窗口（短窗口），避免连续快速消息被拆成两批
- trigger 和 history 共享容量上限，超出时丢弃最早的消息
- drain 后的合并请求强制回复，跳过意愿值判定（用户已等了一轮响应时间）

### 沉默判定与过滤逻辑（REQ-02）
- 不是"空 actions 不记录"，而是改变渲染方式
- timeline 照常记录完整的原始 response，保持 agent.response 结构不变
- 运行时渲染/展示时判断：actions 为空时渲染为"选择沉默"标记（如 "you skipped this round"），而非空的 [Bot Action]
- 在调用 recordAgentResponse 之前做守卫判断（agent 层）
- 区分「LLM 主动沉默」和「LLM 出错无输出」：主动沉默正常记录沉默标记，出错时记录错误标记到 timeline

### 初始上下文裁剪预算（REQ-03）
- messages[0]（初始用户上下文）受独立的固定 token 上限约束
- 该上限作为可配置参数暴露给用户
- 超出时从开头截断，保留末尾（最近信息）
- 按消息边界截断，保持语义完整性（不在句子中间断开）

### Claude's Discretion
- 积压队列的具体数据结构选择（数组 vs 其他队列实现）
- 沉默标记的具体文本内容和格式
- 初始上下文 token 上限的默认值
- 错误标记的具体展示方式

</decisions>

<specifics>
## Specific Ideas

- trigger 语义的核心变化：从"未读消息集合"变为"时间段内的消息集合"，时间起始点为第一条积压消息
- 积压消息附加说明如"这是刚才遗漏的消息"，让 LLM 理解上下文
- bot 自己的响应消息虽然比积压消息新，但仍需纳入 trigger 作为完整上下文

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 29-runtime-bug-fixes*
*Context gathered: 2026-02-26*
