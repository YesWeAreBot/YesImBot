# YesImBot / Athena

<div align="center">
    <img src="https://raw.githubusercontent.com/HydroGest/YesImBot/main/img/logo.png" width="60%" />

[![npm](https://img.shields.io/npm/v/koishi-plugin-yesimbot?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-yesimbot) [![MIT License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat)](http://choosealicense.com/licenses/mit/) ![Language](https://img.shields.io/badge/language-TypeScript-brightgreen) ![NPM Downloads](https://img.shields.io/npm/dw/koishi-plugin-yesimbot) [![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/MiaowFISH/YesImBot)

**✨ 机器壳，人类心。✨**

_让 AI 大模型自然融入群聊的智能机器人系统_

</div>

## 📖 项目简介

YesImBot (Athena) 是一个基于 [Koishi](https://koishi.chat/zh-CN/) 的智能聊天机器人系统，旨在让人工智能大模型能够自然地参与到群聊讨论中，模拟真实的人类互动体验。通过先进的意愿值系统、记忆管理和工具扩展，为用户提供更加人性化的 AI 交流体验。

## 🎯 核心特性

- **🧠 智能对话管理**：基于意愿值系统控制 Bot 的主动发言频率，模拟真实人类的交流模式
- **💾 记忆系统**：通过 Memory 和 Scenario 管理上下文，使机器人能够记住和理解对话历史
- **🔗 多适配器支持**：支持多种 LLM API（OpenAI、Cloudflare、Ollama 等），实现负载均衡和故障转移
- **🛠️ 可扩展的工具系统**：基于工具调用框架，允许机器人执行各种操作
- **🎭 自定义人格**：轻松定制 Bot 的名字、性格、响应模式等
- **📱 Web 管理界面**：提供直观的 Web 界面进行配置和管理
- **🔌 MCP 扩展支持**：支持 Model Context Protocol 扩展，实现更强大的功能集成

## 📦 功能与扩展

先安装核心插件，再按用途选择扩展。配置、管理指令与操作范围见[功能与管理入口](docs/feature-guide.md)。各包是否可独立升级，请以其兼容要求为准。

| 用途                                       | 包目录             | NPM 包名                                            |
| ------------------------------------------ | ------------------ | --------------------------------------------------- |
| 对话、回复调度、模型、工具及 L1/L2/L3 记忆 | `core`             | `koishi-plugin-yesimbot`                            |
| 人物画像、账号关联与审核                   | `person-memory`    | `koishi-plugin-yesimbot-extension-person-memory`    |
| 持久提醒（默认关闭）                       | `durable-tasks`    | `koishi-plugin-yesimbot-extension-durable-tasks`    |
| 好友、群和群成员名单查询                   | `onebot-directory` | `koishi-plugin-yesimbot-extension-onebot-directory` |
| 日程生成与查询                             | `daily-planner`    | `koishi-plugin-yesimbot-extension-daily-planner`    |
| 好感度                                     | `favor`            | `@yesimbot/koishi-plugin-favor`                     |
| 表情包管理                                 | `sticker-manager`  | `koishi-plugin-yesimbot-extension-sticker-manager`  |
| 语音合成                                   | `tts`              | `@yesimbot/koishi-plugin-tts`                       |
| 图片理解                                   | `vision-tools`     | `@yesimbot/koishi-plugin-vision-tools`              |
| 图片生成                                   | `rr3`              | `@yesimbot/koishi-plugin-rr3`                       |
| 代码块转图片                               | `code2image`       | `@yesimbot/koishi-plugin-code2image`                |
| 代码执行                                   | `code-executor`    | `@yesimbot/koishi-plugin-code-executor`             |
| 接入 MCP 工具                              | `mcp`              | `@yesimbot/koishi-plugin-mcp`                       |

核心插件包含 Koishi 控制台页面；无需安装独立的 `webui` 包。`yakumo-client` 是构建辅助包，不是聊天扩展。

## 📋 文档导航

除了文档站（[https://docs.yesimbot.chat/](https://docs.yesimbot.chat/)）的文档外，仓库内还有内置的文档可供参考：

| 文档类型        | 文件路径                                                                                         | 描述                                |
| --------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------- |
| 🎯 **核心功能** | [packages/core/README.md](packages/core/README.md)                                               | 核心插件的详细使用说明和配置指南    |
| 🔧 **扩展开发** | [packages/core/src/services/extension/README.md](packages/core/src/services/extension/README.md) | 扩展系统开发指南和 API 文档         |
| 🔌 **MCP 扩展** | [packages/mcp/README.md](packages/mcp/README.md)                                                 | Model Context Protocol 扩展使用说明 |
| 🧭 **功能导航** | [docs/feature-guide.md](docs/feature-guide.md)                                                   | 功能分类、指令入口和操作范围        |

## 🤝 贡献

我们欢迎所有形式的贡献！

### 贡献者

感谢所有贡献者们，是你们让 Athena 成为可能。

![contributors](https://contrib.rocks/image?repo=HydroGest/YesImBot)

## 💬 社区支持

- 🐛 **问题反馈**: [GitHub Issues](https://github.com/HydroGest/YesImBot/issues)
- 💬 **QQ 交流群**: [857518324](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=k3O5_1kNFJMERGxBOj1ci43jHvLvfru9&authKey=TkOxmhIa6kEQxULtJ0oMVU9FxoY2XNiA%2B7bQ4K%2FNx5%2F8C8ToakYZeDnQjL%2B31Rx%2B&noverify=0&group_code=857518324)

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
