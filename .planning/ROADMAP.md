# Roadmap: Athena (YesImBot v4)

## Milestones

- ✅ **v1.0 Foundation + Feature Parity** — Phases 1-15 (shipped 2026-02-21)
- ✅ **v2.0 Context-Aware Architecture** — Phases 16-19 (shipped 2026-02-23)
- ✅ **v2.1 Polish & Release Prep** — Phases 20-22 (shipped 2026-02-24)
- ✅ **v2.2 Runtime Optimization & Observability** — Phases 23-25 (shipped 2026-02-25)
- 🚧 **v2.3 Architecture Cleanup** — Phases 26-28 (in progress)

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

<details>
<summary>✅ v2.0 Context-Aware Architecture (Phases 16-19) — SHIPPED 2026-02-23</summary>

- [x] Phase 16: PromptService Redesign + HorizonView (2/2 plans) — completed 2026-02-21
- [x] Phase 16.1: Percept Ownership & User Message Context (2/2 plans) — completed 2026-02-21
- [x] Phase 16.2: Percept Type Cleanup & Session Decoupling (2/2 plans) — completed 2026-02-21
- [x] Phase 16.3: Tool Call Improve (2/2 plans) — completed 2026-02-22
- [x] Phase 16.4: Working Memory Improve (2/2 plans) — completed 2026-02-22
- [x] Phase 17: Trait Perception (2/2 plans) — completed 2026-02-22
- [x] Phase 18: Skill Response (2/2 plans) — completed 2026-02-22
- [x] Phase 19: Integration & Validation (2/2 plans) — completed 2026-02-22

</details>

<details>
<summary>✅ v2.1 Polish & Release Prep (Phases 20-22) — SHIPPED 2026-02-24</summary>

- [x] Phase 20: Injection Point Merge & Wrapper Elimination (2/2 plans) — completed 2026-02-23
- [x] Phase 21: Fixed-Role File Loading (2/2 plans) — completed 2026-02-23
- [x] Phase 22: Skill Enhancement & Tech Debt (2/2 plans) — completed 2026-02-24

</details>

<details>
<summary>✅ v2.2 Runtime Optimization & Observability (Phases 23-25) — SHIPPED 2026-02-25</summary>

- [x] Phase 23: Bug Fixes & Reliability (4/4 plans) — completed 2026-02-24
- [x] Phase 24: Observability (2/2 plans) — completed 2026-02-25
- [x] Phase 25: Optimization (2/2 plans) — completed 2026-02-25

</details>

### 🚧 v2.3 Architecture Cleanup (In Progress)

**Milestone Goal:** 简化内部架构——删除 memory_block 模块，消除 Scope 抽象改用裸字段，简化 Environment 构造

- [x] **Phase 26: Memory Cleanup** — Delete memory_block module and all its wiring (completed 2026-02-26)
- [x] **Phase 27: Scope Deletion & Module Migration** — Delete Scope interface, migrate all 13 files to bare fields (completed 2026-02-26)
- [x] **Phase 28: Environment Simplification & DB Schema** — Simplify Environment construction, migrate timeline schema (completed 2026-02-26)

## Phase Details

### Phase 26: Memory Cleanup
**Goal**: memory_block 模块从代码库中完全消失，PromptService 不再有 memory-block partial 和 memory 注入点的相关代码
**Depends on**: Phase 25 (v2.2 complete)
**Requirements**: MEM-01, MEM-02, MEM-03, MEM-04
**Success Criteria** (what must be TRUE):
  1. `core/src/services/memory/` 目录不存在（service.ts, types.ts, index.ts 全部删除）
  2. `core/src/index.ts` 中没有 MemoryService 插件注册和配置项
  3. 代码库中没有 `yesimbot.memory` 服务声明或依赖引用
  4. PromptService 中没有 "memory-block" partial 注册或 "memory" 注入点相关代码
  5. `yarn build` 通过，无 TypeScript 编译错误
**Plans**: TBD

### Phase 27: Scope Deletion & Module Migration
**Goal**: Scope 接口从代码库中完全消失，所有模块改用 `platform: string` + `channelId: string` 裸字段
**Depends on**: Phase 26
**Requirements**: CTX-01, CTX-02, CTX-03, CTX-04, CTX-05, CTX-06
**Success Criteria** (what must be TRUE):
  1. `Scope` 接口定义不存在于任何文件中
  2. Horizon 模块（service.ts, manager.ts, listener.ts, types.ts）所有 scope 参数改为裸字段
  3. Trait 模块（service.ts, detectors/scene.ts, detectors/heat.ts, types.ts）所有 scope 参数改为裸字段
  4. Skill 模块（service.ts）和 Agent/Plugin 模块（service.ts, types.ts）所有 scope 参数改为裸字段
  5. Percept 接口中 `scope: Scope` 字段替换为 `platform: string` + `channelId: string`
  6. `yarn build` 通过，无 TypeScript 编译错误
**Plans**: TBD

### Phase 28: Environment Simplification & DB Schema
**Goal**: Environment 构造不再经过 Scope 中间层，timeline 数据库 schema 使用独立的 platform + channelId 列
**Depends on**: Phase 27
**Requirements**: CTX-07, CTX-08
**Success Criteria** (what must be TRUE):
  1. Environment 构造函数直接接受 `platform` + `channelId` 参数，无 Scope→Environment 转换步骤
  2. timeline 数据库表中 scope JSON 列已替换为独立的 `platform` 和 `channelId` 列
  3. 现有 timeline 数据查询（按频道过滤）使用新列正常工作
  4. `yarn build` 通过，无 TypeScript 编译错误
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-15 | v1.0 | 29/29 | Complete | 2026-02-21 |
| 16-19 | v2.0 | 16/16 | Complete | 2026-02-23 |
| 20-22 | v2.1 | 6/6 | Complete | 2026-02-24 |
| 23-25 | v2.2 | 8/8 | Complete | 2026-02-25 |
| 26. Memory Cleanup | 2/2 | Complete    | 2026-02-26 | - |
| 27. Scope Deletion & Module Migration | 3/3 | Complete    | 2026-02-26 | - |
| 28. Environment Simplification & DB Schema | 1/1 | Complete   | 2026-02-26 | - |
