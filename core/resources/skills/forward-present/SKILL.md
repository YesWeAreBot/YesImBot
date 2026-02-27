---
name: forward-present
description: Enables reading forwarded message bundles when they appear in context
lifecycle: per-turn
conditions:
  match:
    dimension: has-forward
    value: "true"
effects:
  tools:
    include:
      - get_forward_msg
---

上下文中包含合并转发消息，可以使用 get_forward_msg 工具读取转发消息的具体内容。
