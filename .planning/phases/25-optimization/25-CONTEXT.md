# Phase 25: Optimization - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Working memory 的时间一致性优化 + System prompt 的 provider 级缓存。使工具条目与对话历史建立因果关联，精简冗余的 send_message 记录，并在 Anthropic provider 上启用 system prompt 缓存以降低 token 成本。不涉及新功能添加或架构重构。

</domain>

<decisions>
## Implementation Decisions

### 触发位置标记 (OPT-03)
- 消息使用简单递增整数 ID（1-999 循环，不补零），溢出后从 1 重新开始
- 平台原始长 ID（7位+，各适配器不同）通过映射表转为短递增 ID，工具层透明解析——LLM 只看到和使用短 ID，工具接收后自动还原为平台长 ID
- History 消息使用 XML 属性标记格式：`<msg id="N" sender="name" senderId="uid">内容</msg>`
- 回复消息额外标记 `replyTo="M"` 属性，必要时召回被回复的原文进行内联
- 消息内容本身为 koishi 消息元素格式（类 XML），外层 XML 属性包裹自然一致，且天然防御提示词注入
- Working memory 工具条目：保留现有 Round 标记 + 增加 `triggered by #N` 关联到消息 ID
- 混合方案：history 用内联紧凑标记（XML 属性），working memory 用结构化字段（triggeredAt）

### send_message 精简策略 (OPT-04)
- 始终省略 send_message 的内容参数（LLM 自己生成的内容它已经知道），只保留执行结果摘要
- 成功时最简格式："sent #N, ok"（N 为目标消息短 ID）
- 失败时保留错误原因："sent #N, failed: timeout"
- 本次只对 send_message 做精简，其他工具结果保持现状
- 架构上预留扩展空间，未来可对其他工具结果应用类似精简策略

### Cache breakpoint 策略 (OPT-01)
- System prompt 稳定/动态二分：soul + instructions 为稳定部分，working memory + 动态上下文为动态部分
- 所有 provider 统一「稳定内容在前、动态内容在后」的排列策略，利于前缀匹配缓存
- Anthropic provider 在稳定 block 末尾标记 `cache_control: {type: "ephemeral"}`
- 通过 response usage 中的 `cache_creation_input_tokens` / `cache_read_input_tokens` 字段观测缓存命中情况
- 在 debug 日志中记录 cache 相关 token 用量

### Provider 检测与回退 (OPT-02)
- Provider 注册时显式标记类型（anthropic / openai / deepseek / glm 等），不通过 model ID 推断
- 所有 provider 统一「稳定在前、动态在后」排序策略——GLM/DeepSeek 靠前缀匹配自动受益
- Anthropic 在统一排序基础上额外注入 `cache_control` 标记
- 非 Anthropic provider 回退为字符串拼接，debug 日志记录 "cache not supported for provider: xxx"
- 预留 provider 类型 → cache 策略的扩展接口，本次只实现 Anthropic

### Claude's Discretion
- 短 ID 映射表的具体数据结构和生命周期管理
- Working memory triggeredAt 字段的精确格式
- System prompt content blocks 的具体拆分粒度
- Cache 观测日志的格式和级别阈值
- 扩展接口的具体抽象设计

</decisions>

<specifics>
## Specific Ideas

- History 消息 ID 设计需要支持未来的消息操作（撤回、禁言、回复等），不仅仅是 working memory 关联
- v3 和 dev 版本都使用紧凑单行内联文本，曾用过 XML 属性标记——这次选择 XML 属性标记，兼顾结构清晰和提示词注入防御
- koishi 消息元素本身是类 XML 格式，外层用 XML 属性包裹保持风格一致
- GLM/DeepSeek 的隐式前缀缓存机制：只要 system prompt 前部不变，后端自动缓存——统一排序策略让所有 provider 都受益

</specifics>

<deferred>
## Deferred Ideas

- 其他工具结果的精简策略（search_memory、recall 等）——未来可扩展，本次只做 send_message
- 全 provider 缓存抽象（各 provider 缓存语义不同）——先做 Anthropic-only + 统一排序

</deferred>

---

*Phase: 25-optimization*
*Context gathered: 2026-02-25*
