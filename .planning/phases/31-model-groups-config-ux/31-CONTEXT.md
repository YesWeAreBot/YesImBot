# Phase 31: Model Groups + Config UX - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

改善 Koishi Console 配置面板的可读性：将平铺配置项按功能分组折叠展示，为所有配置项添加中文描述，实现 i18n 国际化（zh-CN / en-US）。

注意：模型组与负载均衡（REQ-04）已延期，本 phase 仅覆盖 REQ-06（配置分组）、REQ-07（Schema 描述增强）、REQ-08（i18n 国际化）。

</domain>

<decisions>
## Implementation Decisions

### 配置分组方案

- 五组划分：基础、模型、意愿值、提示词、高级（可根据实际配置项数量和逻辑关系微调）
- 使用 `Schema.intersect` 各子 schema 的 `.description()` 实现 UI 标题分组，保持平铺结构不引入嵌套 object
- Koishi Console 不支持独立折叠各分组（已验证：嵌套 intersect 方案失败），使用标题分隔即可
- 每个分组仅显示纯中文标题，不加额外描述文字
- 组内字段按使用频率排列，常改的靠前，高级/少用的靠后

### Schema 描述风格

- 简洁功能说明：一句话说明字段用途，如「触发回复的最低意愿值阈值」
- 默认值和取值范围依赖 Schema 原生展示机制，不在描述文案中重复
- 描述通过 i18n key 引用，不硬编码中文字符串

### i18n 国际化

- 覆盖范围：core 插件 + 所有 provider 插件，全部做 i18n
- 每个插件独立维护 `locales/` 目录，包含 `zh-CN.json` 和 `en-US.json`（JSON 格式，pkgroll 不支持 YAML 内联）
- 通过 `Schema.i18n()` 注册配置描述翻译，`tsconfig.base.json` 需要 `resolveJsonModule: true`

### Claude's Discretion

- 具体的 i18n key 命名规范
- 分组内字段的精确排序
- 五组划分的微调（如某组配置项过多时是否拆分）

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

- 模型组与负载均衡（REQ-04）— 原计划在本 phase，用户决定延期，继续使用 fallbackChain
- 故障恢复机制（冷却期、重试、全组不可用处理）— 随模型组一起延期

</deferred>

---

_Phase: 31-model-groups-config-ux_
_Context gathered: 2026-02-27_
