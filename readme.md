# YesImBot / Athena

<div align="center">
    <img src="https://raw.githubusercontent.com/HydroGest/YesImBot/main/img/logo.png" width="60%" />

[![npm](https://img.shields.io/npm/v/koishi-plugin-yesimbot?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-yesimbot) [![MIT License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat)](http://choosealicense.com/licenses/mit/) ![Language](https://img.shields.io/badge/language-TypeScript-brightgreen) ![NPM Downloads](https://img.shields.io/npm/dw/koishi-plugin-yesimbot)

**✨ 机器壳，人类心。✨**

_让 AI 大模型自然融入群聊的智能机器人系统_

</div>

## 📖 项目简介

YesImBot (Athena) 是一个基于 [Koishi](https://koishi.chat/zh-CN/) 的智能聊天机器人系统，旨在让人工智能大模型能够自然地参与到群聊讨论中，模拟真实的人类互动体验。通过先进的意愿值系统、记忆管理和工具扩展，为用户提供更加人性化的 AI 交流体验。

## 🎯 核心特性

-   **🧠 智能对话管理**：基于意愿值系统控制 Bot 的主动发言频率，模拟真实人类的交流模式
-   **💾 记忆系统**：通过 Memory 和 Scenario 管理上下文，使机器人能够记住和理解对话历史
-   **🔗 多适配器支持**：支持多种 LLM API（OpenAI、Cloudflare、Ollama 等），实现负载均衡和故障转移
-   **🛠️ 可扩展的工具系统**：基于工具调用框架，允许机器人执行各种操作
-   **🎭 自定义人格**：轻松定制 Bot 的名字、性格、响应模式等
-   **📱 Web 管理界面**：提供直观的 Web 界面进行配置和管理
-   **🔌 MCP 扩展支持**：支持 Model Context Protocol 扩展，实现更强大的功能集成

## 📦 项目结构

本项目采用 monorepo 架构，包含以下主要包：

```
YesImBot/
├── packages/
│   ├── core/          # 🎯 核心插件包
│   ├── mcp/           # 🔌 MCP扩展包
│   └── webui/         # 📱 Web管理界面
├── package.json       # 项目根配置
└── README.md          # 项目说明
```

### 📦 包说明

| 包名      | 描述                        | NPM 包名                               |
| --------- | --------------------------- | -------------------------------------- |
| **core**  | 核心聊天机器人功能          | `koishi-plugin-yesimbot`               |
| **mcp**   | Model Context Protocol 扩展 | `koishi-plugin-yesimbot-extension-mcp` |
| **webui** | Web 管理界面                | _开发中_                               |

## 📋 文档导航

除了文档站（[https://docs.yesimbot.chat/](https://docs.yesimbot.chat/)）的文档外，仓库内还有内置的文档可供参考：

| 文档类型        | 文件路径                                                                         | 描述                                |
| --------------- | -------------------------------------------------------------------------------- | ----------------------------------- |
| 🎯 **核心功能** | [packages/core/README.md](packages/core/README.md)                               | 核心插件的详细使用说明和配置指南    |
| 🏗️ **架构设计** | [packages/core/DESIGN.md](packages/core/DESIGN.md)                               | 系统架构、中间件设计和核心组件说明  |
| 🔧 **扩展开发** | [packages/core/src/extensions/README.md](packages/core/src/extensions/README.md) | 扩展系统开发指南和 API 文档         |
| 🔌 **MCP 扩展** | [packages/mcp/README.md](packages/mcp/README.md)                                 | Model Context Protocol 扩展使用说明 |
| 📱 **Web 界面** | [packages/webui/README.md](packages/webui/README.md)                             | Web 管理界面使用和开发文档          |

## 🤝 贡献

我们欢迎所有形式的贡献！

### 贡献者

感谢所有贡献者们，是你们让 Athena 成为可能。

![contributors](https://contrib.rocks/image?repo=HydroGest/YesImBot)

## 💬 社区支持

-   🐛 **问题反馈**: [GitHub Issues](https://github.com/HydroGest/YesImBot/issues)
-   💬 **QQ 交流群**: [857518324](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=k3O5_1kNFJMERGxBOj1ci43jHvLvfru9&authKey=TkOxmhIa6kEQxULtJ0oMVU9FxoY2XNiA%2B7bQ4K%2FNx5%2F8C8ToakYZeDnQjL%2B31Rx%2B&noverify=0&group_code=857518324)

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🌟 支持项目

如果这个项目对您有帮助，请考虑给我们一个 ⭐️！

## ⭐ Star 历史

[![Athena/YesImBot Star 历史图表](https://api.star-history.com/svg?repos=Hydrogest/Yesimbot&type=Date)](https://star-history.com/#Hydrogest/Yesimbot&Date)

---

<div align="center">

**让 AI 更像人类，让聊天更有温度** 💝

</div>
