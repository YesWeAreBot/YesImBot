# Athena (YesImBot) v4

## What This Is

Athena 是一个 Koishi 插件，让 AI 大语言模型自然融入 IM 平台的群聊和私聊中。它具备性格记忆、动态意愿值决策、可扩展工具调用、Horizon 上下文管理、基于 Trait + Skill 的上下文感知行为调整体系，以及 SOUL.md/AGENTS.md/TOOLS.md 固定角色文件驱动的提示词系统。内部架构使用 platform + channelId 裸字段作为频道标识，无中间抽象层——一个独一无二的、专属于社群的虚拟成员。

## Core Value

智能体能够像真人一样自然地参与群聊讨论，拥有合理的回复决策机制和可扩展的工具调用能力。

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
- ✓ PromptService 架构重设计：命名注入点 + partial 组合 + ctx 生命周期自动清理 — v2.0
- ✓ 模块化提示词结构：partial 组合替代单体模板，HorizonView 结构化渲染 — v2.0
- ✓ HorizonView 渲染优化：结构化标签分区，Percept 职责分层 — v2.0
- ✓ Trait 感知层：TraitAnalyzer 并行分析（Scene/Heat），有状态 per-channel scope — v2.0
- ✓ Skill 响应层：文件夹规范 + 条件树激活 + 分层效果合并 + 热重载 — v2.0
- ✓ 注入点合并 6→4：soul/instructions/memory/extra，编译器强制 + 运行时 guard — v2.1
- ✓ render() 代码内 XML 生成：消除 wrapper partials，删除 11 个废弃文件 — v2.1
- ✓ 固定角色文件系统：SOUL.md/AGENTS.md/TOOLS.md 替代 legacy defaults — v2.1
- ✓ RoleService：文件加载、Mustache 渲染、热重载、注入完整生命周期 — v2.1
- ✓ Skill 可配置注入点：效果可指定任意注入点，按 specificity 排序 — v2.1
- ✓ 三种 Skill 生命周期：per-turn / sticky / trait-bound 运行时可区分 — v2.1
- ✓ TraitAnalyzerConfig type-only export — v2.1
- ✓ Snippet 变量渲染修复：formatHorizonText 完整嵌套 scope，Mustache 变量正确渲染 — v2.2
- ✓ JSON Parser 测试套件：27 个 vitest 用例覆盖 v3 全场景 — v2.2
- ✓ DM 自适应聚合 + per-user 速率限制：TokenBucket + directBoost + 3-8s 聚合窗口 — v2.2
- ✓ 全链路 traceId + 结构化日志：msg-XXXXXXXX 贯穿全流程，debugLevel 分级 — v2.2
- ✓ 人设感知 Judge Prompt：getSoulSummary() + 结构化 JSON 响应 — v2.2
- ✓ Anthropic 系统提示词缓存：stable/dynamic 拆分 + SystemModelMessage[] + cache_control — v2.2
- ✓ Working Memory 时序优化：XML history + short-ID + triggered-by 因果标签 + send_message 裁剪 — v2.2
- ✓ MemoryService 模块删除：snippet 注册迁移到 RoleService，清理全部引用和模板文件 — v2.3
- ✓ Scope 接口删除：ChannelKey 类型别名（platform + channelId 裸字段）替代，全局 13 文件迁移 — v2.3
- ✓ Environment 构造简化：platform/channelId 必填字段，消除 Scope→Environment 转换 — v2.3
- ✓ Timeline DB schema 迁移：scope JSON 列替换为独立 platform + channelId 列 — v2.3
- ✓ 消息队列积压合并：pending 单槽改为数组队列，burst 消息合并一次性响应 — v2.4
- ✓ Bot Action 空记录修复：沉默渲染为 "(chose silence)" 标记，不写入空记录 — v2.4
- ✓ Working Memory 裁剪修复：initialContextCharBudget 限制初始上下文，head-trim-at-newline — v2.4
- ✓ Provider 架构统一：AbstractProvider 抽象基类 + createProviderSchema 工厂，消除 36-61% 重复 — v2.4
- ✓ 配置分组优化：5 组 intersect 分组（基础/模型/意愿值/提示词/高级），Console UI 折叠展开 — v2.4
- ✓ Schema 描述增强：32 个字段 i18n 描述，zh-CN + en-US 双语 — v2.4
- ✓ i18n 国际化：core + 3 provider 插件 locales 文件，Schema .i18n() 链式调用 — v2.4
- ✓ Persona 插件：表单化人设自定义，preset 下拉 + 字段覆盖 + soul 注入点集成 — v2.4

### Active

- [ ] 模型组与负载均衡：多模型实例分组、group: 前缀路由、failover/round-robin/random 策略

### Out of Scope

- 三级记忆系统（L1/L2/L3）— 核心记忆块是 L0，L1/L2/L3 后续迭代
- 生命周期管理（RoutineScheduler、TaskManager）— 高级特性，后续迭代
- 唤醒机制（ArousalHandler、离线回顾）— 后续迭代
- 知识图谱与用户画像 — 后续迭代
- ChatMode 机制 — 已被 Trait + Skill 体系替代（v2.0 验证）
- 内置工具迁移（CoreUtil/QManager/Interactions）— 后续迭代
- TTS/STT、RAG 记忆库 — 后续迭代
- 全 provider 缓存抽象 — 各 provider 缓存语义不同，先做 Anthropic-only（v2.2 验证）
- Scope 细粒度化（per-user/per-topic）— platform+channelId 足够，不过度设计（v2.3 验证）
- 跨频道 scope 共享 — 伪命题，未来记忆系统 + 工具查询替代（v2.3 验证）

## Context

- **v1.0 shipped:** 2026-02-21, 3,470 LOC TypeScript, 15 phases, 29 plans
- **v2.0 shipped:** 2026-02-23, +12,546 LOC TypeScript, 8 phases, 16 plans
- **v2.1 shipped:** 2026-02-24, +1,741 LOC TypeScript, 3 phases, 6 plans
- **v2.2 shipped:** 2026-02-25, +1,580 LOC TypeScript, 3 phases, 8 plans
- **v2.3 shipped:** 2026-02-26, 6,029 LOC TypeScript total, 3 phases, 6 plans
- **v2.4 shipped:** 2026-02-27, +348 LOC TypeScript, 4 phases, 8 plans
- **技术栈:** Koishi 4.x, ai-sdk, Turbo monorepo, Yarn workspaces
- **包结构:** packages/shared-model + core + providers/provider-{openai,deepseek,anthropic} + plugins/persona
- **前身项目**：YesImBot-v3（`references/YesImBot-v3/`），YesImBot-dev（`references/YesImBot-dev/`）
- **设计文档**：`references/books/` 目录为作者架构思考，`references/talks/` 为完整架构讨论
- **v2.4 达成:** 消息队列积压合并、沉默渲染修复、WM 裁剪修复、AbstractProvider 统一、配置分组 i18n、Persona 插件
- **已知技术债:** formatHorizonText deferred-judgment 路径省略 percept（设计决策）；REQ-04 模型组与负载均衡推迟
- **测试覆盖:** vitest 基础设施已建立，JSON Parser 27 用例 + TokenBucket/Willingness/HorizonText 单测

## Constraints

- **Framework**: Koishi 4.x（4.18.x），TypeScript
- **Build**: Turbo monorepo，Yarn workspaces
- **Model SDK**: ai-sdk（替代 xsai）
- **Package Structure**: core + packages/shared-model + plugins/provider-\*
- **Linting**: oxlint
- **Target**: ES2022，bundler moduleResolution

## Key Decisions

| Decision                          | Rationale                                                                                | Outcome                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------- |
| 使用 ai-sdk 替代 xsai             | xsai 过于精简缺少功能，ai-sdk 生态更完善                                                 | ✓ Good                                      |
| 保持 monorepo 结构                | 与 v3 一致，团队熟悉，Turbo 构建成熟                                                     | ✓ Good                                      |
| 混合回复决策（规则+LLM）          | 纯随机不够智能，纯 LLM 成本太高                                                          | ✓ Good — v1.0 完成完整意愿值 + LLM 延迟判断 |
| 模型服务优先开发                  | 是所有其他子系统的基础依赖                                                               | ✓ Good                                      |
| Provider 插件化                   | 避免统一配置窗口过于复杂，支持独立参数                                                   | ✓ Good — 动态 Schema 联动已完成             |
| v1 不含记忆系统                   | 聚焦核心骨架，降低复杂度，后续迭代                                                       | ✓ Good — v1.0 引入核心记忆块                |
| 原生 tool call                    | ai-sdk tool calling 替代 JSON 文本解析                                                   | ✓ Good                                      |
| v2 迁移而非重写                   | v3/dev 已验证功能直接适配新架构                                                          | ✓ Good — 4 天完成 15 phases                 |
| Horizon 三元组架构                | Environment/Entity/Event 替代 per-channel 隔离                                           | ✓ Good — 支持跨频道 Entity 连续性           |
| PQueue 并发控制                   | 防止 LLM API 过载                                                                        | ✓ Good — call/streamCall 统一队列化         |
| per-module fallbackChain          | 替代全局 defaultModel，更灵活                                                            | ✓ Good — agent/willingness 独立 fallback    |
| Trait + Skill 替代 ChatMode       | ChatMode 是离散模式切换，无法描述多维度叠加的真实场景；Trait 感知 + Skill 响应解耦更灵活 | ✓ Good — v2.0 完整管线验证                  |
| PromptService 重设计              | v1 的 Injection 是为插件工具注入临时加的 hack，不支持多注入点和上下文感知                | ✓ Good — 命名注入点 + partial 组合          |
| Skill 分层效果叠加                | Prompt/Tools 层叠加，Style 层优先级覆盖，Willingness 不直接干预                          | ✓ Good — 条件树激活 + 效果合并              |
| JSON 文本输出替代原生 tool_call   | 原生 tool_call 不支持心跳循环和自定义解析                                                | ✓ Good — 手动心跳 + jsonrepair fallback     |
| 渐进式工作记忆裁剪                | 无限增长 messages 导致 token 溢出                                                        | ✓ Good — softTrim/hardClear 两级策略        |
| Percept 构造从 horizon 移到 agent | horizon 只负责数据，不参与决策                                                           | ✓ Good — 职责边界清晰                       |

| OpenClaw 风格 memory_block | SOUL.md/AGENTS.md 固定角色文件替代自由标签 persona.md，职责更清晰 | ✓ Good — RoleService 完整生命周期 |
| 注入点合并 6→4 | identity+style→soul, control_flow+basic_functions→instructions，减少抽象层 | ✓ Good — 编译器全局强制 + 运行时 guard |
| render() 代码内 XML 生成 | 消除 Mustache partial 间接层，删除 11 个废弃文件 | ✓ Good |
| Skill 可配置注入点 | 效果可指定 soul/instructions/memory/extra 任意点 | ✓ Good — 按 specificity 排序 |
| trait-bound 即时移除 | trait 信号消失时立即移除，不设宽限期 | ✓ Good — 与 sticky countdown 区分 |
| TraceContext 显式对象传递 | Koishi 事件系统不保证 async context 传播，不用 AsyncLocalStorage | ✓ Good — traceId 贯穿全链路 |
| Prompt cache Anthropic-only | 各 provider 缓存语义不同，先做 Anthropic ephemeral | ✓ Good — 非 Anthropic 无行为变化 |
| providerType 字段检测 | 不从 model ID 推断 provider 类型 | ✓ Good — 显式声明更可靠 |
| memory_block 合并推迟 | 迁移风险高，不阻塞 v2.2 任何功能 | ✓ Good — 推迟到 v2.3 |
| JSON 文本输出 + 结构化 Judge | Judge 用 JsonParser 解析结构化响应，保留 legacy yes/no fallback | ✓ Good — 兼容性好 |
| DM TokenBucket 用 senderId | 真正的 per-user 限流，避免 channelId 在 DM 场景的歧义 | ✓ Good |
| MemoryService 删除而非合并 | SOUL.md 已覆盖人设定制，memory_block 读写能力验证效果不佳 | ✓ Good — snippet 迁移到 RoleService |
| Scope→ChannelKey 裸字段替代 | Scope 可选字段过度设计，platform+channelId 必填字段更严格 | ✓ Good — 全局 13 文件一次性迁移 |
| DB bridge 渐进迁移 | Phase 27 先迁移 TS 类型，Phase 28 再迁移 DB schema，降低风险 | ✓ Good — 两步完成零回归 |
| Environment 必填字段 | 消除 optional chaining，调用方必须提供 platform/channelId | ✓ Good — 类型系统强制正确性 |
| isDirect 从 Session 读取 | 不属于频道标识，从 event.runtime.session 获取 | ✓ Good — 职责边界清晰 |
| pending 数组队列替代单槽 Map | 单槽覆盖导致 burst 消息丢失 | ✓ Good — 合并积压一次性响应 |
| initialContextCharBudget head-trim | messages[0] 不裁剪导致 WM 无限增长 | ✓ Good — newline 边界裁剪 |
| AbstractProvider 自动注册 | 构造函数中完成注册，子类无需手动调用 | ✓ Good — 消除 36-61% 重复 |
| CallSettings 替代 ModelDefaultParams | ai-sdk 原生类型，减少自定义接口 | ✓ Good — 类型更精确 |
| Persona declare module 本地增强 | 不依赖 core devDependency，插件自包含 | ✓ Good — 轻量解耦 |
| Persona preset merge-then-override | 预设为基础，用户字段覆盖非空值 | ✓ Good — 直觉化配置体验 |

## Latest Milestone: v2.4 Runtime & Polish (Shipped 2026-02-27)

**Delivered:** 消息队列积压合并、沉默渲染修复、WM 裁剪修复、AbstractProvider 统一、配置分组 i18n、Persona 插件

---

_Last updated: 2026-02-27 after v2.4 milestone_
