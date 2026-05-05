# @yesimbot/agent

Athena 的 Agent Runtime 框架层。提供通用的 agent loop、session 管理、上下文压缩和扩展系统。

## 职责

- **Agent Loop** (`src/agent/`): LLM 调用 → 工具执行 → 响应生成的循环
- **Session 管理** (`src/session/`): AgentSession、SessionManager、上下文压缩
- **扩展系统** (`src/session/extensions/`): ExtensionRegistry、ExtensionRunner、ExtensionDefinition

## 不负责

- 具体群聊业务语义（由 `core/` 承担）
- 具体模型接入（由 `providers/*` 承担）
- 具体工具实现（由 `plugins/*` 承担）
