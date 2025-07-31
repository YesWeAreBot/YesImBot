[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / Tool

# Function: Tool()

> **Tool**\<`TParams`\>(`metadata`): (`target`, `propertyKey`, `descriptor`) => `void`

Defined in: [packages/core/src/services/extension/decorators.ts:113](https://github.com/YesWeAreBot/YesImBot/blob/d2253e77ca577ebc8cece14ecd60820dcfb9833e/packages/core/src/services/extension/decorators.ts#L113)

## Type Parameters

### TParams

`TParams`

## Parameters

### metadata

[`ToolMetadata`](../interfaces/ToolMetadata.md)\<`TParams`\>

工具的元数据

## Returns

> (`target`, `propertyKey`, `descriptor`): `void`

### Parameters

#### target

`any`

#### propertyKey

`string`

#### descriptor

`TypedPropertyDescriptor`\<(`args`) => `Promise`\<`any`\>\>

### Returns

`void`

## Tool

方法装饰器
用于将一个类方法声明为"工具"。
