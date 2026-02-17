# Phase 2: Model Service & Providers - Context

**Gathered:** 2026-02-18
**Status:** Ready for planning

<domain>
## Phase Boundary

通过统一的 ModelService 抽象层，让多个 LLM 提供商（OpenAI、DeepSeek）能够注册并被调用。Provider 以独立 Koishi 插件形式存在，通过 Service 机制注入 ModelService。ModelService 提供两层调用模式：包装调用（内置 fallback、队列、监控）和元调用（直接获取 LanguageModel 对象）。

</domain>

<decisions>
## Implementation Decisions

### Provider 注册机制
- 每个 provider 是独立的 Koishi 插件包，通过 Koishi Service 机制注入 ModelService
- 允许同一种 provider 注册多个实例（如两个不同 API key 的 OpenAI provider）
- 用户在插件配置中自定义每个实例的名称（如 "openai-main"、"openai-backup"）
- Provider 注册时声明支持的模型列表，模型列表可在运行时动态更新
- 注册/注销跟随 Koishi 插件生命周期自动管理
- API 连通性延迟到首次调用时验证，注册时只检查配置格式
- 其他服务按需查询 ModelService 当前可用 provider 列表，无需事件通知

### 模型选择与路由
- 调用方显式指定 provider 实例名 + 模型名（如 `modelService.call("openai-main", "gpt-4o", ...)`）
- 支持默认模型概念：配置中指定默认 provider+模型组合，调用方可不传参数使用默认模型
- 当指定 provider 不可用时支持自动 fallback
- Fallback 链由用户在核心插件（YesImBot 主插件）中配置，按顺序尝试

### API 调用与响应处理
- **双层调用模式：**
  - **包装调用：** ModelService 提供封装方法，同时支持 streaming 和非 streaming，用户指定调用格式。内置 auto fallback、请求队列、usage 监控
  - **元调用：** 调用方通过 ModelService 获取 ai-sdk 的 LanguageModel 对象 + 默认参数，自行使用 ai-sdk 的 generateText/streamText 方法调用，适用于特殊场景
- Provider 创建 LanguageModel 时已注入 API key、base URL 等连接信息，调用方拿到即用
- 默认参数（temperature、topP 等）由 Provider 设置，调用方可覆盖
- Provider 注册时声明每个模型的能力标签（tool calling、vision、JSON mode 等），调用方可查询
- Provider 将不同 API 的错误统一为标准错误类型抛出
- Token 用量追踪由调用方自行从 ai-sdk 返回值中获取（元调用模式），包装调用模式下由 ModelService 内置 usage 监控

### Provider 配置体验
- 每个 provider 插件在 Koishi 控制台有独立配置页
- 配置项包括：实例名称、API key、base URL、模型列表
- 模型列表支持手动填写覆盖 + 可选自动发现开关
- 多实例通过配置中的实例名字段区分（非 Koishi 多实例机制）
- Fallback 链在核心插件中统一配置（跨 provider 编排逻辑）

### Claude's Discretion
- 统一错误类型的具体定义（错误码、错误分类）
- 请求队列的具体实现策略（并发限制、优先级等）
- 模型能力标签的具体枚举值
- 自动发现模型列表的实现方式

</decisions>

<specifics>
## Specific Ideas

- ModelService 不仅是 model 注册表，还是调用编排层——包装调用提供开箱即用的 fallback/队列/监控，元调用提供灵活性
- Provider 插件应该是"配置好就能用"的体验，用户填 API key 和实例名即可
- ai-sdk 作为底层统一抽象，Provider 负责创建 ai-sdk 的 LanguageModel 对象

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-model-service-providers*
*Context gathered: 2026-02-18*
