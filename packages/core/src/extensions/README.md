# Athena 扩展开发指南

## 目录
1. 扩展概述
2. 开发准备
3. 扩展结构
4. 开发示例
5. 发布与安装

## 扩展概述

Athena 扩展系统允许开发者为大模型添加新的功能能力。每个扩展都是一个独立的 TypeScript/JavaScript 文件，可以通过装饰器定义函数名、描述和参数，供大模型调用。

## 开发准备

开发环境要求：
- 带有 Athena 的 Koishi 开发环境
- 代码编辑器 (推荐 VS Code)

## 扩展结构

### 1. 基本结构

每个扩展文件需要包含以下基本要素：

````typescript
// ==Extension==
// @name         扩展名称
// @version      版本号
// @description  扩展描述
// @author       作者名
// ==/Extension==

import { Description, Extension, Name, Param } from "./base";

@Name("function-name")
@Description("功能描述")
@Param("param-name", "参数描述")
export class YourExtension extends Extension {
    async apply(args: { /* 参数类型定义 */ }) {
        // 实现逻辑
    }
}
````

### 2. 元数据说明

头部注释中的元数据是必需的，包括：
- `@name`: 扩展显示名称
- `@version`: 版本号 (语义化版本)
- `@description`: 扩展功能描述
- `@author`: 开发者信息

### 3. 装饰器说明

- `@Name`: 定义函数名，这是大模型调用时使用的名称
- `@Description`: 功能描述，帮助大模型理解该功能的用途
- `@Param`: 定义参数，包括参数名和描述

### 4. 行为说明

#### 加载流程
1. 扩展加载后，Athena 会提取：
  - 函数名称
  - 功能描述
  - 参数描述
2. 这些信息会被添加到系统提示词中

#### 执行流程
1. 当大模型回复包含扩展定义的函数名和参数时，Athena 会执行对应函数
2. 函数执行后：
  - 如果有返回值，会生成包含返回值和函数 id 的 ToolMessage
  - ToolMessage 会被添加到上下文中
  - Athena 会再次尝试生成一次回复

#### 注意事项
- 扩展函数的返回值必须是`string`类型
- 返回其他类型可能导致错误

## 开发示例

### 基础示例

下面是一个简单的扩展示例：

````typescript
// ==Extension==
// @name         示例扩展
// @version      1.0.0
// @description  这是一个示例扩展
// @author       YourName
// ==/Extension==

import { Description, Extension, Name, Param } from "./base";
import { SchemaNode } from "../adapters/creators/schema";

@Name("greet")
@Description("向指定用户发送问候")
@Param("userid", SchemaNode.String("要问候的用户ID"))
@Param("message", SchemaNode.String("问候消息", "你好！"))
export class Greeting extends Extension {
    async apply(args: { userid: string; message: string }) {
        const { userid, message } = args;
        try {
            await this.session.bot.sendMessage(`private:${userid}`, message);
            this.ctx.logger.info(`已向 ${userid} 发送问候`);
        } catch (e) {
            this.ctx.logger.error(`发送问候失败: `, e.message);
        }
    }
}
````

### 可用的工具类

1. 会话相关 (`this.session`):
- `bot`: 机器人实例
- `guildId`: 当前群组ID
- `channelId`: 当前频道ID
- 更多请参阅 Koishi 文档

2. 上下文相关 (`this.ctx`):
- `logger`: 日志工具
- `memory`: 记忆工具

3. 机器人相关 (`this.bot`):
...

## 发布与安装

### 1. 发布到 GitHub

1. 创建一个公开仓库
2. 上传你的扩展文件（.ts 或编译后的 .js）

### 2. 用户安装方式

用户可以使用以下命令安装扩展：

```bash
# 基础安装
安装扩展 https://raw.githubusercontent.com/username/repo/main/ext_example.js

# 指定文件名安装
安装扩展 https://raw.githubusercontent.com/username/repo/main/ext_example.js -f custom_name
```

### 3. 最佳实践

1. 提供完整的文档说明
2. 记录依赖关系
3. 提供使用示例
4. 添加错误处理
5. 使用 TypeScript 开发以获得更好的类型支持

### 4. 发布检查清单

- [ ] 完整的元数据信息
- [ ] 清晰的功能描述
- [ ] 所有参数都有说明
- [ ] 适当的错误处理
- [ ] 编译通过的 JavaScript 文件
- [ ] README 文档

## 其他说明

1. 扩展文件命名必须以 `ext_` 开头
2. 建议使用 TypeScript 开发以获得更好的类型提示
3. 遵循异步编程最佳实践
4. 注意错误处理和日志记录
