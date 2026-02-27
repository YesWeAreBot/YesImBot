# Phase 32: Persona Customization UX - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

提供一个独立的 persona skill 插件，通过 Koishi 配置面板表单让用户直观地自定义人设内容，注入到 prompt 的 soul 注入点。不改动 core 功能，不改变 SOUL.md 的定位。SOUL.md 保持精简核心身份定义，persona skill 作为补充层提供详细人格特质配置。

分层/场景覆盖（按群组叠加不同人设）属于后续增强，不在本 phase 范围内。

</domain>

<decisions>
## Implementation Decisions

### 插件形态

- 独立插件（非 core 内置），用户可在 Koishi Console 中单独启用/禁用
- 不启用时不影响任何现有功能，SOUL.md + RoleService 照常工作

### 注入机制

- 作为 skill 注册到 SkillRegistry，lifecycle 为无条件常驻注入（per-turn，无 conditions）
- 注入到 soul 注入点，与 SOUL.md 的 `__role_soul` 内容区分
- 使用语义前缀区分（如「以下是补充人格特质：」），让 LLM 理解这是对 SOUL 的扩展而非替代

### 优先级关系

- SOUL.md 优先，persona skill 互补共存
- SOUL.md 有内容时：SOUL.md 排在前面定义核心身份，persona skill 内容作为补充排在后面
- SOUL.md 为空/默认时：persona skill 成为主要人设来源
- persona skill 未启用时：完全不影响现有行为

### 配置面板表单

- 精简字段 + 大文本区域的风格
- 3-4 个核心字段：名字、核心性格（短文本）、语气风格（短文本）、自由补充（大文本区域）
- 对话示例暂放在自由文本区域中，未来按需开发专用 skill
- 不提供注入内容预览（Koishi 配置面板不支持此功能）

### 预设模板系统

- 内置 2-3 个精选预设模板
- 配置面板提供下拉选择框，选择预设后自动填充各表单字段
- 用户可在填充基础上自由修改任何字段
- 切换预设时直接覆盖当前所有字段（Koishi 面板不支持切换前确认）

### Claude's Discretion

- 具体预设模板的内容设计（风格方向和文案）
- 表单字段的 i18n 描述文案
- 注入文本的拼接格式和语义前缀措辞
- 插件内部的 Schema 结构设计

</decisions>

<specifics>
## Specific Ideas

- SOUL.md 应该精简凝练，不应该塞大量内容。用户人设文件多达十几 ktoken 的情况，内容多是对话示例，这些更适合用 skills/references 实现
- persona skill 的定位是在"单文件全量配置"和"skills 编程注入"之间提供一个方便直观的中间层
- 表单 + 自由文本的混合模式：结构化字段引导基础配置，自由文本区域满足高级需求

</specifics>

<deferred>
## Deferred Ideas

- 分层注入（base persona + overlay）— 按群组/场景叠加不同人设片段，留作后续增强
- 对话示例专用 skill — 根据实际使用情况决定是否开发结构化的 few-shot examples skill
- 人设内容预览功能 — 如果 Koishi 未来支持自定义面板组件

</deferred>

---

_Phase: 32-persona-customization-ux_
_Context gathered: 2026-02-27_
