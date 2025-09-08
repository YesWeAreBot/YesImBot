[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ChatRequestOptions

# Interface: ChatRequestOptions

Defined in: [packages/core/src/services/model/chat-model.ts:42](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/chat-model.ts#L42)

## Indexable

\[`key`: `string`\]: `any`

## Properties

### abortSignal?

> `optional` **abortSignal**: `AbortSignal`

Defined in: [packages/core/src/services/model/chat-model.ts:43](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/chat-model.ts#L43)

***

### messages

> **messages**: `Message`[]

Defined in: [packages/core/src/services/model/chat-model.ts:46](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/chat-model.ts#L46)

***

### onStreamStart()?

> `optional` **onStreamStart**: () => `void`

Defined in: [packages/core/src/services/model/chat-model.ts:44](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/chat-model.ts#L44)

#### Returns

`void`

***

### stream?

> `optional` **stream**: `boolean`

Defined in: [packages/core/src/services/model/chat-model.ts:47](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/chat-model.ts#L47)

***

### temperature?

> `optional` **temperature**: `number`

Defined in: [packages/core/src/services/model/chat-model.ts:48](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/chat-model.ts#L48)

***

### topP?

> `optional` **topP**: `number`

Defined in: [packages/core/src/services/model/chat-model.ts:49](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/chat-model.ts#L49)

***

### validation?

> `optional` **validation**: [`ValidationOptions`](ValidationOptions.md)

Defined in: [packages/core/src/services/model/chat-model.ts:45](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/chat-model.ts#L45)
