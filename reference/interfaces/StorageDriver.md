[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / StorageDriver

# Interface: StorageDriver

Defined in: [packages/core/src/services/assets/types.ts:42](https://github.com/YesWeAreBot/YesImBot/blob/55a8abc008dec0156f9206604fa4b847d22615e1/packages/core/src/services/assets/types.ts#L42)

存储驱动接口

## Methods

### delete()

> **delete**(`id`): `Promise`\<`void`\>

Defined in: [packages/core/src/services/assets/types.ts:45](https://github.com/YesWeAreBot/YesImBot/blob/55a8abc008dec0156f9206604fa4b847d22615e1/packages/core/src/services/assets/types.ts#L45)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`void`\>

***

### exists()

> **exists**(`id`): `Promise`\<`boolean`\>

Defined in: [packages/core/src/services/assets/types.ts:46](https://github.com/YesWeAreBot/YesImBot/blob/55a8abc008dec0156f9206604fa4b847d22615e1/packages/core/src/services/assets/types.ts#L46)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`boolean`\>

***

### getStats()?

> `optional` **getStats**(`id`): `Promise`\<[`FileStats`](FileStats.md)\>

Defined in: [packages/core/src/services/assets/types.ts:47](https://github.com/YesWeAreBot/YesImBot/blob/55a8abc008dec0156f9206604fa4b847d22615e1/packages/core/src/services/assets/types.ts#L47)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<[`FileStats`](FileStats.md)\>

***

### listFiles()?

> `optional` **listFiles**(): `Promise`\<`string`[]\>

Defined in: [packages/core/src/services/assets/types.ts:48](https://github.com/YesWeAreBot/YesImBot/blob/55a8abc008dec0156f9206604fa4b847d22615e1/packages/core/src/services/assets/types.ts#L48)

#### Returns

`Promise`\<`string`[]\>

***

### read()

> **read**(`id`): `Promise`\<`Buffer`\<`ArrayBufferLike`\>\>

Defined in: [packages/core/src/services/assets/types.ts:44](https://github.com/YesWeAreBot/YesImBot/blob/55a8abc008dec0156f9206604fa4b847d22615e1/packages/core/src/services/assets/types.ts#L44)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`Buffer`\<`ArrayBufferLike`\>\>

***

### write()

> **write**(`id`, `buffer`): `Promise`\<`void`\>

Defined in: [packages/core/src/services/assets/types.ts:43](https://github.com/YesWeAreBot/YesImBot/blob/55a8abc008dec0156f9206604fa4b847d22615e1/packages/core/src/services/assets/types.ts#L43)

#### Parameters

##### id

`string`

##### buffer

`Buffer`

#### Returns

`Promise`\<`void`\>
