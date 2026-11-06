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
