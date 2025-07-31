[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ToolCallResult

# Interface: ToolCallResult\<TResult\>

Defined in: [packages/core/src/services/extension/types.ts:62](https://github.com/YesWeAreBot/YesImBot/blob/f40a2c3f35bb44bbd9f41261b4cceea534e7e968/packages/core/src/services/extension/types.ts#L62)

工具调用结果

## Type Parameters

### TResult

`TResult` = `any`

## Properties

### error?

> `optional` **error**: `string`

Defined in: [packages/core/src/services/extension/types.ts:67](https://github.com/YesWeAreBot/YesImBot/blob/f40a2c3f35bb44bbd9f41261b4cceea534e7e968/packages/core/src/services/extension/types.ts#L67)

错误信息

***

### metadata?

> `optional` **metadata**: `Record`\<`string`, `any`\>

Defined in: [packages/core/src/services/extension/types.ts:71](https://github.com/YesWeAreBot/YesImBot/blob/f40a2c3f35bb44bbd9f41261b4cceea534e7e968/packages/core/src/services/extension/types.ts#L71)

附加元数据，如执行时间等

***

### result?

> `optional` **result**: `TResult`

Defined in: [packages/core/src/services/extension/types.ts:65](https://github.com/YesWeAreBot/YesImBot/blob/f40a2c3f35bb44bbd9f41261b4cceea534e7e968/packages/core/src/services/extension/types.ts#L65)

返回结果

***

### retryable?

> `optional` **retryable**: `boolean`

Defined in: [packages/core/src/services/extension/types.ts:69](https://github.com/YesWeAreBot/YesImBot/blob/f40a2c3f35bb44bbd9f41261b4cceea534e7e968/packages/core/src/services/extension/types.ts#L69)

是否可重试

***

### status

> **status**: `string`

Defined in: [packages/core/src/services/extension/types.ts:63](https://github.com/YesWeAreBot/YesImBot/blob/f40a2c3f35bb44bbd9f41261b4cceea534e7e968/packages/core/src/services/extension/types.ts#L63)
