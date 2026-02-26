# Feature Landscape

**Domain:** Koishi AI chat plugin — runtime polish & model infrastructure
**Researched:** 2026-02-26
**Milestone:** v2.4 Runtime & Polish

---

## Table Stakes

Features users expect. Missing = product feels incomplete or broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| 消息队列重构（积压合并） | 处理中收到新消息时当前行为未定义，用户会看到重复响应或丢失消息 | Medium | 现有 `pending` Map 已有骨架，但处理中触发新消息时 `pending` 被覆盖而非合并 |
| Bot Action 空记录修复 | LLM 选择不回复时写入空 `[Bot Action]` 污染 history，影响后续上下文质量 | Low | `recordAgentResponse` 在 loop.ts 无条件调用，需加 guard |
| Tool trim 修复 | working memory 无限增长导致 token 溢出，最终请求失败 | Low-Medium | `trimMessages` 逻辑存在但未被正确触发或 messages 数组结构不符合预期 |
| 配置分组优化 | 当前 `Schema.intersect` 平铺所有字段，Koishi Console UI 无分组，难以找到相关配置 | Low | Koishi 支持 `Schema.object().description()` + `.collapse()` 实现分组折叠 |

## Differentiators

Features that set the product apart. Not expected, but valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| 模型组与负载均衡 | 多个 API key / 多个端点分担负载，单点故障不影响服务 | High | v3 已有完整实现（CircuitBreaker + RoundRobin/Failover），需适配 v4 provider 插件架构 |
| Provider 架构优化（公共基类） | 三个 provider 插件有大量重复代码（Schema、constructor、listModels），抽取基类减少维护成本 | Medium | 当前 OpenAI/DeepSeek/Anthropic 各自独立实现，差异仅在 `createXxx()` 调用和 Anthropic 的 fetch 拦截 |
| Schema 描述增强 | 配置项缺少中文描述和合理默认值说明，用户不知道该填什么 | Low | 纯文案工作，无逻辑变更 |

## Anti-Features

Features to explicitly NOT build in this milestone.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| 完整断路器（CircuitBreaker）实现 | v3 的断路器与 per-model config 深度耦合，v4 provider 是插件化的，架构不同 | 先实现 round-robin 和 failover 两种策略，断路器作为后续迭代 |
| 模型组 Dynamic Schema 联动 | 模型组名称需要在 provider 注册后才能枚举，与现有 `registry.chatModels` 联动复杂 | 模型组名称用 `Schema.string()` 手填，不做下拉联动 |
| 全 provider 缓存抽象 | 各 provider 缓存语义不同（PROJECT.md Out of Scope 明确排除） | 保持 Anthropic-only 缓存现状 |
| 跨频道消息合并 | 消息队列重构只处理同一 channelKey 的积压，跨频道无意义 | 保持 per-channel 隔离 |
| 任务类型（TaskType）映射 | v3 的 chat/embed/summarize 任务映射过度设计，v4 只有 agent 一个主任务 | 模型组直接在 AgentCore config 中引用，不做任务映射层 |

---

## Feature Details

### 1. 消息队列重构（积压合并）

**当前行为（bug）：**

```
handleEvent() 触发 → 聚合窗口到期 → 检查 queues.has(channelKey)
  → 如果正在处理：pending.set(channelKey, built)  ← 覆盖，丢失中间消息
  → 如果空闲：enqueue()
```

**期望行为：**
- 处理中收到新消息 → 追加到积压队列（不覆盖）
- 当前处理完成 → 将所有积压消息合并为一次 percept → 触发一次 loop
- 合并策略：取最新 event 的 metadata，content 拼接所有积压消息

**实现要点：**
- `pending` 从 `Map<string, LoopPayload>` 改为 `Map<string, LoopPayload[]>`（数组）
- `enqueue` 的 `.then()` 回调从 `pending.get()` 改为取数组后合并
- 合并函数：多个 percept → 单个 percept，content 用换行拼接

**依赖：** 无外部依赖，纯内部逻辑修改

---

### 2. Bot Action 空记录修复

**当前行为（bug）：**

```typescript
// loop.ts — 无条件记录，即使 actions 为空或 LLM 选择不回复
await horizon.events.recordAgentResponse({
  ...
  data: { round, assistantText: rawText, actions: response.actions, toolResults },
});
```

**期望行为：**
- 如果 `response.actions` 为空数组，不记录
- 如果所有 actions 都是 no-op（无 send_message 且无 tool call），不记录
- 只有实际执行了有意义动作时才写入 history

**实现要点：**
- 在 `recordAgentResponse` 调用前加 guard：`if (response.actions.length === 0) skip`
- 更精确：`if (!hasToolCalls && !hasActionCalls) skip`
- `hasToolCalls` / `hasActionCalls` 已在 `executeActions` 返回值中，可直接使用

**依赖：** 无外部依赖

---

### 3. Tool trim 修复

**当前行为（bug）：**

`trimMessages` 函数逻辑正确，但 `messages` 数组在 loop 中只有一条初始 user message，后续 assistant/user 轮次在 `while` 循环内 `push`。`trimMessages` 在每轮开始时调用——此时 messages 长度可能不足以触发 trim（`totalRounds = Math.floor((messages.length - 1) / 2)` 为 0）。

跨 loop 调用（多次 `run()`）时，history 来自 Horizon，不在 messages 数组中，trim 对 Horizon history 无效。

**期望行为：**
- charBudget 应基于字符数触发，不依赖轮次数
- 单次 loop 内轮次不够多时，trim 对 userContent（Horizon 渲染的历史）也应生效

**实现要点：**
- 确认 bug 根因：是 messages 数组太短导致 `eligibleEnd <= 1`，还是 charBudget 设置过大
- 如果是前者：需要对 userContent 字符串本身也做 trim（独立于 messages 数组的 trim）
- 如果是后者：降低默认 charBudget 或增加日志确认触发条件
- 建议先加日志确认 `totalChars(messages)` 实际值，再决定修复方向

**依赖：** 需要先确认 bug 根因（代码审查）

---

### 4. 模型组与负载均衡

**期望行为：**
- 用户在 ModelService config 中定义模型组：`{ name: "main", models: ["openai:gpt-4o", "deepseek:deepseek-chat"], strategy: "round-robin" | "failover" }`
- AgentCore 的 `model` 字段可以引用模型组名称（如 `"group:main"`）或直接引用单个模型
- `ModelService.call()` 检测到 group 引用时，按策略选择模型执行
- round-robin：轮流选择，per-group 维护计数器
- failover：按顺序尝试，失败才切换下一个

**实现要点：**
- ModelService 新增 `groups` 配置：`Schema.array(Schema.object({ name, models: string[], strategy }))`
- `resolveModel()` 扩展：识别 `group:xxx` 前缀，返回组内当前模型
- 组内模型选择器：`GroupSelector` 类，持有 round-robin 计数器（`Map<string, number>`）
- Dynamic Schema 更新：`registry.chatModels` 追加已定义的组名（`group:xxx`）
- fallbackChain 保持不变，组内 failover 是组级别的，fallbackChain 是跨组的

**与 v3 的区别：**
- v3 的模型组在 ModelService 内部管理（单体配置），v4 的 provider 是独立插件
- v4 不需要 `useChatGroup()` 返回 Switcher 对象，直接在 `call()` 内部处理
- v4 不实现断路器（过度设计），只做 round-robin 和 failover

**依赖：** 依赖 provider 插件已注册（现有机制），无新外部依赖

---

### 5. Provider 架构优化（公共基类）

**当前重复代码（三个 provider 各自实现）：**

完全相同的部分：
- Schema 结构（id, apiKey, baseURL, models array, defaultParams）
- `IModelProvider` 接口实现（id, providerType, models, defaultParams）
- `listModels()` 实现
- `getDefaultParams()` 实现
- models 数组构造逻辑

差异部分：
- OpenAI：`createOpenAI()` + `topP` 参数
- DeepSeek：`createDeepSeek()` + `topP` 参数
- Anthropic：`createAnthropic()` + fetch 拦截（user_id 注入）+ `projectId/sessionId` 字段

**期望行为：**
- `shared-model` 提供 `BaseProvider` 抽象类实现公共 `IModelProvider` 方法
- 各 provider 继承基础类，只需实现 `createClient()` 和声明 `providerType`
- `createBaseSchema()` 工厂函数生成公共 Schema 部分，各 provider 用 `Schema.intersect` 追加差异字段

**实现要点：**

```typescript
// shared-model 新增
export abstract class BaseProvider implements IModelProvider {
  readonly id: string;
  readonly models: ModelInfo[];
  readonly defaultParams: ModelDefaultParams;
  abstract readonly providerType: string;
  abstract getModel(modelId: string): LanguageModel;

  // 公共实现
  listModels(): Record<string, ModelInfo> {
    return Object.fromEntries(this.models.map((m) => [m.id, m]));
  }
  getDefaultParams(): ModelDefaultParams { return this.defaultParams; }
}
```

**依赖：** 无外部依赖，纯重构

---

### 6. 配置分组优化

**当前问题：**

`Schema.intersect([AgentCoreConfigSchema, HorizonServiceConfigSchema, ...])` 将所有字段平铺，Koishi Console 显示为一个长列表，无法区分哪些字段属于哪个子系统。

**期望行为：**
- 每个子系统的配置有独立的折叠分组，标题清晰
- 高频配置（model、allowedChannels）在顶层可见
- 低频配置（debugLevel、softTrimHead 等）在折叠组内

**实现要点（HIGH confidence，从 v3 config.ts 验证）：**

```typescript
// Koishi Schema 分组机制
Schema.object({ ... }).collapse().description("分组标题")
```

- `Schema.intersect` 中每个 `Schema.object` 加 `.description()` 在 UI 中显示为分组标题
- `.collapse()` 使分组默认折叠
- 顶层保留最重要的字段不折叠（model、allowedChannels、rolePath）

**依赖：** 无外部依赖，纯 Schema 调整

---

## Feature Dependencies

```
Provider 架构优化 → 模型组与负载均衡（基类稳定后再加组逻辑更安全）
消息队列重构 → 独立（无依赖）
Bot Action 空记录修复 → 独立（无依赖）
Tool trim 修复 → 需先确认根因（可能依赖消息队列重构后的结构）
配置分组优化 → 独立（无依赖）
```

## MVP Recommendation

优先顺序（按风险和价值排序）：

1. **Bot Action 空记录修复** — 最简单，直接影响 history 质量，一行 guard
2. **消息队列重构** — 中等复杂度，修复真实运行时 bug，用户可感知
3. **Tool trim 修复** — 需先确认根因，可能是配置问题而非代码 bug
4. **配置分组优化** — 纯 Schema 调整，低风险，改善 UX
5. **Provider 架构优化** — 重构，无功能变化，降低维护成本
6. **模型组与负载均衡** — 最复杂，新功能，依赖 provider 架构稳定

推迟：断路器、Dynamic Schema 模型组联动、任务类型映射

---

## Sources

- `/home/workspace/Athena/core/src/services/agent/service.ts` — 消息队列现有实现（HIGH confidence）
- `/home/workspace/Athena/core/src/services/agent/loop.ts` — recordAgentResponse 调用位置（HIGH confidence）
- `/home/workspace/Athena/core/src/services/agent/trimmer.ts` — trim 逻辑实现（HIGH confidence）
- `/home/workspace/Athena/core/src/services/model/service.ts` — ModelService 现有架构（HIGH confidence）
- `/home/workspace/Athena/providers/provider-openai/src/index.ts` — provider 重复代码（HIGH confidence）
- `/home/workspace/Athena/providers/provider-anthropic/src/index.ts` — Anthropic 差异（HIGH confidence）
- `/home/workspace/Athena/references/YesImBot-v3/packages/core/src/services/model/service.ts` — v3 负载均衡参考实现（HIGH confidence）
- `/home/workspace/Athena/references/YesImBot-v3/packages/core/src/services/model/config.ts` — v3 模型组 Schema 设计（HIGH confidence）
- `/home/workspace/Athena/.planning/PROJECT.md` — milestone 目标和 Out of Scope 约束（HIGH confidence）
