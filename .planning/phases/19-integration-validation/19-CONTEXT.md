# Phase 19: Integration & Validation - Context

**Gathered:** 2026-02-23
**Status:** Ready for planning

<domain>
## Phase Boundary

将完整的 Trait→Skill 管线接入 ThinkActLoop，用示例 skill 验证端到端的上下文感知行为适配。不新增 trait detector 或 skill 框架功能——只做接线和验证。

</domain>

<decisions>
## Implementation Decisions

### 管线接入点
- prompt 渲染前一次性调用：buildView → trait.analyze() → skill.resolve() → 注入 effect → renderToString
- loop 内部直接调用 trait/skill 服务，通过 ctx 服务注入访问（ctx['yesimbot.trait']、ctx['yesimbot.skill']）
- trait/skill 是必须依赖——agent service 声明 inject，Koishi 确保 trait/skill 加载后才启动 agent
- 不在每轮 loop 重新分析，一次 percept 触发一次 trait/skill 解析

### 示例 Skill 选择
- 三个 skill 覆盖三种效果类型：
  - `private-chat`（已有）→ **style** 效果，scope:isDirect 触发
  - `image-gen`（改写）→ **tools** 效果，用代码激活器替代 YAML intent 条件，关键词匹配（画画、draw 等）触发
  - 新增 `mention-aware`（被 @ 提醒型）→ **prompt** 效果，scope:isMentioned 触发，注入"用户在叫你，认真回答"的 prompt 指导

### 效果应用方式
- promptInjections：用 prompt.inject() 注册临时 injection，loop 结束后 dispose 清理（和现有 tool schema 注入同模式），用唯一名称避免并发冲突
- styleOverride：注入到 style 注入点，同样临时 inject + dispose
- toolFilter：构建 tool schema 时过滤，include/exclude 在 buildToolSchemaForPrompt 环节生效

### 回归保护
- 编译通过即可（typecheck + build）
- 功能验证靠手动端到端测试（真实群聊/私聊）
- 不写自动化测试

### Claude's Discretion
- injection 名称的唯一性方案（percept.id 后缀或其他）
- buildToolSchemaForPrompt 的 toolFilter 集成细节
- mention-aware skill 的具体 prompt 文案

</decisions>

<specifics>
## Specific Ideas

- image-gen 的代码激活器：检查上下文中是否包含"画画"、"draw"等关键词来激活
- 并发 loop 场景下 injection 需要唯一名称，避免 PromptService 的名称去重检查导致第二个 loop 的 injection 被忽略

</specifics>

<deferred>
## Deferred Ideas

- IntentTrait detector（意图检测维度）— 未来 phase
- TopicTrait detector（话题检测维度）— TRAIT-06
- RelationTrait detector（关系检测维度）— TRAIT-07

</deferred>

---

*Phase: 19-integration-validation*
*Context gathered: 2026-02-23*
