# 架构审查报告 — Athena

**日期**: 2026-05-23
**方法**: improve-codebase-architecture skill
**范围**: core/, packages/agent/, plugins/*, providers/*

## 术语

- **模块 (Module)** — 有接口和实现的任何东西（函数、类、包）
- **接口 (Interface)** — 调用者必须知道的一切：类型、不变量、错误模式、顺序约束
- **深度 (Depth)** — 接口的杠杆：小接口背后大行为 = 深模块；接口≈实现 = 浅模块
- **Seam** — 接口所在之处，行为可以不编辑原地而改变
- **杠杆 (Leverage)** — 调用者从深度中获得的好处
- **局部性 (Locality)** — 维护者从深度中获得的好处：变更、bug、知识集中在一个地方

---

## 候选总览

| # | 候选 | 强度 | 文件 | 核心问题 |
|---|------|------|------|----------|
| 1 | 拆分 AgentSession 上帝类 | **Strong** | `packages/agent/src/session/agent-session.ts` | 2109 行，25+ 私有字段，8 种职责 |
| 2 | Provider 样板代码工厂化 | **Strong** | `providers/{openai,anthropic,deepseek,google}/src/index.ts` | 4 个 provider 几乎相同，~200 行重复 |
| 3 | 分解 RuntimeService 会话工厂 | Worth exploring | `core/src/runtime/service.ts` | 170 行闭包混合 6 种关注点 |
| 4 | 统一 Adapter 事件创建 | Worth exploring | `core/src/adapter/generic.ts` + `onebot/index.ts` | ~30 行重复事件创建逻辑 |
| 5 | Session 格式提取为共享 seam | Worth exploring | `core/src/extension/chat-history/jsonl-parser.ts` | 硬编码 agent 内部 JSONL 格式 |
| 6 | 合并两个 Extension 注册表 | Speculative | `packages/agent/src/session/extensions/registry.ts` + `core/src/extension/service.ts` | agent 和 core 各有一个，关系不清 |
| 7 | 统一 workspace 工具错误处理 | Speculative | `plugins/workspace/src/tools/*.ts` | 4 个文件重复 stderr 字符串匹配 |
| 8 | 泛化 ExtensionRunner emit 模式 | Speculative | `packages/agent/src/session/extensions/runner.ts` | 5 个 emit 方法重复迭代+错误隔离模式 |

---

## 候选 1: 拆分 AgentSession 上帝类

**强度**: Strong
**文件**: `packages/agent/src/session/agent-session.ts` (2109 行)

### 问题

AgentSession 是整个系统中最大的文件，承担 8 种职责：

1. **事件编排** — `_processAgentEvent` 方法 90 行，复杂分支逻辑
2. **消息持久化** — 通过 SessionManager
3. **自动压缩** — `compact()` + `_runAutoCompaction()` 共享 ~90% 逻辑
4. **自动重试** — 指数退避状态机
5. **工具注册表** — 合并 base + extension + custom 三来源
6. **扩展生命周期** — build / reload / bind / dispose 散布各处
7. **队列 UI 跟踪**
8. **模型管理**

25+ 私有字段。`compact()` 和 `_runAutoCompaction()` 是明显的代码重复。

### 方案

提取 4 个聚焦的协作者：

- **CompactionOrchestrator** — 合并重复的 compact/auto-compact 逻辑
- **RetryHandler** — 指数退避状态机
- **ToolRegistry** — 3 来源工具合并 + prompt snippet 收集
- **SessionEventBridge** — agent event → extension event 映射

AgentSession 变为 ~600 行的薄编排器。

### 收益

- 局部性：压缩 bug 集中在一个模块
- 杠杆：每个协作者一个接口，N 条测试路径
- AgentSession 从 2109 行降到 ~600 行
- 重试逻辑可独立测试

---

## 候选 2: Provider 样板代码工厂化

**强度**: Strong
**文件**: `providers/{openai,anthropic,deepseek,google}/src/index.ts`

### 问题

4 个 provider 文件结构几乎相同：

```
1. export const name = "yesimbot-provider-{X}"
2. export const inject = ["yesimbot.model"]
3. Config schema: id, apiKey, baseURL, chatModels[], embeddingModels[]
4. apply() {
     const client = createX({ apiKey, baseURL })
     const provider: ModelProvider = { id, capabilities, chatModels, embeddingModels, chat, embedding }
     ctx["yesimbot.model"].register(provider)
     ctx.on("dispose", () => unregister)
   }
```

唯一有意义的差异：
- OpenAI/Google: 支持 embedding
- Anthropic: embedding 抛错
- DeepSeek: 用 `wrapLanguageModel` + middleware 包装模型

~200 行纯样板重复。

### 方案

提取 `createProviderPlugin({ name, createClient, defaults, capabilities, chatAdapter? })` 工厂函数。每个 provider 减少到 ~15 行配置。DeepSeek 的 middleware 包装适配可选 `chatAdapter` hook。

### 收益

- 杠杆：一个接口，4 个适配器（未来 N 个）
- 局部性：注册 bug 在工厂中一次修复
- 删除 ~200 行重复样板
- 新 provider = ~15 行配置

---

## 候选 3: 分解 RuntimeService 会话工厂

**强度**: Worth exploring
**文件**: `core/src/runtime/service.ts` (386 行)

### 问题

`createSessionContext()` 闭包 (~170 行) 混合了：
- Agent 构造
- Settings 合并
- Adapter 查找
- Delivery 接线
- **内联 prompt 扩展**（绕过 ExtensionService，无法注销/检查）
- Event 订阅 (~258 行事件处理)

`athena/event` 处理器混合了会话生命周期管理、格式化和 turn 触发。

### 方案

- 提取 **SessionFactory**（创建 Agent+Session+Delivery）
- 将 prompt 扩展移到 **ExtensionService** 注册
- 提取 **MessageRouter** 处理 athena/event

RuntimeService 变为 ~100 行的接线代码。

### 收益

- 局部性：prompt 扩展由 ExtensionService 管理
- 杠杆：SessionFactory 可脱离 Koishi 运行时测试
- MessageRouter 独立可测

---

## 候选 4: 统一 Adapter 事件创建

**强度**: Worth exploring
**文件**: `core/src/adapter/generic.ts` + `core/src/adapter/onebot/index.ts`

### 问题

`GenericAdapter.install()` 和 `OneBotAdapter.install()` 包含 ~30 行相同的事件创建逻辑。OneBotAdapter 注册为"专用"适配器（使 GenericAdapter 跳过 onebot），但不提供自定义格式化、自定义消息发送或任何额外能力。

### 方案

提取 `extractAthenaEvent(session)` 共享工具函数。要么用真正的 OneBot 特定格式化器加深 OneBotAdapter，要么删除它让 GenericAdapter 通过 middleware 模式处理 onebot。

### 收益

- 删除 ~30 行重复事件创建
- 杠杆：一个提取函数，N 个适配器

---

## 候选 5: Session 格式提取为共享 seam

**强度**: Worth exploring
**文件**: `core/src/extension/chat-history/jsonl-parser.ts` (235 行)

### 问题

`jsonl-parser.ts` 硬编码了 agent 内部 session 格式的知识：
- `type: "custom_message"`, `"message"`, `"custom"`
- `role: "compactionSummary"`
- `customType: "athena:event"`

agent 包对序列化格式的任何更改都会静默破坏 chat-history 搜索。

### 方案

在 `packages/agent` 中提取 session 格式解析/序列化规则为专用模块。`SessionManager` 和 core 的 `jsonl-parser` 都从它导入。格式变更成为单点编辑，合同变更时有编译时安全性。

### 收益

- 局部性：格式规则在一个模块
- 编译时安全
- core/extension 失去对 agent 的隐式格式依赖

---

## 候选 6: 合并两个 Extension 注册表

**强度**: Speculative
**文件**: `packages/agent/src/session/extensions/registry.ts` (43 行) + `core/src/extension/service.ts` (98 行)

### 问题

两个注册表：
1. `agent/ExtensionRegistry` — 简单 Map + Set + 广播 reload
2. `core/ExtensionService` — Koishi Service + ChannelContext 包装

agent 的注册表在生产中可能未使用。core 的服务做真正的工作并直接向 AgentSession 传递定义。

### 方案

删除或明确记录 agent 的 `ExtensionRegistry`。如果确实未使用，删除它。

### 收益

- 扩展注册的唯一真实来源
- 减少贡献者困惑

---

## 候选 7: 统一 workspace 工具错误处理

**强度**: Speculative
**文件**: `plugins/workspace/src/tools/{read-file,write-file,edit-file,grep}.ts`

### 问题

4 个工具文件重复相同的 stderr 字符串匹配（`"No such file"`, `"Permission denied"`, `"Is a directory"`），每个文件 10-15 行。另外：
- `requireWorkspace()` 死代码（定义但从未调用）
- `init()` 空异步方法
- heredoc 截断 bug（内容包含 `WORKSPACE_EOF` 时数据丢失）

### 方案

提取 `parseFsError(stderr): ToolError` 到 `helpers.ts`。修复 heredoc 分隔符为随机 token。删除死代码。

### 收益

- 删除 ~50 行重复错误匹配
- 修复 heredoc 数据丢失边界情况

---

## 候选 8: 泛化 ExtensionRunner emit 模式

**强度**: Speculative
**文件**: `packages/agent/src/session/extensions/runner.ts` (576 行)

### 问题

5 个 `emit*` 方法重复相同模式：遍历 bindings → 遍历 handlers → try/catch → 累积结果。`bindCore()` 设置的 8 个私有函数引用可以分组。

### 方案

提取通用 `emitWithAccumulator()`。将 `bindCore()` 字段分组为 `ContextActions` 对象。

### 收益

- 删除 ~80 行重复迭代
- 新 emit 事件 = 一个函数调用
- 错误隔离测试一次

---

## Top Recommendation

### 先做 #2: Provider 工厂

**理由**: 杠杆率最高、风险最低。

- `createProviderPlugin()` 工厂消除 ~200 行纯样板
- 新 provider 只需 ~15 行配置
- 纯机械重构，不改变行为，不破坏 agent loop
- 触及 `packages/agent/src/ai/types.ts` 中的 `ModelProvider` 接口——所有 provider 共享的 seam

### 之后做 #1: AgentSession 拆分

**理由**: 影响最大但更复杂。Provider 工厂先建立对 seam 词汇的信心，再动上帝类。

---

## 代码库结构参考

### 包依赖图

```
@yesimbot/agent (packages/agent/)     ← 零工作区依赖，纯基础
       ↑ runtime dep
koishi-plugin-yesimbot (core/)        ← 依赖 agent，提供 Koishi 服务
       ↑ peer dep
plugins/{workspace,skill,mcp-client}  ← 通过 ctx["yesimbot.extension"] 注册
providers/{openai,anthropic,deepseek,google} ← 通过 ctx["yesimbot.model"] 注册
```

### 服务依赖图（core 内部）

```
RuntimeService ──depends──→ ModelService
                 depends──→ ExtensionService
                 depends──→ SessionService
                 depends──→ AdapterService

SessionService ──depends──→ ModelService (声明但未使用？)

ModelService ──no deps──
ExtensionService ──no deps──
AdapterService ──no deps──
```

### 测试覆盖

| 模块 | 测试状态 |
|------|----------|
| pure functions (delivery, compaction, settings, JSONL parser) | ✅ 良好 |
| workspace tools | ✅ 良好（mock-based） |
| extension system (loader, runner, registry) | ✅ 良好 |
| chat-history tools | ✅ 集成级（real filesystem） |
| **agent-loop.ts** | ❌ 完全未测试 |
| **AgentSession.prompt/steer/followUp** | ❌ 未测试 |
| **RuntimeService** | ❌ 未测试 |
| **所有 providers** | ❌ 无测试 |
| **skill, mcp-client 插件** | ❌ 无测试 |
