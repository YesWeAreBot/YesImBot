# Core Owns Extension Lifecycle

Athena 将 extension system 的定义管理、`setup/cleanup` 生命周期、热重载、built-in prompt extension 注册和 extension tool snapshot 收集统一收归 `koishi-plugin-yesimbot` 的 `ExtensionService`。`@yesimbot/agent` 只保留 hook dispatch、agent loop、session persistence 和其他通用运行时能力，这样 agent 包不会继续携带 Koishi/core 特有的 extension 平台语义，扩展边界也只剩一个真实来源。
