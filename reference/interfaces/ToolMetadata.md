[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ToolMetadata

# Interface: ToolMetadata\<TParams\>

Defined in: [packages/core/src/services/extension/types.ts:41](https://github.com/YesWeAreBot/YesImBot/blob/3710100a530c2f8760188c4d2983966d4a0de073/packages/core/src/services/extension/types.ts#L41)

工具元数据接口，用于描述一个可供 LLM 调用的工具。

## Type Parameters

### TParams

`TParams`

## Properties

### description

> **description**: `string`

Defined in: [packages/core/src/services/extension/types.ts:43](https://github.com/YesWeAreBot/YesImBot/blob/3710100a530c2f8760188c4d2983966d4a0de073/packages/core/src/services/extension/types.ts#L43)

***

### isSupported()?

> `optional` **isSupported**: (`session`) => `boolean`

Defined in: [packages/core/src/services/extension/types.ts:45](https://github.com/YesWeAreBot/YesImBot/blob/3710100a530c2f8760188c4d2983966d4a0de073/packages/core/src/services/extension/types.ts#L45)

#### Parameters

##### session

`Session`

#### Returns

`boolean`

***

### name?

> `optional` **name**: `string`

Defined in: [packages/core/src/services/extension/types.ts:42](https://github.com/YesWeAreBot/YesImBot/blob/3710100a530c2f8760188c4d2983966d4a0de073/packages/core/src/services/extension/types.ts#L42)

***

### parameters

> **parameters**: `Schema`\<`TParams`\>

Defined in: [packages/core/src/services/extension/types.ts:44](https://github.com/YesWeAreBot/YesImBot/blob/3710100a530c2f8760188c4d2983966d4a0de073/packages/core/src/services/extension/types.ts#L44)
