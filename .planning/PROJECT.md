# Athena (YesImBot) v4

## What This Is

Athena 是一个 Koishi 插件，让 AI 大语言模型自然融入 IM 平台的群聊和私聊中。它具备性格记忆、动态意愿值决策、可扩展工具调用和 Horizon 上下文管理——一个独一无二的、专属于社群的虚拟成员。基于 YesImBot-v3 完全重写，v1.0 已达到 v3 功能平替水平。

## Core Value

智能体能够像真人一样自然地参与群聊讨论，拥有合理的回复决策机制和可扩展的工具调用能力。

## Current Milestone: v2.0 Context-Aware Architecture

**Goal:** 重设计提示词服务架构，建立模块化提示词结构，引入 Trait + Skill 上下文感知行为调整体系——替代 ChatMode 的离散模式切换。

**Target features:**
- PromptService 架构重设计：多注入点、上下文感知、生命周期管理
- 模块化提示词结构：partial 组合（identity / environment / working_memory / memories / tools / output）
- HorizonView 渲染优化：结构化上下文编排
- Trait 感知层：多维度并行分析上下文（场景、话题、热度等）
- Skill 响应层：文件夹规范定义、条件激活、分层效果叠加

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
- ✓ 动态 Schema 联动：Provider 注册的模型在配置下拉列表中可选 — v1.0
- ✓ 意愿值系统：完整算法（指数衰减、对话热度、S 曲线增益、回复成本、LLM 延迟判断）— v1.0
- ✓ 核心记忆块：文件系统加载人设/知识块，注入 Prompt scope — v1.0
- ✓ Horizon 上下文填充：从 Koishi session 填充 Environment/Entity 实际数据 — v1.0
- ✓ 内置 Prompt snippet：时间、用户信息、频道信息、机器人信息动态数据 — v1.0

### Active

- [ ] PromptService 架构重设计：多注入点、上下文感知渲染、生命周期管理
- [ ] 模块化提示词结构：partial 组合替代单体模板
- [ ] HorizonView 渲染优化：结构化上下文编排
- [ ] Trait 感知层：多维度并行上下文分析
- [ ] Skill 响应层：文件夹规范定义、条件激活、分层效果叠加

### Out of Scope

- 三级记忆系统（L1/L2/L3）— 核心记忆块是 L0，L1/L2/L3 后续迭代
- 生命周期管理（RoutineScheduler、TaskManager）— 高级特性，后续迭代
- 唤醒机制（ArousalHandler、离线回顾）— 后续迭代
- 知识图谱与用户画像 — 后续迭代
- ChatMode 机制 — 已被 Trait + Skill 体系替代（v2.0 架构决策）
- 内置工具迁移（CoreUtil/QManager/Interactions）— v2 聚焦核心体验，工具后续迁移
- 模型组与负载均衡 — v2 聚焦功能平替，高级模型管理后续迭代
- TTS/STT、RAG 记忆库 — 后续迭代

## Context

- **v1.0 shipped:** 2026-02-21, 3,470 LOC TypeScript, 15 phases, 29 plans
- **技术栈:** Koishi 4.x, ai-sdk, Turbo monorepo, Yarn workspaces
- **包结构:** packages/shared-model + plugins/core + providers/provider-openai + providers/provider-deepseek
- **前身项目**：YesImBot-v3（`references/YesImBot-v3/`），YesImBot-dev（`references/YesImBot-dev/`）
- **设计文档**：`books/` 目录为作者架构思考，`docs/` 为完整架构讨论
- **v1.0 达成:** v3 功能平替 — 动态 Schema、意愿值系统、核心记忆块、Horizon 上下文填充
- **已知技术债:** Schema 在首个 Provider 注册前为空（by design）

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
| 混合回复决策（规则+LLM） | 纯随机不够智能，纯 LLM 成本太高 | ✓ Good — v1.0 完成完整意愿值 + LLM 延迟判断 |
| 模型服务优先开发 | 是所有其他子系统的基础依赖 | ✓ Good |
| Provider 插件化 | 避免统一配置窗口过于复杂，支持独立参数 | ✓ Good — 动态 Schema 联动已完成 |
| v1 不含记忆系统 | 聚焦核心骨架，降低复杂度，后续迭代 | ✓ Good — v1.0 引入核心记忆块 |
| 原生 tool call | ai-sdk tool calling 替代 JSON 文本解析 | ✓ Good |
| v2 迁移而非重写 | v3/dev 已验证功能直接适配新架构 | ✓ Good — 4 天完成 15 phases |
| Horizon 三元组架构 | Environment/Entity/Event 替代 per-channel 隔离 | ✓ Good — 支持跨频道 Entity 连续性 |
| PQueue 并发控制 | 防止 LLM API 过载 | ✓ Good — call/streamCall 统一队列化 |
| per-module fallbackChain | 替代全局 defaultModel，更灵活 | ✓ Good — agent/willingness 独立 fallback |
| Trait + Skill 替代 ChatMode | ChatMode 是离散模式切换，无法描述多维度叠加的真实场景；Trait 感知 + Skill 响应解耦更灵活 | — Pending |
| PromptService 重设计 | v1 的 Injection 是为插件工具注入临时加的 hack，不支持多注入点和上下文感知 | — Pending |
| Skill 分层效果叠加 | Prompt/Tools 层叠加，Style 层优先级覆盖，Willingness 不直接干预 | — Pending |

---
*Last updated: 2026-02-21 after v2.0 milestone started*
