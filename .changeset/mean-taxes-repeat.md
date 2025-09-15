---
"koishi-plugin-yesimbot-extension-daily-planner": patch
"koishi-plugin-yesimbot": patch
"@yesimbot/koishi-plugin-tts": patch
---

fix(core): 修复上下文处理中的异常捕获

- 过滤空行以优化日志读取
- 增加日志长度限制和定期清理历史数据功能

fix(core): 响应频道支持直接填写用户 ID

- closed [#152](https://github.com/YesWeAreBot/YesImBot/issues/152)

refactor(tts): 优化 TTS 适配器的停止逻辑和临时目录管理

refactor(daily-planner): 移除不必要的依赖和清理代码结构
