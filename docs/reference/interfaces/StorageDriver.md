[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / StorageDriver

# Interface: StorageDriver

Defined in: [packages/core/src/services/assets/types.ts:52](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/assets/types.ts#L52)

存储驱动接口

## Methods

### delete()

> **delete**(`id`): `Promise`\<`void`\>

Defined in: [packages/core/src/services/assets/types.ts:55](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/assets/types.ts#L55)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`void`\>

***

### read()

> **read**(`id`): `Promise`\<`Buffer`\<`ArrayBufferLike`\>\>

Defined in: [packages/core/src/services/assets/types.ts:54](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/assets/types.ts#L54)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`Buffer`\<`ArrayBufferLike`\>\>

***

### write()

> **write**(`id`, `buffer`): `Promise`\<`void`\>

Defined in: [packages/core/src/services/assets/types.ts:53](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/assets/types.ts#L53)

#### Parameters

##### id

`string`

##### buffer

`Buffer`

#### Returns

`Promise`\<`void`\>
