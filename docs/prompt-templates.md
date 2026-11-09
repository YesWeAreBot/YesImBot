# 提示词模板与扩展内容

系统预设可使用 `NATIVE_TOOL_CALLING` 区分本次请求的输出协议。开启原生工具时使用工具接口；切换到 JSON fallback 时，该值为 `false`。人格、语气和记忆规则放在条件分支外，两种模式都会保留。

```mustache
你的人格与交流规则……
{{#NATIVE_TOOL_CALLING}}
通过原生工具接口执行动作，使用 send_message 发送回复。
{{/NATIVE_TOOL_CALLING}}
{{^NATIVE_TOOL_CALLING}}
只输出包含 thoughts、actions 和 request_heartbeat 的 JSON 对象。
{{/NATIVE_TOOL_CALLING}}
```

除 LF/CRLF 换行差异外，完全匹配旧版内置默认系统预设的配置，会在加载时自动使用新版默认预设。自定义预设保持原文；如果原生工具模式仍要求输出 JSON actions，请按上述分支调整。修改过的旧默认预设也属于自定义预设。

消息正文、记忆、工具结果、日程和人物资料中的 `{{…}}` 均按原文保留，不会再次展开。`maxRenderDepth` 仅为兼容旧配置保留，不再让动态内容递归渲染。

扩展的 `prompt.inject(name, priority, callback)` 回调应返回已经准备好的文字。需要组合可信模板时，可注册模板后使用 `injectTemplate`，把用户或模型产生的内容放进数据字段：

```ts
prompt.registerTemplate("my-extension.summary", "当前安排：{{plan}}");
prompt.injectTemplate("my-extension", 10, "my-extension.summary", async () => ({
    plan: await readCurrentPlan(),
}));
```

这里仅解释注册模板本身。即使 `plan` 包含双大括号或不完整的模板语法，也会保留为普通文字。不要把用户正文或模型返回值拼入注册模板的源码。

## 上下文裁剪与工具历史

默认请求不包含内部裁剪报告。完整估算、删除计数和超软预算原因可在服务端调试日志“上下文裁剪”中查看。原样保存的旧默认用户模板也不会继续输出报告；自定义模板明确引用 `CONTEXT_BUDGET` 时保留该兼容能力，意味着这些内部统计将发送给主模型。报告中的 token 数是保守估算，事件数也不等于聊天消息数。

软预算只裁剪可替代的世界状态，不修改系统提示词或核心记忆。固定内容与必要来源已超过预算时，请求仍保留它们，并在服务端报告超预算。旧工具轨迹先于近期用户对话让出空间；同一执行中的工具结果和关联回执作为同一因果组保留。

模型历史不会重放原始思考或工具参数中的 `inner_thoughts`。同一次调用的结果已有观察记录时，不再重复展示框架回执；管理员或独立工具回执仍保留简洁结果。原始审计日志保持完整。实际机器人消息保留在对话中，已能逐段核对的发送动作只保留消息编号引用；没有确认消息或发送失败时仍保留动作记录。
