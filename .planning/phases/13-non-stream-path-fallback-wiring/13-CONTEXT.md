# Phase 13: Non-stream Path & Fallback Wiring - Context

**Gathered:** 2026-02-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Route non-stream generateText() through ModelService.call() and wire parseModelId + fallbackModel. Clean up finishTool double-inclusion. Ensure both stream and non-stream paths share identical fallback/concurrency behavior through ModelService.

</domain>

<decisions>
## Implementation Decisions

### Fallback 行为
- 切换时记录 warn 级别日志，不影响用户体验（不通知用户）
- 仅临时性错误触发 fallback（429/503/超时），认证错误等直接报错
- 主模型重试 1-2 次后仍失败再切换 fallback
- 遍历整条 fallback 链，全部失败才最终报错

### 非流式路径统一策略
- ModelService 提供 call() 和 stream() 双方法，共享 fallback/PQueue 逻辑
- 非流式和流式路径行为语义完全一致（相同的 fallback 链、并发限制、错误处理）
- 顺便确保流式路径也走 ModelService（如果尚未统一）
- 正常路径必须走 ModelService，特殊场景（测试/调试）允许直接调用 ai-sdk

### finishTool 清理范围
- 修复双重包含 bug + 小幅整理 tool 注入逻辑
- finishTool 始终自动包含，不需要配置开关
- tool 注入收敛到单一组装点，而非多处分散拼接

### parseModelId 处置
- parseModelId 已迁移到 shared-model，正式使用（不移除）
- 已引入 `type ModelSelector = { provider: string; model: string }` 规范类型
- 边界解析策略：用户配置输入处解析一次 provider:model 字符串为 ModelSelector，内部全部传递 ModelSelector 对象
- fallbackModel 配置格式与主模型相同（provider:model 字符串），边界统一解析
- 解析逻辑和可用性判断全部收敛到 ModelService 内部，调用方只传 ModelSelector

### Claude's Discretion
- 重试次数的具体值（1 或 2 次）
- fallback 链遍历的具体实现方式
- call()/stream() 内部共享逻辑的抽取方式
- tool 组装点的具体位置选择

</decisions>

<specifics>
## Specific Ideas

- "parseModelId 已经迁移到 shared-model 作为共享工具，并在 modelservice 和 agent 中使用"
- ModelSelector 类型已存在，需要统一消除当前代码中的重复解析和可用性判断

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 13-non-stream-path-fallback-wiring*
*Context gathered: 2026-02-20*
