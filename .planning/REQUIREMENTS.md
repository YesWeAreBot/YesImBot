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
- [ ] **AGENT-03**: 心跳循环 — stimulus → context build → LLM → tool exec → respond → continue 流程

### Horizon (Context Management)

- [x] **HORIZON-01**: Horizon 上下文架构 — Environment/Entity/Event 三元组抽象，替代 per-channel 会话隔离
- [ ] **HORIZON-02**: Timeline 存储 — Event 按时间序列的数据库存储架构
- [x] **HORIZON-03**: Observation 生成 — Event 展开为 LLM 可直接阅读的 Observation 数据
- [x] **HORIZON-04**: Percept 触发机制 — 描述智能体被触发的原因（消息、定时任务等），驱动 AgentCore 处理

### Tool System

- [x] **TOOL-01**: 工具注册与执行 — 注册工具、Schema 验证、执行调度、结果返回
- [x] **TOOL-02**: 可扩展工具框架 — 装饰器注册模式，Agent loop 中的工具调用集成

### Prompt System

- [x] **PROMPT-01**: 基础提示词配置 — 人设/性格配置，系统提示词模板加载与渲染

### Platform Integration

- [ ] **PLATFORM-01**: Koishi 集成 — 作为 Koishi 4.x 插件运行，Service 注入体系，生命周期管理

## v2 Requirements

### Model Service

- **MODEL-04**: 模型组与负载均衡 — 为不同任务配置模型组，支持故障转移
- **MODEL-05**: Provider 健康检查与熔断 — Circuit breaker 模式处理 API 故障

### Prompt System

- **PROMPT-02**: 模板渲染与动态注入 — Mustache 模板、变量注入、动态片段、记忆块集成

### Platform Integration

- **PLATFORM-02**: 错误处理与优雅降级 — API 失败重试、graceful degradation
- **PLATFORM-03**: 限流与成本控制 — 请求限流、token 限制、成本追踪
- **PLATFORM-04**: 流式响应支持 — Streaming API 集成与平台适配

## Out of Scope

| Feature                                       | Reason                                      |
| --------------------------------------------- | ------------------------------------------- |
| 三级记忆系统（L1/L2/L3）                      | v1 聚焦核心骨架，记忆系统复杂度高，后续迭代 |
| 生命周期管理（RoutineScheduler、TaskManager） | 高级特性，需要稳定的 AgentCore 基础         |
| 唤醒机制（ArousalHandler、离线回顾）          | 依赖生命周期管理，后续迭代                  |
| 知识图谱与用户画像                            | 依赖记忆系统，后续迭代                      |
| TTS/STT、RAG 记忆库                           | 非核心功能，后续迭代                        |
| 多智能体协作                                  | v1 预留扩展点但不实现，后续迭代             |
| Always-on 回复模式                            | 反特性：导致刷屏，不自然                    |
| 无限工具调用深度                              | 反特性：导致循环和成本失控                  |

## Traceability

| Requirement | Phase            | Status   | Notes                                                                                      |
| ----------- | ---------------- | -------- | ------------------------------------------------------------------------------------------ |
| MODEL-01    | Phase 2          | Complete | ModelService.registerProvider() implemented; provider plugins register via it              |
| MODEL-02    | Phase 2          | Complete | provider-openai package at providers/provider-openai/src/index.ts                         |
| MODEL-03    | Phase 2          | Complete | provider-deepseek package at providers/provider-deepseek/src/index.ts                     |
| AGENT-01    | Phase 5, Phase 7 | Complete | AgentCore + ThinkActLoop + DEFAULT_SYSTEM_TEMPLATE fully implemented                       |
| AGENT-02    | Phase 6          | Complete | WillingnessCalculator with rule scoring + LLM judge implemented                            |
| AGENT-03    | Phase 5, Phase 8 | Partial  | Loop exists; streamMode config unused until Phase 8 activates it                          |
| HORIZON-01  | Phase 3          | Complete | Environment/Entity/Event schema in place                                                   |
| HORIZON-02  | Phase 3, Phase 8 | Partial  | Schema + records work; stage transitions (markAsActive/archiveStale) not called until Phase 8 |
| HORIZON-03  | Phase 3          | Complete | toObservations() implemented in EventManager                                               |
| HORIZON-04  | Phase 3          | Complete | EventListener + percept emission implemented                                               |
| TOOL-01     | Phase 4          | Complete | PluginService + buildAiSdkTools implemented                                                |
| TOOL-02     | Phase 4          | Complete | Decorator pattern in base-plugin.ts                                                        |
| PROMPT-01   | Phase 4, Phase 7 | Complete | PromptService + DEFAULT_SYSTEM_TEMPLATE + empty-render warnings implemented                |
| PLATFORM-01 | Phase 1, Phase 5 | Partial  | Koishi Service pattern used throughout; plugin loads but no formal integration test        |

**Coverage:**

- v1 requirements: 14 total
- Mapped to phases: 14
- Unmapped: 0 ✓

---

_Requirements defined: 2026-02-17_
_Last updated: 2026-02-19 after Phase 8 traceability audit_
