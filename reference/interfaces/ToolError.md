[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ToolError

# Interface: ToolError

Defined in: [packages/core/src/services/extension/types.ts:62](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/extension/types.ts#L62)

标准化的工具错误接口

## Properties

### message

> **message**: `string`

Defined in: [packages/core/src/services/extension/types.ts:66](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/extension/types.ts#L66)

人类可读的错误信息

***

### name

> **name**: `string`

Defined in: [packages/core/src/services/extension/types.ts:64](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/extension/types.ts#L64)

错误的类型或名称 (例如: 'ValidationError', 'APIFailure', 'RuntimeError')

***

### retryable?

> `optional` **retryable**: `boolean`

Defined in: [packages/core/src/services/extension/types.ts:68](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/extension/types.ts#L68)

错误是否可重试
