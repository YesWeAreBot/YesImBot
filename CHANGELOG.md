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
