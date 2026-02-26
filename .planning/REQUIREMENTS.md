# Requirements: v2.4 Runtime & Polish

## Bug Fixes

### REQ-01: 消息队列积压合并

**Priority:** Must Have
**Category:** Bug Fix

pending 单槽 Map 导致积压消息丢失且逐条触发响应。改为数组存储，处理完成后合并积压消息一次性响应。

**Acceptance criteria:**
- pending 从单槽改为数组（或队列）
- 处理中收到的新消息追加到积压队列
- 当前响应完成后，drain 积压队列合并为一次请求
- 不影响现有聚合窗口（pre-enqueue 逻辑不变）

### REQ-02: Bot Action 空记录过滤

**Priority:** Must Have
**Category:** Bug Fix

LLM 选择沉默时 `recordAgentResponse()` 无条件调用，写入空 `[Bot Action]` 到 timeline。

**Acceptance criteria:**
- actions 为空时跳过 `recordAgentResponse` 调用
- timeline 中不再出现空 `[Bot Action]` 记录
- 正常回复行为不受影响

### REQ-03: Tool trim 修复

**Priority:** Must Have
**Category:** Bug Fix

`trimMessages()` 对 `messages[0]`（初始用户上下文）永远不裁剪，`totalRounds = Math.floor((1-1)/2) = 0`，导致 working memory 无限增长。

**Acceptance criteria:**
- 初始用户上下文受独立裁剪预算约束
- working memory token 数量在多轮对话中保持稳定
- 不破坏当前轮上下文完整性

## Model Service

### REQ-04: 模型组与负载均衡

**Priority:** Should Have
**Category:** Enhancement

支持将多个模型实例分组，通过 `group:` 前缀路由，提供 round-robin/random/failover 策略。

**Acceptance criteria:**
- 配置中可定义模型组（名称 + 成员列表 + 策略）
- `resolveModel()` 识别 `group:` 前缀并路由到具体模型
- 支持 round-robin、random、failover 三种策略
- failover 与现有 fallbackChain 语义不冲突
- 模型组成员故障时自动跳过（带冷却期）

### REQ-05: Provider 架构统一

**Priority:** Should Have
**Category:** Enhancement

三个 provider 插件存在大量重复代码。抽取 `BaseProvider` 抽象类和 `createBaseProviderSchema` 工厂。

**Acceptance criteria:**
- `BaseProvider` 抽象类封装公共逻辑（listModels、getDefaultParams、注册流程）
- `createBaseProviderSchema()` 工厂生成公共配置 Schema
- 三个 provider 插件继承 BaseProvider，消除重复代码
- 不改变现有 provider 的外部行为

## Config UX

### REQ-06: 配置分组优化

**Priority:** Should Have
**Category:** Enhancement

Koishi Console 配置 UI 当前为平铺列表，不易阅读。使用 `Schema.intersect` 各子 schema 的 `.description()` 实现 UI 折叠分组。

**Acceptance criteria:**
- 配置项按功能分组（基础、模型、意愿值、提示词、高级等）
- 每个分组有中文标题和简要说明
- 保持 intersect 平铺结构，不引入嵌套 object（避免破坏配置兼容性）
- Console UI 中各分组可折叠展开

### REQ-07: Schema 描述增强

**Priority:** Should Have
**Category:** Enhancement

配置项缺少中文描述，用户难以理解各项含义。为每个配置项添加描述和默认值说明。

**Acceptance criteria:**
- 所有配置项有中文 `.description()` 描述
- 关键配置项标注默认值和取值范围
- 描述通过 i18n key 引用（配合 REQ-08）

### REQ-08: i18n 国际化

**Priority:** Should Have
**Category:** Enhancement

提取配置文本，实现国际化。参考 Koishi i18n 模式，使用 locales 目录存放翻译文件。

**Acceptance criteria:**
- core 和各 provider 插件创建 `locales/zh-CN.yml` 和 `locales/en-US.yml`
- Schema `.description()` 使用 i18n key 引用
- 通过 `ctx.i18n.define()` 或 locales 文件注册翻译
- 中文为主语言，英文为辅助语言
- 不影响现有配置值和默认行为

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| REQ-01 | Phase 29 | Complete |
| REQ-02 | Phase 29 | Pending |
| REQ-03 | Phase 29 | Pending |
| REQ-05 | Phase 30 | Pending |
| REQ-04 | Phase 31 | Pending |
| REQ-06 | Phase 31 | Pending |
| REQ-07 | Phase 31 | Pending |
| REQ-08 | Phase 31 | Pending |
