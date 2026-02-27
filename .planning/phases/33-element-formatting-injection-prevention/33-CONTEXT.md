# Phase 33: Element Formatting & Injection Prevention - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

将 Koishi 消息元素（at/quote/image/face/forward/audio/video/file）解析为 AI 可读文本，并对所有用户内容进行防 prompt injection 处理。不包含 AssetService 实现、多模态图片处理（Phase 38）、富文本输出（Phase 39）。

</domain>

<decisions>
## Implementation Decisions

### 元素解析格式

- 保留经处理的消息元素 XML 格式（非语义文本），输入输出一致性 — LLM 看到什么格式就用什么格式输出
- `at` 元素：保留 `<at>` 标签，包含 id 和 name 属性
- `face` 元素：保留 `<face>` 标签，包含平台原始属性
- `audio/video/file`：预留 `id` 属性位（供未来 AssetService 填充），保留语义 metadata（文件名、时长等）
- `image`：本 phase 仅做基础标签处理，多模态由 Phase 38 单独处理
- `forward`：占位标签，通过已有的 `get_forward` 工具获取详情
- 解析后使用 `elements.map(el => el.toString()).join("")` 合并，自然处理相邻文本节点

### 引用消息展示

- 方括号内联格式：`[回复 Alice: 消息内容预览]`
- 放在消息正文开头，作为消息前缀
- 固定截断长度，防止长消息撑大上下文
- 只展示一层引用，嵌套引用不递归展开

### 转义与防注入策略

- 信任 Koishi 框架层解析 — `session.elements` 已完成 XML 转义，用户文本中的 `<` `>` 已被转义
- 三层防御：XML 转义（框架层）+ prompt 指引（system prompt 中明确告知 LLM）+ 可疑内容标记
- 长度阈值检测：超过阈值的用户消息包裹 `<unverified>` 标签 + 提示 LLM 甄别（参考 dev 版 heartbeat-processor.ts 实现）
- 部分 LLM 在长上下文下无法区分 `<` 和 `&lt;`，因此不能仅依赖 XML 转义

### Formatter 架构

- Handler map + fallback 模式：每种已知元素类型有专门 handler，未注册类型走通用占位符
- 通用占位符带类型信息：`<unsupported type="xyz"/>`
- 可扩展注册：通过 Service 方法注册自定义元素处理器（如 `ctx.elementFormatter.register('poke', handler)`）
- 仅处理顶层元素，不递归处理子节点

### Claude's Discretion

- 具体截断长度数值
- unverified 标签的提示文案
- handler 注册接口的具体签名设计
- prompt 指引的具体措辞

</decisions>

<specifics>
## Specific Ideas

- 输入输出格式一致性是核心设计原则 — v3/dev 已验证 LLM 对结构化 XML 元素的理解能力足够
- dev 版 `heartbeat-processor.ts:L112` 的 `<unverified>` 标签模式作为防注入参考
- `element.toString()` join 是 Koishi 惯用的元素序列化方式

</specifics>

<deferred>
## Deferred Ideas

- AssetService 资源服务（内部 ID 替换 URL、缓存管理、生命周期） — 未来 phase 或 Phase 38 时引入
- 递归引用链展开 — v2.6

</deferred>

---

_Phase: 33-element-formatting-injection-prevention_
_Context gathered: 2026-02-27_
