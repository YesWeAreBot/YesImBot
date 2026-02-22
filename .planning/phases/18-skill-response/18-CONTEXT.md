# Phase 18: Skill Response - Context

**Gathered:** 2026-02-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Skills defined as file-based folders or plugin-registered definitions activate against trait signals and modify prompt sections, style, and tool availability through layered effect merging. Plugin registration is the primary mechanism; file-based skills are a supplementary loading source.

</domain>

<decisions>
## Implementation Decisions

### Skill 文件夹结构
- Skill 发现机制接收多个来源：core 内置资源目录（随包分发）+ 用户自定义目录（运行时管理），不需要释放内置资源到用户目录
- SKILL.md 格式：YAML frontmatter 声明元信息和激活条件，Markdown 正文作为 prompt 内容
- scripts/ 目录放预编译 JS 文件（代码激活器、自定义效果逻辑）
- references/ 目录放 few-shot 示例对话（未来 RAG 支持后可扩展参考文档）

### 激活条件设计
- 声明式条件使用 AND/OR/NOT 逻辑组合表达式（非简单键值匹配）
- 代码激活器：scripts/ 中导出 `activate(signals) => boolean` 函数式接口
- 全局 confidence 阈值：低于阈值的 TraitSignal 视为不存在，不参与条件匹配

### 效果合并策略
- Prompt 层：按 injection point 叠加（复用 PromptService 现有机制）
- Style 层：按条件具体度覆盖（条件越具体优先级越高，类似 CSS specificity）
- Tools 层：支持 include/exclude 声明，exclude 优先

### 热重载行为
- 手动触发重载（不自动监听文件变化）
- 当前正在处理的请求不受影响，新请求使用新定义
- 格式错误的 Skill 文件跳过并记录日志，不影响其他 Skill

### 上下文呈现
- 带标记注入：LLM 可感知 Skill 来源（如 `<skill name="...">内容</skill>`）
- few-shot 示例按 token 预算截取（多 Skill 同时激活时控制总量）
- Style 效果通过 style injection point 体现

### 生命周期（Skill 激活持续时间）
- Skill 自声明持续策略，三种类型：
  - `per-turn`：每轮重新计算（适合场景类 Skill）
  - `sticky`：激活后保持 N 轮无相关活动才退出（适合指令级 Skill）
  - `trait-bound`：跟随 trait 信号存在而存在
- sticky 类型有全局默认超时轮数，Skill 可在 frontmatter 中覆盖

### 注册式 Skill（插件生态集成）
- 插件注册为主，文件夹为辅——两者共存于统一的 SkillRegistry
- API：`ctx.skillRegistry.register()` 注册 Skill 定义对象
- 注册式 Skill 完全访问 ctx 服务（数据库、HTTP、其他插件等）
- 跟随 Koishi ctx 生命周期自动清理（插件卸载时 Skill 自动移除）

### Claude's Discretion
- YAML 条件表达式的具体语法设计
- confidence 阈值的默认值
- 条件具体度（specificity）的计算算法
- sticky 默认超时轮数
- few-shot 截取策略的具体实现
- 文件夹式 Skill 到注册式 Skill 的内部转换机制

</decisions>

<specifics>
## Specific Ideas

- 指令级 Skill 场景：用户发送"生成图片 xxx"触发图片生成 Skill，第一次效果不满意时用户要求修改，Skill 需要跨轮保持（sticky 策略的核心用例）
- 插件注册式 Skill 的优势：scripts 不再是无状态的，可以通过 Koishi 服务进行配置，或连接其他服务和功能；可通过 Koishi 插件市场分发
- 注意：Koishi 中每条消息和事件都有独立 session，不存在"对话 session"概念，生命周期管理需基于 channel scope

</specifics>

<deferred>
## Deferred Ideas

- RAG 式参考文档查询（references/ 目录扩展）——等系统支持 RAG 后再添加
- Per-skill token 预算——需求文档已明确 out of scope，用 per-injection-point 预算替代
- 用户界面 Skill 开关——需求文档已明确 out of scope，自动激活即可

</deferred>

## 示例 Skill 规划

Phase 18 内置两个示例 Skill 验证完整体系：

1. **私聊模式 Skill**（场景类）
   - 持续策略：trait-bound（跟随 scene: private 信号）
   - 效果类型：style 覆盖（切换为更亲密/详细的回复风格）

2. **图片生成 Skill**（指令类）
   - 持续策略：sticky（激活后保持数轮）
   - 效果类型：tools include（注入图片生成工具）+ prompt 叠加（注入相关提示词）

---

*Phase: 18-skill-response*
*Context gathered: 2026-02-22*
