# Requirements: Athena v2.0 Context-Aware Architecture

**Defined:** 2026-02-21
**Core Value:** 智能体能够像真人一样自然地参与群聊讨论，拥有合理的回复决策机制和可扩展的工具调用能力。

## v2.0 Requirements

### Prompt Architecture

- [x] **PROMPT-01**: PromptService 支持命名注入点（identity/environment/style/memories/tools/output），每个注入点独立管理优先级队列
- [x] **PROMPT-02**: PromptService 支持模块化 partial 注册和组合，模板通过 `{{>partial}}` 引用可替换的子模板
- [x] **PROMPT-03**: Injection 跟随 Koishi ctx 生命周期自动清理，子插件卸载时其注册的 injection 自动移除
- [x] **PROMPT-04**: PromptService renderer 支持递归 partial 变量收集和多轮渲染
- [x] **PROMPT-05**: 提供开箱即用的 section-based 系统提示词模板，包含所有命名注入点的默认 partial

### HorizonView

- [x] **HVIEW-01**: HorizonView 渲染输出使用结构化标签分区（environment/members/history）
- [x] **HVIEW-02**: 提示词模板重做为模块化 partial 组合（identity/environment/working_memory/memories/tools/output）

### Trait Perception

- [x] **TRAIT-01**: TraitAnalyzer 框架支持注册多个 Trait 检测器，并行分析 HorizonView 输出 TraitSignal
- [x] **TRAIT-02**: 内置 SceneTrait 检测器（群聊/私聊/被@/被忽略等场景维度）
- [x] **TRAIT-03**: 内置 HeatTrait 检测器（对话热度/趋势维度）
- [x] **TRAIT-04**: TraitSignal 协议定义，解耦感知层和响应层
- [x] **TRAIT-05**: 有状态 Trait 支持（per-channel scope，增量更新，如关系熟悉度累积）

### Skill Response

- [ ] **SKILL-01**: Skill 文件夹规范定义（SKILL.md + scripts/ + references/），YAML frontmatter 声明元信息和激活条件
- [ ] **SKILL-02**: SkillRegistry 加载和管理 Skill 文件夹，支持热重载
- [ ] **SKILL-03**: Skill 基于 TraitSignal 条件匹配激活，支持声明式条件和代码激活器
- [ ] **SKILL-04**: 分层效果合并——Prompt 层叠加、Style 层优先级覆盖、Tools 层叠加
- [ ] **SKILL-05**: 内置 1-2 个示例 Skill 验证完整体系

## Future Requirements

### Token Management

- **TOKEN-01**: Per-injection-point token 预算控制
- **TOKEN-02**: 自适应上下文截断（重要内容优先保留）

### Advanced Traits

- **TRAIT-06**: TopicTrait 话题检测器（技术/闲聊/求助等）
- **TRAIT-07**: RelationTrait 关系检测器（基于 Entity 属性）

## Out of Scope

| Feature | Reason |
|---------|--------|
| LLM-based trait analysis | 200-500ms 延迟 + 成本，群聊场景不可接受 |
| ChatMode 离散模式切换 | 已被 Trait + Skill 体系替代 |
| Skill 继承/组合 | 依赖链和排序问题，用 flat 定义 + 共享 partial |
| Per-skill token 预算 | 组合爆炸，用 per-injection-point 预算替代 |
| Skill 直接修改意愿值 | 破坏关注点分离，Skill 只影响 prompt/style/tools |
| 用户界面 Skill 开关 | 过早复杂化，自动激活即可 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROMPT-01 | Phase 16 | Complete |
| PROMPT-02 | Phase 16 | Complete |
| PROMPT-03 | Phase 16 | Complete |
| PROMPT-04 | Phase 16 | Complete |
| PROMPT-05 | Phase 16 | Complete |
| HVIEW-01 | Phase 16 | Complete |
| HVIEW-02 | Phase 16 | Complete |
| TRAIT-01 | Phase 17 | Complete |
| TRAIT-02 | Phase 17 | Complete |
| TRAIT-03 | Phase 17 | Complete |
| TRAIT-04 | Phase 17 | Complete |
| TRAIT-05 | Phase 17 | Complete |
| SKILL-01 | Phase 18 | Pending |
| SKILL-02 | Phase 18 | Pending |
| SKILL-03 | Phase 18 | Pending |
| SKILL-04 | Phase 18 | Pending |
| SKILL-05 | Phase 19 | Pending |

**Coverage:**
- v2.0 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0

---
*Requirements defined: 2026-02-21*
*Last updated: 2026-02-21 after roadmap creation*
