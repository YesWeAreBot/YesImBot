[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ChatRequestOptions

# Interface: ChatRequestOptions

Defined in: [packages/core/src/services/model/chat-model.ts:15](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/model/chat-model.ts#L15)

Chat 方法的请求选项。
包含所有必要的聊天信息和可覆盖的运行时参数。

## Indexable

\[`key`: `string`\]: `any`

其他任何可以传递给聊天提供程序的参数

## Properties

### abortSignal?

> `optional` **abortSignal**: `AbortSignal`

Defined in: [packages/core/src/services/model/chat-model.ts:19](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/model/chat-model.ts#L19)

用于中止请求的 AbortSignal

***

### messages

> **messages**: `Message`[]

Defined in: [packages/core/src/services/model/chat-model.ts:17](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/model/chat-model.ts#L17)

聊天消息列表

***

### onStreamStart()?

> `optional` **onStreamStart**: () => `void`

Defined in: [packages/core/src/services/model/chat-model.ts:21](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/model/chat-model.ts#L21)

流式传输开始时的回调

#### Returns

`void`

***

### stream?

> `optional` **stream**: `boolean`

Defined in: [packages/core/src/services/model/chat-model.ts:27](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/model/chat-model.ts#L27)

是否使用流式传输。如果未提供，则使用模型配置的默认值。

***

### temperature?

> `optional` **temperature**: `number`

Defined in: [packages/core/src/services/model/chat-model.ts:29](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/model/chat-model.ts#L29)

温度参数

***

### topP?

> `optional` **topP**: `number`

Defined in: [packages/core/src/services/model/chat-model.ts:31](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/model/chat-model.ts#L31)

Top-P 采样参数
