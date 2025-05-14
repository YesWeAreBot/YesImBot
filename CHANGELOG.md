### 3d93844

refactor(middleware): 重构响应处理逻辑并优化消息处理流程

- 将 `LLMHandlingMiddleware` 重命名为 `ResponseHandlingMiddleware`，以更清晰地表达其职责
- 在 `CheckReplyConditionMiddleware` 中引入消息延迟处理和用户连续消息检测逻辑，避免重复处理
- 新增 `getMiddleware` 方法以支持中间件之间的协作
- 移除 `container.ts` 中未使用的导入，清理代码
- 更新版本号至 `3.0.0-alpha.6`

### d5ffd12

refactor(core): 重构核心模块，优化代码结构和功能

- 重构 `Memory.ts` 和 `Scenario.ts`，优化代码可读性
- 将 `cacheManager.ts` 重命名为 `cache.ts`，并优化代码结构
- 新增 `container.ts` 服务容器，提供依赖注入功能
- 新增多个中间件，包括 `ErrorHandling.ts`、`DatabaseStorage.ts`、`CheckReplyCondition.ts` 等
- 更新 `package.json` 版本号至 `3.0.0-alpha.4`
- 删除不再使用的 `extension.ts` 和 `cacheManager.ts`
- 优化 `config.ts` 配置项，简化设置并移除冗余配置
- 重构 `index.ts`，将主要逻辑移至 `Agent` 类中

### 5dabcd5

feat: 添加日期格式化功能并优化记忆模块

- 新增 `formatDate` 函数，支持自定义日期格式化
- 优化 `Memory` 模块，支持绑定记忆文件并自动创建目录
- 重构 `Scenario` 模块，改进历史记录加载和渲染逻辑
- 修复 `SearchConversation` 工具，支持按日期范围搜索消息


### 99ad6cb

为多个工具函数添加inner_thoughts和request_heartbeat参数

为`Execute`、`DeleteMsg`、`BanUser`、`Reaction`、`Essence`和`Poke`工具函数添加`inner_thoughts`和`request_heartbeat`参数，以支持对话中的内部思考和执行后的心跳请求功能。


### 81a7cb0

refactor(agent): 优化消息和工具调用记录的处理逻辑

1. 将消息和交互记录的类型定义提取到单独的类型声明中
2. 新增 `LAST_REPLY_TABLE` 用于记录上次回复时间
3. 优化 `Scenario` 类中的历史记录加载逻辑，支持按时间排序和标记已读状态
4. 更新日志消息格式，增加 `[Adapter]` 前缀