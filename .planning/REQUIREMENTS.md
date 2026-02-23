# Requirements: Athena v2.1 Polish & Release Prep

**Defined:** 2026-02-23
**Core Value:** 智能体能够像真人一样自然地参与群聊讨论，拥有合理的回复决策机制和可扩展的工具调用能力。

## v2.1 Requirements

### Prompt System Refactor (提示词系统重构)

- [x] **PROMPT-01**: 注入点从 6 个合并为 4 个（identity+style→soul, control_flow+basic_functions→instructions, 保留 memory 和 extra）
- [x] **PROMPT-02**: 消除 5 个 wrapper partials（identity/style/control_flow/basic_functions/memory.mustache），改为 PromptService.render() 代码内生成 XML 标签
- [x] **PROMPT-03**: system.mustache 模板适配新的 4 注入点结构
- [x] **PROMPT-04**: CACHEABLE_POINTS 与 InjectionPoint 类型同步更新

### Fixed-Role Files (固定角色文件)

- [x] **ROLE-01**: SOUL.md 固定角色文件替代 default-identity.md + default-style.md + default persona.md，注入到 soul 点
- [x] **ROLE-02**: AGENTS.md 固定角色文件替代 default-control-flow.md + default-basic-functions.md，注入到 instructions 点
- [x] **ROLE-03**: TOOLS.md 可选固定角色文件，注入到 instructions 点（缺失时静默跳过）
- [x] **ROLE-04**: 参考 OpenClaw 模板风格重写默认提示词内容（SOUL.md/AGENTS.md/TOOLS.md）
- [x] **ROLE-05**: 固定角色文件支持 Mustache 模板变量（{{bot.name}}、{{date.now}} 等）
- [x] **ROLE-06**: 固定角色文件缺失时优雅降级（使用内置最小默认内容，不崩溃）
- [x] **ROLE-07**: 固定角色文件支持热重载（与现有 memory block 一致的 fs.watch + debounce）

### Skill Enhancement (Skill 增强)

- [ ] **SKILL-01**: Skill 效果可指定注入到 soul/instructions/memory/extra 任意点（不再硬编码 extra）
- [ ] **SKILL-02**: Skill 定义文件中可配置 injection point 字段

### Tech Debt (技术债修复)

- [ ] **DEBT-01**: TraitAnalyzerConfig 改为 type-only export
- [ ] **DEBT-02**: trait-bound 生命周期在 SkillRegistry.resolve() 中实现运行时区分（与 per-turn 不同行为）

### Test Infrastructure (测试基础设施)

- [ ] **TEST-01**: vitest 测试基础设施搭建（vitest 配置、turbo pipeline 集成、pool:forks 模式）
- [ ] **TEST-02**: MemoryService 单元测试（block 加载、frontmatter 解析、注入渲染、字符限制）
- [ ] **TEST-03**: SkillRegistry 单元测试（条件树激活、效果合并、sticky/trait-bound 生命周期）
- [ ] **TEST-04**: PromptService 单元测试（inject/render/dispose 生命周期、注入点排序、XML 标签生成）

## Future Requirements

### v3.0 Candidates

- **MEM-01**: 三级记忆系统（L1/L2/L3）
- **LIFE-01**: 生命周期管理（RoutineScheduler、TaskManager）
- **WAKE-01**: 唤醒机制（ArousalHandler、离线回顾）
- **TOOL-01**: 内置工具迁移（CoreUtil/QManager/Interactions）

## Out of Scope

| Feature | Reason |
|---------|--------|
| USER.md（OpenClaw 用户画像文件） | 需要 per-user 持久化，属于 L1/L2/L3 记忆系统范畴 |
| 动态 per-channel SOUL.md | 违背固定角色设计，Skill 效果已覆盖 per-context 调整 |
| E2E 场景自动化验证 | 需要 live Koishi 环境，v2.1 不做 |
| 新增超过 4 个注入点 | 4 个注入点已覆盖所有场景（soul/instructions/memory/extra） |
| 包发布元数据和 README | 延迟到正式发布前单独处理 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROMPT-01 | Phase 20 | Complete |
| PROMPT-02 | Phase 20 | Complete |
| PROMPT-03 | Phase 20 | Complete |
| PROMPT-04 | Phase 20 | Complete |
| ROLE-01 | Phase 21 | Complete |
| ROLE-02 | Phase 21 | Complete |
| ROLE-03 | Phase 21 | Complete |
| ROLE-04 | Phase 21 | Complete |
| ROLE-05 | Phase 21 | Complete |
| ROLE-06 | Phase 21 | Complete |
| ROLE-07 | Phase 21 | Complete |
| SKILL-01 | Phase 22 | Pending |
| SKILL-02 | Phase 22 | Pending |
| DEBT-01 | Phase 22 | Pending |
| DEBT-02 | Phase 22 | Pending |
| TEST-01 | Phase 23 | Pending |
| TEST-02 | Phase 23 | Pending |
| TEST-03 | Phase 23 | Pending |
| TEST-04 | Phase 23 | Pending |

**Coverage:**
- v2.1 requirements: 19 total
- Mapped to phases: 19
- Unmapped: 0

---
*Requirements defined: 2026-02-23*
*Last updated: 2026-02-23 after roadmap creation*
