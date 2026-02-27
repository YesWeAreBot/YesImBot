---
name: search
description: Enables web search when user asks about current events or needs information lookup
lifecycle: sticky
stickyTimeout: 2
conditions:
  match:
    dimension: intent
    value: search
effects:
  tools:
    include:
      - search
---

当用户询问需要查找最新信息、新闻、事实核查或网络内容时，使用搜索工具获取相关信息。搜索后根据结果自然地回答用户的问题。
