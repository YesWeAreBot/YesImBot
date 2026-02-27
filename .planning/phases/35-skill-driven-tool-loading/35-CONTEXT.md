# Phase 35: Skill-Driven Tool Loading - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

工具默认隐藏，只有当活跃的 Skill 显式 include 时才对 LLM 可见。搜索工具作为首个 Skill 工具落地，采用统一接口 + 注册机制支持多搜索后端。Phase 35 交付框架 + tavily 后端实现。

</domain>

<decisions>
## Implementation Decisions

### 搜索工具架构

- 统一接口 + 注册机制，参考 v3 的 `plugins/tts/src` 和 `plugins/code-executor/src` 模式
- LLM 只看到一个 `search` 工具，后端通过配置切换
- 配置选定活跃后端，工具参数 schema 动态反映该后端支持的参数
- Phase 35 交付：框架 + tavily 作为首个后端实现，其他后端后续 phase 添加

### 搜索工具行为

- 参数设计：query 必填 + 可选参数（limit、language 等，由活跃后端决定）
- 结果格式：结构化摘要列表（标题+摘要+URL），token 效率优先
- 错误处理：静默返回空结果（如"未找到相关结果"），LLM 自行决定下一步
- 调用方式：单一 HTTP endpoint，通过 `ctx.http` 调用

### 工具暴露策略

- 匹配粒度：按工具名精确匹配（Skill 的 `effects.tools.include` 写工具名如 `'search'`）
- 多 Skill 冲突：并集模式 — 只要任一活跃 Skill include 了该工具就保持可见
- 实现机制：hidden 标记切换 — 工具始终注册，Skill 激活时取消 hidden 标记

### 常驻工具机制

- `hidden: false` = 常驻可见（如 send_message），`hidden: true` = 需 Skill 启用
- 不需要额外 `alwaysVisible` 属性，hidden 默认值本身就区分了常驻与按需
- send_message 天然 `hidden: false`，无需特殊处理

### 工具列表动态性

- 每次构建 LLM 请求时重新计算当前活跃 Skill 的工具并集
- 对话中途 Skill 变化时无缝切换，下一轮 LLM 调用自动反映新工具列表
- 不逐次通知 LLM 工具变化，但在 system prompt 中说明工具列表是动态的

### Claude's Discretion

- 搜索接口的具体抽象层设计（trait/interface 结构）
- tavily API 的具体调用细节和参数映射
- 工具 hidden 标记的存储位置（工具定义上 vs 独立注册表）
- 结构化摘要列表的具体字段和格式

</decisions>

<specifics>
## Specific Ideas

- 参考 `references/YesImBot-v3/plugins/tts/src` 和 `references/YesImBot-v3/plugins/code-executor/src` 的多后端模式 — 统一接口，注册不同实现，只向 LLM 暴露一个工具
- 不同搜索后端可以有不同的可选参数，动态反映到工具参数 schema 中（配置切换后端 = 切换 schema）

</specifics>

<deferred>
## Deferred Ideas

- 更多搜索后端实现（brave、zhipu-web-search 等）— 后续 phase 按需添加
- 工具按类别标签批量暴露 — 当前按工具名精确匹配已足够

</deferred>

---

_Phase: 35-skill-driven-tool-loading_
_Context gathered: 2026-02-27_
