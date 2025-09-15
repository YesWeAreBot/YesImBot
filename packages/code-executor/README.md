# YesImBot 扩展插件：代码执行器 (Code Executor)

[![npm](https://img.shields.io/npm/v/@yesimbot/koishi-plugin-code-executor.svg)](https://www.npmjs.com/package/@yesimbot/koishi-plugin-code-executor)
[![license](https://img.shields.io/npm/l/@yesimbot/koishi-plugin-code-executor.svg)](https://www.npmjs.com/package/@yesimbot/koishi-plugin-code-executor)

为 [YesImBot](https://github.com/YesWeAreBot/YesImBot) 提供一个**安全、隔离、功能强大**的 Python 代码执行环境。

这个插件允许 AI 智能体编写并执行代码来完成复杂的任务，例如：

- 进行精确的数学计算和数据分析
- 调用外部 API 获取实时信息
- 处理和转换文本或数据
- 执行任何可以通过编程逻辑实现的复杂工作流

所有代码都在一个受限的沙箱环境中运行，确保了主系统的安全

## ✨ 主要特性

- **🔒 安全至上**: 基于 `pyodide` 构建隔离沙箱，有效防止恶意代码访问文件系统、子进程或不安全的内置模块。
- **🧩 无缝集成 YesImBot**: 作为 `yesimbot` 的扩展插件自动注册，其工具（`execute_python`）会直接添加到智能体的可用工具集中。
- **📦 动态依赖管理**: 智能体可以通过 `import` 语法请求外部模块。插件会自动解析并安装在白名单内的依赖。
- **⚙️ 高度可配置**: 管理员可以通过白名单精确控制允许使用的内置模块和第三方模块。
- **⏱️ 超时与保护**: 对每一次代码执行都设置了超时限制，有效防止因死循环或长时间运行的任务而导致的资源耗尽。
- **🤖 AI 友好反馈**: 当代码执行失败时，插件会返回清晰的错误信息和**可行动的修复建议**，引导 AI 智能体自我修正代码，提高任务成功率。
- **⚡️ 结果缓存**: 可选的执行结果缓存功能，对于重复执行相同代码的场景，可以秒速返回结果，降低延迟和资源消耗。
