### 3.0.0-alpha.16
fix: 修复语言文件导入问题
refactor(core): 重构工具管理器为插件服务并优化代码结构
- 将 ToolManager 重构为 Koishi 插件服务，移除单例模式，通过 Context 注入使用
- 优化工具定义和执行逻辑，增强类型安全性和可维护性
- 统一工具参数命名规范，修复内置工具的参数校验问题
- 添加多语言支持文件并整理代码格式

### 3.0.0-alpha.15
refactor(embeddings): 重构嵌入功能到适配器模块
fix(command): 添加参数验证
fix(extension): 修复扩展导入路径
fix(tool): 修复内置工具
feat(config): 增加最大心跳次数
feat: 优化场景管理和响应处理逻辑
- 在ResponseHandling中跳过send_message函数的交互记录
- 修改CheckReplyCondition以支持频道分组和动态回复概率
- 重构Scenario类，改进消息存储和渲染逻辑
- 在LLMProcessing中添加多频道场景渲染支持
- 增强ScenarioManager的多场景协同处理能力

### 3.0.0-alpha.14
feat: 重构场景管理和平台适配逻辑

主要变更：
1. 新增 ScenarioManager 服务集中管理场景生命周期和缓存
2. 添加 PlatformAdapter 接口实现多平台信息适配
3. 优化交互记录处理，新增 emitter_channel_id 字段
4. 重构错误处理中间件的日志输出格式
5. 移除冗余代码，改进 LLM 处理中间件的适配器切换逻辑

重构动机：
- 将场景管理逻辑从 MessageContext 解耦，提升可维护性
- 支持更灵活的多平台信息获取
- 优化交互记录的存储和查询效率
- 提供更清晰的错误日志和重试机制

### 3.0.0-alpha.13

- feat(adapter): 添加更多适配器支持
- feat(prompt): 优化 Prompt 试图解决刷屏与复读问题
- feat(processor): 使用 MD5 作为图片缓存键
- 将消息 ID 添加到上下文中
- feat(adapter): 支持设置代理服务器
- feat(adapter): 请求失败切换下一个 API

### 3.0.0-alpha.12

- fix: 修复响应失败后没有重置状态

### 3.0.0-alpha.11

- 为API和工具添加超时和重试机制
- 允许配置重试次数
- 优化初始化流程
- 增加对图片消息的处理

### 3.0.0-alpha.10

- refactor(middleware): 优化CheckReplyConditionMiddleware的回复逻辑
  - 不同用户有不同的回复阈值，优先级高的用户更容易获得回复
  - 根据历史互动质量自动调整用户优先级
  - 用户不仅影响个人意愿值，也对频道整体意愿有贡献
- feat(command): 添加清除上下文，图片缓存，扩展管理指令
- feat: 将YesImBot注册为服务

### 3.0.0-alpha.9

- fix(core): 修复响应失败后不会再次触发回复的问题
- feat(tools): 将扩展移动到builtin
- fix: 更改错误上报地址

### 3.0.0-alpha.8

- feat(tools): 修正工具参数
