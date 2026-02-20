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

