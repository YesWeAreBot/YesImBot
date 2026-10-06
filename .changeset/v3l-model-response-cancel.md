---
"koishi-plugin-yesimbot": patch
---

拒绝缺少完成信号的流式模型响应，在工具执行前识别异常 EOF 并进入既有重试与备用模型路径。修复非 OneBot 回复在编码器 before-send 后取消仍发送的问题，保持普通指令、并发会话与适配器原始调用上下文。
