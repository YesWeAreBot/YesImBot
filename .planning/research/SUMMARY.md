# Project Research Summary

**Project:** Athena (YesImBot v4)
**Domain:** Koishi AI chat plugin — runtime bug fixes, model group load balancing, provider architecture, config UX
**Researched:** 2026-02-26
**Confidence:** HIGH (direct source code analysis of v2.3 baseline)

## Executive Summary

v2.4 聚焦两个方向：修复三个运行时 bug 和三个架构增强。

Bug 修复根因已全部定位：(1) 消息队列 `pending` 单槽 Map 导致积压消息丢失且逐条触发响应；(2) `recordAgentResponse()` 无条件调用导致 LLM 选择沉默时写入空 `[Bot Action]` 记录；(3) `trimMessages()` 对 `messages[0]`（初始用户上下文）永远不裁剪，因为 `totalRounds = Math.floor((1-1)/2) = 0`，导致 working memory 无限增长。

增强功能中，模型组负载均衡在 `ModelService.resolveModel()` 上增加 `group:` 前缀路由层；Provider 架构通过 `BaseProvider` 抽象类消除三个 provider 插件的重复代码；配置分组利用 Koishi `Schema.intersect` 的 `.description()` 实现 UI 分组，不破坏现有配置结构。无新运行时依赖。

## Key Findings

### Recommended Stack

无新运行时依赖。所有功能基于现有技术栈实现。

**核心技术（已有）：**
- `ai-sdk 6.0.91`：ModelService 基础，模型组复用现有 resolveModel/fallback 机制
- `Koishi 4.18.x`：Schema `.description()` 支持 UI 分组，Service 子类模式
- `p-queue`：并发控制，模型组可复用现有队列

### Expected Features

**Must have（bug 修复）：**
- 消息队列积压合并 — pending 单槽→数组，完成后合并一次响应
- Bot Action 空记录过滤 — actions 为空时跳过 recordAgentResponse
- Tool trim 生效 — 初始用户上下文受独立裁剪预算约束

**Should have（增强）：**
- 模型组负载均衡 — round-robin/random/failover 策略
- Provider 架构统一 — BaseProvider + createBaseProviderSchema 消除重复
- 配置分组 + Schema 描述 — Console UI 可读性提升

### Architecture Approach

所有 v2.4 功能在现有服务架构上扩展，不新增服务：

**新增组件：**
1. `ModelGroup` (`model/group.ts`) — 负载均衡策略实现，member 选择 + failure 追踪
2. `BaseProvider` (`shared-model/src/provider/base.ts`) — 抽象基类，统一 listModels/getDefaultParams
3. `createBaseProviderSchema()` — Schema 工厂，消除 provider 配置重复

**修改组件：**
4. `AgentCore` — pending 单槽→数组，drain+merge 逻辑
5. `ThinkActLoop` — recordAgentResponse guard + userContext trim
6. `ModelService` — groups map, group-aware resolveModel, refreshSchemas

### Critical Pitfalls

1. **Schema.intersect→嵌套 object 破坏配置兼容性** — 保持 intersect 平铺，用 `.description()` 分组
2. **trimMessages[0] 直接裁剪破坏当前轮上下文** — 在 messages 构造前独立裁剪 userContent
3. **模型组作为假 Provider 注册** — 保持 group 为独立层，resolveModel 做 group→concrete 翻译
4. **聚合窗口阻塞队列** — 聚合逻辑留在 handleEvent（pre-enqueue），队列重构只影响 post-enqueue

## Implications for Roadmap

### Phase 1: Bug Fixes
**Rationale:** 外科手术式修复，低风险，为后续功能建立干净基线
**Delivers:** Bot Action 空记录消除、tool trim 生效、消息队列积压合并
**Addresses:** 3 个已知 bug

### Phase 2: Provider Architecture
**Rationale:** shared-model 类型变更是模型组的前置依赖
**Delivers:** BaseProvider 抽象类、Schema 工厂、3 个 provider 插件瘦身

### Phase 3: Model Groups + Config
**Rationale:** 依赖 Phase 2 的 shared-model 类型；配置分组独立可并行
**Delivers:** 模型组负载均衡、配置 UI 分组 + 描述增强

### Phase Ordering Rationale

- Bug 修复优先：外科手术式改动，零依赖，建立测试基线
- Provider 架构在模型组之前：BaseProvider 在 shared-model 是模型组集成的前置
- 配置分组与模型组并行：纯 UI/Schema 变更，无行为影响

### Research Flags

- **标准模式（跳过研究）：** Phase 1（bug 修复，代码路径已完全映射）
- **标准模式（跳过研究）：** Phase 2（Provider 重构，模式清晰）
- **可能需要研究：** Phase 3 模型组（负载均衡策略选择，failover 与现有 fallbackChain 的交互）

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | 无新依赖，所有版本已验证 |
| Features | HIGH | 6 个功能全部映射到具体源码位置 |
| Architecture | HIGH | 完整服务依赖图，所有 touch points 已识别 |
| Pitfalls | HIGH | 所有陷阱基于实际代码验证 |

**Overall confidence:** HIGH

### Gaps to Address

- 模型组 failover 与现有 fallbackChain 的交互语义需要在 planning 阶段明确
- 配置分组的具体分类需要结合实际 Console UI 效果调整

---
*Research completed: 2026-02-26*
*Ready for roadmap: yes*
