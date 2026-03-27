# Session-Centric Runtime 技术栈选型记录

本文基于以下材料整理：

- `docs/ideas/session-centric-runtime.md`
- `docs/ideas/session-centric-runtime-greenfield-plan.md`
- `references/pi-agent.md`
- `references/pi-ai.md`
- 当前 `packages/shared-model/`、`core/src/services/model/` 与 `providers/*`

它讨论的是 Athena vNext 的 runtime 与 model stack 选型，不修改旧 runtime 的实现前提。

## 结论

- 对 Athena vNext 而言，`pi-agent` 比当前基于 ai-sdk 手工拼装的 agent loop 更适合作为 runtime 底座。
- 如果选择 `pi-agent`，基本等于同时选择 `pi-ai` 作为模型调用与 provider 适配底层。
- 因此，当前 `packages/shared-model/` 不应被直接继承到 vNext 主链路中，因为它本质上是 ai-sdk 类型系统的薄抽象。
- vNext 应采用“`pi-agent` + `pi-ai` + 新的 model contract`”的组合，而不是试图把 `pi-agent` 塞进现有 ai-sdk 抽象壳里。

## 为什么 `pi-agent` 更适合 Athena vNext

### 1. 它的抽象中心更接近 session agent

- `pi-agent` 的核心对象是带状态的 `Agent`，而不是一次性的 `generateText()` 包装。
- 它原生暴露 `messages`、`pendingToolCalls`、`abort()`、`continue()`、`waitForIdle()`、steering queue、follow-up queue 等运行时能力。
- 这些能力天然更接近我们要做的 `session -> mailbox -> busy -> interrupt/resume -> continue` 模型。

### 2. 它的事件流更适合 runtime 编排

- `pi-agent` 原生定义了 `agent_start`、`turn_start`、`message_update`、`tool_execution_start`、`turn_end`、`agent_end` 等事件序列。
- 这些事件比 ai-sdk 的单次 `generateText` / `streamText` 结果更适合拿来构建 session runtime、前端观察流、日志回放和持久化事件流。
- 对 Athena 这种强调状态、恢复、后台 agent、工具执行边界的系统来说，这种事件模型更贴合底层需求。

### 3. 它已经把我们现在手动做的很多事情提升为一等能力

- 工具并发/串行执行是配置项，而不是我们自己再写一层调度器。
- `beforeToolCall` / `afterToolCall` 可以承载工具准入、审计、后处理。
- `transformContext()` 与 `convertToLlm()` 给了上下文裁剪和自定义消息类型的清晰挂点。
- `steer()` / `followUp()` 很接近我们想要的中断、恢复、延后处理语义。

### 4. 它比当前 ai-sdk agent 包装更像“底座”而不是“辅助函数”

- 当前仓库对 ai-sdk 的使用主要还是 `generateText()`、`streamText()` 这类单轮调用。
- memory agent 虽然已经利用了 ai-sdk 的 tools/maxSteps 能力，但整体主 runtime 仍然要自己承担状态机、循环控制、工具收尾、错误恢复。
- `pi-agent` 更像一个可观察、可中断、可续跑的 agent runtime 内核，这正符合 Athena vNext 的方向。

## 为什么选择 `pi-agent` 基本等于选择 `pi-ai`

- `references/pi-agent.md` 开头已明确说明：`pi-agent` built on `@mariozechner/pi-ai`。
- `Agent` 的 `initialState.model`、低层 `agentLoop()` 配置、tool schema 与事件模型都围绕 `pi-ai` 的模型和消息格式设计。
- 虽然 `pi-agent` 支持自定义 `streamFn`，但这更像是代理/转发扩展点，不是“脱离 pi-ai 自己接另一套 model contract”。

因此，从工程上不应假设：

- 继续保留 ai-sdk 作为底层 model contract
- 只单独拿 `pi-agent` 过来包在上面

这种组合理论上也许能强行适配，但会增加一层没有必要的桥接复杂度。

## 当前 `shared-model` 的真实耦合情况

### 它不是 provider-agnostic contract，而是 ai-sdk-shaped contract

`packages/shared-model/src/types/model.ts` 当前直接暴露：

- `LanguageModelV3` from `@ai-sdk/provider`
- `LanguageModel` from `ai`
- `CallSettings` from `ai`

并且 `IModelProvider` 直接定义：

- `getModel(modelId: string): LanguageModel`
- `getDefaultParams(): Partial<CallSettings>`

这意味着当前 `shared-model` 的抽象边界不是“模型服务通用契约”，而是“ai-sdk 对象的仓库内封装”。

### `AbstractProvider` 也直接依赖 ai-sdk 语义

`packages/shared-model/src/providers/abstract-provider.ts` 当前要求 provider client 暴露：

- `chat(modelId: string): LanguageModel`
- 可选 `textEmbeddingModel()`
- `defaultParams?: Partial<CallSettings>`

这仍然是 ai-sdk 模型句柄与参数对象的语义，而不是独立的 Athena contract。

### `ModelService` 进一步把 ai-sdk 固化在调用路径里

`core/src/services/model/service.ts` 当前直接依赖：

- `generateText`
- `streamText`
- `wrapLanguageModel`
- `extractReasoningMiddleware`

也就是说，当前从 provider 注册、model handle、默认参数，到实际调用执行，整条链都已经是 ai-sdk-native。

## 这意味着什么

如果 Athena vNext 选择 `pi-agent` / `pi-ai`，那么：

- 不能把当前 `shared-model` 视为稳定中立层继续沿用。
- 不能只替换 loop，而保留现有 model abstraction 不动。
- 需要一并重做 vNext 的 model contract。

换句话说，`shared-model` 在旧系统里是“共享模型抽象”，但在 vNext 视角里它更像“旧技术栈适配层”。

## 迁移影响范围

### 1. `packages/shared-model/` 需要重定义或分叉

至少要处理以下问题：

- 是否继续导出 ai-sdk 类型。
- provider/model 的统一描述对象是否改为 `pi-ai` 的 model metadata。
- 默认参数、reasoning、tool support、modalities、context window、cost 等字段如何映射到新结构。

推荐做法不是在原包上强行兼容双栈，而是：

- 为 vNext 新建独立 model contract 包，或者
- 把 `shared-model` 重构为不依赖 ai-sdk / pi-ai 的中立描述层，再分别提供 adapter。

对当前阶段而言，前者更简单。

### 2. `core/src/services/model/` 不应直接搬到 vNext

当前 `ModelService` 的优点仍然成立，例如：

- provider registry
- fallback chain
- 并发队列
- usage 统计

但它的调用内核完全建立在 ai-sdk 上，因此更适合作为参考实现，而不是直接复用代码。

vNext 更适合重建一个新的 model/runtime adapter，例如：

- 继续保留 provider registry 思想
- 继续保留 usage / fallback / concurrency 思想
- 但底层调用改为 `pi-ai` 的 `stream` / `complete` / model registry

### 3. `providers/*` 很可能可以显著简化

当前 provider 包中，OpenAI、Google、DeepSeek 等大多只是 ai-sdk provider 的薄封装。

如果转向 `pi-ai`：

- 很多 provider 可以直接使用 `pi-ai` 内建 provider/model registry
- 当前这些 provider workspace 未必还需要保留为独立运行时包
- 可能只需要保留 Athena 自己的配置层与少量 provider-specific patch

### 4. 少数 provider patch 仍需保留适配点

例如当前 `providers/anthropic/src/index.ts` 会在请求体里注入 `metadata.user_id`。

这类逻辑说明：

- 我们并不是完全没有自定义 provider 行为
- 即使迁移到 `pi-ai`，也仍需要预留 provider-specific adapter / transport hook / proxy hook

因此，迁移不应假设“用了 `pi-ai` 就完全不再需要 Athena 自己的 provider 适配层”，只是这层会更薄。

## 推荐路线

### 方案选择

推荐 Athena vNext 直接采用：

- runtime: `pi-agent`
- model layer: `pi-ai`
- Athena adapter layer: 自己实现少量 session、history、tool、provider patch 适配

不推荐：

- `pi-agent` + 旧 `shared-model` + ai-sdk 底层 的混搭方案
- 把 `pi-agent` 当成现有 `ModelService` 上面的一层皮

### 包与目录层面的建议

在 vNext 目录或新 package 中：

- 新建 `model-contract` 或 `runtime-model` 一类包，作为 vNext 专用模型契约
- 不直接复用当前 `packages/shared-model/` 的 ai-sdk 类型导出
- 旧 `shared-model` 继续服务旧 runtime，直到旧系统退场

这样可以避免：

- 为双栈兼容污染 vNext 设计
- 为 vNext 迁移反向破坏旧系统

## 一个更稳的抽象策略

vNext 的“共享模型层”最好分成两层：

### 1. Athena-neutral 描述层

只保留 Athena 自己真正关心的概念：

- provider id
- model id
- reasoning support
- tool call support
- input modalities
- context/output limit
- cost metadata
- provider patch metadata

这层不暴露 ai-sdk 或 `pi-ai` 的具体类型。

### 2. Runtime adapter 层

由具体 runtime stack 决定如何把描述层映射到实际模型对象：

- 旧栈可映射到 ai-sdk `LanguageModel`
- vNext 映射到 `pi-ai` model

如果只做 vNext，则甚至可以先跳过旧栈映射，直接做 `pi-ai` adapter。

## 最终判断

- 站在 Athena vNext 的目标上看，`pi-agent` 确实比当前 ai-sdk agent 包装更适合作为底座。
- 一旦采用 `pi-agent`，就应把 `pi-ai` 视为同一技术决策的一部分。
- 当前 `shared-model` 本质上是 ai-sdk 抽象，不应被误判为中立共享层。
- 因此，若 vNext 采用 `pi-agent` / `pi-ai`，应同步迁移 model contract，而不是只迁移 loop。

这会增加一次性重建成本，但会显著减少长期桥接成本和抽象错位。
