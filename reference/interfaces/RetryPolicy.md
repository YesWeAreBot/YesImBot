[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / RetryPolicy

# Interface: RetryPolicy

Defined in: [packages/core/src/services/model/config.ts:25](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/model/config.ts#L25)

定义重试策略

## Properties

### maxRetries

> **maxRetries**: `number`

Defined in: [packages/core/src/services/model/config.ts:27](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/model/config.ts#L27)

最大重试次数 (在同一模型上)

***

### onContentFailure

> **onContentFailure**: [`ContentFailureAction`](../enumerations/ContentFailureAction.md)

Defined in: [packages/core/src/services/model/config.ts:29](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/model/config.ts#L29)

内容验证失败时的动作
