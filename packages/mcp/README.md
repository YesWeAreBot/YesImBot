# YesImBot MCP 扩展插件

## 🎐 简介

MCP(Model Context Protocol)扩展插件为YesImBot提供了与外部MCP服务器的连接能力，支持SSE、HTTP和标准IO三种连接方式。

## 🎹 特性

- 支持多种连接方式：SSE、HTTP和标准IO
- 自动注册远程工具到YesImBot的工具系统
- 支持环境变量配置
- 自动重连机制

## 🌈 使用方法

### 安装

```bash
npm install koishi-plugin-yesimbot-extension-mcp
```

### 配置示例

```yaml
# koishi.yml
plugins:
    yesimbot-extension-mcp:
        mcpServers:
            - name: local-sse
              type: sse
              url: http://localhost:8080/sse
              environment:
                  API_KEY: your-api-key
            - name: local-stdio
              type: stdio
              command: python
              args:
                  - server.py
                  - --port=8080
```

## 🔧 配置解析

| 参数        | 类型   | 必填 | 说明                        |
| ----------- | ------ | ---- | --------------------------- |
| name        | string | 是   | 服务器名称                  |
| type        | enum   | 是   | 连接类型(sse/http/stdio)    |
| url         | string | 条件 | 当type为sse或http时必填     |
| command     | string | 条件 | 当type为stdio时必填         |
| args        | array  | 否   | 当type为stdio时的命令行参数 |
| environment | object | 否   | 环境变量键值对              |

## 📦 依赖

- @modelcontextprotocol/sdk
- koishi-plugin-yesimbot
