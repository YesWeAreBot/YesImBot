[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / RetryPolicy

# Interface: RetryPolicy

Defined in: [packages/core/src/services/model/config.ts:26](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/model/config.ts#L26)

定义重试策略

## Properties

### maxRetries

> **maxRetries**: `number`

Defined in: [packages/core/src/services/model/config.ts:28](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/model/config.ts#L28)

最大重试次数 (在同一模型上)

***

### onContentFailure

> **onContentFailure**: [`ContentFailureAction`](../enumerations/ContentFailureAction.md)

Defined in: [packages/core/src/services/model/config.ts:30](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/model/config.ts#L30)

内容验证失败时的动作
