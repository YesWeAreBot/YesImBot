# Phase 1: Foundation & Shared Model - Context

**Gathered:** 2026-02-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish monorepo structure with Turborepo + Yarn workspaces, shared-model package exporting core model types, and Koishi plugin skeleton that can be loaded by Koishi 4.x. This phase delivers build infrastructure and type foundations — no runtime behavior.

</domain>

<decisions>
## Implementation Decisions

### Monorepo 包结构
- 按功能拆分，每个 provider 独立包
- 三个顶层目录：`packages/` 放共享包，`plugins/` 放 YesImBot 扩展插件，`providers/` 放 provider 插件
- 包命名：共享包用 `@yesimbot/*`（如 `@yesimbot/shared-model`）；Koishi 插件遵循加载机制，包名为 `@yesimbot/koishi-plugin-*`（如 `@yesimbot/koishi-plugin-core`、`@yesimbot/koishi-plugin-provider-openai`）
- 每个包内部标准 `src/` 结构，`src/index.ts` 作为入口，统一 tsconfig 继承

### 共享类型设计
- shared-model 包含类型定义 + 基础工具函数（非纯类型包）
- 核心类型基于 ai-sdk 类型扩展（IModelProvider、IModel、ModelConfig 等）
- shared-model 不依赖 ai-sdk 运行时，仅 re-export 类型；provider 包各自依赖 ai-sdk 运行时
- shared-model 只放模型相关类型，Horizon（Event/Entity）等其他领域类型归属各自包

### Koishi 插件骨架
- 单核心插件包含所有内置服务（ModelService、AgentCore、Horizon 等），provider 和扩展功能作为独立 Koishi 插件
- Provider 通过核心自定义注册表注册（非 Koishi 原生 Service 机制），支持同一 Provider 插件多实例启用
- 分散配置：核心插件和 provider 插件各自管理自己的 Koishi Config schema
- 核心通过独立 adapter 层接入 Koishi 消息事件，adapter 负责监听事件并调用核心 API

### Claude's Discretion
- 包内部文件组织细节
- TypeScript 编译配置细节
- Turborepo pipeline 设计
- 开发时 watch/热重载方式

</decisions>

<specifics>
## Specific Ideas

- Provider 多实例是核心需求——同一个 OpenAI provider 插件可能配置不同 API key 或 endpoint 多次启用
- Koishi 插件命名必须遵循 `koishi-plugin-*` 或 `@scope/koishi-plugin-*` 加载机制

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation-shared-model*
*Context gathered: 2026-02-17*
