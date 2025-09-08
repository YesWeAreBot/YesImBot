[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / MemoryBlock

# Class: MemoryBlock

Defined in: [packages/core/src/services/memory/memory-block.ts:16](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/memory/memory-block.ts#L16)

## Accessors

### content

#### Get Signature

> **get** **content**(): `string`

Defined in: [packages/core/src/services/memory/memory-block.ts:50](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/memory/memory-block.ts#L50)

##### Returns

`string`

***

### currentSize

#### Get Signature

> **get** **currentSize**(): `number`

Defined in: [packages/core/src/services/memory/memory-block.ts:56](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/memory/memory-block.ts#L56)

##### Returns

`number`

***

### description

#### Get Signature

> **get** **description**(): `string`

Defined in: [packages/core/src/services/memory/memory-block.ts:47](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/memory/memory-block.ts#L47)

##### Returns

`string`

***

### filePath

#### Get Signature

> **get** **filePath**(): `string`

Defined in: [packages/core/src/services/memory/memory-block.ts:59](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/memory/memory-block.ts#L59)

##### Returns

`string`

***

### label

#### Get Signature

> **get** **label**(): `string`

Defined in: [packages/core/src/services/memory/memory-block.ts:44](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/memory/memory-block.ts#L44)

##### Returns

`string`

***

### lastModified

#### Get Signature

> **get** **lastModified**(): `Date`

Defined in: [packages/core/src/services/memory/memory-block.ts:53](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/memory/memory-block.ts#L53)

##### Returns

`Date`

***

### title

#### Get Signature

> **get** **title**(): `string`

Defined in: [packages/core/src/services/memory/memory-block.ts:41](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/memory/memory-block.ts#L41)

##### Returns

`string`

## Methods

### dispose()

> **dispose**(): `void`

Defined in: [packages/core/src/services/memory/memory-block.ts:65](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/memory/memory-block.ts#L65)

#### Returns

`void`

***

### startWatching()

> **startWatching**(): `Promise`\<`void`\>

Defined in: [packages/core/src/services/memory/memory-block.ts:97](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/memory/memory-block.ts#L97)

#### Returns

`Promise`\<`void`\>

***

### toData()

> **toData**(): [`MemoryBlockData`](../interfaces/MemoryBlockData.md)

Defined in: [packages/core/src/services/memory/memory-block.ts:69](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/memory/memory-block.ts#L69)

#### Returns

[`MemoryBlockData`](../interfaces/MemoryBlockData.md)

***

### createFromFile()

> `static` **createFromFile**(`ctx`, `filePath`): `Promise`\<`MemoryBlock`\>

Defined in: [packages/core/src/services/memory/memory-block.ts:140](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/memory/memory-block.ts#L140)

#### Parameters

##### ctx

`Context`

##### filePath

`string`

#### Returns

`Promise`\<`MemoryBlock`\>
