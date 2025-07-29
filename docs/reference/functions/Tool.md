[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / Tool

# Function: Tool()

> **Tool**\<`TParams`\>(`metadata`): (`target`, `propertyKey`, `descriptor`) => `void`

Defined in: [packages/core/src/services/extension/decorators.ts:104](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/extension/decorators.ts#L104)

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
