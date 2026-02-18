# Phase 7: Core Wiring Fixes - Context

**Gathered:** 2026-02-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire missing runtime connections identified by v1 milestone audit. Specifically: bundle a default system prompt template, and add empty-render warnings in PromptService. AgentIdentity injection is explicitly OUT of scope — identity customization is handled entirely through user-provided prompt templates.

</domain>

<decisions>
## Implementation Decisions

### Default system template content

- **定位**: 最小人格 + 功能性指令的 fallback 保底模板
- **语言风格**: 混合——结构性 XML 标签用英文（如 `<identity>`、`<style>`），指令内容用中文
- **结构**: 精简版单体模板，包含三个核心模块：identity（核心身份）、style（交互风格）、how_you_work（运行原理）
- **内容深度**: 从 dev 版 identity.mustache 精简而来，保留核心指令但去掉过于具体的条目（如打错字、自嘲等具体行为）
- **Mustache 变量**: 引用 view 数据（`{{view.self.name}}`、`{{view.environment.name}}` 等），让模板能动态展示当前环境信息
- **不包含**: memory/tools/output 模块（v4 中这些由 Horizon view 和 ai-sdk 自动处理）
- **覆盖机制**: 用户通过 config.templates.system 提供自定义模板时，完全替换默认模板（已有机制，无需改动）

### AgentIdentity — 不做

- AgentIdentity config 字段保留但不注入 prompt scope
- 用户通过自定义 system 模板实现人格定制，不需要代码层面的 identity 注入
- 原审计发现的 "identity not injected into prompt scope" 通过模板机制解决，不通过代码注入

### 空模板警告

- PromptService.render() 返回空字符串时打 warn 级别日志
- 仅警告，不自动 fallback 到默认模板
- 调用方（ThinkActLoop）自行决定如何处理空 prompt

### Claude's Discretion

- 默认模板中 identity/style/how_you_work 各模块的具体措辞
- Mustache 条件渲染的具体写法（如 environment 缺失时的处理）
- warn 日志的具体消息文本

</decisions>

<specifics>
## Specific Ideas

- 参考 dev 版 `identity.mustache`（D:\Codespace\koishi-dev\YesWeAreBot\YesImBot-dev\packages\core\resources\templates\partials\identity.mustache）作为内容基础，精简其中过于具体的行为条目
- 参考 v3 版 `memgpt_v2_chat.txt` 的 control_flow 部分作为 how_you_work 模块的灵感
- dev 版的可组合 partial 框架（agent.system.chat.mustache）作为未来扩展参考，但 Phase 7 不实现 partial 拆分

</specifics>

<deferred>
## Deferred Ideas

- AgentIdentity 代码注入机制 — 如果未来需要，可作为独立 phase
- 模板 partial 拆分（像 dev 版那样 identity/environment/tools 分离）— 未来扩展
- memory blocks 在 system prompt 中的渲染 — 等 memory 系统实现后再做

</deferred>

---

_Phase: 07-core-wiring-fixes_
_Context gathered: 2026-02-19_
