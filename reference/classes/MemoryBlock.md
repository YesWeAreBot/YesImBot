[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / MemoryBlock

# Class: MemoryBlock

Defined in: [packages/core/src/services/memory/MemoryBlock.ts:16](https://github.com/YesWeAreBot/YesImBot/blob/89fa0ef148d2b85a54c30fb720197559d83768ff/packages/core/src/services/memory/MemoryBlock.ts#L16)

## Accessors

### content

#### Get Signature

> **get** **content**(): `string`

Defined in: [packages/core/src/services/memory/MemoryBlock.ts:50](https://github.com/YesWeAreBot/YesImBot/blob/89fa0ef148d2b85a54c30fb720197559d83768ff/packages/core/src/services/memory/MemoryBlock.ts#L50)

##### Returns

`string`

***

### currentSize

#### Get Signature

> **get** **currentSize**(): `number`

Defined in: [packages/core/src/services/memory/MemoryBlock.ts:56](https://github.com/YesWeAreBot/YesImBot/blob/89fa0ef148d2b85a54c30fb720197559d83768ff/packages/core/src/services/memory/MemoryBlock.ts#L56)

##### Returns

`number`

***

### description

#### Get Signature

> **get** **description**(): `string`

Defined in: [packages/core/src/services/memory/MemoryBlock.ts:47](https://github.com/YesWeAreBot/YesImBot/blob/89fa0ef148d2b85a54c30fb720197559d83768ff/packages/core/src/services/memory/MemoryBlock.ts#L47)

##### Returns

`string`

***

### filePath

#### Get Signature

> **get** **filePath**(): `string`

Defined in: [packages/core/src/services/memory/MemoryBlock.ts:59](https://github.com/YesWeAreBot/YesImBot/blob/89fa0ef148d2b85a54c30fb720197559d83768ff/packages/core/src/services/memory/MemoryBlock.ts#L59)

##### Returns

`string`

***

### label

#### Get Signature

> **get** **label**(): `string`

Defined in: [packages/core/src/services/memory/MemoryBlock.ts:44](https://github.com/YesWeAreBot/YesImBot/blob/89fa0ef148d2b85a54c30fb720197559d83768ff/packages/core/src/services/memory/MemoryBlock.ts#L44)

##### Returns

`string`

***

### lastModified

#### Get Signature

> **get** **lastModified**(): `Date`

Defined in: [packages/core/src/services/memory/MemoryBlock.ts:53](https://github.com/YesWeAreBot/YesImBot/blob/89fa0ef148d2b85a54c30fb720197559d83768ff/packages/core/src/services/memory/MemoryBlock.ts#L53)

##### Returns

`Date`

***

### title

#### Get Signature

> **get** **title**(): `string`

Defined in: [packages/core/src/services/memory/MemoryBlock.ts:41](https://github.com/YesWeAreBot/YesImBot/blob/89fa0ef148d2b85a54c30fb720197559d83768ff/packages/core/src/services/memory/MemoryBlock.ts#L41)

##### Returns

`string`

## Methods

### dispose()

> **dispose**(): `void`

Defined in: [packages/core/src/services/memory/MemoryBlock.ts:65](https://github.com/YesWeAreBot/YesImBot/blob/89fa0ef148d2b85a54c30fb720197559d83768ff/packages/core/src/services/memory/MemoryBlock.ts#L65)

#### Returns

`void`

***

### startWatching()

> **startWatching**(): `Promise`\<`void`\>

Defined in: [packages/core/src/services/memory/MemoryBlock.ts:97](https://github.com/YesWeAreBot/YesImBot/blob/89fa0ef148d2b85a54c30fb720197559d83768ff/packages/core/src/services/memory/MemoryBlock.ts#L97)

#### Returns

`Promise`\<`void`\>

***

### toData()

> **toData**(): [`MemoryBlockData`](../interfaces/MemoryBlockData.md)

Defined in: [packages/core/src/services/memory/MemoryBlock.ts:69](https://github.com/YesWeAreBot/YesImBot/blob/89fa0ef148d2b85a54c30fb720197559d83768ff/packages/core/src/services/memory/MemoryBlock.ts#L69)

#### Returns

[`MemoryBlockData`](../interfaces/MemoryBlockData.md)

***

### createFromFile()

> `static` **createFromFile**(`ctx`, `filePath`): `Promise`\<`MemoryBlock`\>

Defined in: [packages/core/src/services/memory/MemoryBlock.ts:140](https://github.com/YesWeAreBot/YesImBot/blob/89fa0ef148d2b85a54c30fb720197559d83768ff/packages/core/src/services/memory/MemoryBlock.ts#L140)

#### Parameters

##### ctx

`Context`

##### filePath

`string`

#### Returns

`Promise`\<`MemoryBlock`\>
