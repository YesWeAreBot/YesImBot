[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / StorageDriver

# Interface: StorageDriver

Defined in: [packages/core/src/services/assets/types.ts:33](https://github.com/YesWeAreBot/YesImBot/blob/0406fd67880597b4fffddeb19651df15b210fb4d/packages/core/src/services/assets/types.ts#L33)

存储驱动接口

## Methods

### delete()

> **delete**(`id`): `Promise`\<`void`\>

Defined in: [packages/core/src/services/assets/types.ts:36](https://github.com/YesWeAreBot/YesImBot/blob/0406fd67880597b4fffddeb19651df15b210fb4d/packages/core/src/services/assets/types.ts#L36)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`void`\>

***

### exists()

> **exists**(`id`): `Promise`\<`boolean`\>

Defined in: [packages/core/src/services/assets/types.ts:37](https://github.com/YesWeAreBot/YesImBot/blob/0406fd67880597b4fffddeb19651df15b210fb4d/packages/core/src/services/assets/types.ts#L37)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`boolean`\>

***

### read()

> **read**(`id`): `Promise`\<`Buffer`\<`ArrayBufferLike`\>\>

Defined in: [packages/core/src/services/assets/types.ts:35](https://github.com/YesWeAreBot/YesImBot/blob/0406fd67880597b4fffddeb19651df15b210fb4d/packages/core/src/services/assets/types.ts#L35)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`Buffer`\<`ArrayBufferLike`\>\>

***

### write()

> **write**(`id`, `buffer`): `Promise`\<`void`\>

Defined in: [packages/core/src/services/assets/types.ts:34](https://github.com/YesWeAreBot/YesImBot/blob/0406fd67880597b4fffddeb19651df15b210fb4d/packages/core/src/services/assets/types.ts#L34)

#### Parameters

##### id

`string`

##### buffer

`Buffer`

#### Returns

`Promise`\<`void`\>
