# Phase 9: Dynamic Schema Linkage - Context

**Gathered:** 2026-02-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Provider 插件注册的模型自动出现在主插件配置 UI 的下拉列表中，支持热插拔时自动刷新。不包含模型组、负载均衡、Circuit breaker 等高级模型管理功能。

</domain>

<decisions>
## Implementation Decisions

### Schema 注册键名设计
- 仅注册 chat 模型，键名为 `registry.chatModels`
- 不区分 chat/embed 模型类型，v4 当前只有 chat 场景
- 不引入模型组（availableGroups）概念
- Schema 选项值类型为 `provider:model` 字符串格式，与 v4 内部 fallback chain key 一致

### 模型列表呈现
- 下拉列表显示文本使用 `provider:modelId` 格式（与内部格式一致）
- 支持自定义输入 — union 末尾加一个自由文本选项，用户可手动填写 `provider:model`
- 主插件 Config 包含两个动态下拉字段：主模型（model）+ 备选模型（fallbackModel）
- 两个字段都使用 `Schema.dynamic('registry.chatModels')` 动态下拉

### Provider 注册接口
- 沿用现有 `registerProvider(name, provider)` 接口，不拆分为两步注册
- `IModelProvider` 接口新增 `listModels()` 方法，返回 `Record<string, ModelInfo>`
- `ModelInfo` 包含丰富元数据（description、能力标记等），不仅仅是 ID
- `registerProvider` 内部调用 `provider.listModels()` 提取模型列表并刷新 schema

### Provider 插件配置体验
- Provider 插件的模型配置列表使用 `Schema.array(Schema.object({...})).role('table')` 表格形式展示
- 模型能力标记（tool calling、streaming、vision 等）使用字符串数组 + checkbox role
- 独立 JSON 覆盖字段 — 表格外单独一个 JSON 文本框，按 modelId 匹配覆盖默认参数
- 表单尽可能简洁，高级定制通过 JSON 覆盖实现

### 热更新行为
- 注册和卸载都自动刷新 schema — `registerProvider` 内部调用 `refreshSchemas()`，provider dispose 钩子也触发 `refreshSchemas()`
- 已选中的模型被 provider 卸载后：配置值保留 + 日志警告（不自动清空）
- 运行时调用已卸载模型时：检查可用性，不可用则 fallback 到备选模型
- `ctx.schema.set()` 调用后 Koishi 控制台自动推送更新到前端，无需用户手动刷新

### Claude's Discretion
- `ModelInfo` 的具体字段设计（除 description 和能力标记外的其他元数据）
- `refreshSchemas()` 的具体实现细节
- Provider 插件 dispose 钩子的注册方式
- 自定义输入选项的 Schema 结构

</decisions>

<specifics>
## Specific Ideas

- v3-dev 的 `refreshSchemas()` 模式是主要参考：`ctx.schema.set('registry.chatModels', Schema.union([...options, customInput]))`
- Provider 插件配置参考 Koishi Schema 的 table role 和 checkbox role 用法
- JSON 覆盖字段让高级用户可以精细控制模型参数，同时保持基础表单简洁

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 09-dynamic-schema-linkage*
*Context gathered: 2026-02-20*
