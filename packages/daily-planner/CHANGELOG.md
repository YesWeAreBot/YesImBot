# koishi-plugin-yesimbot-extension-daily-planner

## 0.1.1

### Patch Changes

- 018350c: fix(core): 修复上下文处理中的异常捕获
    - 过滤空行以优化日志读取
    - 增加日志长度限制和定期清理历史数据功能

    fix(core): 响应频道支持直接填写用户 ID
    - closed [#152](https://github.com/YesWeAreBot/YesImBot/issues/152)

    refactor(tts): 优化 TTS 适配器的停止逻辑和临时目录管理

    refactor(daily-planner): 移除不必要的依赖和清理代码结构

- 018350c: refactor(logger): 更新日志记录方式，移除对 Logger 服务的直接依赖
- Updated dependencies [018350c]
- Updated dependencies [018350c]
    - koishi-plugin-yesimbot@3.0.2

## 0.1.0

### Minor Changes

- 0c77684: prerelease

### Patch Changes

- Updated dependencies [b74e863]
- Updated dependencies [106be97]
- Updated dependencies [1cc0267]
- Updated dependencies [b852677]
    - koishi-plugin-yesimbot@3.0.0
