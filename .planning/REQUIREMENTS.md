# Requirements: Athena v2.2

**Defined:** 2026-02-25
**Core Value:** 智能体能够像真人一样自然地参与群聊讨论，拥有合理的回复决策机制和可扩展的工具调用能力。

## v2.2 Requirements

### Bug 修复 (BUGFIX)

- [x] **BUGFIX-01**: Snippet 变量（`{{date.now}}`、`{{bot.name}}` 等）在 horizon-view 模板中正确渲染，不再输出空字符串
- [ ] **BUGFIX-02**: JSON Parser 拥有完整的 vitest 测试套件，覆盖 v3 的 18 个测试用例（完美 JSON、代码块、嵌套代码块、`[OBSERVE]` 前缀、截断字符串、悬空键等）

### 意愿值系统 (WILL)

- [x] **WILL-01**: 私聊场景自动获得高回复概率（可配置 `directBoost`），配合较长的消息聚合窗口等待用户发完再回复，而非每条消息都触发响应
- [x] **WILL-02**: 私聊回复附带 per-user 速率限制，防止无节制 DM 导致成本爆炸
- [ ] **WILL-03**: Judge Prompt 包含人设摘要上下文，提供明确的判断标准（间接提及、话题相关性、沉默尴尬度），使用结构化输出格式替代裸 yes/no

### 可观测性 (OBS)

- [ ] **OBS-01**: 每条消息处理流程携带 traceId，贯穿 listener → willingness → agent → loop → model → parser → reply 全链路
- [ ] **OBS-02**: 使用 Koishi Logger 命名空间（`agent`、`agent.willingness`、`agent.loop`、`agent.parser` 等），支持 `KOISHI_DEBUG` 环境变量粒度过滤
- [ ] **OBS-03**: 关键节点输出 debug 级别结构化日志：意愿值决策详情、prompt section 大小、模型调用延迟/token 用量、JSON 解析结果、工具执行结果

### 运行时优化 (OPT)

- [ ] **OPT-01**: System prompt 拆分为 `SystemModelMessage[]` content blocks，稳定部分（soul + instructions）标记 cache breakpoint
- [ ] **OPT-02**: ModelService 支持 provider 检测，Anthropic 自动注入 `providerOptions` cache control，其他 provider 回退为字符串拼接
- [ ] **OPT-03**: Working Memory 工具条目标记其在 history 中的触发位置（时间戳或消息 ID 关联），使 LLM 意识到工具执行与聊天窗口的因果联系，而非仅用无区分度的 Round N 标记
- [ ] **OPT-04**: Working Memory 中 `send_message` 动作省略已在 history 中出现的内容参数，仅保留执行结果摘要

## Future Requirements (v2.3+)

### 架构重构

- **ARCH-01**: memory_block 功能完全合并到 RoleService，MemoryService 瘦身为 L2/L3 记忆专用
- **ARCH-02**: 合并后提供用户数据迁移路径（memory block 文件位置变更）

### 测试基础设施

- **TEST-01**: vitest 测试基础设施搭建（从 v2.1 遗留）
- **TEST-02**: MemoryService 单元测试
- **TEST-03**: SkillRegistry 单元测试
- **TEST-04**: PromptService 单元测试

## Out of Scope

| Feature | Reason |
|---------|--------|
| 全 provider 缓存抽象 | 各 provider 缓存语义不同（Anthropic ephemeral、OpenAI auto-cache、Google implicit），先做 Anthropic-only |
| 动态 per-channel 意愿值配置 | 配置复杂度高，收益低，DM vs 群聊区分已足够 |
| 外部结构化日志框架（Winston/Pino） | Koishi 自带 Logger 系统，引入额外框架增加混乱 |
| 独立 "记忆 LLM" 做 WM 摘要 | 增加延迟和成本，当前规模下收益不明确 |
| 自动化 JSON 修复微调模型 | `jsonrepair` 库已覆盖 95%+ 场景，loop.ts 已有 LLM 修复 fallback |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| BUGFIX-01 | Phase 23 | Complete |
| BUGFIX-02 | Phase 23 | Pending |
| WILL-01 | Phase 23 | Complete |
| WILL-02 | Phase 23 | Complete |
| WILL-03 | Phase 24 | Pending |
| OBS-01 | Phase 24 | Pending |
| OBS-02 | Phase 24 | Pending |
| OBS-03 | Phase 24 | Pending |
| OPT-01 | Phase 25 | Pending |
| OPT-02 | Phase 25 | Pending |
| OPT-03 | Phase 25 | Pending |
| OPT-04 | Phase 25 | Pending |

**Coverage:**
- v2.2 requirements: 12 total
- Mapped to phases: 12
- Unmapped: 0 ✓

---
*Requirements defined: 2026-02-25*
*Last updated: 2026-02-25 after roadmap creation*
