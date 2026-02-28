---
name: qmanager
description: 在群聊中且 bot 有管理员权限时，启用群管工具
lifecycle: trait-bound
conditions:
  and:
    - match:
        dimension: scene
        value: group-chat
    - or:
        - match:
            dimension: bot-role
            value: admin
        - match:
            dimension: bot-role
            value: owner
effects:
  tools:
    include:
      - delmsg
      - ban
      - kick
---

在群聊中且 bot 有管理员权限时，可以执行群管操作。典型场景：用户发布违规内容时撤回消息、刷屏骚扰时禁言、严重违规时踢出群组。不能对管理员和群主使用此操作。
