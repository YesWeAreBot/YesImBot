# Phase 16: PromptService Redesign + HorizonView - Context

**Gathered:** 2026-02-21
**Status:** Ready for planning

<domain>
## Phase Boundary

将现有的扁平 PromptService 重构为多 section 命名注入点架构，支持 partial 组合、ctx 生命周期自动清理；同时让 HorizonView 输出结构化对象供模板 partial 消费。去掉 tools/output 注入点（v4 使用原生 tool call）。

</domain>

<decisions>
## Implementation Decisions

### 注入点设计
- 6 个命名注入点，按变动频率从低到高排列（优化提示词缓存命中）：identity → style → core_memories → working_memory → environment → extra
- 去掉 tools 和 output 注入点——v4 已转向原生 tool call，工具直接附加到请求中
- extra 作为通用扩展点，供未来或第三方插件使用
- 同一注入点内多个注入使用 before/after 链式排序，锚点是其他已注册的注入（非默认内容）
- 禁止同名注入——同一注入点内注册同名注入时报错/警告
- 注入内容格式为纯文本字符串，插件完全控制格式

### 模板与 Partial 系统
- 主模板 + section partial 结构：一个系统模板通过 `{{>identity}}` `{{>environment}}` 等引用各 section 的 partial
- render() 返回 Section[] 数组（`{ name, content, cacheable? }`），支持多 system message 拆分以优化提示词缓存
- 同时提供 renderToString() 便捷方法（内部调用 render() 再 join）
- 允许插件覆盖默认 section partial——插件可以完全替换某个 section 的渲染方式

### HorizonView 输出格式
- HorizonView 输出为结构化对象 `{ environment, members, history }`，由模板 partial 各自渲染
- 先使用三层分区（environment/members/history），不引入额外分析器依赖，后期扩展
- HorizonView 与 PromptService 解耦——HorizonView 是独立服务，调用方（ThinkActLoop）负责桥接，将各分区数据注入到 PromptService 对应注入点

### 生命周期与清理
- inject() 接收 ctx 参数，绑定 Koishi ctx 生命周期自动清理——子插件卸载时其注入自动移除
- 热重载采用自然清理+重注册模式，中间有短暂空窗期但无需特殊处理
- PromptService 提供全局超时配置，防止耗时注入阻塞整个渲染流程；超时后静默跳过（返回空）
- 缓存和 fallback 由插件自行负责，PromptService 不内置缓存机制

### Claude's Discretion
- 各注入点的并行渲染策略
- 具体的超时默认值
- before/after 链式排序的冲突解决（循环依赖处理）
- Section[] 中 cacheable 标记的默认策略

</decisions>

<specifics>
## Specific Ideas

- memories 拆为 core_memories（稳定/长期记忆）和 working_memory（当前会话相关），参考 LETTA 的分层缓存策略
- v3 daily-planner 是耗时注入的典型场景（LLM 生成日程），应作为最佳实践示例
- v4 不再需要在提示词中描述工具 JSON Schema 和输出格式——原生 tool call 处理这些
- HorizonView 各分区分别注入到对应注入点，而非 dev 版本的整体塞入 USER PROMPT 槽位
- 结构化数据注入格式（插件返回结构化对象由 renderer 统一格式化）记为未来迭代方向

</specifics>

<deferred>
## Deferred Ideas

- 结构化数据注入格式（替代纯文本）——未来迭代优化
- channel_state 分区（频道状态如话题、气氛）——需要额外分析器，后期扩展
- 原子替换热重载（先注册新的再清理旧的，无空窗期）——当前自然清理足够

</deferred>

---

*Phase: 16-promptservice-redesign-horizonview*
*Context gathered: 2026-02-21*
