[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / MemoryBlock

# Class: MemoryBlock

Defined in: [packages/core/src/services/memory/MemoryBlock.ts:10](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/MemoryBlock.ts#L10)

## Accessors

### content

#### Get Signature

> **get** **content**(): readonly `string`[]

Defined in: [packages/core/src/services/memory/MemoryBlock.ts:44](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/MemoryBlock.ts#L44)

##### Returns

readonly `string`[]

***

### currentSize

#### Get Signature

> **get** **currentSize**(): `number`

Defined in: [packages/core/src/services/memory/MemoryBlock.ts:50](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/MemoryBlock.ts#L50)

##### Returns

`number`

***

### description

#### Get Signature

> **get** **description**(): `string`

Defined in: [packages/core/src/services/memory/MemoryBlock.ts:41](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/MemoryBlock.ts#L41)

##### Returns

`string`

***

### filePath

#### Get Signature

> **get** **filePath**(): `string`

Defined in: [packages/core/src/services/memory/MemoryBlock.ts:53](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/MemoryBlock.ts#L53)

##### Returns

`string`

***

### label

#### Get Signature

> **get** **label**(): `string`

Defined in: [packages/core/src/services/memory/MemoryBlock.ts:38](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/MemoryBlock.ts#L38)

##### Returns

`string`

***

### lastModified

#### Get Signature

> **get** **lastModified**(): `Date`

Defined in: [packages/core/src/services/memory/MemoryBlock.ts:47](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/MemoryBlock.ts#L47)

##### Returns

`Date`

***

### title

#### Get Signature

> **get** **title**(): `string`

Defined in: [packages/core/src/services/memory/MemoryBlock.ts:35](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/MemoryBlock.ts#L35)

##### Returns

`string`

## Methods

### dispose()

> **dispose**(): `void`

Defined in: [packages/core/src/services/memory/MemoryBlock.ts:59](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/MemoryBlock.ts#L59)

#### Returns

`void`

***

### startWatching()

> **startWatching**(): `Promise`\<`void`\>

Defined in: [packages/core/src/services/memory/MemoryBlock.ts:91](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/MemoryBlock.ts#L91)

#### Returns

`Promise`\<`void`\>

***

### toData()

> **toData**(): [`MemoryBlockData`](../interfaces/MemoryBlockData.md)

Defined in: [packages/core/src/services/memory/MemoryBlock.ts:63](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/MemoryBlock.ts#L63)

#### Returns

[`MemoryBlockData`](../interfaces/MemoryBlockData.md)

***

### createFromFile()

> `static` **createFromFile**(`ctx`, `filePath`): `Promise`\<`MemoryBlock`\>

Defined in: [packages/core/src/services/memory/MemoryBlock.ts:134](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/MemoryBlock.ts#L134)

#### Parameters

##### ctx

`Context`

##### filePath

`string`

#### Returns

`Promise`\<`MemoryBlock`\>
