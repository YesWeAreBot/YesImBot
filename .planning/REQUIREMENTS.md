# Requirements: Athena (YesImBot v4)

**Defined:** 2026-02-17
**Core Value:** 智能体能够像真人一样自然地参与群聊讨论，拥有合理的回复决策机制和可扩展的工具调用能力。

## v1 Requirements

### Model Service

- [x] **MODEL-01**: Provider 插件可向核心 ModelService 注册模型，支持独立配置
- [x] **MODEL-02**: OpenAI Provider 插件实现，可通过 ai-sdk 调用 OpenAI 兼容 API
- [x] **MODEL-03**: DeepSeek Provider 插件实现，可通过 ai-sdk 调用 DeepSeek API

### Agent Core

- [x] **AGENT-01**: AgentCore 作为框架无关的编排器，接受 Percept 输入，通过 Horizon 获取 Observation，驱动 think-act 循环；预留 AgentIdentity 扩展点
- [x] **AGENT-02**: 混合回复决策 — 规则引擎快速筛选 + LLM 精细判断，WillingnessCalculator 为纯算法，IM 属性通过 Percept 元数据传入
- [x] **AGENT-03**: 心跳循环 — stimulus → context build → LLM → tool exec → respond → continue 流程（含 streamMode 分支）

### Horizon (Context Management)

- [x] **HORIZON-01**: Horizon 上下文架构 — Environment/Entity/Event 三元组抽象，替代 per-channel 会话隔离
- [x] **HORIZON-02**: Timeline 存储 — Event 按时间序列的数据库存储架构
- [x] **HORIZON-03**: Observation 生成 — Event 展开为 LLM 可直接阅读的 Observation 数据
- [x] **HORIZON-04**: Percept 触发机制 — 描述智能体被触发的原因（消息、定时任务等），驱动 AgentCore 处理

### Tool System

- [x] **TOOL-01**: 工具注册与执行 — 注册工具、Schema 验证、执行调度、结果返回
- [x] **TOOL-02**: 可扩展工具框架 — 装饰器注册模式，Agent loop 中的工具调用集成

### Prompt System

- [x] **PROMPT-01**: 基础提示词配置 — 人设/性格配置，系统提示词模板加载与渲染

### Platform Integration

- [x] **PLATFORM-01**: Koishi 集成 — 作为 Koishi 4.x 插件运行，Service 注入体系，生命周期管理

## v2 Requirements

### Model Service

- [x] **MODEL-04**: 动态 Schema 联动 — Provider 注册的模型自动出现在主插件配置下拉列表中
- [x] **MODEL-05**: Schema 热更新 — Provider 热插拔时配置界面自动刷新可选模型列表

### Willingness（意愿值系统）

- [x] **WILLING-01**: 意愿值衰减 — 指数衰减算法，支持半衰期配置，对话热度检测（hot/warm/cold）
- [x] **WILLING-02**: S 曲线增益 — activation → saturation → negative feedback，防止过度活跃
- [x] **WILLING-03**: 回复成本与关键词兴趣 — 回复后意愿值扣减，关键词匹配提升兴趣乘数

### Memory（核心记忆块）

- [x] **MEMORY-01**: 文件系统记忆加载 — 从配置路径扫描 .md/.txt 文件，解析 YAML frontmatter（优先级、标签）
- [x] **MEMORY-02**: 记忆注入 Prompt — 加载的记忆块注入 Prompt scope，支持内置默认记忆块 fallback

### Horizon（上下文填充）

- [x] **HORIZON-05**: Environment 填充 — 从 Koishi session 填充频道/群组实际数据（名称、平台、类型）
- [x] **HORIZON-06**: Entity 填充 — 从 session 填充用户信息（昵称、角色）和 bot 自身 Entity

### Prompt（内置 snippet）

- [x] **PROMPT-02**: 内置动态 snippet — 时间（当前时间/日期）、用户信息（发送者昵称/ID）、频道信息（频道名/平台）、机器人信息（bot 名称/ID）

## Out of Scope

| Feature                                       | Reason                                          |
| --------------------------------------------- | ----------------------------------------------- |
| 三级记忆系统（L1/L2/L3）                      | 核心记忆块是 L0，L1/L2/L3 后续迭代             |
| 生命周期管理（RoutineScheduler、TaskManager） | 高级特性，需要稳定的 AgentCore 基础             |
| 唤醒机制（ArousalHandler、离线回顾）          | 依赖生命周期管理，后续迭代                      |
| 知识图谱与用户画像                            | 依赖记忆系统，后续迭代                          |
| TTS/STT、RAG 记忆库                           | 非核心功能，后续迭代                            |
| 多智能体协作                                  | v1 预留扩展点但不实现，后续迭代                 |
| Always-on 回复模式                            | 反特性：导致刷屏，不自然                        |
| 无限工具调用深度                              | 反特性：导致循环和成本失控                      |
| ChatMode 机制                                 | v2 先补齐基础上下文，Mode 系统后续迭代          |
| 内置工具迁移（CoreUtil/QManager 等）          | v2 聚焦核心体验，工具后续迁移                   |
| 模型组与负载均衡                              | v2 聚焦功能平替，高级模型管理后续迭代           |
| Circuit breaker 熔断                          | v2 聚焦功能平替，生产级容错后续迭代             |

## Traceability

| Requirement | Phase            | Status   | Notes                                                                                      |
| ----------- | ---------------- | -------- | ------------------------------------------------------------------------------------------ |
| MODEL-01    | Phase 2          | Complete | ModelService.registerProvider() implemented; provider plugins register via it              |
| MODEL-02    | Phase 2          | Complete | provider-openai package at providers/provider-openai/src/index.ts                         |
| MODEL-03    | Phase 2          | Complete | provider-deepseek package at providers/provider-deepseek/src/index.ts                     |
| AGENT-01    | Phase 5, 7, 13   | Complete | Non-stream path bypasses ModelService.call(); gap closure in Phase 13                      |
| AGENT-02    | Phase 6, 15      | Complete | Rule scoring complete; LLM deferred judgment for borderline SKIP in Phase 15               |
| AGENT-03    | Phase 5, 8, 13   | Complete | Stream path complete; non-stream bypasses ModelService — gap closure in Phase 13           |
| HORIZON-01  | Phase 3          | Complete | Environment/Entity/Event schema in place                                                   |
| HORIZON-02  | Phase 3, Phase 8 | Complete | Schema + records + stage transitions (markAsActive/archiveStale) wired after agent response |
| HORIZON-03  | Phase 3          | Complete | toObservations() implemented in EventManager                                               |
| HORIZON-04  | Phase 3          | Complete | EventListener + percept emission implemented                                               |
| TOOL-01     | Phase 4          | Complete | PluginService + buildAiSdkTools implemented                                                |
| TOOL-02     | Phase 4          | Complete | Decorator pattern in base-plugin.ts                                                        |
| PROMPT-01   | Phase 4, Phase 7 | Complete | PromptService + DEFAULT_SYSTEM_TEMPLATE + empty-render warnings implemented                |
| PLATFORM-01 | Phase 1, 5, 14   | Complete | Idiomatic inject pattern in all providers; ctx.get() removed                               |
| MODEL-04    | Phase 9          | Complete |                                                                                            |
| MODEL-05    | Phase 9          | Complete |                                                                                            |
| WILLING-01  | Phase 10         | Complete |                                                                                            |
| WILLING-02  | Phase 10         | Complete |                                                                                            |
| WILLING-03  | Phase 10         | Complete |                                                                                            |
| HORIZON-05  | Phase 11         | Complete |                                                                                            |
| HORIZON-06  | Phase 11         | Complete |                                                                                            |
| MEMORY-01   | Phase 12         | Complete |                                                                                            |
| MEMORY-02   | Phase 12         | Complete |                                                                                            |
| PROMPT-02   | Phase 12         | Complete |                                                                                            |

**Coverage:**

- v1 requirements: 14 total, 11 complete, 3 pending (AGENT-01, AGENT-02, AGENT-03)
- Mapped to phases: 14
- Unmapped: 0 ✓

- v2 requirements: 10 total, 7 complete, 3 pending (MEMORY-01, MEMORY-02, PROMPT-02)
- Mapped to phases: 10
- Unmapped: 0 ✓

---

_Requirements defined: 2026-02-17_
_Last updated: 2026-02-20 after gap closure phases 13-15 creation_
