---
name: social-interactions
description: Enables reaction and poke tools in conversations
lifecycle: trait-bound
conditions:
  or:
    - match:
        dimension: scene
        value: group-chat
    - match:
        dimension: scene
        value: private-chat
effects:
  tools:
    include:
      - reaction_create
      - send_poke
---

可以使用社交互动工具。reaction_create 仅在群聊中有效（工具自身会检查），send_poke 在群聊和私聊均可使用。
