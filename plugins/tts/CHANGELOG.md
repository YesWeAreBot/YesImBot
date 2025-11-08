# @yesimbot/koishi-plugin-tts

## 0.2.2

### Patch Changes

- 更新 IndexTTS2 配置，增加情感控制参数

## 0.2.1

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

## 0.2.0

### Minor Changes

- 拆分本地 open audio 适配器，支持官方 fish audio

## 0.1.0

### Minor Changes

- 支持 fish audio, 初步实现 index-tts2 适配器
