# Requirements: Athena v2.3

**Defined:** 2026-02-26
**Core Value:** 智能体能够像真人一样自然地参与群聊讨论，拥有合理的回复决策机制和可扩展的工具调用能力。

## v2.3 Requirements

Requirements for Architecture Cleanup milestone. Each maps to roadmap phases.

### Memory Cleanup

- [x] **MEM-01**: 删除 `core/src/services/memory/` 目录（service.ts, types.ts, index.ts）
- [x] **MEM-02**: 从 `core/src/index.ts` 移除 MemoryService 插件注册和配置
- [x] **MEM-03**: 移除 `yesimbot.memory` 服务声明和依赖引用
- [x] **MEM-04**: 清理 PromptService 中 "memory-block" partial 和 "memory" 注入点相关代码

### Context Redesign

- [x] **CTX-01**: 删除 `Scope` 接口，用 `platform: string` + `channelId: string` 裸字段替代
- [x] **CTX-02**: 迁移 Horizon 模块（service.ts, manager.ts, listener.ts, types.ts）使用裸字段
- [x] **CTX-03**: 迁移 Trait 模块（service.ts, detectors/scene.ts, detectors/heat.ts, types.ts）使用裸字段
- [x] **CTX-04**: 迁移 Skill 模块（service.ts）使用裸字段
- [x] **CTX-05**: 迁移 Agent 模块（service.ts）和 Plugin 模块（types.ts）使用裸字段
- [x] **CTX-06**: 迁移 Percept 接口从 `scope: Scope` 改为裸字段
- [x] **CTX-07**: 简化 Environment 构造——消除 Scope→Environment 的冗余转换
- [x] **CTX-08**: 迁移 timeline 数据库 schema，scope JSON 列改为 platform + channelId 独立列

## Future Requirements

### Runtime Robustness (deferred to v2.4+)

- **ROBUST-01**: 模型组负载均衡——多模型轮询/权重分配
- **ROBUST-02**: 全链路错误分类 + 优雅降级
- **ROBUST-03**: 监控告警——关键指标采集和阈值告警

## Out of Scope

| Feature | Reason |
|---------|--------|
| memory_block 功能迁移到 RoleService | SOUL.md 已覆盖人设定制，额外知识块暂不需要 |
| memory_block 读写能力恢复 | Letta 式自我进化效果不佳，已验证 |
| 跨频道 scope 共享 | 伪命题——未来记忆系统 + 工具查询替代 |
| Scope 细粒度化（per-user/per-topic） | 当前 platform+channelId 足够，不过度设计 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| MEM-01 | Phase 26 | Complete |
| MEM-02 | Phase 26 | Complete |
| MEM-03 | Phase 26 | Complete |
| MEM-04 | Phase 26 | Complete |
| CTX-01 | Phase 27 | Complete |
| CTX-02 | Phase 27 | Complete |
| CTX-03 | Phase 27 | Complete |
| CTX-04 | Phase 27 | Complete |
| CTX-05 | Phase 27 | Complete |
| CTX-06 | Phase 27 | Complete |
| CTX-07 | Phase 28 | Complete |
| CTX-08 | Phase 28 | Complete |

**Coverage:**
- v2.3 requirements: 12 total
- Mapped to phases: 12
- Unmapped: 0 ✓

---
*Requirements defined: 2026-02-26*
*Last updated: 2026-02-26 after roadmap creation*
