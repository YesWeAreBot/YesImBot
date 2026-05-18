# Athena / YesImBot v4 Roadmap

> 长期目标：从群聊 Agent 演进为「长期存在、可持续感知、可持续行动」的数字主体。
>
> 总原则：先稳骨架，再塑行为；先控复杂度，再长能力。

## 当前阶段：第一阶段「建立可持续的运行骨架」— 接近收尾

### 已完成

- **`packages/agent` 框架层边界收敛**
  - Agent Loop 稳定：LLM 调用 → 工具执行 → 响应生成
  - AgentSession / SessionManager 职责清晰
  - 从 pi-coding-agent 独立出来，不再依赖其重运行时
- **Extension 系统重新设计**
  - 全局 `ExtensionRegistry` 管理 definitions，session-local `ExtensionRunner` 维护 bindings
  - 支持热重载、stale guard、generation 追踪
  - 事件模型统一为 `domain:action` 命名
  - 工具注册、生命周期钩子、system prompt 干预能力就绪
- **AgentSession 配置恢复**
  - Compaction / Retry / System Prompt / Steering Mode 等配置从硬编码恢复为可注入
  - 与 pi-mono 参考实现对齐默认值
- **Tool 返回值类型修正**
  - `normalizeToolResult` 函数统一工具返回值归一化
  - `ToolExecuteReturn<OUTPUT, DETAILS>` 三泛型参数设计
  - terminate 语义收归 `afterToolCall` hook
- **core 业务层稳定**
  - ModelService 基于 ai-sdk，Provider 插件架构
  - `AthenaEvent` / `AthenaMessage` / `CustomMessage` 消息链路
  - Koishi 集成、消息格式转换、事件调度
- **Provider 层独立**
  - OpenAI / DeepSeek / Anthropic / Google provider 插件
  - 通过 `ctx["yesimbot.model"]` 服务注册
- **Extension 异步初始化与动态工具刷新**
  - 异步 `setup()` 完成后自动刷新工具（generation 检查防竞态）
  - `registerTool()` 后自动追加到 active tools（`fromRegisterTool` 标记）
  - `dispose()` 同步调用 extension cleanup（含异步 rejection 捕获）
- **Extension 工具生命周期与热重载**
  - `unregisterTool()` 支持运行时移除已注册工具
  - `registeredToolNames` 追踪工具注册历史（用于审计和诊断）
  - `reload()`/`reloadSync()` 替换 binding 后自动调用 `refreshTools()`
  - `unregisterExtension()` 支持移除 extension definition 并通知所有 runner
- **Extension 最小插件开发模型验证**
  - `plugins/mcp-client` 作为首个真实 Extension 插件：Koishi Service + Schema 配置 + MCP SDK 集成
  - 通过 `ExtensionAPI.registerTool()` 注册工具，验证异步 setup → 工具注册 → Agent 可用完整链路
- **chat-history 扩展实现**
  - 替换旧 `session-context` 扩展，提供 3 个简洁的聊天记录搜索工具
  - 完整搜索引擎架构：QueryGuard → ChannelResolver → FileScanner → ResultFormatter
  - 74 个测试覆盖单元和集成场景
- **旧版清理**
  - 删除 `@yesimbot/plugin-sdk`（与新 Extension 系统不兼容）
  - 删除旧版 plugins（mcp-client, search-service, skill, workspace）
  - 删除旧 session service 和 legacy trait 模块
- **工程基础设施**
  - Yarn 4 monorepo + Turborepo 构建
  - oxlint + oxfmt 代码规范
  - vitest 测试框架
  - lint-staged + husky pre-commit

### 进行中

| 优先级 | 项目                | 说明                                                                  | 关联任务                                                                   |
| ------ | ------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| P1     | Platform Adapter 层 | Phase 1 完成；Phase 2-4（专用 Adapter、多模态、旧类型清理）待后续实现 | [platform-adapter](docs/superpowers/tasks/2026-05-17_01-platform-adapter/) |

### 待完成

| 优先级 | 项目                         | 说明                                                                |
| ------ | ---------------------------- | ------------------------------------------------------------------- |
| P0     | 上下文压缩端到端验证         | 压缩逻辑存在但未手动测试，需验证 compaction → 恢复 → 再压缩完整链路 |
| P1     | `core/src/index.ts` 职责拆分 | 当前入口文件承载过多，需拆分为独立 service 模块                     |
| P1     | Provider 层验证              | 新架构下 Provider 注册和调用链路需要端到端验证                      |
| P2     | 残留硬编码清理               | `agent-session.ts` 中仍有 `//TODO`、`settingsManager` 残留引用      |

---

## 第二阶段：「收敛群聊行为决策模型」

> 核心问题：Athena 如何在群聊里自然地存在——何时回应、何时沉默、如何控制密度。

### 方向

- 群聊响应判断模型（启发式 + LLM 混合路线）
- 发言密度控制与节奏感
- 延迟回应、跟进、插话等社交行为建模
- 「不说话」作为显式决策结果
- 低成本前提下的渐进式行为质量提升

### 待决策问题

- LLM 参与行为判断是默认常开还是条件升级？
- 响应判断和响应生成是否需要拆分为独立层？
- 意愿值机制在新架构下如何重新设计？

---

## 第三阶段：「建立插件化的上下文与记忆生态」

> 在行为模型初步成型后，逐步推进更复杂的上下文与记忆能力。

### 方向

- 高级上下文策略保持插件化，不塞进 core
- 长期记忆（情景 + 语义双层）
- 会话分段与语义召回
- 关系建模与群氛围状态
- 多层摘要与检索增强

### 待决策问题

- core 保持最小实现的边界在哪里？
- 记忆、检索、关系建模等能力优先沉淀到插件还是独立上下文引擎？

---

## 第四阶段：「扩展能力与插件生态成熟」

> 骨架、行为、上下文都初步稳定后，进入扩展生态建设。

### 方向

- Extension API 稳定化与文档化
- 工具、上下文注入、提示词塑形、行为修饰等能力的清晰边界
- Skill、Workspace、Search、MCP 等插件重新实现
- 对插件作者友好的扩展心智模型

### 待决策问题

- 插件可以在多大程度上修改系统提示词与 LLM 可见上下文？
- provider 原生能力与普通扩展能力的边界是否需要更清晰抽象？

---

## 第五阶段：「从群聊 Agent 走向数字主体」

> 更长期的远景阶段。

### 方向

- 逐步淡化对单一聊天平台输入模型的依赖
- 吸收更一般的事件/感知输入
- 行为目标从「聊天回复」扩展到「多种形式的环境参与」
- 借助 Koishi 适配更多平台与媒介
- 最终探索脱离 Koishi 后的独立运行形态

### 待决策问题

- Athena 何时才真正值得从群聊主战场扩展到更一般的感知与行动场景？
- 若脱离 Koishi，哪些当前边界设计已经足够支撑，哪些只是暂时性适配？
