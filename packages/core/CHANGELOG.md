# Changelog

## 3.0.5

### Patch Changes

- - feat: 新增可选的 TypeSafe 接话意愿判断（模式/API/模型/影响力等均可配置，默认关闭）
  - feat: 新增 Jev（System One）集成——置信度门控、附加 Choice/Score/Noul 原子问题、回复质量门禁，全部配置可选且默认关闭
  - fix: 保留模型上下文中的原生引用消息（quote/at 元素），避免引用内容被剥离（#187）
  - fix: 序列化 3.0.3 调度器的待发送消息并适配当前消息策略，防止重复发送（#191）
  - fix: v3 代码审查修复——bot 昵称取值、TypeSafe 异常处理、lint 与文档清理

## 3.0.4

### Patch Changes

- 25aafc5: fix: 修复意愿计算、发送失败处理与视觉空响应，并补齐 Docker 部署依赖

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
