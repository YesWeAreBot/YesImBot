[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / SystemEventPayload

# Interface: SystemEventPayload

Defined in: [packages/core/src/services/worldstate/types.ts:362](https://github.com/YesWeAreBot/YesImBot/blob/7ef28a691ce81d31b3075d68b83f6c934b67bb24/packages/core/src/services/worldstate/types.ts#L362)

系统事件刺激的载荷。

## Properties

### details

> **details**: `any`

Defined in: [packages/core/src/services/worldstate/types.ts:366](https://github.com/YesWeAreBot/YesImBot/blob/7ef28a691ce81d31b3075d68b83f6c934b67bb24/packages/core/src/services/worldstate/types.ts#L366)

事件相关的详细信息

***

### eventType

> **eventType**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:364](https://github.com/YesWeAreBot/YesImBot/blob/7ef28a691ce81d31b3075d68b83f6c934b67bb24/packages/core/src/services/worldstate/types.ts#L364)

Koishi 内部事件类型，如 'guild-member-ban'

***

### message?

> `optional` **message**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:368](https://github.com/YesWeAreBot/YesImBot/blob/7ef28a691ce81d31b3075d68b83f6c934b67bb24/packages/core/src/services/worldstate/types.ts#L368)

[新增] 由系统预渲染的、用于给LLM阅读的自然语言消息
