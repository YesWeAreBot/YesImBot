# Milestones

## v1.0 Foundation + Feature Parity (Shipped: 2026-02-20)

**Phases completed:** 15 phases, 29 plans
**Timeline:** 4 days (2026-02-17 → 2026-02-21)
**Lines of code:** 3,470 TypeScript
**Git range:** feat(01-01) → feat(15-02)

**Key accomplishments:**
1. Monorepo 基础架构 — shared-model 包 + core 插件 + provider 插件体系
2. ModelService 模型服务 — Provider 注册、PQueue 并发控制、fallback 链、流式/非流式双路径
3. Horizon 上下文系统 — Environment/Entity/Event 三元组 + Timeline 存储 + Observation 生成
4. AgentCore 编排器 — ThinkActLoop think-act 循环、工具调用、send_message 多段回复
5. 意愿值系统 — 指数衰减 + S 曲线增益 + 关键词兴趣 + LLM 延迟判断
6. 动态 Schema 联动 — Provider 注册模型自动出现在配置下拉列表，热插拔刷新

---


## v2.0 Context-Aware Architecture (Shipped: 2026-02-23)

**Phases completed:** 8 phases, 16 plans
**Timeline:** 6 days (2026-02-17 → 2026-02-23)
**Commits:** 101
**Files modified:** 131 (+12,546 / -619)
**Git range:** 826040e → f7a2c29

**Key accomplishments:**
1. PromptService 重设计 — 命名注入点 + Mustache partial 组合 + ctx 生命周期自动清理
2. HorizonView 模块化 — 结构化标签分区渲染，Percept 职责清晰分层（agent/horizon/plugin）
3. Tool Call 改造 — JSON 文本输出替代原生 tool_call，手动心跳循环，渐进式工作记忆裁剪
4. TraitAnalyzer 框架 — 并行 Trait 检测器（Scene/Heat），有状态 per-channel scope，解耦信号协议
5. Skill 响应体系 — 文件夹规范 + 条件树激活 + 分层效果合并 + 热重载注册表
6. 端到端验证 — 3 个示例 Skill 验证完整 Trait→Skill→Prompt 管线

**Tech Debt (4 items):**
- TraitAnalyzerConfig exported as value instead of type
- SkillEffect.promptInjections.point always hardcoded to "extra"
- trait-bound lifecycle undifferentiated from per-turn at runtime
- 3 E2E scenarios require live Koishi session for human verification

---


## v2.1 Polish & Release Prep (Shipped: 2026-02-24)

**Phases completed:** 3 phases (20-22), 6 plans, 12 tasks
**Timeline:** 2 days (2026-02-23 → 2026-02-24)
**Commits:** 23
**Files modified:** 30 (+1,741 / -119)
**Git range:** 8ee3ac1 → 6b039f5

**Key accomplishments:**
1. 注入点合并 6→4 — soul/instructions/memory/extra，编译器全局强制 + 运行时 guard
2. render() 代码内生成 XML 标签 — 删除 11 个废弃模板/默认文件，消除 Mustache 间接层
3. 固定角色文件系统 — SOUL.md/AGENTS.md/TOOLS.md 替代 legacy defaults，Mustache 模板变量支持
4. RoleService — 文件加载、渲染、注入、fs.watch 热重载完整生命周期
5. Skill 可配置注入点路由 — 效果可指定任意注入点，按 specificity 排序
6. 三种 Skill 生命周期策略 — per-turn / sticky / trait-bound，运行时可区分

**v2.0 Tech Debt Resolved (3/4):**
- ✓ TraitAnalyzerConfig → type-only export
- ✓ Skill injection point → configurable (was hardcoded "extra")
- ✓ trait-bound lifecycle → runtime distinguishable from per-turn
- ○ 3 E2E scenarios still require live Koishi session (deferred)

**Known Gaps:**
- TEST-01: vitest 测试基础设施搭建 (Phase 23 未启动)
- TEST-02: MemoryService 单元测试 (Phase 23 未启动)
- TEST-03: SkillRegistry 单元测试 (Phase 23 未启动)
- TEST-04: PromptService 单元测试 (Phase 23 未启动)

---

