[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / StorageDriver

# Interface: StorageDriver

Defined in: [packages/core/src/services/assets/types.ts:52](https://github.com/YesWeAreBot/YesImBot/blob/61974070b8a0960f92d55b24b168032ee3547a7a/packages/core/src/services/assets/types.ts#L52)

存储驱动接口

## Methods

### delete()

> **delete**(`id`): `Promise`\<`void`\>

Defined in: [packages/core/src/services/assets/types.ts:55](https://github.com/YesWeAreBot/YesImBot/blob/61974070b8a0960f92d55b24b168032ee3547a7a/packages/core/src/services/assets/types.ts#L55)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`void`\>

***

### read()

> **read**(`id`): `Promise`\<`Buffer`\<`ArrayBufferLike`\>\>

Defined in: [packages/core/src/services/assets/types.ts:54](https://github.com/YesWeAreBot/YesImBot/blob/61974070b8a0960f92d55b24b168032ee3547a7a/packages/core/src/services/assets/types.ts#L54)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`Buffer`\<`ArrayBufferLike`\>\>

***

### write()

> **write**(`id`, `buffer`): `Promise`\<`void`\>

Defined in: [packages/core/src/services/assets/types.ts:53](https://github.com/YesWeAreBot/YesImBot/blob/61974070b8a0960f92d55b24b168032ee3547a7a/packages/core/src/services/assets/types.ts#L53)

#### Parameters

##### id

`string`

##### buffer

`Buffer`

#### Returns

`Promise`\<`void`\>
