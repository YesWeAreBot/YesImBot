[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ToolDefinition

# Interface: ToolDefinition\<TParams\>

Defined in: [packages/core/src/services/extension/types.ts:51](https://github.com/YesWeAreBot/YesImBot/blob/4e044b1ec2226c145f49107053f00a90b7003b02/packages/core/src/services/extension/types.ts#L51)

完整的工具定义，包含了元数据和可执行函数。

## Type Parameters

### TParams

`TParams` = `any`

## Properties

### description

> **description**: `string`

Defined in: [packages/core/src/services/extension/types.ts:53](https://github.com/YesWeAreBot/YesImBot/blob/4e044b1ec2226c145f49107053f00a90b7003b02/packages/core/src/services/extension/types.ts#L53)

***

### execute()

> **execute**: (`args`) => `Promise`\<`any`\>

Defined in: [packages/core/src/services/extension/types.ts:56](https://github.com/YesWeAreBot/YesImBot/blob/4e044b1ec2226c145f49107053f00a90b7003b02/packages/core/src/services/extension/types.ts#L56)

#### Parameters

##### args

[`Infer`](../type-aliases/Infer.md)\<`TParams`\>

#### Returns

`Promise`\<`any`\>

***

### isSupported()?

> `optional` **isSupported**: (`session`) => `boolean`

Defined in: [packages/core/src/services/extension/types.ts:55](https://github.com/YesWeAreBot/YesImBot/blob/4e044b1ec2226c145f49107053f00a90b7003b02/packages/core/src/services/extension/types.ts#L55)

#### Parameters

##### session

`Session`

#### Returns

`boolean`

***

### name

> **name**: `string`

Defined in: [packages/core/src/services/extension/types.ts:52](https://github.com/YesWeAreBot/YesImBot/blob/4e044b1ec2226c145f49107053f00a90b7003b02/packages/core/src/services/extension/types.ts#L52)

***

### parameters

> **parameters**: `Schema`\<`TParams`\>

Defined in: [packages/core/src/services/extension/types.ts:54](https://github.com/YesWeAreBot/YesImBot/blob/4e044b1ec2226c145f49107053f00a90b7003b02/packages/core/src/services/extension/types.ts#L54)
