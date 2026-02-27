---
created: 2026-02-27T04:53:02.961Z
title: 探索更直观的人设自定义方式
area: core
files:
  - plugins/core/src/services/role.ts
---

## Problem

Phase 26 完全移除了 memory_block，由 RoleService 替代进行人设注入。当前存在以下痛点：

1. **单一 SOUL 注入点管理困难** — 所有人设内容集中在一个文件中，内容量大时难以组织和维护
2. **Skills 注入门槛高** — 通过 skills 向 SOUL/STYLE 注入人设属于高级功能，对普通用户不够友好
3. **缺少中间层方案** — 在"单文件全量配置"和"skills 编程注入"之间，缺少一个方便直观的自定义方式

## Solution

可能的方向（TBD）：

- **多文件人设片段** — 支持将人设拆分为多个文件（如 personality.md、speaking-style.md、background.md），RoleService 自动合并注入
- **结构化人设 Schema** — 在 Koishi 配置面板中提供分类字段（性格、语气、背景故事、禁忌话题等），用户通过表单填写
- **人设模板系统** — 提供预设模板 + 用户自定义覆盖，降低从零配置的门槛
- **分层注入** — base persona + overlay 机制，不同场景/群组可叠加不同人设片段
