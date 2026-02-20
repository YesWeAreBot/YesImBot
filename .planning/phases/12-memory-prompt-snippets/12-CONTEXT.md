# Phase 12: Memory & Prompt Snippets - Context

**Gathered:** 2026-02-20
**Status:** Ready for planning

<domain>
## Phase Boundary

从文件系统加载记忆块（memory blocks）并通过内置 prompt snippets 将动态上下文注入每次 LLM 调用。参考 MemGPT/Letta 的核心记忆块设计。不包含记忆块自修改功能、L1/L2/L3 高级记忆系统、规则匹配/主动读取注入（后续迭代）。

</domain>

<decisions>
## Implementation Decisions

### 记忆文件格式与加载
- YAML frontmatter 字段：label、title、description（参考 MemGPT/Letta 设计，不使用 priority/tags）
- 未来添加记忆块修改工具时需增加 limit 字段
- 仅支持 .md 和 .txt 文件格式
- 单层目录结构，不支持嵌套子目录
- 热重载（watch）：监听文件变化自动重新加载

### 记忆注入与排序
- 全量注入：每次将所有记忆块注入 prompt，后续迭代再加上下文匹配逻辑
- 按文件名字母顺序排列
- 记忆块支持模板变量渲染（如 {{ bot.name }}）
- 添加 limit 字段控制总注入量，默认 4000 字符，超出时截断

### 默认 Persona Fallback
- 内置一个默认 persona.md 文件作为 fallback
- 中性通用风格（非 v3 的随性群友人设），让用户自行定制个性化
- persona 块是可选的个性化增强，不注入记忆块系统也可正常工作
- 支持模板变量（如 {{ bot.name }}、{{ date.now }}）

### 内置动态 Snippets
- 仅包含 ROADMAP 要求的 4 类：当前时间、用户昵称/ID、频道名/平台、bot 名称/ID
- 自然语言格式输出（非结构化键值对）
- 作为模板变量注入，供记忆块和 system prompt 模板引用
- 时间格式：中文友好格式（如「2026年2月20日 星期五 下午3:00」）

### Claude's Discretion
- 记忆块在 prompt 中的具体注入位置（system prompt 内嵌 vs 独立 message）
- 模板变量的命名空间设计
- 热重载的具体实现方式（fs.watch vs chokidar 等）
- 默认 persona.md 的具体文案

</decisions>

<specifics>
## Specific Ideas

- 参考 MemGPT/Letta (https://github.com/letta-ai/letta) 的核心记忆块设计
- v3 参考：`references/YesImBot-v3/packages/core/resources/memory_block/persona.md`
- dev 参考：`references/YesImBot-dev/packages/core/resources/memory_block/persona.md`
- 未来可参考 skills 设计，使用规则匹配或主动读取来注入记忆块（本 phase 不实现）
- persona 块只定义个性化回复风格，得益于系统提示词设计，不影响实际功能

</specifics>

<deferred>
## Deferred Ideas

- 记忆块自修改工具（MemGPT 风格的 core memory edit）— 未来 phase
- 规则匹配 / 主动读取注入（按上下文选择性注入记忆块）— 后续迭代
- L1/L2/L3 高级记忆系统 — 已在 REQUIREMENTS.md 标记为 out of scope

</deferred>

---

*Phase: 12-memory-prompt-snippets*
*Context gathered: 2026-02-20*
