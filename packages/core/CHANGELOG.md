# koishi-plugin-yesimbot

## 3.0.2

### Patch Changes

- 018350c: fix(core): 修复上下文处理中的异常捕获
    - 过滤空行以优化日志读取
    - 增加日志长度限制和定期清理历史数据功能

    fix(core): 响应频道支持直接填写用户 ID
    - closed [#152](https://github.com/YesWeAreBot/YesImBot/issues/152)

    refactor(tts): 优化 TTS 适配器的停止逻辑和临时目录管理

    refactor(daily-planner): 移除不必要的依赖和清理代码结构

- 018350c: refactor(logger): 更新日志记录方式，移除对 Logger 服务的直接依赖

## 3.0.1

### Patch Changes

- e6fd019: 修复配置迁移脚本

## 3.0.0

### Patch Changes

- b74e863: use koishi-plugin-sharp
- 106be97: use puppeteer
- 1cc0267: use changesets to manage version
- b852677: 新增流式心跳处理功能，支持实时解析和执行动作
