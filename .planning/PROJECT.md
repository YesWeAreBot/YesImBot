# Athena (YesImBot) v4

## What This Is

Athena 是一个 Koishi 插件，让 AI 大语言模型自然融入 IM 平台的群聊和私聊中。它不是一个问答工具，而是一个具备性格、记忆和动态响应能力的智能体——一个独一无二的、专属于社群的虚拟成员。本次是基于 YesImBot-v3 的完全重写，目标是改进架构、提升可维护性和可扩展性。

## Core Value

智能体能够像真人一样自然地参与群聊讨论，拥有合理的回复决策机制和可扩展的工具调用能力。

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] 模块化模型服务：基于 ai-sdk 的 Provider 插件体系，支持 OpenAI 和 DeepSeek
- [ ] Provider 注册机制：子插件向核心注册模型，支持独立配置
- [ ] 模型组与负载均衡：为不同任务配置模型组，支持故障转移
- [ ] 混合回复决策：规则引擎快速筛选 + LLM 精细判断，平衡成本与准确性
- [ ] 心跳循环：改进 v3 的 stimulus → context → LLM → tool exec → respond 流程
- [ ] 工具调用框架：可扩展的工具注册、Schema 验证和执行系统
- [ ] 提示词系统：模板渲染、动态片段注入、记忆块集成
- [ ] 基础消息处理：接收/发送消息，上下文构建，会话管理
- [ ] Koishi 集成：作为 Koishi 4.x 插件运行，Service 注入体系

### Out of Scope

- 三级记忆系统（L1/L2/L3）— v1 聚焦骨架，记忆系统后续迭代
- 生命周期管理（RoutineScheduler、TaskManager）— 设计文档中的高级特性，后续迭代
- 唤醒机制（ArousalHandler、离线回顾）— 后续迭代
- 知识图谱与用户画像 — 后续迭代
- 基于核心记忆的兴趣值（curiosity）增益 — 未来融入回复决策
- TTS/STT、RAG 记忆库 — 后续迭代

## Context

- **前身项目**：YesImBot-v3（packages/core + plugins/ monorepo），YesImBot-dev（开发版）
- **设计文档**：books/ 和 docs/ 目录包含模块化模型服务、唤醒机制、三级记忆系统、记忆检索方案等详细设计
- **设计文档定位**：仅供参考，不是实现目标，具体细节在开发迭代中逐步确定
- **技术栈演进**：xsai → ai-sdk，统一配置 → Provider 插件化
- **v3 已验证的模式**：意愿值系统、工具扩展框架、Mustache 模板、资源管理

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
| 使用 ai-sdk 替代 xsai | xsai 过于精简缺少功能，ai-sdk 生态更完善 | — Pending |
| 保持 monorepo 结构 | 与 v3 一致，团队熟悉，Turbo 构建成熟 | — Pending |
| 混合回复决策（规则+LLM） | 纯随机不够智能，纯 LLM 成本太高 | — Pending |
| 模型服务优先开发 | 是所有其他子系统的基础依赖 | — Pending |
| Provider 插件化 | 避免统一配置窗口过于复杂，支持独立参数 | — Pending |
| v1 不含记忆系统 | 聚焦核心骨架，降低复杂度，后续迭代 | — Pending |

---
*Last updated: 2026-02-17 after initialization*
