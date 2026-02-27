# Project Retrospective

_A living document updated after each milestone. Lessons feed forward into future planning._

## Milestone: v2.2 — Runtime Optimization & Observability

**Shipped:** 2026-02-25
**Phases:** 3 | **Plans:** 8 | **Tasks:** 15

### What Was Built

- Snippet 变量渲染修复（formatHorizonText 完整嵌套 scope）
- JSON Parser 27 个 vitest 测试用例（移植自 v3）
- DM 自适应聚合窗口 + TokenBucket per-user 速率限制
- 全链路 traceId + debugLevel 分级结构化日志
- 人设感知 Judge Prompt（getSoulSummary + 结构化 JSON 响应）
- Anthropic 系统提示词缓存（stable/dynamic 拆分 + cache_control ephemeral）
- Working Memory XML history + short-ID + triggered-by 因果标签

### What Worked

- Wave 0 RED 测试模式：先写测试再实现，23-00 的 scaffold 为后续 plan 提供了清晰的验收标准
- 并行 plan 执行：23-01/02/03 互相独立，可以并行推进
- 小粒度 plan（2-5 min 执行时间）：每个 plan 聚焦单一关注点，偏差极少
- 审计先行：milestone audit 在归档前发现了 OBS 复选框遗漏，避免了脏归档

### What Was Inefficient

- Phase 25 ROADMAP 中 Plans 标记为 "TBD" 但实际已完成 — 归档时需要手动修正
- STATE.md 的 milestone 字段写成了 "v1.0" 而非 "v2.2"（CLI 默认值问题）
- REQUIREMENTS.md 中 OBS-01/02/03 复选框在 phase 完成时未同步更新，直到审计才发现

### Patterns Established

- Namespace logger 模式：`ctx.logger('agent.willingness')` 配合 `KOISHI_DEBUG` 过滤
- debugLevel 分级门控：所有结构化 debug 日志通过 `(config.debugLevel ?? 0) >= N` 控制
- traceId 线程化：在 handleEvent 生成一次，通过 Percept 传递到所有子系统
- Token bucket 速率限制：per-key consume/refill，Map-based 状态管理
- Provider type 显式声明：通过 `providerType` 字段检测，不从 model ID 推断

### Key Lessons

1. REQUIREMENTS.md 复选框应在 phase SUMMARY 写入时同步更新，不要等到审计才发现不一致
2. Wave 0 RED 测试是高效的质量保障模式 — 4 分钟投入换来后续 plan 的零偏差验收
3. memory_block→RoleService 合并推迟是正确决策 — 迁移风险不应阻塞运行时优化

### Cost Observations

- Model mix: balanced profile (sonnet for execution, haiku for workers)
- Sessions: ~4 sessions across 2 days
- Notable: 8 plans 平均执行时间 ~5 min，最长 13 min（JSON parser 移植），最短 2 min（Judge prompt）

---

## Milestone: v2.3 — Architecture Cleanup

**Shipped:** 2026-02-26
**Phases:** 3 | **Plans:** 6 | **Tasks:** ~10

### What Was Built

- MemoryService 模块完全删除，snippet 注册迁移到 RoleService
- PromptService 清理：memory-block partial、"memory" 注入点、3 个废弃模板文件
- Scope 接口删除，ChannelKey 类型别名引入（platform + channelId 裸字段）
- 全局 13 文件迁移到裸字段（Horizon/Trait/Skill/Agent/Plugin）
- Environment 构造简化：platform/channelId 必填字段
- Timeline DB schema 从 scope JSON 列迁移到独立 platform + channelId 列

### What Worked

- DB bridge 渐进迁移策略：Phase 27 先迁移 TS 类型（用 `as unknown as` 桥接），Phase 28 再迁移 DB schema——两步完成零回归
- 审计先行：milestone audit 12/12 requirements + 12/12 integration 全部通过，归档无阻塞
- 极小粒度 plan（2-5 min）：6 个 plan 全部零偏差或仅 auto-fix 级偏差
- ChannelKey 类型别名设计：required 字段比 Scope 的 optional 字段更严格，类型系统强制正确性

### What Was Inefficient

- STATE.md milestone 字段再次被 CLI 写成 "v1.0" 而非 "v2.3"（与 v2.2 相同的 CLI 默认值问题）
- summary-extract CLI 的 `one_liner` 字段返回 null——SUMMARY frontmatter 缺少 `one_liner` 字段定义
- Turbo cache staleness 在 Phase 27 Plan 03 导致假失败，需要 `--force` 构建

### Patterns Established

- ChannelKey 类型别名模式：`{ platform: string; channelId: string }` 作为最小频道标识
- 内联 ChannelKey 对象字面量：调用方直接构造 `{ platform: percept.platform, channelId: percept.channelId }`
- isDirect 从 Session 读取：不属于频道标识，从 `event.runtime?.session?.isDirect` 获取
- Environment 直接字段访问：`env.platform` / `env.channelId`，无 metadata 间接层

### Key Lessons

1. 渐进式迁移（类型先行，DB 后行）比一次性大迁移风险更低——Phase 27/28 拆分验证了这一点
2. SUMMARY frontmatter 应包含 `one_liner` 字段以支持 CLI 自动提取成就
3. Turbo cache 在跨 plan 执行时可能过期——复杂迁移后应默认 `--force` 构建

### Cost Observations

- Model mix: balanced profile (sonnet for execution, haiku for workers)
- Sessions: ~2 sessions in 1 day
- Notable: 6 plans 平均执行时间 ~3 min，整个 milestone 约 20 min 纯执行时间

---

## Milestone: v2.4 — Runtime & Polish

**Shipped:** 2026-02-27
**Phases:** 4 | **Plans:** 8 | **Tasks:** ~18

### What Was Built

- 消息队列积压合并：pending 单槽改为数组队列，burst 消息合并一次性响应
- 沉默渲染修复：空 Bot Action 过滤 + "(chose silence)" 标记
- Working Memory 裁剪修复：initialContextCharBudget 限制初始上下文
- AbstractProvider 抽象基类：三个 provider 消除 36-61% 重复代码
- 配置分组 + i18n：5 组分组 + 32 个字段中英文描述 + provider 国际化
- Persona 插件：表单化人设自定义，preset 下拉 + 字段覆盖 + soul 注入点集成

### What Worked

- Phase 32 作为 bonus 自然融入里程碑——解决了 v2.3 遗留的 todo（人设自定义方案）
- AbstractProvider 抽象效果显著：OpenAI 61%、DeepSeek 58%、Anthropic 36% 代码缩减
- Persona 插件 declare module 本地增强模式——不依赖 core devDependency，保持插件自包含

### What Was Inefficient

- ROADMAP.md Phase 30/31 plans 标记不一致（`- [ ]` 但实际已完成）
- Phase 32 未在 ROADMAP 中归入 v2.4 范围——审计时才发现孤儿阶段
- STATE.md milestone 字段再次被 CLI 写成 "v1.0"（第三次出现的 CLI 默认值问题）
- summary-extract CLI 的 `one_liner` 字段仍返回 null（v2.3 已知问题未修复）

### Patterns Established

- AbstractProvider 自动注册模式：构造函数中完成注册，子类只需 super() 调用
- createProviderSchema 工厂：参数化默认值 + Schema.intersect 扩展字段
- Persona declare module 本地增强：外部插件用最小接口声明消费的服务类型
- Preset merge-then-override：预设为基础，用户非空字段覆盖

### Key Lessons

1. 新增 phase 应立即更新 ROADMAP 里程碑范围——Phase 32 孤儿问题本可避免
2. ROADMAP plan 复选框应在 SUMMARY 写入时同步更新（与 v2.2 REQUIREMENTS 复选框问题同源）
3. CLI milestone 字段默认值 bug 已连续三个里程碑出现——应提 issue 修复

### Cost Observations

- Model mix: balanced profile (sonnet for execution, haiku for workers)
- Sessions: ~3 sessions across 2 days
- Notable: 8 plans 平均执行时间 ~5 min，整个 milestone 约 40 min 纯执行时间

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Days | Phases | Plans | Key Change                          |
| --------- | ---- | ------ | ----- | ----------------------------------- |
| v1.0      | 4    | 15     | 29    | 从零搭建，快速迭代                  |
| v2.0      | 6    | 8      | 16    | 迁移而非重写，Trait+Skill 体系      |
| v2.1      | 2    | 3      | 6     | 精简打磨，技术债清理                |
| v2.2      | 2    | 3      | 8     | Wave 0 RED 测试，审计先行           |
| v2.3      | 1    | 3      | 6     | 渐进式迁移，DB bridge 策略          |
| v2.4      | 2    | 4      | 8     | AbstractProvider 抽象，Persona 插件 |

### Cumulative Quality

| Milestone | Tests | Coverage                            | New Packages                                               |
| --------- | ----- | ----------------------------------- | ---------------------------------------------------------- |
| v1.0      | 0     | 0%                                  | 4 (shared-model, core, provider-openai, provider-deepseek) |
| v2.0      | 0     | 0%                                  | 0                                                          |
| v2.1      | 0     | 0%                                  | 0                                                          |
| v2.2      | 37    | JSON parser + willingness + horizon | 1 (provider-anthropic)                                     |
| v2.3      | 37    | unchanged                           | 0 (cleanup milestone)                                      |
| v2.4      | 37    | unchanged                           | 1 (plugins/persona)                                        |

### Top Lessons (Verified Across Milestones)

1. 小粒度 plan（2-5 min）比大 plan 偏差更少，执行更可预测（v2.1, v2.2, v2.3 验证）
2. 推迟高风险迁移是正确策略 — 聚焦当前 milestone 目标（v1.0 记忆系统, v2.2 memory_block 合并）
3. 审计/验证步骤在归档前必不可少 — 每次都能发现遗漏（v2.0 tech debt, v2.2 OBS 复选框）
4. 渐进式迁移（类型先行，DB 后行）比一次性大迁移风险更低（v2.3 验证）
