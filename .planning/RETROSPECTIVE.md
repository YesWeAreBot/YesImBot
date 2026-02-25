# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

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

## Cross-Milestone Trends

### Process Evolution

| Milestone | Days | Phases | Plans | Key Change |
|-----------|------|--------|-------|------------|
| v1.0 | 4 | 15 | 29 | 从零搭建，快速迭代 |
| v2.0 | 6 | 8 | 16 | 迁移而非重写，Trait+Skill 体系 |
| v2.1 | 2 | 3 | 6 | 精简打磨，技术债清理 |
| v2.2 | 2 | 3 | 8 | Wave 0 RED 测试，审计先行 |

### Cumulative Quality

| Milestone | Tests | Coverage | New Packages |
|-----------|-------|----------|-------------|
| v1.0 | 0 | 0% | 4 (shared-model, core, provider-openai, provider-deepseek) |
| v2.0 | 0 | 0% | 0 |
| v2.1 | 0 | 0% | 0 |
| v2.2 | 37 | JSON parser + willingness + horizon | 1 (provider-anthropic) |

### Top Lessons (Verified Across Milestones)

1. 小粒度 plan（2-5 min）比大 plan 偏差更少，执行更可预测（v2.1, v2.2 验证）
2. 推迟高风险迁移是正确策略 — 聚焦当前 milestone 目标（v1.0 记忆系统, v2.2 memory_block 合并）
3. 审计/验证步骤在归档前必不可少 — 每次都能发现遗漏（v2.0 tech debt, v2.2 OBS 复选框）