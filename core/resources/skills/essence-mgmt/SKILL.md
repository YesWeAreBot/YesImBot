---
name: essence-mgmt
description: Enables essence management when bot has admin role in group chat
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
      - essence_create
      - essence_delete
---

在群聊中且 bot 有管理员权限时，可以设置或取消精华消息。仅对当前上下文中出现过的消息操作。
