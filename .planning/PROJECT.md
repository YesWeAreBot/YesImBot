# Athena (YesImBot) v4

## What This Is

Athena 是一个 Koishi 插件，让 AI 大语言模型自然融入 IM 平台的群聊和私聊中。它不是一个问答工具，而是一个具备性格、记忆和动态响应能力的智能体——一个独一无二的、专属于社群的虚拟成员。本次是基于 YesImBot-v3 的完全重写，目标是改进架构、提升可维护性和可扩展性。

## Core Value

智能体能够像真人一样自然地参与群聊讨论，拥有合理的回复决策机制和可扩展的工具调用能力。

## Current Milestone: v2 功能平替

**Goal:** 补齐 v3 核心功能，让 v4 达到 v3 的可用水平，体现架构优势

**Target features:**
- 动态 Schema 联动 — Provider 注册的模型在主插件配置中可下拉选择
- 意愿值系统迁移 — 从 v3/dev 移植完整的衰减+热度+S 曲线算法
- 核心记忆块 — 文件系统加载人设/知识块(.md/.txt)
- 补齐 Horizon 上下文 — 从平台数据填充 Environment/Entity
- 补齐内置 snippet — 时间、用户信息、频道信息等动态数据注入

## Requirements

### Validated

- ✓ 模块化模型服务：基于 ai-sdk 的 Provider 插件体系 — v1
- ✓ Provider 注册机制：子插件向核心注册模型 — v1
- ✓ 原生 agentic loop：ThinkActLoop 驱动 context → LLM → tool exec → respond — v1
- ✓ 原生工具调用：ai-sdk tool calling 替代 JSON 文本解析 — v1
- ✓ 工具调用框架：可扩展的工具注册、Schema 验证和执行系统 — v1
- ✓ 提示词系统骨架：Mustache 模板渲染、snippet/injection 机制 — v1
- ✓ Horizon 骨架：Environment/Entity/Event 三元组、Timeline 存储 — v1
- ✓ 混合回复决策骨架：规则引擎 + LLM judge — v1
- ✓ PQueue 并发控制：ModelService call/streamCall 队列化 — v1

### Active

- [ ] 动态 Schema 联动：Provider 注册的模型在主插件配置项中可下拉选择
- [ ] 意愿值系统：从 v3/dev 迁移完整算法（指数衰减、对话热度、S 曲线增益、回复成本）
- [ ] 核心记忆块：文件系统加载人设/知识块，注入 Prompt scope
- [ ] Horizon 上下文填充：从 Koishi session 填充 Environment/Entity 实际数据
- [ ] 内置 Prompt snippet：时间、用户信息、频道信息、机器人信息等动态数据

### Out of Scope

- 三级记忆系统（L1/L2/L3）— 核心记忆块是 L0，L1/L2/L3 后续迭代
- 生命周期管理（RoutineScheduler、TaskManager）— 高级特性，后续迭代
- 唤醒机制（ArousalHandler、离线回顾）— 后续迭代
- 知识图谱与用户画像 — 后续迭代
- ChatMode 机制 — v2 先补齐基础上下文，Mode 系统后续迭代
- 内置工具迁移（CoreUtil/QManager/Interactions）— v2 聚焦核心体验，工具后续迁移
- 模型组与负载均衡 — v2 聚焦功能平替，高级模型管理后续迭代
- TTS/STT、RAG 记忆库 — 后续迭代

## Context

- **前身项目**：YesImBot-v3（`references/YesImBot-v3/`），YesImBot-dev（`references/YesImBot-dev/`）
- **设计文档**：`books/` 目录为作者架构思考（仅人类发言），`docs/` 为完整架构讨论
- **设计文档定位**：体现对系统的核心愿景（连续性/关系性/主体性），作为需求对齐参考
- **技术栈演进**：xsai → ai-sdk，统一配置 → Provider 插件化
- **v3 已验证的模式**：意愿值系统（衰减+S 曲线）、动态 Schema 联动、Mustache 模板、核心记忆块
- **v1 架构突破**：原生 agentic loop、原生 tool call、PQueue 并发控制
- **v2 迁移策略**：从 v3/dev 迁移已验证功能，适配 v4 新架构，不重新造轮子

## Constraints

- **Framework**: Koishi 4.x（4.18.x），TypeScript
- **Build**: Turbo monorepo，Yarn workspaces
- **Model SDK**: ai-sdk（替代 xsai）
- **Package Structure**: packages/core + packages/shared-model + plugins/provider-*
- **Linting**: oxlint
- **Target**: ES2022，bundler moduleResolution

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 使用 ai-sdk 替代 xsai | xsai 过于精简缺少功能，ai-sdk 生态更完善 | ✓ Good |
| 保持 monorepo 结构 | 与 v3 一致，团队熟悉，Turbo 构建成熟 | ✓ Good |
| 混合回复决策（规则+LLM） | 纯随机不够智能，纯 LLM 成本太高 | ⚠️ Revisit — v2 迁移 v3 完整意愿值算法 |
| 模型服务优先开发 | 是所有其他子系统的基础依赖 | ✓ Good |
| Provider 插件化 | 避免统一配置窗口过于复杂，支持独立参数 | ✓ Good — 需补动态 Schema 联动 |
| v1 不含记忆系统 | 聚焦核心骨架，降低复杂度，后续迭代 | ✓ Good — v2 引入核心记忆块 |
| 原生 tool call | ai-sdk tool calling 替代 JSON 文本解析，发展趋势 | ✓ Good — 待实战验证 |
| v2 迁移而非重写 | v3/dev 已验证功能直接适配新架构 | — Pending |

---
*Last updated: 2026-02-19 after v2 milestone start*
