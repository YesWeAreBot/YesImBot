[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / RetryPolicy

# Interface: RetryPolicy

Defined in: [packages/core/src/services/model/config.ts:24](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/config.ts#L24)

定义重试策略

## Properties

### maxRetries

> **maxRetries**: `number`

Defined in: [packages/core/src/services/model/config.ts:26](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/config.ts#L26)

最大重试次数 (在同一模型上)

***

### onContentFailure

> **onContentFailure**: [`ContentFailureAction`](../enumerations/ContentFailureAction.md)

Defined in: [packages/core/src/services/model/config.ts:28](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/config.ts#L28)

内容验证失败时的动作
