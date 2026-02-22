# Roadmap: Athena (YesImBot v4)

## Milestones

- ✅ **v1.0 Foundation + Feature Parity** — Phases 1-15 (shipped 2026-02-21)
- 🚧 **v2.0 Context-Aware Architecture** — Phases 16-19 (in progress)

## Phases

<details>
<summary>✅ v1.0 Foundation + Feature Parity (Phases 1-15) — SHIPPED 2026-02-21</summary>

- [x] Phase 1: Foundation & Shared Model (2/2 plans) — completed 2026-02-17
- [x] Phase 2: Model Service & Providers (3/3 plans) — completed 2026-02-18
- [x] Phase 3: Horizon Context System (3/3 plans) — completed 2026-02-18
- [x] Phase 4: Prompt & Tool Services (2/2 plans) — completed 2026-02-18
- [x] Phase 5: Agent Core & Integration (2/2 plans) — completed 2026-02-18
- [x] Phase 6: Willingness & Polish (2/2 plans) — completed 2026-02-18
- [x] Phase 7: Core Wiring Fixes (1/1 plan) — completed 2026-02-19
- [x] Phase 8: Stream Support & Dead Code Cleanup (2/2 plans) — completed 2026-02-19
- [x] Phase 9: Dynamic Schema Linkage (2/2 plans) — completed 2026-02-19
- [x] Phase 10: Willingness System Migration (2/2 plans) — completed 2026-02-19
- [x] Phase 11: Horizon Context Filling (1/1 plan) — completed 2026-02-20
- [x] Phase 12: Memory & Prompt Snippets (2/2 plans) — completed 2026-02-20
- [x] Phase 13: Non-stream Path & Fallback Wiring (2/2 plans) — completed 2026-02-20
- [x] Phase 14: Provider Pattern Cleanup & PLATFORM-01 (1/1 plan) — completed 2026-02-20
- [x] Phase 15: LLM Deferred Judgment & Config (2/2 plans) — completed 2026-02-20

</details>

### 🚧 v2.0 Context-Aware Architecture

**Milestone Goal:** 重设计提示词服务架构，建立模块化提示词结构，引入 Trait + Skill 上下文感知行为调整体系——替代 ChatMode 的离散模式切换。

- [x] **Phase 16: PromptService Redesign + HorizonView** - Multi-section prompt architecture with named injection points, partial composition, and structured context rendering (completed 2026-02-21)
- [ ] **Phase 17: Trait Perception** - Multi-dimensional context analysis framework with scene and heat detectors
- [ ] **Phase 18: Skill Response** - File-based skill definitions with trait-conditional activation and layered effect merging
- [ ] **Phase 19: Integration & Validation** - End-to-end pipeline wiring with example skills proving the full Trait-Skill loop

## Phase Details

### Phase 16: PromptService Redesign + HorizonView
**Goal**: Plugins can compose multi-section prompts through named injection points and modular partials, with HorizonView rendering structured context
**Depends on**: v1.0 complete
**Requirements**: PROMPT-01, PROMPT-02, PROMPT-03, PROMPT-04, PROMPT-05, HVIEW-01, HVIEW-02
**Success Criteria** (what must be TRUE):
  1. A plugin can register injections at named points (identity/environment/style/memories/tools/output) with priority ordering, and the rendered prompt reflects correct section placement
  2. A plugin can register a custom partial and reference it via `{{>partial}}` in templates, with the rendered output including the partial content
  3. When a sub-plugin is unloaded, its registered injections and partials are automatically removed from the prompt without manual cleanup
  4. HorizonView output uses structured tagged sections (environment/members/history) that the prompt template consumes as distinct partials
  5. The default system template renders all named sections with sensible defaults when no custom injections are registered
**Plans:** 2/2 plans complete
Plans:
- [ ] 16-01-PLAN.md — PromptService core: types, renderer, named injection points, ctx lifecycle, Section[] render
- [ ] 16-02-PLAN.md — Templates, HorizonView structured output, consumer migration (MemoryService, ThinkActLoop)

### Phase 16.4: working-memory-improve (INSERTED)

**Goal:** Transform ThinkActLoop messages array from unbounded growth into budget-controlled working memory with progressive trimming, replace post-loop AgentSummary with per-round AgentResponse timeline recording, and present layered context (history + working-memory) to the LLM
**Depends on:** Phase 16
**Plans:** 2 plans

Plans:
- [x] 16.4-01-PLAN.md — Trimmer function + AgentResponse type replacement across horizon chain
- [ ] 16.4-02-PLAN.md — Loop integration (per-round recording, trimming, working-memory template)

### Phase 16.3: tool-call-improve (INSERTED)

**Goal:** Replace native AI SDK tool_call with structured JSON text output, manual heartbeat loop, and prompt-based tool schema rendering
**Depends on:** Phase 16
**Plans:** 2/2 plans complete

Plans:
- [ ] 16.3-01-PLAN.md — JsonParser (ported from v3 with jsonrepair) + tool schema prompt builder
- [ ] 16.3-02-PLAN.md — ThinkActLoop rewrite (manual heartbeat loop, JSON parsing, continuation inference) + template updates

### Phase 16.1: Percept Ownership & User Message Context Refactor (INSERTED)

**Goal:** Percept 构造从 horizon 移到 agent 模块，horizon 只负责数据记录和事件广播；user message 承载全部工作负载（环境、成员、历史），system prompt 变为纯静态；统一使用模板路径渲染上下文
**Depends on:** Phase 16
**Plans:** 2/2 plans complete

Plans:
- [x] 16.1-01-PLAN.md — Horizon event broadcast refactor + agent Percept ownership & aggregation window
- [x] 16.1-02-PLAN.md — Static system prompt, user message context via template, history/trigger stage split

**Architecture Decisions (from discussion):**

1. **System prompt 纯静态，user message 承载工作负载：**
   - system prompt 只定义"你是谁"（identity/style/memories），不包含动态环境数据
   - 每次响应的上下文（environment、members、history、trigger info）全部放入 user message
   - 当前 loop.ts:42-65 的 envLines 构建 + environment partial 注入需要移到 user message 侧

2. **统一模板路径：**
   - 当前存在两条并行路径：toStructured() + 手工拼接 envLines（loop.ts 使用）和 formatHorizonText() + horizon-view.mustache（仅 deferred judgment 使用）
   - 统一为 horizon-view.mustache 模板路径，删除手工拼接代码
   - formatHorizonText() 的输出作为 user message content

3. **Percept 归属重构：**
   - 当前：horizon/listener.ts 构造 Percept → emit("horizon/percept") → agent 订阅并做意愿判断
   - 目标：horizon/listener.ts 广播原始事件（不构造 Percept）→ agent 订阅 horizon 事件 → agent 内部做意愿计算/聚合 → agent 构造 Percept → loop.run(percept)
   - Percept 语义变为"已决定要响应的触发源"，一旦构造就必定触发一次响应
   - aggregation window（schedulePercept）逻辑从 listener 移到 agent，因为这是调度决策

4. **Percept 不是单条消息：**
   - 有意愿系统存在，agent 响应不是由某条消息触发，而是多条消息共同促进
   - 但 Percept 也不能包含多条消息（避免把意愿计算职责迁移到 horizon）
   - Percept 在 agent 模块中构造，代表"决定响应"这个事实，携带触发上下文

5. **horizon 职责边界：**
   - horizon 只负责：接收 koishi 事件 → 记录 timeline → 广播 horizon event 回调
   - horizon 不参与决策（不构造 Percept，不做意愿判断）
   - buildView() 仍在 horizon（数据访问层），但由 agent/loop 调用

**Key files affected:**
- `core/src/services/horizon/listener.ts` — 移除 buildPercept()、schedulePercept()，改为广播原始事件
- `core/src/services/horizon/types.ts` — Percept 类型可能移到 agent 模块
- `core/src/services/agent/service.ts` — 接管聚合窗口、Percept 构造
- `core/src/services/agent/loop.ts` — user message 重写，使用 formatHorizonText() 模板
- `core/resources/templates/system.mustache` — 移除 environment partial 引用
- `core/resources/templates/partials/environment.mustache` — 可能删除或重新定位
- `core/resources/templates/partials/horizon-view.mustache` — 成为 user message 的主模板

**Success Criteria** (what must be TRUE):
  1. horizon/listener 不再构造 Percept，只广播原始事件（新事件名，非 "horizon/percept"）
  2. agent 模块订阅 horizon 事件，内部完成意愿计算 + 聚合窗口 + Percept 构造
  3. LLM 收到的 user message 包含完整上下文（environment、members、history、trigger），通过 horizon-view.mustache 模板渲染
  4. system prompt 不包含任何动态环境数据（纯静态：identity + style + memories）
  5. formatHorizonText() 是唯一的上下文渲染路径，toStructured() + 手工 envLines 拼接被移除
  6. deferred judgment（executeDeferredJudgment）继续工作，使用统一的模板路径

Plans:
- [x] 16.1-01-PLAN.md — Horizon event broadcast refactor + agent Percept ownership & aggregation window
- [x] 16.1-02-PLAN.md — Static system prompt, user message context via template, history/trigger stage split

### Phase 16.2: Percept Type Cleanup & Session Decoupling (INSERTED)

**Goal:** 彻底清理 16.1 遗留的类型问题：移除临时方案 BasePerceptRef，将 session 从 PerceptInput 核心结构中解耦，建立 Percept 在 agent/horizon/plugin 三层的清晰职责边界
**Depends on:** Phase 16.1
**Plans:** 2/2 plans complete

**Background (from 16.1 / quick-1):**
- quick-1 将 TriggerType, Scope, BasePerceptRef 提取到 shared/types.ts，解决了循环引用
- 但 BasePerceptRef 是临时妥协方案（HorizonView.percept 用它避免循环导入），需要彻底移除
- PerceptInput 包含 `runtime?: { session: Session }`，但 Percept 设计为支持多事件源（定时器、内部触发等），这些没有 session
- 部分 PluginTool（如 send_message）依赖 session，但实际可从 ctx 获取 bot 对象

**Key problems:**
1. BasePerceptRef 是 Percept 的子集投影，造成类型冗余和语义模糊
2. session 耦合在 PerceptInput 核心结构中，限制了非消息事件源的 Percept 构造
3. Plugin 工具的 session 依赖边界不清晰 — 哪些工具真正需要 session，哪些可以用 ctx 替代

**Reference implementations:**
- v3: `isSupported` 守卫模式 — 工具声明平台+session 前置条件（references/YesImBot-v3/packages/core/src/services/extension/builtin/memory.ts）
- dev: `requireSession` 工具激活器 — 运行时判断环境是否满足工具启用条件（references/YesImBot-dev/packages/core/src/services/plugin/builtin/interactions.ts）

**Scope:**
- 移除 BasePerceptRef，统一为完整 Percept 类型引用
- 将 session 从 PerceptInput 核心结构移到可选的事件源上下文
- 设计工具可用性守卫机制（参考 v3/dev 方案）
- 明确 Percept 在三层的职责：agent 构造、horizon 记录/广播、plugin 消费

Plans:
- [x] 16.2-01-PLAN.md — Types cleanup: clean Percept, ToolExecutionContext, ViewOptions, Activator types + horizon buildView decoupling
- [ ] 16.2-02-PLAN.md — Agent + plugin wiring: split buildPercept/buildToolContext, wire ToolExecutionContext through loop, activator filtering

### Phase 17: Trait Perception
**Goal**: The system can analyze conversation context across multiple dimensions in parallel, producing typed signals that downstream consumers can react to
**Depends on**: Phase 16
**Requirements**: TRAIT-01, TRAIT-02, TRAIT-03, TRAIT-04, TRAIT-05
**Success Criteria** (what must be TRUE):
  1. Multiple TraitDetectors run in parallel against a HorizonView and each produces typed TraitSignal results without blocking each other
  2. SceneTrait correctly identifies group chat, private chat, direct mention, and being-ignored scenarios from conversation context
  3. HeatTrait tracks conversation activity rate and trend direction (heating/cooling/stable) per channel
  4. TraitSignal protocol is defined such that a consumer can match against signals without importing detector implementations (decoupled)
  5. Stateful traits persist per-channel and update incrementally across conversations
**Plans**: TBD

### Phase 18: Skill Response
**Goal**: Skills defined as file-based folders activate against trait signals and modify prompt sections, style, and tool availability through layered effect merging
**Depends on**: Phase 17
**Requirements**: SKILL-01, SKILL-02, SKILL-03, SKILL-04
**Success Criteria** (what must be TRUE):
  1. A skill folder (SKILL.md + scripts/ + references/) with YAML frontmatter is loaded by SkillRegistry and its metadata is accessible at runtime
  2. SkillRegistry detects file changes and hot-reloads skill definitions without restarting the bot
  3. Skills activate when their declared trait-signal conditions match, supporting both declarative YAML conditions and programmatic activators
  4. When multiple skills activate simultaneously, their prompt injections and tool additions stack additively while style effects resolve by priority
**Plans**: TBD

### Phase 19: Integration & Validation
**Goal**: The full Trait-Skill pipeline is wired into ThinkActLoop, with example skills demonstrating end-to-end context-aware behavior adaptation
**Depends on**: Phase 18
**Requirements**: SKILL-05
**Success Criteria** (what must be TRUE):
  1. ThinkActLoop invokes TraitAnalyzer and SkillRegistry between buildView() and prompt rendering, with active skill effects reflected in the LLM call
  2. At least one example skill demonstrably changes bot behavior (prompt content, style, or available tools) based on detected trait signals in a real conversation flow
  3. Existing v1.0 functionality (willingness gate, tool calling, memory injection) continues working unchanged through the new pipeline
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 16 → 17 → 18 → 19

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation & Shared Model | v1.0 | 2/2 | Complete | 2026-02-17 |
| 2. Model Service & Providers | v1.0 | 3/3 | Complete | 2026-02-18 |
| 3. Horizon Context System | v1.0 | 3/3 | Complete | 2026-02-18 |
| 4. Prompt & Tool Services | v1.0 | 2/2 | Complete | 2026-02-18 |
| 5. Agent Core & Integration | v1.0 | 2/2 | Complete | 2026-02-18 |
| 6. Willingness & Polish | v1.0 | 2/2 | Complete | 2026-02-18 |
| 7. Core Wiring Fixes | v1.0 | 1/1 | Complete | 2026-02-19 |
| 8. Stream & Dead Code Cleanup | v1.0 | 2/2 | Complete | 2026-02-19 |
| 9. Dynamic Schema Linkage | v1.0 | 2/2 | Complete | 2026-02-19 |
| 10. Willingness System Migration | v1.0 | 2/2 | Complete | 2026-02-19 |
| 11. Horizon Context Filling | v1.0 | 1/1 | Complete | 2026-02-20 |
| 12. Memory & Prompt Snippets | v1.0 | 2/2 | Complete | 2026-02-20 |
| 13. Non-stream Path & Fallback | v1.0 | 2/2 | Complete | 2026-02-20 |
| 14. Provider Pattern & PLATFORM-01 | v1.0 | 1/1 | Complete | 2026-02-20 |
| 15. LLM Deferred Judgment & Config | v1.0 | 2/2 | Complete | 2026-02-20 |
| 16. PromptService Redesign + HorizonView | v2.0 | 2/2 | Complete | 2026-02-21 |
| 16.1. Percept Ownership & User Message Context Refactor | v2.0 | Complete    | 2026-02-21 | 2026-02-21 |
| 16.2. Percept Type Cleanup & Session Decoupling | 2/2 | Complete    | 2026-02-21 | - |
| 16.3. Tool Call Improve | v2.0 | 2/2 | Complete | 2026-02-22 |
| 16.4. Working Memory Improve | v2.0 | 1/2 | In Progress | - |
| 17. Trait Perception | v2.0 | 0/? | Not started | - |
| 18. Skill Response | v2.0 | 0/? | Not started | - |
| 19. Integration & Validation | v2.0 | 0/? | Not started | - |
